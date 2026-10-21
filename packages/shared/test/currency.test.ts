import { describe, it, expect } from "vitest";
import {
  STROOPS_PER_UNIT,
  MAX_STELLAR_DECIMALS,
  stellarToStroops,
  stroopsToStellar,
  compareStellarAmounts,
} from "../src/index.ts";

describe("packages/shared currency & stroop arithmetic (Issue #315)", () => {
  describe("constants and scale invariants", () => {
    it("defines 10,000,000 stroops per 1 unit and 7 decimal places", () => {
      expect(STROOPS_PER_UNIT).toBe(10_000_000n);
      expect(MAX_STELLAR_DECIMALS).toBe(7);
    });
  });

  describe("stellarToStroops", () => {
    it("converts whole integers to stroops", () => {
      expect(stellarToStroops("0")).toBe(0n);
      expect(stellarToStroops("1")).toBe(10_000_000n);
      expect(stellarToStroops("100")).toBe(1_000_000_000n);
    });

    it("converts exact 7-decimal Stellar amounts to stroops", () => {
      expect(stellarToStroops("0.0000001")).toBe(1n); // exactly 1 stroop
      expect(stellarToStroops("0.0000010")).toBe(10n);
      expect(stellarToStroops("1.0000000")).toBe(10_000_000n);
      expect(stellarToStroops("10.5000000")).toBe(105_000_000n);
      expect(stellarToStroops("10.5000001")).toBe(105_000_001n);
      expect(stellarToStroops("1234.5678901")).toBe(12_345_678_901n);
    });

    it("correctly pads short fractional decimal strings", () => {
      expect(stellarToStroops("1.5")).toBe(15_000_000n);
      expect(stellarToStroops("1.05")).toBe(10_500_000n);
      expect(stellarToStroops("1.005")).toBe(10_050_000n);
      expect(stellarToStroops("1.0005")).toBe(10_005_000n);
      expect(stellarToStroops("1.00005")).toBe(10_000_500n);
      expect(stellarToStroops("1.000005")).toBe(10_000_050n);
    });

    it("rejects trailing dot without fractional digits", () => {
      expect(() => stellarToStroops("1.")).toThrow(/bad_amount/);
    });


    it("handles surrounding whitespace cleanly", () => {
      expect(stellarToStroops("  10.5000000  ")).toBe(105_000_000n);
    });

    it("rejects negative amounts", () => {
      expect(() => stellarToStroops("-1")).toThrow(/bad_amount/);
      expect(() => stellarToStroops("-0.0000001")).toThrow(/bad_amount/);
      expect(() => stellarToStroops("-10.5")).toThrow(/bad_amount/);
    });

    it("rejects scientific notation", () => {
      expect(() => stellarToStroops("1e-7")).toThrow(/bad_amount/);
      expect(() => stellarToStroops("1e7")).toThrow(/bad_amount/);
      expect(() => stellarToStroops("1.5e3")).toThrow(/bad_amount/);
    });

    it("rejects amounts with more than 7 fractional digits", () => {
      expect(() => stellarToStroops("1.00000001")).toThrow(/bad_amount/);
      expect(() => stellarToStroops("0.12345678")).toThrow(/bad_amount/);
      expect(() => stellarToStroops("10.99999999")).toThrow(/bad_amount/);
    });

    it("rejects non-numeric strings, malformed decimals, and empty inputs", () => {
      expect(() => stellarToStroops("")).toThrow(/bad_amount/);
      expect(() => stellarToStroops("   ")).toThrow(/bad_amount/);
      expect(() => stellarToStroops("abc")).toThrow(/bad_amount/);
      expect(() => stellarToStroops("1.2.3")).toThrow(/bad_amount/);
      expect(() => stellarToStroops("1,000.00")).toThrow(/bad_amount/);
      expect(() => stellarToStroops(null as unknown as string)).toThrow(/bad_amount/);
      expect(() => stellarToStroops(undefined as unknown as string)).toThrow(/bad_amount/);
    });
  });

  describe("stroopsToStellar", () => {
    it("formats stroops back into canonical 7-decimal strings", () => {
      expect(stroopsToStellar(0n)).toBe("0.0000000");
      expect(stroopsToStellar(1n)).toBe("0.0000001");
      expect(stroopsToStellar(10_000_000n)).toBe("1.0000000");
      expect(stroopsToStellar(105_000_000n)).toBe("10.5000000");
      expect(stroopsToStellar(12_345_678_901n)).toBe("1234.5678901");
    });

    it("formats negative stroops with leading minus sign", () => {
      expect(stroopsToStellar(-1n)).toBe("-0.0000001");
      expect(stroopsToStellar(-10_000_000n)).toBe("-1.0000000");
    });

    it("round-trips canonical 7-decimal strings losslessly", () => {
      const samples = [
        "0.0000001",
        "0.0000010",
        "1.0000000",
        "10.5000000",
        "10.5000001",
        "99.9999999",
        "10000000.0000000",
      ];
      for (const s of samples) {
        expect(stroopsToStellar(stellarToStroops(s))).toBe(s);
      }
    });
  });

  describe("compareStellarAmounts & IEEE-754 precision drift protection", () => {
    it("asserts exact match when amounts are identical", () => {
      const res = compareStellarAmounts("10.5000000", "10.5000000");
      expect(res.matches).toBe(true);
      expect(res.diffStroops).toBe(0n);
      expect(res.gotStroops).toBe(105_000_000n);
      expect(res.wantStroops).toBe(105_000_000n);
    });

    it("strictly rejects a 1-stroop difference at the 7th decimal", () => {
      const res1 = compareStellarAmounts("10.5000000", "10.5000001");
      expect(res1.matches).toBe(false);
      expect(res1.diffStroops).toBe(1n);

      const res2 = compareStellarAmounts("10.5000000", "10.4999999");
      expect(res2.matches).toBe(false);
      expect(res2.diffStroops).toBe(1n);
    });

    it("demonstrates precision traps where JavaScript Number() floating point fails", () => {
      // In JS binary floating point:
      // 0.1 + 0.2 === 0.30000000000000004 !== 0.3
      const num1 = Number("0.1000000");
      const num2 = Number("0.2000000");
      const numSum = num1 + num2;
      expect(numSum).not.toBe(0.3); // Proves IEEE-754 failure

      // In stroops (BigInt integer arithmetic):
      const stroop1 = stellarToStroops("0.1000000"); // 1,000,000n
      const stroop2 = stellarToStroops("0.2000000"); // 2,000,000n
      const stroopSum = stroop1 + stroop2;
      expect(stroopSum).toBe(stellarToStroops("0.3000000")); // Exactly 3,000,000n!
      expect(stroopsToStellar(stroopSum)).toBe("0.3000000");
    });

    it("supports an explicit stated tolerance in stroops when requested", () => {
      // Allow up to 2 stroops tolerance
      const res = compareStellarAmounts("10.5000000", "10.5000002", { maxDriftStroops: 2n });
      expect(res.matches).toBe(true);
      expect(res.diffStroops).toBe(2n);

      const resExceeded = compareStellarAmounts("10.5000000", "10.5000003", { maxDriftStroops: 2n });
      expect(resExceeded.matches).toBe(false);
      expect(resExceeded.diffStroops).toBe(3n);
    });
  });
});
