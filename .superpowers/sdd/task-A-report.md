# Task A Report — Comex Privy Foundation

## Files created

| File | Purpose |
|---|---|
| `apps/web/src/lib/comexPrivy.tsx` | ComexPrivyProvider + useComexWallet hook |
| `apps/web/src/components/ConfirmTxModal.tsx` | Security-critical TX confirmation modal |
| `apps/web/src/pages/Comex.tsx` | /comex shell page (loading / unauthenticated / dashboard) |
| `apps/web/src/pages/comex/Dashboard.tsx` | Dashboard placeholder with tab nav |
| `apps/web/src/App.tsx` | Added comex route (modified) |

## Exact Privy SDK calls used

```
// from @privy-io/react-auth@3.32.2
PrivyProvider (component) — wraps with appId + config
usePrivy() — { ready, authenticated, user, login, logout }
useWallets() — { wallets: ConnectedWallet[] }
useMfaEnrollment() — { showMfaEnrollmentModal } (called but modal trigger deferred)
ConnectedWallet.sign(hexString) — personal_sign via embedded wallet
ConnectedWallet.address — stable wallet address (Ethereum hex)
ConnectedWallet.walletClientType — used to identify embedded wallet ("privy" | "privy-v2")
```

Config shape used:
```ts
{
  loginMethods: ["email"],
  embeddedWallets: {
    ethereum: { createOnLogin: "users-without-wallets" }
  },
  mfa: {
    noPromptOnMfaRequired: false
  }
}
```

## Assumptions made

1. **Ethereum embedded wallet, not Stellar.** Privy v3.32 React SDK does not expose a Stellar (Ed25519) embedded wallet client-side. `address` is the Ethereum hex address. Callers needing a Stellar G... address must derive it separately or use server-wallet rawSign (privyWallet.ts).

2. **signHash uses personal_sign (EIP-191 prefix).** `ConnectedWallet.sign()` is the only available signing method on the client-side wallet. Raw hash signing (no prefix) requires the server-wallet `walletApi.rawSign` path. This is documented in VERIFY-WITH-KEYS comments.

3. **MFA enforcement deferred.** Comex.tsx calls `useMfaEnrollment()` but does not programmatically block dashboard access — `usePrivy().user.mfaMethods` must be checked post-App-ID-config. The hook is in place; the gate is a one-liner VERIFY-WITH-KEYS comment.

4. **`PrivyClientConfig.embeddedWallets.ethereum.createOnLogin`** — the spec said top-level `embeddedWallets: { createOnLogin: "users-without-wallets" }` but the actual type nests it under `ethereum` or `solana` sub-objects. Used `ethereum: { createOnLogin: "users-without-wallets" }` which matches the type definition.

## tsc result

```
npx tsc --noEmit -p apps/web/tsconfig.json
(no output — zero errors)
```

## Commit hash

`6e2ae54`

## VERIFY-WITH-KEYS notes

- `comexPrivy.tsx` line 1: top-level comment flags all calls as unverifiable without `VITE_PRIVY_APP_ID`
- `signHash`: `ConnectedWallet.sign()` applies EIP-191 prefix. If Stellar raw signing is needed, use `rawSignHash` from `privyWallet.ts` (server-wallet path)
- MFA gate: add `usePrivy().user.mfaMethods.length === 0` check in `Comex.tsx` before rendering dashboard once App ID is configured
- `address` field: Ethereum hex, not Stellar G... — downstream callers that need Stellar must map separately

---

## UPDATE — Stellar extended-chain rewrite (2026-06-22)

`comexPrivy.tsx` rewritten to use Privy's client-side Stellar (Ed25519) support via `@privy-io/react-auth/extended-chains`.

### Exact Privy API calls used (verbatim from installed types, @privy-io/react-auth@3.32.2)

**Wallet creation** (`@privy-io/react-auth/extended-chains` · `extended-chains.d.ts:28`):
```ts
const { createWallet } = useCreateWallet();
// useCreateWallet: () => UseCreateWalletInterface
// createWallet: (input: CreateWalletInput) => Promise<CreateWalletOutput>
// CreateWalletInput.chainType: CurveSigningChainType | 'spark'
// CurveSigningChainType includes 'stellar' (wallets.d.ts:174)
const { wallet } = await createWallet({ chainType: 'stellar' });
// wallet.address → G... Stellar account ID (Wallet.address: string)
```

**Address retrieval** (from `user.linkedAccounts`, `types-sr2FRXdy.d.ts:1234`):
```ts
// WalletWithMetadata extends Wallet { type: 'wallet'; chainType: WalletChainType; address: string; id?: string | null }
const stellarAccount = user.linkedAccounts.find(
  (a) => a.type === 'wallet' && a.chainType === 'stellar'
);
// stellarAccount.address → G... address
```

**Sign raw hash** (`@privy-io/react-auth/extended-chains` · `extended-chains.d.ts:75`):
```ts
const { signRawHash } = useSignRawHash();
// useSignRawHash: () => UseSignRawHashInterface
// signRawHash: (input: SignRawHashInput) => Promise<SignRawHashOutput>
// SignRawHashInput { address: string; chainType: CurveSigningChainType; hash: `0x${string}` }
// SignRawHashOutput { signature: `0x${string}` }  // 64-byte Ed25519 r+s
const { signature } = await signRawHash({
  address,           // G... Stellar address
  chainType: 'stellar',
  hash: `0x${hexHash}`,
});
```

### tsc result (post-rewrite)

```
npx tsc --noEmit -p apps/web/tsconfig.json
(no output — zero errors)
```
