import { describe, it, expect } from "vitest";
import { toBaseUnits, fromBaseUnits, USDC_DECIMALS } from "./usdc.ts";

describe("toBaseUnits", () => {
  it("converts integer amounts", () => {
    expect(toBaseUnits("10")).toBe(10_000_000n);
    expect(toBaseUnits("1")).toBe(1_000_000n);
    expect(toBaseUnits("100")).toBe(100_000_000n);
  });

  it("converts decimal amounts", () => {
    expect(toBaseUnits("10.5")).toBe(10_500_000n);
    expect(toBaseUnits("0.000001")).toBe(1n); // minimum unit
    expect(toBaseUnits("1.123456")).toBe(1_123_456n);
  });

  it("rejects scientific notation (1e3)", () => {
    expect(() => toBaseUnits("1e3")).toThrow();
    expect(() => toBaseUnits("1E6")).toThrow();
  });

  it("rejects junk strings", () => {
    expect(() => toBaseUnits("abc")).toThrow();
    expect(() => toBaseUnits("")).toThrow();
    expect(() => toBaseUnits("   ")).toThrow();
    expect(() => toBaseUnits("-1")).toThrow();
    expect(() => toBaseUnits("+1")).toThrow();
    expect(() => toBaseUnits("1.2.3")).toThrow();
  });

  it("rejects more than 6 decimal places", () => {
    expect(() => toBaseUnits("1.1234567")).toThrow(/too many decimal/);
    expect(() => toBaseUnits("0.0000001")).toThrow(/too many decimal/);
  });

  it("rejects zero and negative-equivalent", () => {
    expect(() => toBaseUnits("0")).toThrow();
    expect(() => toBaseUnits("0.0")).toThrow();
    expect(() => toBaseUnits("0.000000")).toThrow();
  });
});

describe("fromBaseUnits", () => {
  it("converts integer result", () => {
    expect(fromBaseUnits(10_000_000n)).toBe("10");
    expect(fromBaseUnits(1_000_000n)).toBe("1");
  });

  it("converts fractional result", () => {
    expect(fromBaseUnits(10_500_000n)).toBe("10.5");
    expect(fromBaseUnits(1n)).toBe("0.000001");
    expect(fromBaseUnits(1_123_456n)).toBe("1.123456");
  });

  it("round-trips through toBaseUnits", () => {
    const cases = ["10.5", "1.123456", "0.000001", "1000"];
    for (const c of cases) {
      expect(fromBaseUnits(toBaseUnits(c))).toBe(c);
    }
  });
});

describe("USDC_DECIMALS", () => {
  it("is 6", () => {
    expect(USDC_DECIMALS).toBe(6);
  });
});
