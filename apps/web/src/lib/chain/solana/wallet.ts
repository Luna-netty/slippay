// Solana biometric wallet binding (passkey, non-custodial).
//
// LazorKit is the active wallet: a passkey smart wallet that verifies the device
// P-256 assertion ON-CHAIN via the secp256r1 precompile (SIMD-0075, mainnet since
// 2025-06), so a paymaster sponsors gas WITHOUT custody — the user's funds move
// only because the on-chain program accepts the passkey. This mirrors the Stellar
// passkey/relayer model (lib/passkey.ts) on Solana.
//
// LazorKit's API is a React hook (useWallet) — connect()/signAndSendTransaction
// live in component land. The bridge (components/SolanaWalletGate) binds a
// connected wallet here as a plain executor so the chain adapter stays React-free.
//
// NON-CUSTODIAL caveat for mainnet cutover: LazorKit V2's audit is INTERNAL (not
// an independent third-party audit) with noted critical/high items. Acceptable on
// devnet; revisit before mainnet with real funds.

import type { TransactionInstruction } from "@solana/web3.js";

/** A connected biometric wallet, reduced to what the adapter needs: an address
 *  to pay from, and an executor that signs (passkey) + sponsors (paymaster) +
 *  submits a set of instructions, returning the tx signature. */
export interface SolanaWallet {
  /** vaultPda — the fund-holding account; used as the SPL source / fee owner. */
  address: string;
  execute(instructions: TransactionInstruction[]): Promise<string>;
}

let bound: SolanaWallet | null = null;

/** Bind/unbind the active wallet (called by the React wallet gate on connect). */
export function bindSolanaWallet(wallet: SolanaWallet | null): void { bound = wallet; }

export function boundSolanaWallet(): SolanaWallet {
  if (!bound) throw new Error("no solana wallet connected — tap the biometric button to connect");
  return bound;
}
