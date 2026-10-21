> **Historical / self-superseded.** This was an internal planning document for a
> Soroban subscription contract. That contract has since been built and deployed
> on mainnet. Kept for reference only; do not treat it as the current spec.

# Soroban Subscription Contract — internal planning document

> **Status (2026-05-10): superseded for grant purposes.** Slippay is enrolled
> in a Stellar Brasil ecosystem program with its own sprint-gated milestone
> deliverables. This document remains as **internal product planning** for a
> possible Soroban subscription contract roadmap; it is **not** the active
> grant proposal. Live deliverables come from the program's sprint board.

**Document type:** internal planning / future SCF candidate
**Slippay status:** live on testnet at api.slippay.cc
**License:** Apache-2.0 (contract + SDK + reference integration, when shipped)

---

## 1. The gap

Recurring billing is the highest-LTV merchant feature in payments. Stripe, PayPal,
and every Pix gateway in Brazil ship subscriptions because monthly SaaS billing is
where the volume lives — not one-shot e-commerce checkout.

**On Stellar in 2026, no production merchant subscription contract exists on
Soroban.** I verified this across:

- `usepaykit/stellartools` — only active Stellar-native gateway (last commit
  2026-05-07, 7 GitHub stars). Lists "subscriptions" as a feature but the
  contract is not in the repo.
- SCF #34 winners (April 2026, $1.72M / 17 projects). Three payment-related
  grants — Logistech ($101k), Greep Pay ($70k), Payrit ($47k) — all one-shot
  checkout / POS, none recurring.
- SDF reference repos (`stellar/basic-payment-app`,
  `stellar/soroban-react-payment`) — demo dapps, not subscription primitives.
- DefiLlama Stellar TVL ~$100M total — Soroban DeFi exists but no subscription
  contract surfaced in any active protocol.

This is the missing primitive. Every Stellar-native SaaS, every B2B
subscription product, every recurring-donation tool currently has to either
(a) settle off-chain and lose the non-custodial property, (b) issue manual
invoices each cycle, or (c) build their own contract from scratch.

A reference contract + SDK + audited code closes that gap as a public good.

## 2. What the contract does

```
buyer ──signs subscription auth──► subscription contract ──registers──► state
   │                                       │
   │                                       │ at each period:
   │                                       ▼
   │                          slippay backend (or any caller)
   │                          calls charge(subscription_id)
   │                                       │
   │                                       ▼
   │                          contract.token.transfer(buyer→merchant, amount)
   │                                       │
   │                                       ▼
   │                          updates last_charge_time, counter
   ▼
buyer can call cancel(id) at any time
```

State per subscription:

| field | type | meaning |
|---|---|---|
| `buyer` | `Address` | pre-authorized account |
| `merchant` | `Address` | settlement destination |
| `asset` | `Address` | SEP-41 token (USDC, PYUSD, BRZ, etc.) |
| `amount` | `i128` | per-period charge in stroops |
| `period_seconds` | `u64` | e.g. `2_592_000` for 30 days |
| `max_periods` | `u32` | hard cap (0 = unlimited until expiry) |
| `expiry` | `u64` | absolute timestamp |
| `charges_done` | `u32` | counter |
| `last_charge_at` | `u64` | timestamp of last successful debit |
| `status` | `enum` | Active, Paused, Cancelled, Expired |

Functions:

- `create(buyer, merchant, asset, amount, period, max_periods, expiry) -> id`
  — buyer pre-authorizes via `Auth::require_auth` (Soroban native pattern,
  buyer signs the call with their private key)
- `charge(id) -> (success, next_due_at)` — anyone can call; contract checks
  time elapsed ≥ period, status = Active, charges < max, current_time < expiry
- `cancel(id)` — only buyer can call (require_auth); status = Cancelled, no
  further charges
- `pause(id)` / `resume(id)` — only merchant can call
- `query(id) -> Subscription` — read-only

Charge call is **idempotent on time**: if called twice within the same period,
second call returns `(false, next_due_at)`. No double-charge possible.

## 3. Why Stellar / why Soroban

