# Three surfaces, one core

SlipPay exposes one rail through three surfaces. They share the same non-custodial
settlement, the same contracts, and the same listener, but they are aimed at three
different users and present different routes and components. This page is the map
of which surface owns what, so the codebase does not get read as one
undifferentiated audience.

All three surfaces reduce to the same money path: build an unsigned transfer →
the user verifies what they sign (WYSIWYS gate) → the user signs → submit.

## 1. The human "dollar account" surface

For a person who wants to receive and pay USDC without running infrastructure.
The mental model is a dollar account: receive money, pay money, get a receipt.
No keys to manage by hand, no contract addresses to copy.

What it is for:

- receive USDC against a generated request (a QR or a checkout link)
- pay USDC with a biometric (passkey) instead of a seed phrase
- get a verifiable receipt for a payment that anyone can check

Routes and components (in `apps/web`):

- `/` (AgentHome) and `/human` (older Home) — the human landing.
- `/pay` — biometric pay. Real path: passkey secp256r1 -> smart-wallet ->
  relayer sponsors gas only. Mainnet path is real money. (smart-wallet itself is
  testnet only today; see the seam below.)
- `/cobrar` — merchant QR generator (produces a `slippay:pay` QR). Demo
  recipient today.
- `/checkout/:order_id` — one-time order pay.
- `/sub/:id` — on-chain recurring charge surface.
- `/comprovante/:txhash` — public payment verifier. Reads Horizon effects and
  the on-chain subscription state and judges payment against obligation.
- merchant-side app under `/dashboard*`.

On the off-chain plane this surface leans on the API's `/v1/orders`,
`/v1/subscriptions`, `/v1/merchants`, and `/v1/relayer`, and on the listener for
settlement confirmation and webhooks.

## 2. The agent / builder surface

For a developer or an autonomous agent that needs to make payments under an
explicit, machine-checkable spending policy. The mental model is a bounded
spender: the agent can pay, but only inside ceilings that hold on-chain and that
can be re-verified offline.

What it is for:

- let an agent make autonomous USDC payments without holding a backend in the
  path
- bound those payments by an on-chain allowance and contract policy
- gate settlement on a fail-closed integrity attestation (testnet today)
- carry an offline-checkable proof of the spending bound

Routes, packages, and components:

- `/agents` — the builder narrative in the web app.
- `/verify` — re-verify an AXL certificate client-side (re-hash the spec, regen
  the SMT-LIB obligations; no solver runs in-browser yet).
- `@slippay/mcp` — the rail as agent verbs behind a role membrane. Agents get
  `slippay_verify`, `slippay_whoami`, `slippay_charge_attested`,
  `slippay_status`. Principal-only setup verbs (`slippay_subscribe`,
  `slippay_approve`, `slippay_autocharge`, `slippay_arm_gate`, `slippay_pay`)
  are hidden from agents.
- `@slippay/attester` — the integrity oracle that signs an ed25519 verdict only
  when the agent's action stays inside its committed surface.
- on-chain: the subscription contract's v0.2 autocharge (mainnet) and v0.3
  attested gate (testnet), and the smart-wallet's agent session-key model
  (testnet).
- `axl-compiler` — the proof-carrying certificate of the spending bound
  (build-only).

On the off-chain plane the agent path mostly bypasses the API: `@slippay/mcp` is
backend-free and talks to an RPC directly. The autocharge scheduler
(`scripts/autocharge-scheduler.mjs`) and the relayer are the off-chain pieces
that keep recurring debits moving without giving anyone custody.

## 3. The comex treasury surface

For import/export companies that need a corporate USD account — multi-user,
non-biometric, connected to a licensed câmbio partner for R$↔USD conversion.
The mental model is a treasury desk: hold idle dollars, convert when needed, send
and receive, earn yield on the float.

What it is for:

- hold USDC in a corporate account owned by the company (Privy embedded Solana
  wallet — non-custodial, email + MFA, not a biometric passkey)
- convert R$↔USD through 4P Finance, a licensed partner that settles on Solana
- send and receive USDC for trade settlement (payments to suppliers, receipt from
  buyers)
- earn yield on idle USDC via DeFindex while cash is not in transit

Routes and components:

- `/comex` — the corporate treasury landing and dashboard entry point.
- `/pix-pay` — R$→USDC conversion and outbound payment flow (4P ramp, gated
  behind `VITE_PAGFINANCE_ENABLED`).
- `apps/web/src/lib/solanaAuthorize.ts` — the WYSIWYS gate ported to Solana:
  decode the built transaction, assert destination + amount, require explicit
  confirm before signing. Same property as the Stellar gate, different chain.
- `apps/web/src/lib/chain/solana.ts` — the Solana `ChainAdapter` implementation
  (`payOneTime`, `approveRecurring`, address checks).

State: built and adversarially reviewed; gated pending 4P partner keys and the
Solana cutover. Wallet custody model confirmed: Privy embedded wallets are
user-owned — SlipPay's servers hold no signing key. See
[`docs/comex-go-live-checklist.md`](../comex-go-live-checklist.md) and
[`docs/4P_SOLANA_RAMP.md`](../4P_SOLANA_RAMP.md).

## What is shared

- non-custodial settlement: in all three narratives the buyer's, agent's, or
  company's wallet signs funds directly to the recipient; SlipPay never holds or
  signs for funds.
- the WYSIWYS gate: decode the built transaction → assert destination/amount →
  human confirm → re-derive hash locally → sign. Protects all three surfaces
  against receiver substitution, amount drift, and a compromised backend.
- the contract suite and the SEP-41 USDC token (Stellar surfaces) / SPL USDC
  (Solana / comex surface).
- the listener and `/comprovante` receipt verification (Stellar).
- the relayer as a fee-payer (gas sponsor) that cannot move user funds.

## The testnet/mainnet seam, by surface

All three surfaces cross the same seam, and the docs should not paper over it:

- Human surface: `/comprovante` verification is real on mainnet. Biometric pay
  depends on the smart-wallet, which is testnet only. `/cobrar` uses a demo
  recipient. `/preview` is a pure mock.
- Agent surface: v0.2 autocharge (allowance-bounded) is live on mainnet. The
  v0.3 attestation gate is testnet only. The smart-wallet agent session model is
  testnet only. AXL is build-only with no on-chain artifact.
- Comex surface: built and gated on Solana. Not yet live; ships with the Solana
  cutover once 4P partner keys are available.

When a layer graduates from testnet to mainnet, update both this page and
[architecture](architecture.md).
