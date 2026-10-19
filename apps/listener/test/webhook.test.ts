import { describe, it, expect, vi, beforeEach } from "vitest";
import { lookup } from "node:dns/promises";

// deliverOnce now always resolves + validates the target (audit-003 L1). These
// tests pass allowLocal:true (dev-only flag) so the blocklist/https/port checks
// are skipped for the example.com mock server, but the hostname still goes
 // through DNS resolution — mock it to keep the tests hermetic.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

import { nextBackoff, deliverOnce, claimDeliveries, reclaimExpiredClaims, startWebhookWorker } from "../src/webhook.js";

const mockLookup = lookup as unknown as ReturnType<typeof vi.fn>;

describe("nextBackoff", () => {
  it("returns escalating delays per attempt", () => {
    expect(nextBackoff(0)).toBe(60);
    expect(nextBackoff(1)).toBe(300);
    expect(nextBackoff(2)).toBe(1800);
    expect(nextBackoff(3)).toBe(7200);
    expect(nextBackoff(4)).toBe(43200);
    expect(nextBackoff(5)).toBe(86400);
    expect(nextBackoff(6)).toBe(null);
  });
});

describe("deliverOnce", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockLookup.mockReset();
    // example.com resolves to a public IP; allowLocal:true skips the blocklist
    // anyway, but validateWebhookUrl still pins the resolved address.
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  it("returns sent on 2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));
    const r = await deliverOnce({
      url: "https://example.com/wh",
      secret: "s",
      deliveryId: "d-1",
      payload: { type: "order.paid", data: { id: "o-1" } },
      allowLocal: true,
    });
    expect(r.status).toBe("sent");
    expect(r.code).toBe(200);
  });

  it("returns failed on 5xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 503 })));
    const r = await deliverOnce({ url: "https://example.com/wh", secret: "s", deliveryId: "d-2", payload: {}, allowLocal: true });
    expect(r.status).toBe("failed");
  });

  it("returns failed on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("dns")));
    const r = await deliverOnce({ url: "https://example.com/wh", secret: "s", deliveryId: "d-3", payload: {}, allowLocal: true });
    expect(r.status).toBe("failed");
  });

  // M3 regression guard at the deliverOnce layer: with allowLocal=false (the
  // production default), a webhook_url resolving to a blocked literal IP is
  // rejected before any fetch is attempted, regardless of network. Audit-003 L1.
  it("rejects a blocked literal IP without fetching (allowLocal=false)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const url of ["http://169.254.169.254/", "http://127.0.0.1/"]) {
      const r = await deliverOnce({ url, secret: "s", deliveryId: "d-blocked", payload: {}, allowLocal: false });
      expect(r.status).toBe("failed");
      expect(r.body).toMatch(/^unsafe_url:/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// In-memory fake of the webhook_deliveries table sufficient to exercise the
// claim / reclaim / double-delivery guarantees. Two workers share one fake db
// so the conditional update acts as the compare-and-swap that arbitrates ownership.
// --------------------------------------------------------------------------

interface FakeRow {
  id: string;
  order_id: string;
  payload: unknown;
  attempt_n: number;
  status: string;
  next_attempt_at: string;
  owner_id?: string | null;
  visible_at?: string | null;
  response_code?: number;
  response_body?: string;
  last_attempt_at?: string;
  orders?: { merchants?: { webhook_url?: string; webhook_secret?: string; network?: string } | null };
}

class FakeQuery {
  private ops: Array<(r: FakeRow) => boolean> = [];
  private updatePayload: Record<string, unknown> | null = null;
  private selectCols: string | null = null;
  private limitN: number | null = null;
  constructor(private rows: FakeRow[], private mode: "select" | "update") {}

  in(col: string, vals: unknown[]) {
    this.ops.push(r=> vals.includes((r as any)[col]));
    return this;
  }
  eq(col: string, val: unknown) {
    this.ops.push(r=> (r as any)[col] === val);
    return this;
  }
  lte(col: string, val: unknown) {
    this.ops.push(r=> String((r as any)[col] <= String(val)));
    return this;
  }
  lt(col: string, val: unknown) {
    this.ops.push(r=> String((r as any)[col]) < String(val));
    return this;
  }
  order(_col: string, _opts?: unknown) { return this; }
  limit(n: number) { this.limitN = n; return this; }
  select(cols?: string) { this.selectCols = cols ?? null; return this; }
  update(payload: Record<string, unknown>) { this.updatePayload = payload; return this; }

  private matches(r: FakeRow): boolean {
    return this.ops.every(fn => fn.call(this, r));
  }

  // Then awaatable so `await qb.from()...` works like supabase-js.
  then(onResolve?: (res: { data: unknown }) => void) {
    const run = () => {
      if (this.mode === "select") {
        const hits = this.rows.filter(r => this.matches(r));
        const limited = this.limitN == null ? hits : hits.slice(0, this.limitN);
        const data = limited.map(r => {
          if (this.selectCols && this.selectCols.trim() === "id") return { id: r.id };
          return { id: r.id, order_id: r.order_id, payload: r.payload, attempt_n: r.attempt_n, status: r.status, owner_id: r.owner_id ?? null, orders: r.orders ?? null };
        });
        return { data };
      }
      // update mode
      const hits = this.rows.filter(r => this.matches(r));
      for (const r of hits) Object.assign(r, this.updatePayload);
      const data = hits.map(r => (this.selectCols ? { id: r.id } : r));
      return { data };
    };
    const p = Promise.resolve(undefined).then(run);
    if (onResolve) p.then(onResolve);
    return p;
  }
  catch(onReject?: (e: unknown) => void) {
    const p = this.then();
    if (onReject) p.catch(onReject);
    return p;
  }
}

class FakeDb {
  constructor(public rows: FakeRow[]) {}
  from(_table: string) {
    return {
      select: (cols?: string) => new FakeQuery(this.rows, "select").select(cols),
      update: (payload: Record<string, unknown>) => new FakeQuery(this.rows, "update").update(payload),
    };
  }
}

function makeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: "delivery-1",
    order_id: "order-1",
    payload: { type: "order.paid" },
    attempt_n: 0,
    status: "queued",
    next_attempt_at: new Date(Date.now() - 1000).toISOString(),
    owner_id: null,
    visible_at: null,
    orders: { merchants: { webhook_url: "https://example.com/wh", webhook_secret: "s", network: "testnet" } },
    ...overrides,
  };
}

