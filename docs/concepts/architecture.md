# Architecture

SlipPay is a non-custodial USDC payment and agent-payment-integrity layer on
Stellar, with Solana in parallel migration. This page covers the full current
system: the off-chain API and listener, the on-chain contract suite, the
autocharge scheduler and gas-sponsor relayer, the two npm packages, the three
web surfaces, and the cross-cutting WYSIWYS signing gate. It states the
testnet/mainnet seam explicitly wherever a layer is not yet live on mainnet.

Non-custodial here is a precise property: the buyer's, agent's, or company's
wallet signs funds directly to the recipient. SlipPay never holds funds and
never has signing authority over user funds. The relayer is a fee-payer only;
it sponsors gas and cannot move user funds.

## Layered diagram

```
  HUMAN SURFACE          AGENT / BUILDER SURFACE      COMEX B2B TREASURY
  (apps/web: /, /pay,    (@slippay/mcp,               (apps/web: /comex,
   /cobrar, /comprovante,  @slippay/attester,           Privy embedded wallet,
   /sub, /checkout)        /agents, /verify)            R$↔USD via 4P partner,
        |                         |                     DeFindex yield on idle USD)
        |                         |                           |
        +-------------------------+---------------------------+
                                  |
                      WYSIWYS SIGNING GATE (cross-cutting)
                      decode → assert → human confirm →
                      re-derive hash locally → sign client-side
                      (txguard.ts Stellar · solanaAuthorize.ts Solana)
                                  |
                                  v
  +-----------------------------+         +-----------------------------------+
  | api (Deno + Hono)           |         | @slippay/mcp  (agent holds its    |
  | supabase/functions/api      |         |   own key; backend-free path)     |
  | /v1/orders /v1/subscriptions|         | role membrane: agent vs principal |
  | /v1/relayer (gas sponsor)   |         +-----------------------------------+
  | /v1/x402 /v1/billing /v1/ask|                         |
  +-----------------------------+                         |
        |            |                                    |
        |            | (unsigned XDR; buyer/agent signs)  |
        v            v                                    v
  +-----------+   +------------------------------------------------------+
  | Postgres  |   | Stellar (Soroban contracts + SEP-41 tokens)          |
  | (Supabase)|   |                                                      |
  +-----------+   |  subscription  (MAINNET v0.2 autocharge;             |
        ^         |     v0.4 autocharge + attestation gate +             |
        |         |     2.97% on-chain platform fee — live rail;         |
        |         |     v0.2 autocharge — mainnet, no gate)              |
        |         |  smart-wallet  (MAINNET wasm; per-user instances     |
        |         |     deployed on demand by relayer)                   |
        |         |  checkout      (TESTNET ONLY: atomic fee-split,      |
        |         |     now WYSIWYS-gated client-side)                   |
        |         |  receipt                                             |
        |         +------------------------------------------------------+
        |                         ^                  ^
        |                         |                  |
  +-----------+   +---------------+--+   +-----------+-------------------+
  | listener  |   | autocharge       |   | relayer (gas sponsor)        |
  | (Horizon  |   |  scheduler       |   |  fee-payer only; validates    |
  |  poll)    |   | (off-chain cron, |   |  sponsorable ops fail-closed  |
  +-----------+   |  fee-payer only) |   +------------------------------+
                  +------------------+
                                  |
        +-------------------------+
        | Solana (comex treasury, gated; CCTP bridge Stellar↔Solana)    |
        | Privy non-custodial wallet · 4P câmbio · DeFindex yield       |
        +----------------------------------------------------------------+

  ORTHOGONAL: axl-compiler (Rust, build-only). Compiles an agent { } block to
  a proof-carrying certificate of the spending bound. No on-chain artifact.
```

## Off-chain plane

### API (Deno + Hono)

Canonical source at `supabase/functions/api`. A Hono server on Deno. It never
holds funds and never signs for user funds; on-chain endpoints return unsigned
XDR for the buyer or agent to sign externally.

Auth has three credential types:

- API key `sk_live_...` — HMAC-SHA256 with `API_KEY_PEPPER`, never stored
  plaintext. For merchant server-to-server calls.
- Checkout token — HMAC with `CHECKOUT_TOKEN_SECRET`, for public, PII-stripped
  checkout reads.
- Supabase JWT — for the dashboard.

Routes:

- `/v1/merchants` (JWT) — merchant profile, including the merchant Stellar
  address and webhook secret.
