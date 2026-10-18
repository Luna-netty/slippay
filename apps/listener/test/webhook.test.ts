import { describe, it, expect, vi, beforeEach } from "vitest";
import { lookup } from "node:dns/promises";

// deliverOnce now always resolves + validates the target (audit-003 L1). These
// tests pass allowLocal:true (dev-only flag) so the blocklist/https/port checks
// are skipped for the example.com mock server, but the hostname still goes
// through DNS resolution — mock it to keep the tests hermetic.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

import { nextBackoff, deliverOnce } from "../src/webhook.js";

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