describe("claimDeliveries", () => {
  it("claims a due row and records the owner", async () => {
    const row = makeRow();
    const db = new FakeDb([row]);
    const claimed = await claimDeliveries(db as any, "worker-a");
    expect(claimed.length).toBe(1);
    expect(row.status).toBe("delivering");
    expect(row.owner_id).toBe("worker-a");
    expect(row.visible_at).toBeTruthy();
  });

  it("does not claim a row that is not due", async () => {
    const row = makeRow({ next_attempt_at: new Date(Date.now() + 60_000).toISOString() });
    const db = new FakeDb([row]);
    const claimed = await claimDeliveries(db as any, "worker-a");
    expect(claimed.length).toBe(0);
    expect(row.status).toBe("queued");
  });

  it("two concurrent workers claim a single row only once", async () => {
    const row = makeRow();
    const db = new FakeDb([row]);
    const [a, b] = await Promise.all([
      claimDeliveries(db as any, "worker-a"),
      claimDeliveries(db as any, "worker-b"),
    ]);
    expect(a.length + b.length).toBe(1);
    // The winner owns the row and it is no longer claimable.
    expect(row.status).toBe("delivering");
    expect(["worker-a", "worker-b"]).toContain(row.owner_id);
  });
});

describe("reclaimExpiredClaims", () => {
  it("returns a stranded 'delivering' row to the pool after its deadline", async () => {
    const row = makeRow({
      status: "delivering",
      owner_id: "crashed-worker",
      visible_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const db = new FakeDb([row]);
    await reclaimExpiredClaims(db as any);
    expect(row.status).toBe("failed");
    expect(row.owner_id).toBeNull();
    expect(row.visible_at).toBeNull();
  });

  it("leaves a live claim alone", async () => {
    const row = makeRow({
      status: "delivering",
      owner_id: "live-worker",
      visible_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const db = new FakeDb([row]);
    await reclaimExpiredClaims(db as any);
    expect(row.status).toBe("delivering");
    expect(row.owner_id).toBe("live-worker");
  });
});

describe("startWebhookWorker double-delivery guard", () => {
  it("two concurrent workers perform one delivery for one row", async () => {
    const row = makeRow();
    const db = new FakeDb([row]);

    // Count the HTTP POSTs actually issued by the workers.
    const fetchSpy = vi.fn().mockImplementation(async () => {
      // Give the other worker a chance to claim concurrently.
      await new Promise(r => setTimeout(r, 20));
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const stopA = startWebhookWorker(db as any, true, "worker-a");
    const stopB = startWebhookWorker(db as any, true, "worker-b");

    // Wait until the row is finally sent (or time out).
    const deadline = Date.now() + 2000;
    while (row.status !== "sent" && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10));
    }
    stopA();
    stopB();

    expect(row.status).toBe("sent");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Owner id is cleared on completion but the attempt count proves only one
    // delivery ran.
    expect(row.attempt_n).toBe(1);
  });
});
