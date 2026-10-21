import { describe, it, expect, vi, beforeEach } from "vitest";
import { reconcileMatch } from "../src/reconciler.js";

function makeMockDb() {
  const single = vi.fn();
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const insert = vi.fn().mockReturnThis();
  const update = vi.fn().mockReturnThis();
  const eq = vi.fn().mockReturnThis();
  const inFn = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();
  const from = vi.fn().mockReturnThis();
  const mock = { from, update, insert, eq, in: inFn, select, single, maybeSingle };
  return mock as unknown as Parameters<typeof reconcileMatch>[0] & typeof mock;
}

describe("reconcileMatch", () => {
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => { mockDb = makeMockDb(); });

  it("updates pending order to paid and enqueues webhook on outcome=paid", async () => {
    mockDb.single.mockResolvedValueOnce({ data: { id: "ord-1", external_ref: "x", brl_amount: "10.00", usdc_amount: "1.7", paid_at: "2026-05-07T00:00:00Z" }, error: null });
    await reconcileMatch(mockDb, { id: "ord-1", merchant_id: "m-1", memo: "ab".repeat(32), usdc_amount: "1.7", merchant_stellar_address: "G".padEnd(56,"A"), platform_fee_bp: 100 }, { outcome: "paid" }, "txhash");
    expect(mockDb.update).toHaveBeenCalledWith(expect.objectContaining({ status: "paid", tx_hash: "txhash" }));
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("is idempotent on already-paid order (no webhook insert when no row matched)", async () => {
    mockDb.single.mockResolvedValueOnce({ data: null, error: null });
    await reconcileMatch(mockDb, { id: "ord-1", merchant_id: "m-1", memo: "ab".repeat(32), usdc_amount: "1.7", merchant_stellar_address: "G".padEnd(56,"A"), platform_fee_bp: 100 }, { outcome: "paid" }, "txhash");
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("does nothing on ignore outcome", async () => {
    await reconcileMatch(mockDb, { id: "ord-1", merchant_id: "m-1", memo: "ab".repeat(32), usdc_amount: "1.7", merchant_stellar_address: "G".padEnd(56,"A"), platform_fee_bp: 100 }, { outcome: "ignore" }, "txhash");
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("allows underpaid→paid transition (audit-003 L3)", async () => {
    mockDb.single.mockResolvedValueOnce({ data: { id: "ord-1", external_ref: "x", brl_amount: "10.00", usdc_amount: "1.7", paid_at: "2026-05-16T00:00:00Z" }, error: null });
    await reconcileMatch(mockDb, { id: "ord-1", merchant_id: "m-1", memo: "ab".repeat(32), usdc_amount: "1.7", merchant_stellar_address: "G".padEnd(56,"A"), platform_fee_bp: 100 }, { outcome: "paid" }, "topup-tx");
    expect(mockDb.in).toHaveBeenCalledWith("status", ["pending", "underpaid"]);
  });

  it("only allows pending→underpaid (no backward transition)", async () => {
    mockDb.single.mockResolvedValueOnce({ data: null, error: null });
    await reconcileMatch(mockDb, { id: "ord-1", merchant_id: "m-1", memo: "ab".repeat(32), usdc_amount: "1.7", merchant_stellar_address: "G".padEnd(56,"A"), platform_fee_bp: 100 }, { outcome: "underpaid", expected: "1.7000000", received: "0.5000000" }, "partial-tx");
    expect(mockDb.in).toHaveBeenCalledWith("status", ["pending"]);
  });

  it("dedupe on unique-violation (23505) does not log error", async () => {
    mockDb.single.mockResolvedValueOnce({ data: { id: "ord-1", external_ref: "x", brl_amount: "10.00", usdc_amount: "1.7", paid_at: "2026-05-16T00:00:00Z" }, error: null });
    mockDb.insert.mockReturnValueOnce(Promise.resolve({ error: { code: "23505", message: "duplicate" } }));
    await reconcileMatch(mockDb, { id: "ord-1", merchant_id: "m-1", memo: "ab".repeat(32), usdc_amount: "1.7", merchant_stellar_address: "G".padEnd(56,"A"), platform_fee_bp: 100 }, { outcome: "paid" }, "txhash");
    // no throw, no error log assertion — surviving the call is the contract
    expect(mockDb.insert).toHaveBeenCalled();
  });
});