- `/v1/orders` (API key) — fee computed, persisted, and exposed per order
  (297 bp default). `GET /v1/orders/:id?t=` is public, token-gated, PII-stripped.
- `/v1/subscriptions` (API key), plus `/onchain-charge`, which builds an
  unsigned Soroban charge XDR; the buyer signs externally.
- `/v1/billing/fees` — aggregate fee reporting.
- `/v1/x402-resources` and `/v1/x402/:slug` — HTTP 402 pay-per-call. Client
  identity is the rightmost XFF hop (trust the proxy you control, not the
  forgeable left side).
- `/v1/relayer` — the gas-sponsor for passkey wallets: `/info`, `/deploy`,
  `/submit`. `validateSponsorable` is fail-closed: the source must be the
  sponsor, a single operation, fee at or below cap, and either a create-contract
  whose wasm hash matches the passkey-wallet hash, or a SAC transfer whose
  `from` is a contract address with amount at or below cap.
- `/v1/ask` — concierge chat endpoint.

There is no autocharge or CCTP endpoint in the API. Autocharge runs as an
off-chain scheduler (below). CCTP (Stellar↔Solana) is a Circle protocol used
at the chain adapter layer, not exposed via the API.

### Listener

A separate process that **polls** Horizon; there is no long-lived stream. `manager.ts`
re-reads the active-merchant list every `MERCHANT_POLL_MS` (default 30 s) and,
for each active Merchant address not already watched, acquires a per-account
lease in `listener_leases` (`lease.ts` stores a `holder_id` + `expires_at` and
heartbeats it) so only one pod ever watches a given account. `horizon.ts` then
pages `GET /accounts/{id}/payments` forward from a persisted `paging_token`
(`listener_state`), one HTTP GET per `LISTENER_POLL_MS` (default 4 s), and
matches a USDC payment to an order by memo hash: `memo_type=hash`, `asset=USDC`,
correct issuer, `to=merchant`, `base64 -> hex memo == order.memo`. Money math is
in BigInt stroops, status transitions are forward-only, and webhooks are
HMAC-signed with SSRF defense on the delivery target.

Polling replaced Horizon's `.stream()` deliberately: that stream can die
silently — the socket stays open with no `onerror`, no events, and no
auto-reconnect — so a nominally "online" listener stops confirming payments
invisibly. A fresh GET each tick is immune to that failure mode, and a periodic
`poller_alive` heartbeat makes a stall visible. The extra latency is bounded by
`LISTENER_POLL_MS` and is fine for a checkout flow that already polls.

The listener is read-only against Stellar. It never writes on-chain. Its only
writes are to SlipPay's own Postgres state.

### Autocharge scheduler

`scripts/autocharge-scheduler.mjs` is the cron half of the v0.2 subscription
model. It queries Supabase for due subscriptions
(`status=active`, `soroban_subscription_id` set, `next_charge_at <= now`) and
fires `autocharge(id)` signed by a relayer. The relayer is a fee-payer only and
never custodies funds; money moves via the buyer's standing SEP-41 allowance.
Safe-by-default: it dry-runs unless `CHARGE=1` is set, and additionally requires
`CONFIRM_MAINNET=1` on mainnet. Default contract is the v0.2 mainnet
subscription contract.

### Gas-sponsor relayer

The relayer (exposed via `/v1/relayer`) sponsors the outer transaction envelope
so a passkey wallet user does not need XLM for gas. It is structurally unable to
move user funds: `validateSponsorable` rejects anything that is not a
fee-bearing sponsor op over a whitelisted shape. Funds move only because the
on-chain `__check_auth` accepts the user's passkey assertion, not because the
relayer authorized a transfer.

## On-chain plane (Soroban contract suite)

Network names: Stellar mainnet is `PUBLIC`; testnet is `TESTNET`.

### subscription — recurring debit (`contracts/subscription`)

Four models share the contract family. The mainnet/testnet seam runs through
the middle of it.

- **v0.2 autocharge** (MAINNET). No per-period buyer signature. The buyer
  grants a standing SEP-41 allowance once, off-band
  (`token.approve(buyer, contract, cap, expiry)`). Then `autocharge(id)` pulls
  via `transfer_from(spender=contract, buyer -> merchant)` each period, and any
  relayer can submit. Two independent ceilings apply: the contract side
  (`status`, `period`, `max_periods`, `expires_at`) and the SAC side (allowance
  cap and allowance expiry ledger). When the allowance is exhausted or expired,
  `transfer_from` fails and the buyer must re-approve. That allowance is a hard
  on-chain ceiling, not a backend policy. Contract:
  `CAQZECYTKQGUJETQRRBONGQA2DJBNQVYCSKBYCKXOVQOEEOMHKBTJZEP` (wasm `f8cfed71…`).
