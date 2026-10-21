# 4P ramp on Solana — funding the LazorKit smart wallet

Goal: in production, the buyer funds their Solana biometric (LazorKit) smart
wallet via Pix → USDC on Solana, delivered by 4P directly to the wallet address.
This replaces the devnet test-mint (`scripts/devnet-testmint.cjs`), which is e2e
only.

## Verified (2026-06-18)
- 4P API key is **active**: `GET /v1/4p/status` → `{"enabled":true,"provider":"4p","chain":"Base","asset":"USDC","rails":["pix"]}` (was 401 on 16/06).
- 4P (Gabriel Broetto, comercial) confirmed networks: **Polygon, Ethereum, Base, Solana, Avalanche, Arbitrum**.
- Backend **already supports Solana with no code change**: `POST /v1/4p/onramp`
  takes optional `chain` + required `receiverWallet`, forwarded to the 4P
  `PUT /v1/pix/transaction` as `chain` + `custom_data.receiver_wallet`
  (routes/fourp.ts:129/135/162, lib/fourp/client.ts:160/162). Default chain is
  env `FOURP_CHAIN` ("Base"); per-request `chain` overrides it.

## The Solana onramp request (no backend change)
The Solana `/cash` posts the smart-wallet address as the receiver and overrides
the chain — Base stays the default for everything else:

```
POST https://api.slippay.cc/api/v1/4p/onramp
{
  "amountBrl": 50.00,
  "receiverWallet": "<LazorKit vault PDA, base58>",
  "chain": "Solana",
  "asset": "USDC",
  "email": "buyer@example.com",
  "cpf": "<cpf>"
}
```

## Gated on (before a real Solana onramp)
1. **Confirm with 4P (Gabriel):** does 4P deliver *native USDC on Solana* (Circle
   mint) via API? Exact `chain` identifier string ("Solana"?) and the
   `receiver_wallet` format for Solana. Network listed ≠ asset guaranteed.
2. **Frontend:** Cash.tsx (Solana mode) passes `chain:"Solana"` + the connected
   LazorKit `smartWalletPubkey` as `receiverWallet`. Small wiring; do once (1) is
   confirmed.
3. **Empirical probe (side-effecting — needs operator ok):** one onramp with a
   tiny amount creates an *unpaid* Pix charge on the 4P account; it confirms 4P
   accepts `chain:"Solana"` without moving money. Not run unilaterally.

## NOT done (deliberately)
- Did NOT flip `FOURP_CHAIN` global to Solana (per-request override is enough and
  keeps Base intact).
- Did NOT create a 4P onramp (outward-facing side effect).
