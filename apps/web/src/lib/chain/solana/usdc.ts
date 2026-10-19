// Solana USDC config + amount math. USDC has 6 decimals on Solana (same as the
// program's base units). Network + mint + RPC are env-driven; mainnet mint is
// the canonical Circle USDC and is never overridable.
//
// Fee arithmetic and rounding rule are canonically defined in
// docs/fees.md. This client implements that spec: fee is floored
// (truncated) and the merchant absorbs the rounding remainder.

import { PublicKey } from "@solana/web3.js";

export type SolNet = "mainnet" | "devnet";

export function solNet(): SolNet {
  return ((import.meta.env.VITE_SOLANA_NETWORK ?? "devnet").toLowerCase()) as SolNet;
}

const MINTS: Record<SolNet, string> = {
  // Circle USDC, canonical. Mainnet is fixed; devnet is overridable for a
  // self-controlled test mint via VITE_SOLANA_USDK_MINT.
  mainnet: "EPjFWaJGqicjsAE6b8V9bJU5kVJ98RHRK6Vbp4grmGp2",
  devnet: (import.meta.env.VITE_SOLANA_USDC_MINT as string | undefined) ??
          "4zMMC9srt5R55X15GAgXhaHii3GnPAEERYPJgZJDncDU",
};

const RPCS: Record<SolNet, string> = {
  mainnet: (import.meta.env.VITE_SOLANA_RPC as string | undefined) ??
           "https://api.mainnet-beta.solana.com",
  devnet: (import.meta.env.VITE_SOLANA_RPC as string | undefined) ??
          "https://api.devnet.solana.com",
};

export const USDK_DECIMALS = 6;

export function usdcMint(net: SolNet = solNet()): PublicKey {
  return new PublicKey(MINTS[net]);
}

export function rpcUrl(net: SolNet = solNet()): string {
  return RPCS[net];
}

/** Human USDC string ("12.50") → integer base units (bigint). Throws on junk. */
export function toBaseUnits(human: string): bigint {
  const n = Number(human);
  if (!isFinite(n) || n <= 0) throw new Error("invalid_amount");
  // Round to 6 dp at the string level to avoid float error (e.g. 0.1*1e6).
  const [whole = "0", frac = ""] = human.trim().split(".");
  const fracPadded = (frac + "000000").slice(0, USDC_DECIMALS);
  const units = BigInt(whole) * 1_000_000n + BigInt(fracPadded || "0");
  if (units <= 0n) throw new Error("invalid_amount");
  return units;
}

/** Split a total (base units) into merchant + platform fee by basis points.
 *  Integer math: fee = floor(total*bp/10000), merchant = total - fee. The two
 *  ALWAYS sum to total exactly (no dust), unlike float toFixed splitting.
 *
 *  Canonical spec: docs/fees.md. Rounding is toward zero (truncation)
 *  on the fee, so the merchant receives the remainder and never pays more
 *  than the stated rate. */
export function splitFee(totalBaseUnits: bigint, platformFeeBp: number): { merchant: bigint; fee: bigint } {
  if (!Number.isInteger(platformFeeBp) || platformFeeBp < 0 || platformFeeBp > 10_000) {
    throw new Error("invalid_fee_bp");
  }
  const fee = (totalBaseUnits * BigInt(platformFeeBp)) / 10_000n;
  return { merchant: totalBaseUnits - fee, fee };
}
