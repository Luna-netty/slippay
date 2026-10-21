# Task: Solana Foundation — Report

## Files Created

- `apps/web/src/lib/comexSolana.tsx` — Privy Solana provider + hook
- `apps/web/src/lib/solanaAuthorize.ts` — USDC transfer security gate
- `apps/web/test/solanaAuthorize.test.ts` — 11 vitest tests

## Exact Privy Solana API Used (verbatim from installed types)

Source: `@privy-io/react-auth@3.32.2` dist/dts/solana.d.ts

```ts
// useCreateWallet (solana.d.ts line 186-199)
declare function useCreateWallet(): {
  createWallet: (options?: CreateWalletOptions) => Promise<{ wallet: Wallet }>;
};

// useSignTransaction (solana.d.ts line 262-266)
declare function useSignTransaction(): {
  signTransaction(input: SignTransactionInput): Promise<SignTransactionOutput>;
};
// where:
// SignTransactionInput = { transaction: Uint8Array, wallet: ConnectedStandardSolanaWallet, chain?: SolanaChain }
// SignTransactionOutput = { signedTransaction: Uint8Array }

// useWallets (solana.d.ts line 156-166)
declare function useWallets(): { ready: boolean; wallets: ConnectedStandardSolanaWallet[] };
```

`PrivyClientConfig.embeddedWallets.solana.createOnLogin` (types-sr2FRXdy.d.ts line 1805-1823):
- Type: `'all-users' | 'users-without-wallets' | 'off'`
- Used: `'all-users'` — every corporate email login auto-creates Solana wallet.

## VERIFY-WITH-KEYS Notes

- `@privy-io/react-auth/solana` is the correct import path (not `/extended-chains` which is Stellar).
- `ConnectedStandardSolanaWallet` is exported from `@privy-io/react-auth/solana` (re-exported from `@privy-io/js-sdk-core`).
- `useWallets()` returns only Privy embedded Solana wallets (not external injected).
- No `chainType` arg on `createWallet()` — the Solana-specific hook handles it.
- `tx.serialize({ requireAllSignatures: false, verifySignatures: false })` required pre-sign.

## Test Results

```
Test Files  9 passed (9)
     Tests  47 passed (47)
New tests:  11 passed (11)  [test/solanaAuthorize.test.ts]
```

## TypeScript

```
npx tsc --noEmit -p apps/web/tsconfig.json
# exit 0, no errors
```

## Build

```
VITE_COMEX_ENABLED=1 npx vite build
# ✓ built in 28.41s
# exit 0
# Chunk size warning is pre-existing (Privy + Solana bundles), not introduced by this PR.
```

## Gate Order Enforcement

`authorizeSolanaPayment` in `solanaAuthorize.ts`:
1. `buildUsdcTransfer` — constructs tx locally, sets blockhash from RPC
2. `decodeUsdcTransfer` — extracts to+amount from the built tx
3. `assertTransferMatches` — machine assert before human sees anything
4. `confirm(decoded)` — human confirmation callback
5. if `!approved` → throw "cancelado pelo usuário" (sign never called)
6. `signTransaction` — Privy embedded wallet signs
7. `sendAndConfirmRawTransaction` — on-chain submission
8. return `{ signature }`

Tests prove steps 5 and 3 both block signing before step 6.
