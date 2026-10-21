import { describe, it, expect } from "vitest";
import { buildAtomicTx } from "../src/lib/stellar.ts";

describe("buildAtomicTx", () => {
  const buyer   = "GBBKIN4ZQWJUND63GSFEXLKZFLXZ3J265FPGYKPLGXA34QYSAFFC3C5X";
  const merchant = "GC4HWUN3LGTPZTU3ET2COOBPSWEV6IZHPCWOJURPG6FD7KAX6OAGM6UZ";
  const platform = "GCSVLVWNINYK4YDPCVEFFXQG2NO2Z5MRPKCNYHFOLE6A3AOFQJ4JFOO2";

  it("returns XDR with 2 payment operations", async () => {
    const xdr = await buildAtomicTx({
      buyerPublicKey: buyer,
      buyerSequence: "1234567890",
      merchantAddress: merchant,
      platformAddress: platform,
      usdcAmount: "10.0000000",
      platformFeeBp: 100,
      memo: "ab".repeat(32),
      network: "TESTNET",
      maxTime: Math.floor(Date.now()/1000) + 1800,
    });
    expect(typeof xdr).toBe("string");
    expect(xdr.length).toBeGreaterThan(50);
  });

  it("rejects zero usdc_amount", async () => {
    await expect(buildAtomicTx({
      buyerPublicKey: buyer,
      buyerSequence: "1",
      merchantAddress: merchant,
      platformAddress: platform,
      usdcAmount: "0",
      platformFeeBp: 100,
      memo: "ab".repeat(32),
      network: "TESTNET",
      maxTime: Math.floor(Date.now()/1000) + 1800,
    })).rejects.toThrow();
  });
});
