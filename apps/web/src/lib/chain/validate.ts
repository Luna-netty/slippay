// SYNC, dependency-light address format checks for render-time hard-blocks
// (e.g. disabling a Save button). The AUTHORITATIVE check — does the account
// exist / can it receive USDC — is the async adapter.checkReceiveAddress.
//
// Kept free of @solana/web3.js on purpose so importing it never pulls the Solana
// SDK into the default Stellar bundle. StrKey is already in the Stellar bundle;
// Solana format is a base58 shape check (a full 32-byte decode is the adapter's job).

import { StrKey } from "@stellar/stellar-sdk";
import type { ChainId } from "./types.ts";

const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function chainId(): ChainId {
  return ((import.meta.env.VITE_CHAIN ?? "stellar").toLowerCase()) as ChainId;
}

export function isValidStellarAddress(addr: string): boolean {
  return StrKey.isValidEd25519PublicKey(addr.trim());
}

export function isValidSolanaAddress(addr: string): boolean {
  return SOLANA_ADDR.test(addr.trim());
}

/** Sync format check for the active chain. */
export function isValidAddress(addr: string): boolean {
  return chainId() === "solana" ? isValidSolanaAddress(addr) : isValidStellarAddress(addr);
}