| dimension | Stellar/Soroban | EVM alternative |
|---|---|---|
| gas per charge | ~0.00001 XLM ≈ sub-cent fixed | gas-spike risk: $0.50–$50 on Ethereum mainnet |
| finality | 6s deterministic | 12s probabilistic (Ethereum), 2s soft (Base) |
| asset interop | native SAC for any Stellar asset (USDC, PYUSD, BRZ all SAC-deployable) | each ERC-20 needs separate approve flows |
| existing rail | MoneyGram cash-out 180+ countries → subscription LTV converts to local cash | EVM has no equivalent cash rail |
| merchant onboarding | 56-char address, no gas wallet needed | merchant needs gas-funded wallet |

Subscription economics break on EVM because of gas variance — a $5/mo SaaS sub
shipping a $10 gas-charge in a network spike kills unit economics. Stellar's
deterministic fee removes that failure mode.

## 4. Deliverables (4 milestones, 16 weeks)

### M1 · Contract spec + scaffolding + tests (weeks 1-3, $20k)

- formal spec doc with state machine, auth model, edge cases
- Rust contract scaffold with `soroban-sdk`
- unit tests on testnet (`charge`, `cancel`, `pause`, `expiry`, time-skew, double-charge prevention)
- threat model first draft (replay, frontrunning, time manipulation,
  dust-attack on charges, unauthorized cancel)

**Falsifiable**: 30+ unit tests passing on Soroban testnet by week 3. Below
20 = scope misjudged → flag to SDF and replan.

**Failure mode (named)**: contract semantics may not survive `soroban-sdk`
version upgrades. Mitigation: pin specific SDK version in Cargo.toml, document
upgrade path in spec.

### M2 · Mainnet-ready contract + JS/TS SDK (weeks 4-6, $25k)

- contract deployed to testnet with full flows
- TypeScript SDK (`@slippay/subscriptions`) with `create`, `charge`, `cancel`,
  `query` wrappers; integrates with `@stellar/stellar-sdk`
- React hooks for buyer-side authorization UI
- 10+ integration tests using `freighter`, `lobstr`, `hana` wallets
- gas-cost benchmark across 100 charge calls

**Falsifiable**: end-to-end charge cycle (buyer auth → contract → token
transfer → merchant balance update) completes in <15s on testnet. Above 30s =
performance regression, debug before mainnet.

**Failure mode**: wallet-side support for Soroban auth varies. Mitigation:
test matrix across 5 wallets in M2, document compatibility, file issues
upstream where unsupported.

### M3 · Mainnet deployment + 5 demo merchants + slippay integration (weeks 7-9, $25k)

- audit-prep package: full code freeze, internal review, fuzz tests
- mainnet contract deployment (separate testnet/mainnet contract IDs in SDK)
- 5 demo merchant integrations (real subscriptions, real USDC, public dashboard)
  — at minimum: 1 BR SaaS, 1 indie newsletter, 1 OSS project donation, 1
  hosting reseller, 1 NGO recurring donation
- slippay backend webhook delivery on charge events (`subscription.charged`,
  `subscription.failed`, `subscription.cancelled`, `subscription.expired`)
- public demo URL with live charge history and contract explorer

**Falsifiable**: 5 distinct buyer pubkeys actively running ≥1 subscription
on mainnet by week 9, with ≥10 successful charge cycles total. Below 3
merchants or below 5 cycles = adoption signal weak, may indicate UX friction.

**Failure mode**: real merchants drop off if onboarding takes >2 hours.
Mitigation: `slippay-cli` tool that scaffolds a subscription integration in
~10 lines of code; track time-to-first-charge per merchant.

### M4 · Audit + open-source release + dev rel (weeks 10-16, $35k)

- third-party security audit (Cantina, Macro, or OtterSec — quote pending)
- audit fixes round 1
- public release: Apache-2.0, GitHub `slippay-payments/soroban-subscriptions`
- Rust crate publish on crates.io
- 3 long-form posts (Stellar dev blog, slippay blog, dev.to): "Building
  recurring billing on Soroban", "What we got wrong (and right)", "Subscription
  patterns: pre-auth vs session keys vs forwarder contracts"
- 2 workshops (Meridian conference + 1 LATAM meetup) with live demo
- documented integration paths for SCF-funded payment projects (Logistech,
  Greep Pay, Payrit) so they can adopt without rebuilding

**Falsifiable**: contract has ≥3 external integrations (i.e., projects that
are NOT slippay) calling `charge` on mainnet within 60 days of release. Below
2 external integrations = the public-good thesis is weak; project remains
internal slippay tooling, not ecosystem primitive.

