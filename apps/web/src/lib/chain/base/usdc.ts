// Base USDC config + amount math. USDC has 6 decimals on Base (ERC-20, Circle canonical).
// Mainnet address is fixed; testnet is env-overridable via VITE_BASE_USDC.
// Network is env-driven: VITE_BASE_NETWORK = "mainnet" (default) | "sepolia".

import { createPublicClient, http, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";

export type BaseNet = "mainnet" | "sepolia";

export function baseNet(): BaseNet {
  const v = (import.meta.env.VITE_BASE_NETWORK ?? "mainnet").toLowerCase();
  return v === "sepolia" ? "sepolia" : "mainnet";
}

// Circle USDC on Base mainnet — canonical, not overridable.
// Sepolia testnet address is overridable for test mints.
const USDC_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

const USDC_ADDRESSES: Record<BaseNet, `0x${string}`> = {
  mainnet: USDC_MAINNET,
  sepolia: ((import.meta.env.VITE_BASE_USDC as string | undefined) ??
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`,
};

// Public Base RPC — overridable for paid endpoints.
const DEFAULT_RPCS: Record<BaseNet, string> = {
  mainnet: "https://mainnet.base.org",
  sepolia: "https://sepolia.base.org",
};

export function rpcUrl(net: BaseNet = baseNet()): string {
  return (import.meta.env.VITE_BASE_RPC as string | undefined) ?? DEFAULT_RPCS[net];
}

export function usdcAddress(net: BaseNet = baseNet()): `0x${string}` {
  return USDC_ADDRESSES[net];
}

export const USDC_ADDRESS: `0x${string}` = usdcAddress();

export const USDC_DECIMALS = 6;

/**
 * Human USDC string ("12.50") → integer base units (bigint). Throws on junk.
 *
 * STRICT gate order:
 *   1. regex: /^\d+(\.\d+)?$/ on trimmed — rejects "1e3", signs, spaces, empty
 *   2. >6 decimal places → reject
 *   3. parsed value <= 0 → reject
 */
export function toBaseUnits(human: string): bigint {
  const trimmed = human.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`baseUsdc: invalid amount format: "${human}"`);
  }
  const parts = trimmed.split(".");
  const frac = parts[1] ?? "";
  if (frac.length > USDC_DECIMALS) {
    throw new Error(`baseUsdc: too many decimal places (max ${USDC_DECIMALS}): "${human}"`);
  }
  const whole = parts[0]!;
  const fracPadded = (frac + "000000").slice(0, USDC_DECIMALS);
  const units = BigInt(whole) * 1_000_000n + BigInt(fracPadded || "0");
  if (units <= 0n) {
    throw new Error(`baseUsdc: amount must be > 0: "${human}"`);
  }
  return units;
}

/** Integer base units → human-readable USDC string (trims trailing zeros). */
export function fromBaseUnits(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  if (frac === 0n) return `${whole}`;
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

const _chain: Chain = baseNet() === "sepolia" ? baseSepolia : base;

/** viem publicClient for read-only calls (balanceOf, allowance, etc.). */
export const publicClient: ReturnType<typeof createPublicClient> = createPublicClient({
  chain: _chain,
  transport: http(rpcUrl()),
});
