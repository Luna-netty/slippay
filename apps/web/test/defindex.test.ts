import { describe, it, expect } from "vitest";
import { usdcToStroops, stroopsToUsdc } from "../src/lib/defindex.ts";

// USDC on Stellar has 7 decimals: 1 USDC = 10_000_000 stroops.
// The DeFindex SDK takes `amounts: number[]` as RAW integer stroops, while the
// rest of Slippay passes human decimal strings. A units mistake here silently
// moves 10^7x the intended amount — these tests are the guard.
describe("usdcToStroops", () => {
  it("converts a whole number of USDC to stroops", () => {
    expect(usdcToStroops("10")).toBe(100_000_000);
  });

  it("converts a decimal amount to stroops", () => {
    expect(usdcToStroops("10.5")).toBe(105_000_000);
  });

  it("does NOT introduce float error (1.1 * 1e7 === 11000000.000000002 in JS)", () => {
    expect(usdcToStroops("1.1")).toBe(11_000_000);
    expect(usdcToStroops("10.50")).toBe(105_000_000);
  });

  it("handles the smallest unit (1 stroop)", () => {
    expect(usdcToStroops("0.0000001")).toBe(1);
  });

  it("rejects zero and negative amounts", () => {
    expect(() => usdcToStroops("0")).toThrow();
    expect(() => usdcToStroops("-5")).toThrow();
  });

  it("rejects non-numeric input", () => {
    expect(() => usdcToStroops("abc")).toThrow();
    expect(() => usdcToStroops("")).toThrow();
  });

  it("rejects more than 7 decimal places instead of silently truncating funds", () => {
    expect(() => usdcToStroops("1.12345678")).toThrow();
  });
});

describe("stroopsToUsdc", () => {
  it("converts stroops back to a trimmed decimal string", () => {
    expect(stroopsToUsdc(105_000_000)).toBe("10.5");
    expect(stroopsToUsdc(100_000_000)).toBe("10");
    expect(stroopsToUsdc(1)).toBe("0.0000001");
    expect(stroopsToUsdc(0)).toBe("0");
  });

  it("round-trips with usdcToStroops (inputs already canonical)", () => {
    for (const v of ["10", "10.5", "0.0000001", "1.1", "999.9999999"]) {
      expect(stroopsToUsdc(usdcToStroops(v))).toBe(v);
    }
  });
});
