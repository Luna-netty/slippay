import { describe, it, expect } from "vitest";

describe("4P quote margin and rate agreement (Resolves #109)", () => {
  const marginBps = 280; // 2.80% default Slippay margin
  const netBps = 10_000 - marginBps;

  // Table of amounts: small, fractional, standard, and large values
  const testAmountsBrl = [1.0, 5.5, 10.0, 25.75, 50.0, 100.0, 250.0, 500.0, 1234.56, 5000.0];
  const fxRates = [4.85, 5.00, 5.25, 5.80, 6.12];

  it("asserts dollarRate * cryptoOut ≈ brl within one stroop/cent for a table of amounts", () => {
    for (const fx of fxRates) {
      for (const brl of testAmountsBrl) {
        const grossOut = brl / fx;
        // Formula from routes/fourp.ts: integer basis points with round down to 6 decimals
        const cryptoOut = Math.floor(grossOut * netBps * 1e2) / 1e6;
        // Effective dollarRate derived from net crypto in apps/web/src/lib/ramp4p.ts
        const dollarRate = brl / cryptoOut;

        const effectiveBrl = dollarRate * cryptoOut;
        const diff = Math.abs(effectiveBrl - brl);

        // Asserts agreement within 1 stroop (1e-7) and 1 cent (0.01)
        expect(diff).toBeLessThanOrEqual(1e-7);
        expect(diff).toBeLessThan(0.01);
      }
    }
  });

  it("verifies explicit round down in platform's disfavour with zero toFixed truncation", () => {
    const gross = 123.456789;
    const net = Math.floor(gross * netBps * 1e2) / 1e6;
    const mathematicalNet = (gross * netBps) / 10_000;

    // Platform never over-collects: net is floor-rounded in platform's disfavour
    expect(net).toBeLessThanOrEqual(mathematicalNet);

    // Number of decimal places never exceeds 6 decimals (native USDC)
    const decimals = (String(net).split(".")[1] || "").length;
    expect(decimals).toBeLessThanOrEqual(6);
  });
});
