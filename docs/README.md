# SlipPay Documentation

Non-custodial dollar settlement over one core, with three surfaces: a human
"dollar account" (receive, verify, pay with a passkey), an agent/builder surface
(autonomous payments bounded by on-chain policy, a fail-closed integrity
attestation, and an offline-checkable proof), and a comex B2B treasury (a
corporate account that holds USD and converts R$↔USD via a licensed partner;
yield on idle dollars is phase 2). Every money path is protected by the same
[**what-you-see-is-what-you-sign** gate](#security--threat-models).

> **Status.** Mainnet (`PUBLIC`): subscription v0.2 autocharge
> `CAQZECYTKQGUJETQRRBONGQA2DJBNQVYCSKBYCKXOVQOEEOMHKBTJZEP` and v0.4 (attested
> gate + 2.97% on-chain fee) `CD2RFNOLMIKZN4EETDCGULGMD4ANS56IIUDIBLOE24P4JRZM2GCVFV2U`;
> smart wallet (passkey) live via the relayer; ZK proof-of-KYC/mandate verified on
> mainnet (zero-PII). The **comex treasury** runs on **Base (EVM)**: Privy
> non-custodial EVM wallet + native USDC + 4P câmbio; DeFindex yield is phase 2
> (see the [go-live checklist](./comex-go-live-checklist.md)). The Solana adapter
> and the Solana docs are **reference only** — not active in production, with no
> cutover date. AXL is build/test only. No traction or GMV claims;
> the deployed contracts have no third-party audit.

## Start here

| | |
|---|---|
| [**Quickstart — human**](./quickstart-human.md) | Receive USDC by QR, verify a payment, pay with a passkey. |
| [**Quickstart — agent**](./quickstart-agent.md) | Install `@slippay/mcp`, verify a cert offline, settle. |
| [**Architecture**](./concepts/architecture.md) | The full system: API, listener, contracts, packages, web. |

## Concepts

| | |
|---|---|
| [Two narratives](./concepts/two-narratives.md) | The human surface vs the agent/builder surface. |
| [Proof-bounded settlement](./concepts/proof-bounded-settlement.md) | Allowance ceiling + integrity attestation + offline proof. |
| [Agent-integrity attestation](./concepts/agent-integrity-attestation.md) | "Is the payment authorized?" vs "is the agent compromised?". |
| [Non-custodial settlement](./concepts/non-custodial-settlement.md) | What non-custodial means here, precisely. |
| [Regulatory framing](./concepts/regulatory.md) | BCB Res 519/520/521 and 561, and the response. |

## Contracts

| | |
|---|---|
| [Overview](./contracts/README.md) | The contract suite and a deployed-address table. |
| [Subscription](./contracts/subscription.md) | v0.1 (per-period signature), v0.2 autocharge, v0.3 gate. |
| [Smart wallet](./contracts/smart-wallet.md) | WebAuthn/passkey custom account + agent session keys. |
| [Checkout](./contracts/checkout.md) | Atomic fee-split payment. |

## AXL (proof-carrying certificates)

| | |
|---|---|
| [Language](./axl/README.md) | The agent-block DSL: bind / constrain / prove / invariant. |
| [Compiler](./axl/compiler.md) | The `axlc` CLI, the z3 discharge, the certificate. |
| [Proofs and limits](./axl/proofs-and-limits.md) | What is proved, and the honest gaps. |

## Comex (B2B treasury · Base)

The comex treasury runs on Base (EVM). The go-live checklist is the source of
truth for its chain: the Solana docs below are kept **as technical reference
only** and are not a roadmap.

| | |
|---|---|
| [Go-live checklist](./comex-go-live-checklist.md) | Base (EVM) rollout: exact env vars + ordered steps, and the Solana status statement. |
| [Design spec](./superpowers/specs/2026-06-22-comex-treasury-phase1-design.md) | Corporate treasury phase-1 design: non-custodial Privy wallet, câmbio, yield. Written before the move to Base; the checklist supersedes its chain and FX partner. |
| [4P Solana ramp](./4P_SOLANA_RAMP.md) | The licensed R$↔USD partner integration (Solana). **Reference only — Solana is not active in production.** |
| [Solana frontend port](./SOLANA_FRONTEND_PORT.md) | The `ChainAdapter` and the Stellar→Solana **reference** adapter — gated behind `VITE_CHAIN=solana`, not active in production. |
| [Solana migration plan](./SOLANA_MIGRATION.md) | The parallel Stellar→Solana migration plan. **Reference only — frozen on `feat/solana-adapter`, no cutover date.** |

## Packages

| | |
|---|---|
| [`@slippay/mcp`](./packages/slippay-mcp.md) | MCP server: agent verbs behind a role membrane. |
| [`@slippay/attester`](./packages/slippay-attester.md) | The agent-integrity attestation oracle (AIA). |

## API reference

| resource | description |
|---|---|
| [Authentication](./api-reference/authentication.md) | API keys, JWT sessions, webhook HMAC. |
| [Merchants](./api-reference/merchants.md) | Sign up, manage settings, rotate API key. |
| [Orders](./api-reference/orders.md) | One-shot payments. |
| [Subscriptions](./api-reference/subscriptions.md) | Recurring billing (v0.2 autocharge is live on mainnet). |
| [Webhooks](./api-reference/webhooks.md) | Event types, retries, HMAC verification. |
| [Errors](./api-reference/errors.md) | Status codes and error shapes. |

## Guides

| | |
|---|---|
| [Biometric pay](./guides/biometric-pay.md) | The `/pay` passkey flow end to end. |
| [Receive USDC by QR](./guides/receive-usdc-qr.md) | `/cobrar` and `/comprovante`. |
| [Verify a cert](./guides/verify-a-cert.md) | `/verify` and the offline `slippay_verify` path. |
| [Agent surface](./product/agent-surface.md) | The membrane, `/sub`, and MCP integration. |
| [Web locale strategy](./product/locale-strategy.md) | Supported locales (PT primary / EN mirror), detection + persistence, canonical routes and the legacy aliases. |
| [Recurring billing](./guides/recurring-billing.md) | Subscriptions, off-chain and on-chain. |
| [Drop-in SDK](./guides/drop-in-sdk.md) | Two lines of JavaScript. |
| [WooCommerce plugin](./guides/woocommerce.md) | Install and configure. |
| [Handle webhooks](./guides/webhooks-handler.md) | Verify HMAC, idempotency, retries. |

## Integrations

| | |
|---|---|
| [x402 protocol](./integrations/x402.md) | Pay-per-call resources gated by Stellar USDC. |
| [MoneyGram](./integrations/moneygram.md) | Cash-out plan (not shipped). |

## Security & threat models

The signing moment is the threat surface; it is hardened the same way on every
money path — `decode → assert → human confirm → re-derive hash locally → sign`.

| | |
|---|---|
| [Key custody](./security/key-custody.md) | Deployer and platform-fee key custody; what is and isn't held. |
| [WYSIWYS signing gate](../apps/web/src/lib/txguard.ts) | `txguard.ts` (Stellar) / `baseAuthorize.ts` (Base, comex) / `solanaAuthorize.ts` (Solana, reference only): decode + assert + confirm before any signature. |
| [Threat models & plans](./superpowers) | Pre-code STRIDE threat models and the implementation plans they gate. |
| [Audits 001–006](./security/audit-001.md) | WooCommerce plugin security audits (historical). |

Edge hardening: HTTPS-only (HSTS), `X-Frame-Options`, `nosniff`, `Referrer-Policy`,
`Permissions-Policy`; zero render-blocking external CDN dependencies (fonts
self-hosted) so a CDN outage can never blank the app.

## Operations

| | |
|---|---|
| [Deploy](./ops/deploy.md) | The real deploy mechanism (VPS + PM2 + nginx + rsync). |

## Stay close to the runtime

Every claim in this documentation should be verifiable against the code. If a doc
says something the code does not do, that is a bug worth an issue, not an
aspiration.
