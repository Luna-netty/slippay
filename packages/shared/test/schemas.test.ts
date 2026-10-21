import { describe, it, expect } from "vitest";
import {
  CreateMerchantInputSchema,
  CreateOrderInputSchema,
  UsdcAmountSchema,
  OrderStatusSchema,
  LimitQuerySchema,
} from "../src/index.ts";

describe("CreateMerchantInputSchema", () => {
  it("accepts valid input", () => {
    expect(CreateMerchantInputSchema.parse({
      display_name: "Acme Crypto",
      stellar_address: "GBXYZ".padEnd(56, "A"),
      webhook_url: "https://acme.com/wh",
    })).toBeTruthy();
  });

  it("rejects bad stellar address length", () => {
    expect(() => CreateMerchantInputSchema.parse({
      display_name: "Acme",
      stellar_address: "G123",
    })).toThrow();
  });

  it("rejects stellar address containing 0/1/8/9 (not in base32 alphabet)", () => {
    const bad = "G" + "0".repeat(55);
    expect(() => CreateMerchantInputSchema.parse({
      display_name: "Acme",
      stellar_address: bad,
    })).toThrow();
  });

  it("rejects non-https webhook", () => {
    expect(() => CreateMerchantInputSchema.parse({
      display_name: "Acme",
      webhook_url: "http://acme.com/wh",
    })).toThrow();
  });
});

describe("UsdcAmountSchema", () => {
  it("accepts valid decimal strings with up to 7 fractional places", () => {
    expect(UsdcAmountSchema.parse("10.00")).toBe("10.00");
    expect(UsdcAmountSchema.parse("10.1234567")).toBe("10.1234567");
    expect(UsdcAmountSchema.parse("10")).toBe("10");
    expect(UsdcAmountSchema.parse("0.0000001")).toBe("0.0000001");
  });

  it("rejects amounts with > 7 fractional places", () => {
    expect(() => UsdcAmountSchema.parse("10.12345678")).toThrow();
  });

  it("rejects non-positive amounts", () => {
    expect(() => UsdcAmountSchema.parse("0")).toThrow();
    expect(() => UsdcAmountSchema.parse("0.00")).toThrow();
    expect(() => UsdcAmountSchema.parse("-1.00")).toThrow();
  });
});

describe("CreateOrderInputSchema", () => {
  it("accepts valid order with brl_amount", () => {
    expect(CreateOrderInputSchema.parse({
      brl_amount: "100.00",
      external_ref: "cart_42",
    })).toBeTruthy();
  });

  it("accepts valid order with usd_amount", () => {
    expect(CreateOrderInputSchema.parse({
      usd_amount: "10.50",
      external_ref: "cart_43",
    })).toBeTruthy();
    expect(CreateOrderInputSchema.parse({
      usd_amount: "10.1234567",
      external_ref: "cart_44",
    })).toBeTruthy();
  });

  it("rejects negative amount", () => {
    expect(() => CreateOrderInputSchema.parse({ brl_amount: "-1.00" })).toThrow();
    expect(() => CreateOrderInputSchema.parse({ usd_amount: "-1.00" })).toThrow();
  });

  it("rejects brl_amount with > 2 decimals", () => {
    expect(() => CreateOrderInputSchema.parse({ brl_amount: "100.123" })).toThrow();
  });

  it("rejects usd_amount with > 7 decimals", () => {
    expect(() => CreateOrderInputSchema.parse({ usd_amount: "100.12345678" })).toThrow();
  });
});

describe("OrderStatusSchema", () => {
  it("includes all known statuses", () => {
    for (const s of ["pending","paid","underpaid","expired","cancelled","dead"]) {
      expect(OrderStatusSchema.parse(s)).toBe(s);
    }
  });
});

describe("LimitQuerySchema", () => {
  it("defaults to 50 when undefined", () => {
    expect(LimitQuerySchema.parse(undefined)).toBe(50);
  });

  it("parses valid positive integer within 1..200", () => {
    expect(LimitQuerySchema.parse("1")).toBe(1);
    expect(LimitQuerySchema.parse("50")).toBe(50);
    expect(LimitQuerySchema.parse("200")).toBe(200);
  });

  it("caps values > 200 at 200", () => {
    expect(LimitQuerySchema.parse("250")).toBe(200);
    expect(LimitQuerySchema.parse("1000")).toBe(200);
  });

  it("rejects non-numeric values", () => {
    expect(() => LimitQuerySchema.parse("abc")).toThrow();
    expect(() => LimitQuerySchema.parse("12a")).toThrow();
    expect(() => LimitQuerySchema.parse("")).toThrow();
    expect(() => LimitQuerySchema.parse(" ")).toThrow();
  });

  it("rejects negative numbers and zero", () => {
    expect(() => LimitQuerySchema.parse("-1")).toThrow();
    expect(() => LimitQuerySchema.parse("0")).toThrow();
  });

  it("rejects floating point decimals", () => {
    expect(() => LimitQuerySchema.parse("10.5")).toThrow();
    expect(() => LimitQuerySchema.parse("50.0")).toThrow();
  });
});
