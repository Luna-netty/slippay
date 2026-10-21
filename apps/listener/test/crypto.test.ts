import { describe, it, expect } from "vitest";
import { signWebhook, verifyWebhook } from "../src/crypto.js";

describe("signWebhook", () => {
  it("returns t=<unix>,v1=<hmac> format", async () => {
    const sig = await signWebhook("secret", "{\"a\":1}", 1700000000);
    expect(sig).toMatch(/^t=1700000000,v1=[a-f0-9]{64}$/);
  });
});

describe("verifyWebhook", () => {
  it("accepts a fresh signature within tolerance window", async () => {
    const now = Math.floor(Date.now()/1000);
    const sig = await signWebhook("secret", "body", now);
    expect(await verifyWebhook("secret", "body", sig, now)).toBe(true);
  });

  it("rejects expired signature", async () => {
    const old = Math.floor(Date.now()/1000) - 600;
    const sig = await signWebhook("secret", "body", old);
    expect(await verifyWebhook("secret", "body", sig, Math.floor(Date.now()/1000))).toBe(false);
  });

  it("rejects forged signature", async () => {
    const sig = "t=1,v1=" + "0".repeat(64);
    expect(await verifyWebhook("secret", "body", sig, 1)).toBe(false);
  });
});
