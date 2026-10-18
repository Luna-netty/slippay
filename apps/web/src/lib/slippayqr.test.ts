import { describe, it, expect } from "vitest";
import { encodeRequest, decodeRequest, stroopsToXlm, type PayRequest } from "./slippayqr.ts";

// A known-valid Stellar ed25519 public key (56 chars, base32). The decoder only
// shape-checks against /^[GC][A-Z2-7]{55}$/, so these round-trips are
// independent of parsePaymentQr and of any real network/account lookup.
const TO = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
const TO_2 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("encodeRequest → decodeRequest round-trip", () => {
  it("round-trips a minimal payload and compares the whole object", () => {
    const request: PayRequest = { to: TO, amount: "3000000" };

    const encoded = encodeRequest(request);
    const decoded = decodeRequest(encoded);

    // Whole-object equality, not per-field: encode/decode asymmetry fails here.
    expect(decoded).toEqual(request);
  });

  it("round-trips a fully-populated payload (asset + label)", () => {
    const request: PayRequest = { to: TO, amount: "15000000", asset: "USDC", label: "Café com leite ☕" };

    expect(decodeRequest(encodeRequest(request))).toEqual(request);
  });

  it("round-trips the XLM asset variant", () => {
    const request: PayRequest = { to: TO_2, amount: "1", asset: "XLM", label: "nota" };

    expect(decodeRequest(encodeRequest(request))).toEqual(request);
  });

  it("emits the documented slippay:pay URI shape", () => {
    expect(encodeRequest({ to: TO, amount: "3000000" })).toBe(`slippay:pay?to=${TO}&amount=3000000`);
    expect(encodeRequest({ to: TO, amount: "3000000", asset: "USDC" })).toBe(
      `slippay:pay?to=${TO}&amount=3000000&asset=USDC`,
    );
  });

  it("treats a missing asset as the legacy (XLM) default", () => {
    expect(decodeRequest(`slippay:pay?to=${TO}&amount=10`).asset).toBeUndefined();
  });
});

describe("decodeRequest malformed input", () => {
  it("rejects a non-slippay string", () => {
    expect(() => decodeRequest("https://slippay.cc/pay")).toThrow("Esse QR não é um pedido de pagamento Slippay.");
  });

  it("rejects a truncated payload with no query string", () => {
    expect(() => decodeRequest("slippay:pay")).toThrow("Esse QR não é um pedido de pagamento Slippay.");
    expect(() => decodeRequest("slippay:pay?")).toThrow("QR incompleto (falta destinatário ou valor).");
  });

  it("rejects a payload missing the recipient or the amount", () => {
    expect(() => decodeRequest(`slippay:pay?amount=10`)).toThrow("QR incompleto (falta destinatário ou valor).");
    expect(() => decodeRequest(`slippay:pay?to=${TO}`)).toThrow("QR incompleto (falta destinatário ou valor).");
  });

  it("rejects a recipient that is not a Stellar G/C address", () => {
    expect(() => decodeRequest(`slippay:pay?to=0xdeadbeef&amount=10`)).toThrow("Endereço do QR é inválido.");
    // valid base32 but 55 chars (one short)
    expect(() => decodeRequest(`slippay:pay?to=${TO.slice(0, 55)}&amount=10`)).toThrow("Endereço do QR é inválido.");
  });

  it("rejects a non-numeric amount", () => {
    expect(() => decodeRequest(`slippay:pay?to=${TO}&amount=1.5`)).toThrow("Valor do QR é inválido.");
    expect(() => decodeRequest(`slippay:pay?to=${TO}&amount=-10`)).toThrow("Valor do QR é inválido.");
    expect(() => decodeRequest(`slippay:pay?to=${TO}&amount=abc`)).toThrow("Valor do QR é inválido.");
  });

  it("drops an unknown asset value instead of populating it partially", () => {
    expect(decodeRequest(`slippay:pay?to=${TO}&amount=10&asset=DOGE`).asset).toBeUndefined();
  });

  it("is case-insensitive on the scheme", () => {
    expect(decodeRequest(`SLIPPAY:PAY?to=${TO}&amount=10`)).toEqual({ to: TO, amount: "10" });
  });
});

describe("stroopsToXlm", () => {
  it("renders stroops as a pt-BR human amount", () => {
    expect(stroopsToXlm("3000000")).toBe("0,3");
    expect(stroopsToXlm("10000000")).toBe("1");
    expect(stroopsToXlm("15000000")).toBe("1,5");
  });

  it("handles the minimum unit and zero without crashing", () => {
    expect(stroopsToXlm("1")).toBe("0,0000001");
    expect(stroopsToXlm("0")).toBe("0");
  });
});
