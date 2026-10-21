import { describe, it, expect } from "vitest";
import { DEFAULT_PLATFORM_FEE_BP } from "../src/index.ts";

/**
 * Canonical fee calculation per docs/fees.md
 */
export function calculateFee(grossBaseUnits: bigint, feeBp: number): { net: bigint; fee: bigint } {
  if (!Number.isInteger(feeBp) || feeBp < 0 || feeBp > 10_000) {
    throw new Error("invalid_fee_bp");
  }
  const fee = (grossBaseUnits * BigInt(feeBp)) / 10_000n;
  const net = grossBaseUnits - fee;
  return { net, fee };
}

describe("docs/fees.md canonical fee arithmetic specification vectors", () => {
  it("Vector 1: Standard Exact Settlement (100 USDC @ 297 bp)", () => {
    // 100 USDC = 100 * 10^7 = 1,000,000,000 stroops
    const gross = 1_000_000_000n;
    const { net, fee } = calculateFee(gross, 297);
    expect(fee).toBe(29_700_000n); // 2.97 USDC
    expect(net).toBe(970_300_000n); // 97.03 USDC
    expect(net + fee).toBe(gross);
  });

  it("Vector 2: Inexact Division with Fractional Dust (1.0000001 USDC @ 297 bp)", () => {
    // 1.0000001 USDC = 10,000,001 stroops
    const gross = 10_000_001n;
    const { net, fee } = calculateFee(gross, 297);
    // 10000001 * 297 = 2970000297. Floor / 10000 = 297000 stroops
    expect(fee).toBe(297_000n);
    expect(net).toBe(9_703_001n);
    expect(net + fee).toBe(gross);
    // Verifies that merchant receives the fractional remainder dust (0.0297 stroops discarded from fee)
  });

  it("Vector 3: Sub-Cent Micro-Payment (1 stroop @ 297 bp)", () => {
    const gross = 1n;
    const { net, fee } = calculateFee(gross, 297);
    // 1 * 297 / 10000 = 0 fee
    expect(fee).toBe(0n);
    expect(net).toBe(1n);
    expect(net + fee).toBe(gross);
  });

  it("Vector 4: Zero-Fee Account (50 USDC @ 0 bp)", () => {
    const gross = 500_000_000n;
    const { net, fee } = calculateFee(gross, 0);
    expect(fee).toBe(0n);
    expect(net).toBe(gross);
    expect(net + fee).toBe(gross);
  });

  it("Conservation invariant: net + fee === gross for all valid ranges", () => {
    const testCases: [bigint, number][] = [
      [12_500_000n, 297],
      [999_999n, 297],
      [10_000_000n, DEFAULT_PLATFORM_FEE_BP],
      [5_432_109n, 100],
      [100_000_000n, 1000],
      [77_777_777n, 499],
    ];

    for (const [gross, bp] of testCases) {
      const { net, fee } = calculateFee(gross, bp);
      expect(net + fee).toBe(gross);
      expect(net).toBeGreaterThanOrEqual(0n);
      expect(fee).toBeGreaterThanOrEqual(0n);
    }
  });

  it("Rejects invalid fee basis points bounds (< 0 or > 10000)", () => {
    expect(() => calculateFee(100n, -1)).toThrow("invalid_fee_bp");
    expect(() => calculateFee(100n, 10_001)).toThrow("invalid_fee_bp");
  });
});
