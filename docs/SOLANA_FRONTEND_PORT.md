# Solana frontend port — chain adapter abstraction

Branch: `feat/solana-adapter` (off `feat/dark-yeezy-redesign`, which holds the canonical porquinho landing). Non-destructive: Stellar stays the live/default chain. Solana is opt-in via `VITE_CHAIN=solana`.

Decision (operator, 2026-06-18):
- **Where:** abstract `lib/` behind a chain-agnostic interface with two adapters (Stellar + Solana), env-selectable. Both coexist → real backup.
- **Wallet:** adapt the existing passkey/relayer biometric pattern to Solana (NOT Privy — no App ID gate). Privy adapter exists in the slippay-solana SDK and can be swapped in later behind the same interface.

## Surface being abstracted (today, Stellar)
- `lib/wallet.ts` — connect/sign (StellarWalletsKit)
- `lib/stellar.ts` — `buildAtomicTx` (one-time 2-op payment), `submitSignedTx`, `fetchSequence`, `isValidStellarAddress`, `checkReceiveAddress`
- `lib/soroban.ts` — `approveAllowance` (the 1 signature for recurring), `requestOnchainCharge`, `signAndSubmitContractCharge`

Pages calling these: `Checkout.tsx` (one-time), `Sub.tsx` (recurring), `DashboardSettings.tsx`/`StellarAddressInput.tsx` (address validation). Landing (`LandingV2`) touches none.

## Interface (`lib/chain/types.ts`)
```ts
type ChainId = "stellar" | "solana";
interface AddressCheck { validFormat: boolean; accountExists: boolean | null; hasUsdcTrustline: boolean | null; }
interface ChainAdapter {
  id: ChainId;
  connectWallet(): Promise<string>;            // returns address
  isValidAddress(addr: string): boolean;       // offline
  checkReceiveAddress(addr: string): Promise<AddressCheck>;
  payOneTime(a: OneTimePayArgs): Promise<{ hash: string }>;   // build+sign+submit, hides XDR/Tx
  approveRecurring(a: ApproveArgs): Promise<{ hash: string }>;// the single allowance signature
}
```
- Stellar `hasUsdcTrustline` ⇄ Solana "recipient has a USDC ATA" (same onboarding guard, different mechanism).

## Increments
1. **[DONE 713356e] Interface + Stellar adapter (behavior-preserving).** Wrap existing libs. Lint+build green.
2. **[DONE 713356e/1a233fc/4d85860] Rewire to `getChainAdapter()`.** Checkout.payOneTime, Sub.authorizeRecurring, PayButton.connect, Dashboard/DashboardSettings/StellarAddressInput validation. Stellar byte-identical. `ApproveArgs` redesigned chain-agnostic ({buyerAddress, capUsdc, durationSecs}); SAC/ledger/unit mechanics moved into each adapter. `lib/chain/validate.ts` = sync dep-light format check. Sub.pay() left Stellar-only (Soroban charge has no Solana backend). Lint+build green.
3. **[DONE 5c61ed4] Solana adapter.** @solana/web3.js + spl-token + anchor added; IDL vendored; mandate client ported; lazy-load (377KB code-split). payOneTime = 2-transfer SPL split; approveRecurring = SPL approve→mandate PDA. 8 vitest green.
4. **[PENDING] Solana biometric wallet (passkey/relayer).** Port the passkey + relayer signer to Solana behind `bindSolanaWallet`/`connectWallet` (today throws until bound). Backend relayer work separate. Also: on-chain memo for order binding; ConnectWallet (CCTP dual) if needed. Gate: e2e on devnet/localnet.

Cutover stays gated until 4 proves out + devnet funding + ramp. Stellar remains default.
