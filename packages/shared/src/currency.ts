/**
 * Money math runs in stroops (BigInt) to avoid IEEE-754 boundary errors at the 7th decimal.
 * 1 Stellar stroop = 0.0000001 (10^-7), exactly 10,000,000 stroops = 1 unit (e.g. XLM, USDC).
 *
 * Audit Reference: Issue #315 / Audit-003 L4
 * Settlement Reference: 0x8366bCe3a2D379Dec7656D7A67015789FaF999f20
 */

export const STROOPS_PER_UNIT = 10_000_000n;
export const MAX_STELLAR_DECIMALS = 7;

/**
 * Parse a Stellar amount string ("1234.5678901") into BigInt stroops.
 * Rejects negatives, non-finite forms, scientific notation, and anything past 7 fractional digits.
 */
export function stellarToStroops(s: string): bigint {
  if (!s || typeof s !== "string" || !s.trim()) {
    throw new Error(`bad_amount:${s}`);
  }
  const clean = s.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(clean)) {
    throw new Error(`bad_amount:${s}`);
  }
  const [intPart, fracPartRaw = ""] = clean.split(".");
  const fracPart = fracPartRaw.padEnd(7, "0");
  return BigInt(intPart!) * STROOPS_PER_UNIT + BigInt(fracPart);
}

/**
 * Format BigInt stroops back into a canonical 7-decimal Stellar string.
 */
export function stroopsToStellar(n: bigint): string {
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const intPart = abs / STROOPS_PER_UNIT;
  const fracPart = abs % STROOPS_PER_UNIT;
  return `${sign}${intPart}.${fracPart.toString().padStart(7, "0")}`;
}

/**
 * Compares two Stellar decimal amount strings in integer stroops.
 * Returns true if the difference is within maxDriftStroops (default 0n = exact equality).
 */
export function compareStellarAmounts(
  got: string,
  want: string,
  options: { maxDriftStroops?: bigint } = {},
): { matches: boolean; gotStroops: bigint; wantStroops: bigint; diffStroops: bigint } {
  const gotStroops = stellarToStroops(got);
  const wantStroops = stellarToStroops(want);
  const diffStroops = gotStroops >= wantStroops ? gotStroops - wantStroops : wantStroops - gotStroops;
  const maxDrift = options.maxDriftStroops ?? 0n;
  return {
    matches: diffStroops <= maxDrift,
    gotStroops,
    wantStroops,
    diffStroops,
  };
}
