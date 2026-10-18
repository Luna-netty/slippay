// Unit tests for the listener's lease-scoped order-status write path.
//
// `src/db.ts` is only the Supabase client factory (a thin `createClient`
// wrapper) that `src/horizon.ts` hands to `src/reconciler.ts`. The status writes
// that follow a match live in `reconcileMatch`, and the per-account lease from
// `src/lease.ts` is what guarantees only one listener pod is watching a merchant
// account. The write predicate on the `orders` row is therefore the mechanism
// that stops a pod which lost (or never held) the lease from marking an order
// paid or re-emitting a webhook.
//
// These specs exercise that write path against a fully mocked client, so no
// Supabase connection is ever opened.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reconcileMatch } from "../src/reconciler.js";

interface Call {
  table: string;
  method: string;
  args: unknown[];
}

/**
 * A chainable mock that records every PostgREST builder call. `orders.single()`
 * resolves from a queue so a test can model "the row matched" followed by "the
 * predicate no longer matches on replay". `webhook_deliveries.insert()` is the
 * success side-effect we assert on. Nothing here touches the network.
 */
function makeMockDb(opts: {
  orderUpdates?: Array<{ data: unknown; error: unknown }>;
  webhookInsert?: { error: unknown };
} = {}) {
  const calls: Call[] = [];
  const orderQueue = opts.orderUpdates ?? [{ data: null, error: null }];

  function makeBuilder(table: string) {
    const b: any = {};
    const chain = (method: string) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return b;
      });

    b.update = chain("update");
    b.eq = chain("eq");
    b.in = chain("in");
    b.select = chain("select");
    b.insert = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: "insert", args });
      return Promise.resolve(opts.webhookInsert ?? { error: null });
    });
    b.single = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: "single", args });
      if (table !== "orders") return Promise.resolve({ data: null, error: null });
      const next = orderQueue.length > 1 ? orderQueue.shift()! : orderQueue[0]!;
      return Promise.resolve(next);
    });
    b.maybeSingle = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: "maybeSingle", args });
      return Promise.resolve({ data: null, error: null });
    });
    return b;
  }

  const db = {
    from: vi.fn((table: string) => {
      calls.push({ table, method: "from", args: [table] });
      return makeBuilder(table);
    }),
  };

  return { db: db as unknown as Parameters<typeof reconcileMatch>[0], calls };
}

const order = {
  id: "ord-1",
  merchant_id: "mer-1",
  memo: "ab".repeat(32),
  usdc_amount: "1.7000000",
  merchant_stellar_address: "G".padEnd(56, "A"),
  platform_fee_bp: 297,
};

const paidRow = {
  id: "ord-1",
  external_ref: "x",
  brl_amount: "9.90",
  usdc_amount: "1.7000000",
  paid_at: "2026-06-26T00:00:00Z",
};

function callsTo(calls: Call[], table: string, method: string) {
  return calls.filter((c) => c.table === table && c.method === method);
}

describe("reconcileMatch — lease-scoped order-status writes", () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(String(args[0]));
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("marks the order paid with the order-id + forward-only status predicate", async () => {
    const mock = makeMockDb({
      orderUpdates: [{ data: paidRow, error: null }],
      webhookInsert: { error: null },
    });

    await reconcileMatch(mock.db, order, { outcome: "paid" }, "tx-1");

    const update = callsTo(mock.calls, "orders", "update");
    expect(update).toHaveLength(1);
    expect(update[0]!.args[0]).toMatchObject({ status: "paid", tx_hash: "tx-1" });

    // Predicates, not just the call: the write is scoped to this order *and* to
    // the prior states a paid transition may legally come from.
    const eqs = callsTo(mock.calls, "orders", "eq");
    expect(eqs.some((c) => c.args[0] === "id" && c.args[1] === "ord-1")).toBe(true);

    const ins = callsTo(mock.calls, "orders", "in");
    expect(
      ins.some(
        (c) =>
          c.args[0] === "status" &&
          JSON.stringify(c.args[1]) === JSON.stringify(["pending", "underpaid"]),
      ),
    ).toBe(true);
  });

  it("treats a zero-row update as a lost write, not success, and enqueues no webhook", async () => {
    // Zero rows matched: this pod no longer holds the row (lease lost, or the
    // lease holder already transitioned it). reconcileMatch must not fall
    // through to the success side-effect.
    const mock = makeMockDb({ orderUpdates: [{ data: null, error: null }] });

    await reconcileMatch(mock.db, order, { outcome: "paid" }, "tx-1");

    expect(callsTo(mock.calls, "orders", "update")).toHaveLength(1);
    expect(callsTo(mock.calls, "webhook_deliveries", "insert")).toHaveLength(0);
    // The caller is told: a structured `reconcile_skipped` warning is emitted.
    expect(logged.some((l) => l.includes("reconcile_skipped"))).toBe(true);
  });

  it("is idempotent: a replayed match writes exactly one webhook, not two", async () => {
    const mock = makeMockDb({
      orderUpdates: [{ data: paidRow, error: null }, { data: null, error: null }],
      webhookInsert: { error: null },
    });

    // First delivery matches the row and enqueues the webhook.
    await reconcileMatch(mock.db, order, { outcome: "paid" }, "tx-1");
    // Replay: the status predicate no longer matches → zero rows.
    await reconcileMatch(mock.db, order, { outcome: "paid" }, "tx-1");

    expect(callsTo(mock.calls, "webhook_deliveries", "insert")).toHaveLength(1);
  });

  it("only permits pending → underpaid (no backwards paid → underpaid transition)", async () => {
    const mock = makeMockDb({ orderUpdates: [{ data: null, error: null }] });

    await reconcileMatch(
      mock.db,
      order,
      { outcome: "underpaid", expected: "1.6500000", received: "0.5000000" },
      "tx-partial",
    );

    const update = callsTo(mock.calls, "orders", "update");
    expect(update[0]!.args[0]).toMatchObject({ status: "underpaid", paid_at: null });

    const ins = callsTo(mock.calls, "orders", "in");
    expect(ins.some((c) => JSON.stringify(c.args[1]) === JSON.stringify(["pending"]))).toBe(true);
  });

  it("does not touch the database at all when the match is ignored", async () => {
    const mock = makeMockDb();

    await reconcileMatch(mock.db, order, { outcome: "ignore", reason: "memo_mismatch" }, "tx-1");

    expect(mock.calls).toHaveLength(0);
  });
});
