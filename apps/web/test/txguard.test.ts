import { describe, it, expect } from "vitest";
import { Account, Asset, Operation, TransactionBuilder, Networks, BASE_FEE } from "@stellar/stellar-sdk";
import { decodeTx, localHash, assertPaymentMatches } from "../src/lib/txguard.ts";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const DEST = "GC4HWUN3LGTPZTU3ET2COOBPSWEV6IZHPCWOJURPG6FD7KAX6OAGM6UZ";
const SRC = "GBBKIN4ZQWJUND63GSFEXLKZFLXZ3J265FPGYKPLGXA34QYSAFFC3C5X";

function sampleXdr(amount: string): string {
  const tx = new TransactionBuilder(new Account(SRC, "123"), {
    fee: BASE_FEE, networkPassphrase: Networks.PUBLIC,
    timebounds: { minTime: 0, maxTime: 0 },
  }).addOperation(Operation.payment({
      destination: DEST, asset: new Asset("USDC", ISSUER), amount,
    })).build();
  return tx.toXDR();
}

function twoPaymentXdr(): string {
  const tx = new TransactionBuilder(new Account(SRC, "123"), {
    fee: BASE_FEE, networkPassphrase: Networks.PUBLIC,
    timebounds: { minTime: 0, maxTime: 0 },
  })
    .addOperation(Operation.payment({ destination: DEST, asset: new Asset("USDC", ISSUER), amount: "10" }))
    .addOperation(Operation.payment({ destination: SRC, asset: new Asset("USDC", ISSUER), amount: "999" }))
    .build();
  return tx.toXDR();
}

function xlmXdr(): string {
  const tx = new TransactionBuilder(new Account(SRC, "123"), {
    fee: BASE_FEE, networkPassphrase: Networks.PUBLIC,
    timebounds: { minTime: 0, maxTime: 0 },
  }).addOperation(Operation.payment({ destination: DEST, asset: Asset.native(), amount: "10.5" })).build();
  return tx.toXDR();
}

describe("decodeTx", () => {
  it("extracts destination, amount and asset from a payment XDR", () => {
    const s = decodeTx(sampleXdr("10.5"), "PUBLIC");
    expect(s.source).toBe(SRC);
    expect(s.operations[0]!.type).toBe("payment");
    expect(s.operations[0]!.destination).toBe(DEST);
    expect(s.operations[0]!.amount).toBe("10.5000000");
    expect(s.operations[0]!.assetCode).toBe("USDC");
  });
});

describe("localHash", () => {
  it("matches the SDK's own tx hash (proves we re-derive, not trust)", () => {
    const xdr = sampleXdr("1");
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    expect(localHash(xdr, "PUBLIC").equals(tx.hash())).toBe(true);
  });
});

describe("assertPaymentMatches", () => {
  it("passes when destination, asset and amount match", () => {
    const s = decodeTx(sampleXdr("10.5"), "PUBLIC");
    expect(() => assertPaymentMatches(s, { destination: DEST, amount: "10.5", assetCode: "USDC" })).not.toThrow();
  });
  it("throws on destination mismatch (receiver substitution)", () => {
    const s = decodeTx(sampleXdr("10.5"), "PUBLIC");
    expect(() => assertPaymentMatches(s, { destination: SRC, amount: "10.5", assetCode: "USDC" })).toThrow();
  });
  it("throws on amount drift beyond tolerance", () => {
    const s = decodeTx(sampleXdr("10.5"), "PUBLIC");
    expect(() => assertPaymentMatches(s, { destination: DEST, amount: "10.6", assetCode: "USDC" })).toThrow();
  });
  it("throws on asset mismatch (XLM where USDC expected)", () => {
    const s = decodeTx(xlmXdr(), "PUBLIC");
    expect(() => assertPaymentMatches(s, { destination: DEST, amount: "10.5", assetCode: "USDC" })).toThrow(/ativo/);
  });
  it("throws when more than one payment op is present (hidden second payment)", () => {
    const s = decodeTx(twoPaymentXdr(), "PUBLIC");
    expect(() => assertPaymentMatches(s, { destination: DEST, amount: "10", assetCode: "USDC" })).toThrow(/exatamente 1/);
  });

  it("strictly rejects a 1-stroop difference at the 7th decimal (Issue #315)", () => {
    // 10.5000000 vs 10.5000001 (exactly 1 stroop difference)
    const s = decodeTx(sampleXdr("10.5000000"), "PUBLIC");
    expect(() =>
      assertPaymentMatches(s, { destination: DEST, amount: "10.5000001", assetCode: "USDC" })
    ).toThrow(/valor divergente/);

    expect(() =>
      assertPaymentMatches(s, { destination: DEST, amount: "10.4999999", assetCode: "USDC" })
    ).toThrow(/valor divergente/);

    // 0.0000001 vs 0.0000002 (smallest unit 1 stroop difference)
    const sMin = decodeTx(sampleXdr("0.0000001"), "PUBLIC");
    expect(() =>
      assertPaymentMatches(sMin, { destination: DEST, amount: "0.0000002", assetCode: "USDC" })
    ).toThrow(/valor divergente/);
  });

  it("strictly rejects malformed or unparseable amount strings in guard", () => {
    const s = decodeTx(sampleXdr("10.5"), "PUBLIC");
    expect(() =>
      assertPaymentMatches(s, { destination: DEST, amount: "not_a_number", assetCode: "USDC" })
    ).toThrow(/valor não numérico/);

    expect(() =>
      assertPaymentMatches(s, { destination: DEST, amount: "-10.5", assetCode: "USDC" })
    ).toThrow(/valor não numérico/);

    expect(() =>
      assertPaymentMatches(s, { destination: DEST, amount: "1e-7", assetCode: "USDC" })
    ).toThrow(/valor não numérico/);

    expect(() =>
      assertPaymentMatches(s, { destination: DEST, amount: "10.12345678", assetCode: "USDC" })
    ).toThrow(/valor não numérico/);

    expect(() =>
      assertPaymentMatches(s, { destination: DEST, amount: "", assetCode: "USDC" })
    ).toThrow(/valor não numérico/);
  });

  it("passes exact 7-decimal identical amounts without floating point precision decay", () => {
    const s = decodeTx(sampleXdr("1234.5678901"), "PUBLIC");
    expect(() =>
      assertPaymentMatches(s, { destination: DEST, amount: "1234.5678901", assetCode: "USDC" })
    ).not.toThrow();

    // Short fractional string "10.5" normalizes to same stroops as "10.5000000"
    const sShort = decodeTx(sampleXdr("10.5"), "PUBLIC");
    expect(() =>
      assertPaymentMatches(sShort, { destination: DEST, amount: "10.5000000", assetCode: "USDC" })
    ).not.toThrow();
  });
});


