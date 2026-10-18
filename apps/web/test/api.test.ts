import { describe, it, expect, vi } from "vitest";
import { fetchOrder } from "../src/lib/api.ts";

describe("fetchOrder", () => {
  it("calls /v1/orders/:id and returns order", async () => {
    const fakeOrder = { id: "abc", brl_amount: "10.00", usdc_amount: "1.7240000", memo: "f".repeat(64), status: "pending", expires_at: "2099-01-01T00:00:00Z", merchant_stellar_address: "G" + "X".repeat(55) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ order: fakeOrder }), { status: 200 })));
    const result = await fetchOrder("abc");
    expect(result.id).toBe("abc");
    expect(result.status).toBe("pending");
  });

  it("throws on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "not_found" }), { status: 404 })));
    await expect(fetchOrder("missing")).rejects.toThrow();
  });
});