- **v0.4 autocharge + attestation gate + 2.97% on-chain platform fee** (MAINNET,
  the live rail). `autocharge_attested(id, not_after, signature)` plus
  `set_attester`, with an on-chain `env.crypto().ed25519_verify`. The signed
  message is 44 bytes: `id(32) || charges_done(u32 BE, 4) || not_after(u64 BE,
  8)`. The `id` binding blocks cross-subscription replay; the `charges_done`
  binding makes each attestation single-use; `not_after` is freshness.
  `ed25519_verify` traps and reverts, so the gate is fail-closed. The 2.97%
  platform fee is computed and split on-chain at charge time. Contract:
  `CD2RFNOLMIKZN4EETDCGULGMD4ANS56IIUDIBLOE24P4JRZM2GCVFV2U` (wasm
  `4312612c…`). This seam is load-bearing and must not be blurred.

Other entrypoints: `create` (buyer-auth; minimum period 86400s in production,
1s only under the `demo` cargo feature, which must never ship to mainnet),
`cancel` (buyer), `pause`/`resume` (merchant), `get`, and `mark_expired`
(callable by anyone, idempotent; it exists because Soroban panics revert state,
so a terminal status cannot persist from inside `charge`). Every persistent
storage write is followed by `extend_ttl(17280, 535000)`, and there is
`checked_add` overflow defense.

### smart-wallet — WebAuthn/passkey custom account (`contracts/smart-wallet`)

Wasm on MAINNET (`8e9b6760…`); per-user instances deployed on demand by the
gas-sponsor relayer. Each instance is a Soroban custom account (CAP-46-11
`__check_auth`) with two authorization models dispatched on the credential type:

- **Passkey** (`WalletAuth::Passkey`): real on-chain WebAuthn.
  `verify_webauthn` binds to the transaction by requiring the base64url-nopad of
  the Soroban auth payload inside `client_data_json` (replay defense),
  reconstructs `SHA256(authenticator_data || SHA256(client_data_json))`, and runs
  `env.crypto().secp256r1_verify` (Protocol 21, the WebAuthn P-256 curve). There
  is also a pull-policy path: a per-merchant `Policy` (`max_per_charge` cap,
  interval, expiry, revoke) authorizes a matching transfer without consuming a
  fresh signature.
- **Agent** (`WalletAuth::Agent`): an ed25519 session key for autonomous agent
  push payments. An `AgentSession` carries `per_tx_cap`, a sliding-window
  aggregate `window_cap`, a non-empty recipient allowlist, an `ssl_hash`
  provenance pin, revoke, and expiry. The proven worst-case real-time-window
  bound is `2x window_cap`, which is the property the AXL layer proves.

The constructor sets an immutable `max_absolute_per_charge` ceiling. Hardened
bounds: cap ratio at most 10x, window ratio at most 100x, no self or
wallet-as-merchant, single-use session pubkey.

### checkout — atomic fee-split (`contracts/checkout`)

TESTNET. `fee_bps` 300; a fee-split has been proven on testnet (paid 10 ->
merchant +9.7, fee +0.3). Mainnet is pending; it needs a funded deployer and a
`/pay` wrapper. `pay(from, merchant, token, amount)` runs
`from.require_auth()`, computes `fee = amount * fee_bps / 10000`, and does two
SEP-41 transfers (net to merchant, fee to `fee_to`). `fee_to` and `fee_bps` are
fixed at the constructor and read from storage on every `pay`, so a merchant
cannot route around the fee. No tests yet.

### receipt (`contracts/receipt`)

Backs the public payment-receipt surface. Verify purpose against source before
relying on details.

## Packages

### @slippay/mcp (`packages/slippay-mcp`)

An MCP server an agent installs via `npx -y @slippay/mcp`. It is non-custodial
and backend-free: the agent holds its own key (`SLIPPAY_SIGNER_SECRET`) and
builds, signs, and submits Soroban and Stellar transactions straight to an RPC.
No SlipPay backend sits in the path. Configured via `SLIPPAY_CONTRACT`,
`SLIPPAY_NETWORK` (`testnet|public`), and RPC and USDC issuer overrides.

