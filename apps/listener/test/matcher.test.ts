import { describe, it, expect, afterEach } from "vitest";
import { matchPaymentToOrder, stellarToStroops, stroopsToStellar, type StellarPaymentEvent } from "../src/matcher.js";

const order = {
  id: "ord-1",
  memo: "ab".repeat(32),
  usdc_amount: "10.0000000",
  merchant_stellar_address: "G" + "M".repeat(55),
  platform_fee_bp: 100,
};

const validEvent: StellarPaymentEvent = {
  memo_type: "hash",
  memo_b64: Buffer.from("ab".repeat(32), "hex").toString("base64"),
  successful: true,
  asset_code: "USDC",
  asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  to: "G" + "M".repeat(55),
  amount: "9.9000000",
  hash: "txhash",
};

describe("matchPaymentToOrder", () => {
  afterEach(() => { delete process.env.STELLAR_USDC_ISSUER_OVERRIDE; });

  it("matches valid USDC payment with correct memo + amount", () => {
    expect(matchPaymentToOrder(validEvent, order, "TESTNET")).toEqual({ outcome: "paid" });
  });

  it("returns underpaid when amount short", () => {
    const e = { ...validEvent, amount: "5.0000000" };
    expect(matchPaymentToOrder(e, order, "TESTNET")).toEqual({ outcome: "underpaid", expected: "9.9000000", received: "5.0000000" });
  });

  it("ignores when memo doesnt match", () => {
    const e = { ...validEvent, memo_b64: Buffer.from("cd".repeat(32), "hex").toString("base64") };
    expect(matchPaymentToOrder(e, order, "TESTNET").outcome).toBe("ignore");
  });

  it("ignores when wrong asset", () => {
    const e = { ...validEvent, asset_code: "XLM", asset_issuer: undefined };
    expect(matchPaymentToOrder(e, order, "TESTNET").outcome).toBe("ignore");
  });

  it("ignores unsuccessful tx", () => {
    const e = { ...validEvent, successful: false };
    expect(matchPaymentToOrder(e, order, "TESTNET").outcome).toBe("ignore");
  });

  it("matches when STELLAR_USDC_ISSUER_OVERRIDE overrides expected issuer", () => {
    const customIssuer = "GCUSTOM" + "X".repeat(49);
    process.env.STELLAR_USDC_ISSUER_OVERRIDE = customIssuer;
    const e = { ...validEvent, asset_issuer: customIssuer };
    expect(matchPaymentToOrder(e, order, "TESTNET")).toEqual({ outcome: "paid" });
  });

  it("ignores when issuer doesnt match override", () => {
    process.env.STELLAR_USDC_ISSUER_OVERRIDE = "GCUSTOM" + "X".repeat(49);
    // validEvent still has the Circle testnet issuer, not the override
    expect(matchPaymentToOrder(validEvent, order, "TESTNET").outcome).toBe("ignore");
  });

  it("BigInt path: 1 stroop short is underpaid (FP would round to paid)", () => {
    const o = { ...order, usdc_amount: "1.0000001", platform_fee_bp: 25 };
    // expected = 10000001 * 9975 / 10000 = 9975000 (truncated). Send 1 stroop less.
    const e = { ...validEvent, amount: "0.9974999" };
    expect(matchPaymentToOrder(e, o, "TESTNET").outcome).toBe("underpaid");
  });

  it("BigInt path: exact expected stroop count is paid", () => {
    const o = { ...order, usdc_amount: "1.0000001", platform_fee_bp: 25 };
    const e = { ...validEvent, amount: "0.9975000" };
    expect(matchPaymentToOrder(e, o, "TESTNET")).toEqual({ outcome: "paid" });
  });

  it("rejects malformed amount as ignore", () => {
    const e = { ...validEvent, amount: "10.99999999" }; // 8 fractional digits
    expect(matchPaymentToOrder(e, order, "TESTNET").outcome).toBe("ignore");
  });

  it("rejects fee_bp >= 10000 as ignore (would zero merchant share)", () => {
    const o = { ...order, platform_fee_bp: 10_000 };
    expect(matchPaymentToOrder(validEvent, o, "TESTNET").outcome).toBe("ignore");
  });

  it("rejects null fee_bp as ignore instead of treating as zero fee", () => {
    const o = { ...order, platform_fee_bp: null };
    expect(matchPaymentToOrder(validEvent, o, "TESTNET")).toEqual({ outcome: "ignore", reason: "fee_bp_invalid" });
  });

  it("rejects undefined/missing fee_bp as ignore", () => {
    const o = { ...order, platform_fee_bp: undefined };
    expect(matchPaymentToOrder(validEvent, o, "TESTNET")).toEqual({ outcome: "ignore", reason: "fee_bp_invalid" });
  });

  it("rejects negative fee_bp as ignore", () => {
    const o = { ...order, platform_fee_bp: -1 };
    expect(matchPaymentToOrder(validEvent, o, "TESTNET")).toEqual({ outcome: "ignore", reason: "fee_bp_invalid" });
  });
});

describe("stellarToStroops · stroopsToStellar", () => {
  it("round-trips canonical amounts", () => {
    for (const s of ["0.0000001", "1.0000000", "10.9999999", "9999999.9999999"]) {
      expect(stroopsToStellar(stellarToStroops(s))).toBe(s);
    }
  });

  it("normalizes short fractional", () => {
    expect(stellarToStroops("1.5")).toBe(15_000_000n);
    expect(stroopsToStellar(15_000_000n)).toBe("1.5000000");
  });

  it("rejects negative, scientific, more than 7 fractional digits", () => {
    expect(() => stellarToStroops("-1")).toThrow();
    expect(() => stellarToStroops("1e2")).toThrow();
    expect(() => stellarToStroops("1.00000001")).toThrow();
  });
});