**Failure mode**: audit reveals a critical bug that requires contract redeploy.
Mitigation: contract is upgrade-safe via deployer-controlled migration pattern
(documented in M1 spec), with v2 deployment plan budgeted into M4.

## 5. Total budget

| milestone | weeks | budget |
|---|---|---|
| M1 spec + scaffolding | 1-3 | $20,000 |
| M2 mainnet-ready + SDK | 4-6 | $25,000 |
| M3 mainnet + 5 merchants | 7-9 | $25,000 |
| M4 audit + open-source + dev rel | 10-16 | $35,000 |
| **total** | **16** | **$105,000 USD-equivalent in XLM** |

Allocation: ~60% engineering, ~25% audit, ~15% dev rel + integrations.

Tranche release: SCF-standard milestone-gated. Each milestone unlocks the next
on objective deliverable verification (commits, mainnet tx hashes, audit report).

## 6. Why this is the right team

- **Solo founder**: I (Manuel) am sole eng + ops + GTM. Slippay backend
  (Deno + Hono api, Node + Stellar SDK listener, Supabase + pg_cron) is live
  on testnet — built solo over April-May 2026. I can verify execution speed.
- **Cybersecurity background**: AI engineer / security specialist (web2 +
  web3). Threat-modeling and audit-prep workflows are not new territory.
- **Independent of slippay's commercial outcome**: contract + SDK are
  Apache-2.0. Even if slippay (the gateway) fails commercially, the contract
  remains in the ecosystem.

## 7. Risks (honest)

1. **Soroban semantics change**. Soroban Phase 2 went mainnet Feb 2024; SDK
   is on stable release line but breaking changes happen. Mitigation: pin
   SDK version, monitor Soroban release notes, file issues upstream.
2. **Wallet support gap**. Pre-auth UX requires wallet to surface "you are
   authorizing X future debits up to Y total". Lobstr / Freighter handle
   `Auth::require_auth` but pretty UI for recurring auth is wallet-side
   work that's outside scope. Mitigation: collaborate with Lobstr team
   (already integration partners through MoneyGram); file UI proposals.
3. **No production traction signal**. SCF #34 funded products with clearer
   GTM. Slippay's GTM is in-progress (testnet only, BR partnerships in
   outreach phase). Mitigation: this proposal sets contract as the
   public-good deliverable, not slippay-specific traction.
4. **Audit cost overrun**. Cantina / Macro audits range $15-40k for
   contract scope this size. M4 budgets $35k including audit. If audit
   quote exceeds, slippay underwrites the gap from non-grant runway.

## 8. Falsifiable success metrics (90 days post-grant completion)

- **5+** external projects (non-slippay) integrated, calling `charge` on mainnet
- **100+** total charge cycles processed across all integrations
- **0** critical security incidents (audit-reported or in production)
- **3+** Rust crate downloads from non-slippay developers
- **1+** SCF-funded payment project adopting the contract (Logistech, Greep
  Pay, or Payrit are the natural candidates)

If 3 of these 5 fail by 90 days post-completion, the public-good thesis
underdelivered. Slippay still has working tooling for itself, but I'd
disclose the underdelivery to SCF and document why for future proposals.

## 9. Companion artifacts (already shipping)

- slippay backend live at https://api.slippay.cc/api/health (Deno + Hono +
  Stellar listener, PM2 production deploy)
- platform Stellar testnet keypair (pubkey
  `GDCJ5VBKPOSZM74FWK6CELWZYZN7BRXWRHRMOIP2GJKLC5XVFG5VCV7T`, USDC trustline
  active, 10000 XLM testnet)
- merchant signup, dashboard, settings, API key rotation, webhook delivery
  with HMAC + exponential retry — all working
- 4 schema tables + RLS policies + pg_cron expiry job on Supabase

The subscription contract slots into this stack as the next layer up.
SCF is funding the missing primitive, not bootstrapping a new project from
zero.

## 10. Repo + contact

- **draft contract repo**: `slippay-payments/soroban-subscriptions` (to be
  initialized at grant approval)
- **slippay backend**: `/opt/slippay-backend/` on production VPS
  (165.22.10.194, NYC1) — mirror to public GitHub at proposal acceptance
- **email**: manuel@bluewaveai.online
- **operator**: Manuel Galmanus, Blumenau-SC, BR · CNPJ 66.381.800/0001-08

---

**Status of this document:** DRAFT v0.1 · 2026-05-10 · ready for SCF
submission after operator review and final number adjustments.
