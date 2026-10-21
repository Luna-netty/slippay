import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A controllable stand-in for `Horizon.Server`: every call() pops the next page
// from a queue and records the (order, limit, cursor) the module asked with.
const hz = vi.hoisted(() => {
  const calls: { order: string; limit: number; cursor?: string }[] = [];
  let queue: any[] = [];
  const cur: { order: string; limit: number; cursor?: string } = { order: "asc", limit: 0 };
  const builder: any = {
    forAccount: () => builder,
    order: (o: string) => { cur.order = o; return builder; },
    limit: (n: number) => { cur.limit = n; return builder; },
    cursor: (c: string) => { cur.cursor = c; return builder; },
    call: async () => {
      const entry: { order: string; limit: number; cursor?: string } = { order: cur.order, limit: cur.limit };
      if (cur.cursor !== undefined) entry.cursor = cur.cursor;
      calls.push(entry);
      const page = queue.shift() ?? { records: [] };
      cur.order = "asc"; cur.limit = 0; delete cur.cursor;
      return page;
    },
  };
  const Server = class { constructor(_url: string) {} payments() { return builder; } };
  return {
    calls,
    Server,
    setQueue(q: any[]) { queue = q; },
    reset() { calls.length = 0; queue = []; cur.order = "asc"; cur.limit = 0; delete cur.cursor; },
  };
});

vi.mock("@stellar/stellar-sdk", () => ({ Horizon: { Server: hz.Server } }));
vi.mock("../src/matcher.js", () => ({ matchPaymentToOrder: vi.fn(() => ({ outcome: "ignore" })) }));
vi.mock("../src/reconciler.js", () => ({ reconcileMatch: vi.fn(async () => undefined) }));
vi.mock("../src/log.js", () => ({ log: vi.fn() }));

import { watchAccount } from "../src/horizon.js";

// --- db stub: enough of the Supabase chain for listener_state + orders -------
const stateRow = { current: null as null | { paging_token: string } };
const upserted: { account_id: string; paging_token: string }[] = [];

const db: any = {
  from: (table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      maybeSingle: () => Promise.resolve({ data: table === "listener_state" ? stateRow.current : null, error: null }),
      upsert: (row: any) => {
        if (table === "listener_state") upserted.push(row);
        return Promise.resolve({ error: null });
      },
    };
    return b;
  },
};

const ACCOUNT = "G" + "M".repeat(55);
const headPage = (token: string) => ({ records: [{ type: "payment", paging_token: token }] });

function paymentRecord(token: string) {
  return {
    type: "payment",
    paging_token: token,
    asset_code: "USDC",
    asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    to: ACCOUNT,
    amount: "1.0000000",
    transaction_hash: `hash-${token}`,
    transaction: async () => ({ memo_type: "hash", memo: Buffer.from("00".repeat(32), "hex").toString("base64"), successful: true }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  hz.reset();
  stateRow.current = null;
  upserted.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("watchAccount · resume cursor", () => {
  it("starts at the current head when no cursor is stored", async () => {
    hz.setQueue([headPage("100"), { records: [] }]);
    const stop = await watchAccount({ db, network: "TESTNET", accountId: ACCOUNT });
    await vi.advanceTimersByTimeAsync(0);

    expect(hz.calls[0]).toEqual({ order: "desc", limit: 1 });
    // The very first poll is anchored on the head token, and it ascends.
    expect(hz.calls[1]).toEqual({ order: "asc", limit: 200, cursor: "100" });
    stop();
  });

  it("resumes from the stored cursor instead of re-fetching head (no replay)", async () => {
    stateRow.current = { paging_token: "55" };
    hz.setQueue([{ records: [] }]);
    const stop = await watchAccount({ db, network: "TESTNET", accountId: ACCOUNT });
    await vi.advanceTimersByTimeAsync(0);

    expect(hz.calls).toHaveLength(1);
    expect(hz.calls[0]).toMatchObject({ order: "asc", cursor: "55" });
    expect(hz.calls.some((c) => c.order === "desc")).toBe(false);
    stop();
  });
});

describe("watchAccount · cursor paging (duplicate + out-of-order)", () => {
  it("advances the paging token monotonically and persists every record's token", async () => {
    stateRow.current = { paging_token: "10" };
    hz.setQueue([{ records: [paymentRecord("11"), paymentRecord("12")] }, { records: [] }]);
    const stop = await watchAccount({ db, network: "TESTNET", accountId: ACCOUNT });
    await vi.advanceTimersByTimeAsync(0);

    expect(upserted.map((u) => u.paging_token)).toEqual(["11", "12"]);
    expect(upserted.every((u) => u.account_id === ACCOUNT)).toBe(true);
    stop();
  });

  it("passes the last token as the next cursor, so a consumed page is not re-requested", async () => {
    stateRow.current = { paging_token: "12" };
    hz.setQueue([{ records: [paymentRecord("13")] }, { records: [] }]);
    const stop = await watchAccount({ db, network: "TESTNET", accountId: ACCOUNT });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4_000); // next poll

    // Second upstream request resumes strictly after the last consumed token.
    expect(hz.calls[1]).toMatchObject({ order: "asc", cursor: "13" });
    // ...and the empty second page adds nothing.
    expect(upserted.map((u) => u.paging_token)).toEqual(["13"]);
    stop();
  });

  it("keeps the last Horizon token across a non-contiguous token gap (does not reset to head)", async () => {
    stateRow.current = { paging_token: "20" };
    hz.setQueue([{ records: [paymentRecord("21"), paymentRecord("30"), paymentRecord("40")] }, { records: [] }]);
    const stop = await watchAccount({ db, network: "TESTNET", accountId: ACCOUNT });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4_000);

    expect(upserted.map((u) => u.paging_token)).toEqual(["21", "30", "40"]);
    // next request is anchored on the highest token seen, not on the head.
    expect(hz.calls[1]).toMatchObject({ cursor: "40" });
    stop();
  });

  it("handles a page that repeats a token by leaving the cursor idempotent", async () => {
    stateRow.current = { paging_token: "50" };
    hz.setQueue([{ records: [paymentRecord("50"), paymentRecord("50")] }, { records: [] }]);
    const stop = await watchAccount({ db, network: "TESTNET", accountId: ACCOUNT });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4_000);

    expect(upserted.map((u) => u.paging_token)).toEqual(["50", "50"]);
    expect(hz.calls[1]).toMatchObject({ cursor: "50" });
    stop();
  });
});

describe("watchAccount · shutdown", () => {
  it("stops polling after the returned stop() is called", async () => {
    stateRow.current = { paging_token: "1" };
    hz.setQueue([{ records: [] }]);
    const stop = await watchAccount({ db, network: "TESTNET", accountId: ACCOUNT });
    await vi.advanceTimersByTimeAsync(0);
    const before = hz.calls.length;

    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hz.calls.length).toBe(before);
  });
});