It enforces a role membrane via `SLIPPAY_ROLE` (default `agent`):

- agent tools: `slippay_verify` (offline cert re-verification, the
  differentiated verb), `slippay_whoami`, `slippay_charge_attested` (an
  autonomous charge that settles only with a fresh single-use ed25519
  attestation), and `slippay_status` (Horizon settlement read).
- principal-only tools (trust setup, hidden from agents): `slippay_pay` (raw
  SAC/SEP-41 transfer), `slippay_subscribe`, `slippay_approve` (the one
  allowance that arms autonomous debit), `slippay_autocharge` (allowance-gated,
  no attestation), and `slippay_arm_gate` (`set_attester`).

The membrane means a compromised agent cannot get a fresh attestation, cannot
issue a raw pay, and cannot run setup verbs.

### @slippay/attester (`packages/slippay-attester`)

An integrity oracle. It answers "is the agent compromised?", not "is the payment
authorized?". The v0 detection is surface deviation (recipient not in the
committed set, amount over cap, off-surface tool) plus velocity. It is
fail-closed: it signs an ed25519 verdict only if the action stays inside the
agent's committed surface.

Bindings: the Stellar 44-byte message (`id || charges_done || not_after`) is
byte-for-byte identical to the on-chain gate; a generic 48-byte message
(`action_hash || not_after || nonce`, where
`action_hash = sha256(canonical_json(descriptor))`); and an x402 binding over
the economically-binding subset of x402 v2 `PaymentRequirements`. Flow:
`commitSurface` / `POST /register` -> `attest` / `POST /attest` (signs iff
in-surface, `not_after = now + 300s`) -> `verifyAttestation` / `POST /verify`. A
zero-dependency Node HTTP server on `:8790`; `GET /pubkey`; `/attest` returns
HTTP 403 when refused. A demo key is derived from a fixed seed if
`SLIPPAY_ATTESTER_SECRET` is unset (development only). See the in-package
`SPEC.md`.

## Web app (`apps/web`)

Built for mainnet (`VITE_STELLAR_NETWORK=PUBLIC`). The `VITE_` values are public
configuration, not secrets (API base, network, platform address, the v0.4
subscription contract id, the Supabase URL and anon key). Three surfaces share
the SPA; see [two-narratives](two-narratives.md) for the human/agent split and
the comex go-live checklist for the B2B surface.

The active chain is selected by `VITE_CHAIN` via the `ChainAdapter`
(`apps/web/src/lib/chain`). All pages call one interface (`payOneTime`,
`approveRecurring`, address checks); Stellar and Solana adapters implement it
side by side. The comex surface targets Solana and is gated pending partner
keys + Solana cutover.

Real versus demo on the human surface:

- `/pay` is real. Passkey secp256r1 -> smart-wallet -> the relayer sponsors gas
  only and cannot move funds. The mainnet path is real money.
- `/comprovante/:txhash` is real. It reads Horizon effects and the Soroban
  `get(subId)` and judges the payment against the obligation. The strong path
  (`?sub=`) trusts nothing in the URL; the weak path (`?amount&to`) compares
  forgeable claims and is labeled as such.
- `/verify` is real but client-side only: it re-hashes the spec and regenerates
  the SMT-LIB obligations. No solver runs in-browser yet.
- `/checkout` is testnet only; the client flow is now WYSIWYS-gated
  (`apps/web/src/lib/txguard.ts`), meaning no blind-sign path remains.
- `/cobrar` generates a `slippay:pay` QR, but the recipient is a throwaway
  testnet keypair, so it is a demo merchant, not productionized.
- `/sub/:id` is a real rail on a demo surface (it needs a demo merchant key in
  the browser).
- `/preview` is a pure mock.

The biometric pay flow: `createPasskey` (`navigator.credentials.create`, alg
ES256/-7, platform authenticator, user verification required) -> deploy a
smart-wallet bound to the pubkey via the relayer -> decode a `slippay:pay` QR ->
build the Soroban transfer invocation -> compute the `SorobanAuthorization`
preimage hash as the WebAuthn challenge -> `getAssertion` (Face/Touch ID) ->
DER-to-raw64 low-S normalized signature -> a `("Passkey", {...})` auth entry ->
the relayer signs the outer envelope (gas only) and submits. Funds move only
because the on-chain `__check_auth` accepts the passkey assertion.

The platform fee is configurable per merchant via `platform_fee_bp`. The API
default is 297 bp (2.97%). The fee is computed, persisted, and exposed per order.

## How a payment flows (human, one-shot order)

```
  1. POST /v1/orders                                    <- merchant (API key)
  2. orders row: status=pending, memo=<sha256>          <- api
  3. checkout_url returned                              <- api
  4. buyer opens checkout / /pay                        <- web
  5. wallet signs Stellar payment with Memo.hash(memo)  <- web -> wallet
  6. tx submitted to an RPC / Horizon                   <- wallet -> Stellar
  7. listener polls Horizon /payments                         <- Stellar -> listener
  8. matcher: asset, issuer, to, memo, amount           <- listener
  9. orders.update status=paid, tx_hash=...             <- listener
 10. webhook_deliveries.insert (HMAC-signed)            <- listener
 11. delivery worker POSTs to merchant.webhook_url      <- listener
 12. merchant fulfills order                            <- merchant
```

## How an agent autocharge flows (v0.4 mainnet, attestation gate live)

```
  setup (principal, once):
    a. slippay_subscribe -> create(id, ...)             <- principal-auth
    b. slippay_approve -> token.approve(buyer,           <- principal-auth
         contract, cap, expiry)                            (the hard ceiling)

  recurring (no per-period buyer signature):
    1. autocharge scheduler finds due subs (Supabase)   <- off-chain cron
    2. agent commits its surface to @slippay/attester
    3. attester signs an ed25519 verdict iff in-surface (fail-closed)
    4. relayer signs the envelope (fee-payer only)      <- relayer
    5. autocharge_attested(id, not_after, signature)    <- Stellar (mainnet v0.4)
         verifies the 44-byte message on-chain via ed25519_verify (fail-closed)
    6. transfer_from(contract, buyer -> merchant)       <- SEP-41, bounded by
         within contract + allowance ceilings              both ceilings;
         2.97% platform fee split on-chain at charge time
    7. listener observes settlement                     <- listener
    8. slippay_status / /comprovante reads the result   <- agent / human

  v0.2 (mainnet, no attestation gate — still operational for existing subs):
    steps 2-3 and 5's on-chain verify are absent; autocharge(id) pulls directly.
```

The composition, outside-in: the attester verdict (off-chain, fail-closed)
gates the on-chain attestation check (fail-closed), which gates settlement,
which is itself bounded by the buyer's single SEP-41 allowance, which is driven
by a fee-payer-only relayer, and the whole rail is exposed to agents through the
@slippay/mcp role membrane. AXL is an orthogonal layer: it makes the spending
bound a re-checkable theorem rather than a runtime assertion. See
[proof-bounded-settlement](proof-bounded-settlement.md).

## Multi-chain (`apps/web/src/lib/chain`)

Stellar is the live settlement chain. Solana is being brought up in parallel,
non-destructively, so the live product is never at risk during the migration.

- **`ChainAdapter`** — a single interface (`payOneTime`, `approveRecurring`,
  address validation) that all pages call. The active chain is chosen by the
  `VITE_CHAIN` env var. Stellar and Solana adapters implement it side by side in
  `apps/web/src/lib/chain`.
- **Comex on Solana** — the corporate treasury surface targets Solana because the
  licensed câmbio partner (4P Finance) settles there. Wallet = Privy embedded
  Solana wallet (email + MFA, non-custodial, no biometric required for corporate
  multi-user flow); yield = DeFindex on idle USD. The WYSIWYS gate is ported to
  Solana (`apps/web/src/lib/solanaAuthorize.ts`). State: built + adversarially
  reviewed; gated pending 4P partner keys + Solana cutover
  ([go-live checklist](../comex-go-live-checklist.md)).
- **CCTP** — Circle's Cross-Chain Transfer Protocol is live on Stellar mainnet,
  providing native USDC movement between Stellar and Solana without wrapped-token
  bridges when cross-chain settlement is needed.

## WYSIWYS signing gate (cross-cutting)

Every money path — human checkout, agent autocharge, comex treasury transfer —
runs through the same gate before any key is used to sign:

1. Build the unsigned transaction (XDR on Stellar, instruction set on Solana).
2. **Decode that exact transaction** and display the real destination, amount, and asset.
3. **Assert** that the decoded destination and amount match what the user or agent intended. This catches receiver-substitution and amount-drift even from a compromised backend.
4. Only after explicit human or agent confirmation, **re-derive the hash locally** and sign.

A compromised server, a man-in-the-middle, or a buggy API cannot make a user
sign a payment they did not see. Implementation:

- `apps/web/src/lib/txguard.ts` (Stellar): decodes an XDR envelope, re-derives
  its hash locally, and asserts the transaction contains exactly one payment
  operation matching `{destination, amount, asset}`. Rejects NaN, multi-payment
  smuggling, wrong asset, receiver substitution, and amount drift.
- `apps/web/src/lib/solanaAuthorize.ts` (Solana): the same gate for the comex
  Solana path and any future Solana surface. The UI must call this orchestrator;
  signing is unreachable without an explicit confirmation.

The checkout's previous blind-sign path was caught in adversarial review and
closed. The gate is now the only entry to any signature on any surface.

## Comex B2B treasury surface

A corporate (non-biometric, multi-user) account for import/export companies:

- **Auth**: Privy embedded Solana wallet, email + MFA. Non-custodial: the wallet
  is user-owned, not a server wallet.
- **Câmbio**: R$↔USD conversion through 4P Finance (the licensed partner).
  SlipPay's non-custodial classification depends on not holding funds during
  conversion; 4P is the licensed exchanger.
- **Yield**: DeFindex on idle USD.
- **WYSIWYS**: all treasury transfers run through `solanaAuthorize.ts` before
  signing.
- **State**: built + adversarially reviewed (receiver-pinning gap caught and
  closed). Gated behind feature flag; ships with the Solana cutover. See
  [comex go-live checklist](../comex-go-live-checklist.md) and
  [4P Solana ramp](../4P_SOLANA_RAMP.md).

## AXL (`axl-compiler`)

A Rust, std-only, zero-dependency compiler. One `agent { }` block compiles to one
inference contract with mechanical guarantees: `bind -> [tools]` (exact tool
allowlist; an unbound tool has no schema and physically cannot be called),
`constrain -> Schema` (engine-enforced constrained decoding), `prove ->
<predicate>` (decidable predicates compiled to deterministic code, never an LLM
judge), and `invariant -> sliding_window(ceiling = M) bound K` (the spending
safety bound, the only directive sent to an SMT solver). The solver step prefers
a `z3` binary, falls back to the `z3-solver` Python package, and refuses if
neither exists (absence of a checker is not a pass). It emits a proof-carrying
certificate; `axlc verify-cert` re-hashes and re-discharges and asserts
byte-equality.

Status: build/test-only. There is no on-chain artifact, the certificate is not a
required CI gate, and there is zero downstream adoption today. The smart-wallet
has no dependency on the compiler and never interprets the certificate; the
`ssl_hash` pin is provenance only.

## Deploy reality

`app.slippay.cc` and `api.slippay.cc` run on a single VPS under PM2 and nginx.
The web deploy is: build on the laptop, then rsync `dist/` to the server's
`apps/web/dist`. Not Vercel, not GitHub Actions, not git-on-server. Any older
doc describing Vercel plus Actions is stale.

## Status and honest limitations

- Subscription v0.2 (autocharge, no gate): mainnet
  (`CAQZECYTKQGUJETQRRBONGQA2DJBNQVYCSKBYCKXOVQOEEOMHKBTJZEP`).
- Subscription v0.4 (autocharge + attestation gate + 2.97% on-chain fee): mainnet,
  the live rail (`CD2RFNOLMIKZN4EETDCGULGMD4ANS56IIUDIBLOE24P4JRZM2GCVFV2U`).
- Smart-wallet: wasm on mainnet (`8e9b6760…`); per-user instances deployed on demand.
- Checkout: testnet only; WYSIWYS-gated client-side (no blind-sign path).
- ZK proof-of-mandate + proof-of-KYC (Groth16): mainnet, zero-PII; generic verifier live.
- Comex treasury (Privy + 4P + DeFindex): built + adversarially reviewed on Solana;
  gated pending partner keys + Solana cutover.
- CCTP (Stellar↔Solana): live on Stellar mainnet.
- axl-compiler: build-only, no on-chain artifact, certificate not a required CI
  gate, zero downstream adoption.
- No third-party audit of the newer contracts (smart-wallet, checkout, subscription
  v0.4, axl). Existing audits cover the WooCommerce plugin only. There is a
  self-run adversarial audit harness; findings are fixed before shipping.
- No paying customers and no GMV. The Circle USDC issuer account referenced in
  configuration is the asset issuer, not SlipPay activity.
