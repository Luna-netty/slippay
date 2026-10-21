<div align="center">

# SlipPay

**Non-custodial dollar settlement — for people, for agents, for companies.**

<img src="apps/web/public/liberty.webp" alt="A blindfolded Statue of Liberty — the industry makes you sign blind" width="900" />

*The industry makes you sign blind. SlipPay takes the blindfold off — **what you see is what you sign.***

USDC payments where the user's own wallet signs funds *directly* to the recipient.
SlipPay never holds funds and never has signing authority over them. The settlement
core is one rail; three surfaces sit on top of it.

`Stellar mainnet` · `Base · comex functional on-chain` · `non-custodial` · `Apache-2.0`

[**Read the paper (PDF)**](./docs/paper/slippay.pdf) · [Live](https://app.slippay.cc) · [Docs](./docs/README.md) · [Architecture](./docs/concepts/architecture.md) · [Security model](#security-model) · [Security policy](./SECURITY.md)

**Paper:** *Slippay — Metacognitive Governance for Autonomous Agent Payments: Non-Custodial, Integrity-Gated, Proof-Carrying Settlement on Stellar.* → **[docs/paper/slippay.pdf](./docs/paper/slippay.pdf)**
**Extended abstract for NEAR X** (Slippay as a portable governance layer for NEAR's agent economy) → **[docs/paper/slippay-nearx-abstract.pdf](./docs/paper/slippay-nearx-abstract.pdf)**

</div>

---

## What this is

SlipPay turns "holding dollars and moving them" into a touch, without ever taking
custody. *Non-custodial* is used precisely here, not as a slogan:

> The buyer's, agent's, or company's wallet signs the transaction. SlipPay builds
> the **unsigned** transaction, the user signs it client-side, and the funds go
> straight to the recipient. SlipPay's servers never hold a key with authority
> over user funds. The gas-sponsor relayer is a **fee-payer only** — it pays
> network fees and cannot move a cent of user money.

Everything in this repository is meant to be verifiable against the code. There
are **no traction or GMV claims** here. On-chain artifacts list their network and
address so you can check them yourself. If a doc says something the code does not
do, that is a bug worth an issue.

---

## PROVEN ON MAINNET: an autonomous agent paid another agent — inside a provable mandate

> **Not a slide. A verifiable on-chain transaction.**
>
> On **26 Jun 2026**, a Slippay **buyer agent** — with **no human in the loop** — hit a seller
> agent's HTTP **402**, decided to pay **within a cryptographically-signed spending mandate**,
> paid **USDC on Stellar mainnet**, and received the goods. The full loop closed end to end:
> **charge → autonomous decision → on-chain settlement → delivery.**
>
> - **Mainnet proof:** [tx `34eb71b1…`](https://stellar.expert/explorer/public/tx/34eb71b1c4446bf1b39a1d811370f93c24188e61458d56a126957b13d4eea13b) — USDC on Stellar, content delivered to the paying agent
> - **Full loop on testnet** (incl. the seller's release): [tx `61db50c6…`](https://stellar.expert/explorer/testnet/tx/61db50c6ec5b6c6890045c4fe09b3c76bf7baa506a54af3c22da491cf81d55f1)
> - Every payment leaves a **signed registry record**: who paid whom, how much, under which mandate, with the attestation signature.

**Full write-up:** the design, the threat model, the metacognitive framing and the on-chain evidence are in the paper → **[docs/paper/slippay.pdf](./docs/paper/slippay.pdf)**.

**Honest positioning — agent payments are not new.** Coinbase's **x402** (May 2025) has settled
150M+ transactions; Google's **AP2** defines human-approved "mandates"; Coinbase ships agent
wallets with spend guardrails. What is different here:

- **Non-custodial.** The agent's *own* wallet signs. No platform holds the funds or the keys — unlike a custodial agent-wallet guardrail.
- **Portable integrity attestation.** Slippay answers the question the payment rails don't ask — *"is this agent still operating inside the surface it committed to?"* — as an **ed25519 verdict verifiable on-chain AND offline by anyone**, not a guardrail locked inside one platform. ([agent-integrity attestation](./docs/concepts/agent-integrity-attestation.md))
- **The bound can be a theorem.** The spending limit compiles to a **z3-checked, offline-verifiable proof-carrying certificate** ([AXL](#axl--agent-spend-limits-as-proof-carrying-theorems)).

### Why this is the shape regulators will require

Brazil's Receita Federal **"DeCripto"** (Normative Instruction 2,291 — monthly reporting from
**July 2026**, aligned with the OECD **CARF** auto-exchange) is the template the world is moving
toward: it obliges intermediaries to **identify and report** crypto transactions, while
**explicitly carving out self-custody** — *"operações on-chain em carteiras controladas pelo
próprio usuário, sem intermediário, ficam fora do escopo."*

Autonomous agents moving money collide head-on with this: **who is the holder of the transaction
when both sides are agents and no human pressed a button?** No regulator has a closed answer in
2026. The agent payments that *survive* that question are the ones that are **non-custodial**
(inside the self-custody carve-out), **provably bounded** (a human-signed mandate at the root, so
authorization exists even without a per-transaction click), and **auditable** (a signed registry
that reconstructs every payment). That is exactly this architecture. We don't ask permission to
occupy the grey zone — we run inside it, with the clean signed trail that defines the standard.

*(Not legal advice. The agent-as-holder classification is an open question we are taking to counsel — see [regulatory](./docs/concepts/regulatory.md).)*

---

## Research: Metacognitive Engineering

Slippay is the applied edge of a deeper research thesis: an autonomous system's safety
lives in its **metacognitive layer** — how it monitors and governs its own state — and
that layer is both the attack surface and the right place to put the gate. Two papers,
both in this repo:

**1 · Foundational** — *Metacognitive Engineering as a Security Surface: Introspective
Vulnerabilities in Large Language Model Alignment* (41 pp). Formalizes the dual-layer model
`y = G(x, M(x, θ))`, proves that generative-layer-only alignment is incomplete
(**Theorem 1**, under four explicitly stated, empirically grounded assumptions, with a
bounded falsification condition), maps a taxonomy of **7 metacognitive attack classes**,
and proposes **5 metacognitive alignment primitives**.

> **Original work — and potentially industry-defining.** This is an original thesis by
> Manuel Galmanus, not a repackaging of existing prompt-injection or jailbreak taxonomies.
> Its contribution is *structural*: it identifies the metacognitive layer as a first-class
> attack surface and proves — formally, not anecdotally — *why* generative-layer alignment
> (RLHF, Constitutional AI, DPO) can never be complete on its own. **If the thesis holds, it
> could reshape how the entire industry secures frontier models** — moving the field from
> endlessly patching generative-layer coverage to constraining the metacognitive layer
> itself. The claim is stated as a falsifiable theorem with explicit refutation conditions,
> so it can be tested rather than merely asserted — which is exactly what makes a
> potentially field-changing claim credible instead of hype.

📄 **Read the paper:** **[github.com/Galmanus/slippay/…/metacognitive-security-surface.pdf](https://github.com/Galmanus/slippay/blob/main/docs/paper/metacognitive-security-surface.pdf)**
&nbsp;·&nbsp; [LaTeX source](https://github.com/Galmanus/slippay/blob/main/docs/paper/metacognitive-security-surface.tex)
&nbsp;·&nbsp; [local PDF](./docs/paper/metacognitive-security-surface.pdf)

**2 · Applied** — *Slippay — Metacognitive Governance for Autonomous Agent Payments.* The
same monitor → gate → control loop, moved from reasoning to **money**: a payment settles
only when an integrity monitor confirms the agent is inside a human-signed mandate.
→ **[docs/paper/slippay.pdf](./docs/paper/slippay.pdf)** · NEAR X brief: **[slippay-nearx-abstract.pdf](./docs/paper/slippay-nearx-abstract.pdf)**

**3 · Formal** — *AXL: A Standalone Proof-Carrying Compiler for Agent Spending Bounds.* A tiny
policy language + a zero-dependency Rust compiler (`axlc`) that lowers a spending policy to an
SMT obligation, discharges it by **k-induction**, and emits a **tamper-evident certificate**
anyone can re-verify offline. Proves a *tight, minimal* bound for the deployed wallet
(real-time-window outflow ≤ **2× window_cap**), and is candid about scope: it's an offline
verifier today, not yet a CI-gated production control.

📄 **Read the paper:** **[github.com/Galmanus/slippay/…/axl.pdf](https://github.com/Galmanus/slippay/blob/main/docs/paper/axl.pdf)**
&nbsp;·&nbsp; [LaTeX source](https://github.com/Galmanus/slippay/blob/main/docs/paper/axl.tex)
&nbsp;·&nbsp; [compiler source](./axl-compiler)

The through-line: **the gate that governs an agent's reasoning is the same gate that should
govern its payments.** Slippay is that gate, on-chain.

---

## Three surfaces, one core

| Surface | Who it's for | What it does | State |
|---|---|---|---|
| **Dollar account** | a normal person | receive USDC by QR, verify a payment on-chain, pay with a passkey (Face/Touch ID) — no seed phrase in the user's hands | live on Stellar mainnet |
| **Agent / builder** | autonomous agents | agent payments bounded by an on-chain spend policy, a fail-closed integrity attestation, and an offline-checkable proof of the spending bound | rail live (mainnet); attested gate on testnet |
| **Comex treasury** | import/export companies | a corporate (non-biometric) account on Base that holds USD, sends/receives USDC, and converts R$↔USD **both ways** through a licensed FX partner; yield on idle dollars is next | **live in production** on Base ([app.slippay.cc/comex](https://app.slippay.cc)) — wallet + send/receive USDC live; **R$→USD buy (on-ramp) live via licensed partner 4P** (Pix → USDC settled on Base, verified end-to-end); **USD→R$ sell (off-ramp) now live via 4P** — Pix-out quotes working in both directions through the partner (first sell settle pending); yield (DeFindex) is phase 2 ([go-live checklist](./docs/comex-go-live-checklist.md)) |

> **The comex treasury is functional on-chain.** On 25 Jun 2026 a real R$ Pix on-ramp
> settled USDC into a company wallet on Base, confirmed on-chain. The corporate
> non-custodial wallet, USDC send/receive, and R$→USD buy (via licensed FX partner
> **4P**) all run in production at [app.slippay.cc/comex](https://app.slippay.cc), with
> the exact dollar rate and fee shown to the user. The reverse — **USD→R$ sell
> (off-ramp)** — is now wired through 4P as well: live Pix-out quotes in both
> directions (e.g. 20 USDC → R$101.62, partner spread shown), first sell settle pending.

> **Agent payments are real on-chain transactions, not slides.** An autonomous agent
> payment settled on-chain only after an *independent integrity oracle* authorized it
> — agent initiates, the oracle signs off in its committed surface, and the contract
> verifies that signature on-chain (`autocharge_attested` + native `ed25519_verify`)
> before a cent moves. No human in the loop. Verifiable (Stellar testnet):
> [tx `eee0d71f…`](https://stellar.expert/explorer/testnet/tx/eee0d71f2f2100da1b97c971cec98fe367e89758c0b8b91c29ef6d5e84a602ff).
> The buyer-signed `charge` rail is live on **mainnet** (subscription v0.2, `CBJMQ6ZY…`).
> The **autonomous** rail (`autocharge`, SEP-41 allowance) and the attested gate shown here
> are **testnet** — current source, not yet redeployed to mainnet.

The three surfaces never fork the money path: they all reduce to *build an unsigned
transfer → the user verifies what they sign → the user signs → submit*. The same
[security gate](#security-model) is the standard across them — live today on the
comex treasury and the checkout, and being unified into the single signing
chokepoint for every remaining path.

---

## Why it's different

Most "crypto payment" UX asks the user to trust a screen and then sign an opaque
blob. SlipPay's design rule is the opposite — **what you see is what you sign
(WYSIWYS)**, enforced in code at the signing step (live on the comex treasury and
the checkout; being made the single chokepoint for the remaining paths):

1. The app builds the transaction.
2. It **decodes that exact transaction** and shows the real destination + amount + asset.
3. It **asserts** the decoded destination/amount match what the user intended (catches receiver-substitution and amount-drift even from a compromised backend).
4. Only after explicit human confirmation does it **re-derive the hash locally** and sign.

A compromised server, a man-in-the-middle, or a buggy API cannot make a user sign
a payment they did not see. This is the property that makes "non-custodial" actually
mean something at the moment of signing — and it is the same gate on the human
checkout, the agent rail, and the comex treasury.

Security is done **before** code, not after deploy: each money path goes through a
written threat model and an adversarial review pass before it ships. See
[Security model](#security-model).

---

## Zero-knowledge proofs (Stellar mainnet)

Compliance and spend-limits are enforced **cryptographically**, not by trusting a
server. Two Groth16 circuits are deployed and verified on Stellar mainnet, both
**zero-PII**:

- **Proof-of-KYC** — a user proves they are over the age threshold **and** not on a
  sanctions list while emitting **zero personal data**. No name, no birthdate, no
  document ever leaves the client; the on-chain verifier learns only that a valid
  proof exists. The database that would normally hold this PII never exists server-side.
- **Proof-of-mandate** — an agent (or company) proves a payment satisfies its
  authorized mandate without revealing the private mandate fields. The policy stays
  secret; the verifier only learns *"within bound: true."*

The Groth16 verifier is **deployed on mainnet** (`CBDS2YSL…`) and verifies real proofs for
both circuits. Honest scope: it is a **generic** verifier — the verification key is passed
per call, so today it attests *proof validity*, not yet a binding to on-chain payment state —
and the current **trusted setup is single-contributor** (demo-grade, not production trust).
Roadmap: circuit-pinned key, proof↔payment binding, multi-party setup.
The circuits, proving keys, and full deployment are open in the dedicated public repo:
**[github.com/Galmanus/slippay-zk](https://github.com/Galmanus/slippay-zk)**. Conceptual
write-up: [`docs/concepts/proof-bounded-settlement.md`](./docs/concepts/proof-bounded-settlement.md).

This is what lets "non-custodial + compliant" coexist: the secrets a regulator
cares about are proven in zero knowledge, and the secrets an attacker would want
(the KYC store, the spend policy) are never collected in the first place.

---

## Confidential agent payments (Confidential Tokens · Stellar)

Agents and companies can now move dollars **without revealing the amount** — and do
it in a way a regulator can still audit. This is **confidential, not anonymous**:
the amount and the running balance are hidden, while sender and recipient stay
visible. That distinction is the point — it's the privacy a treasury or an agent
mesh needs, with the disclosure a compliance desk needs, in the same primitive.

It's built on **[Confidential Tokens](https://stellar.org/blog/developers/developer-preview-confidential-tokens-on-stellar)**,
the OpenZeppelin contract suite (with a Nethermind UltraHonk verifier) that wraps any
SEP-41 token. Inside the wrapper, a balance is a **Pedersen commitment** — the network
sees only commitments and a **zero-knowledge proof** that the arithmetic is honest
(no overspend, value conserved, correct ownership). Proofs are written in **Noir** and
verified **on-chain** by the UltraHonk verifier, using the Protocol 25 (X-Ray) host
functions. Withdraw, and the funds return to the public SEP-41 asset.

**Verified end-to-end on testnet.** We deployed the confidential-token stack (OpenZeppelin +
Nethermind UltraHonk, based on the public reference implementation) and ran the full flow
— `register → deposit → confidential_transfer → withdraw` — with every proof accepted
on-chain:

```
transfer  alice → bob  400      amount never appears on chain
          alice spendable = 600   (reconstructed from events, matches the commitment ✓)
          bob   received  = 400   (decrypted by bob, matches the commitment ✓)
withdraw  bob  → public 400      on-chain proof OK
```

Our deployed testnet contracts:

| Contract | ID |
|----------|----|
| confidential token | `CBC2X4XHQ6T7ZVZGZMD7PANRBHLZ6GCFGK562IHP5QAUDASD5NVFOH4N` |
| UltraHonk verifier | `CD7WP6JY26IQ2GQ7VTXTZEXGM2Y5F5QHXBL647DHW4FQSZM33325IXFP` |
| auditor            | `CARCTVSJ7ZPKBJZWSCFVSZ7TST3SC35DA7HWC4A3SCBJSZHNIEXFD3RY` |

**Two surfaces this unlocks:**

- **Agent ↔ agent confidential settlement** — one agent pays another inside the wrapper;
  the amount is never public. The counterparties and the proof are; the figure isn't.
  This is the missing privacy layer for an agent economy where every transfer is
  otherwise a public number.
- **Confidential treasury for comex** — a company holds USDC with a hidden balance and
  pays counterparties with hidden amounts, then **proves a single payment to a single
  auditor** (selective disclosure) without exposing the rest of its book. A designated
  **auditor view key** can decrypt the full ledger when mandated; **account-level freeze**
  cascades from the SAC; a **policy engine** plugs in allow/block-list identity registries.

**Honest scope.** Confidential Tokens are a **Developer Preview** (OpenZeppelin × Stellar);
the verifier backend and circuits are **unaudited** and **testnet-only** — not approved
for mainnet, do not use with real value yet. What is real today is the integration above:
our contracts deployed, our proofs accepted on-chain, the full confidential transfer
reproduced. Mainnet follows the SDF's audit and approval, not our timeline.

---

## AXL — agent spend limits as proof-carrying theorems

Most "agent spending limits" are a runtime `if (amount > cap) reject`. You have to
trust the code ran, trust the server, trust nobody patched the check. **AXL removes
the trust: the spending bound becomes a machine-checked theorem — and CI refuses to
let that theorem drift from the bound the contract actually enforces.**

- You write the policy once in a small DSL — an `agent { }` block describing what the
  agent may spend and under what conditions.
- `axl-compiler` (zero crate dependencies, std-only Rust) compiles that block and
  **discharges the bound as an SMT proof by k-induction** (z3): a proof that the agent
  *cannot* exceed the limit over *any* action sequence, not a promise that a check will
  run. For the deployed wallet the proved bound is **tight and minimal** — real-time
  window outflow ≤ **2× window_cap** (the 2× is the epoch-straddle worst case, proven,
  not slack).
- The proof ships as a **proof-carrying certificate** — a portable JSON artifact,
  SHA-256-bound to the exact policy bytes, that **anyone can re-verify offline**
  without running the agent, the server, or trusting Slippay. Verification refuses if
  no solver is present, rather than silently passing.
- **A CI gate keeps it honest.** `axl-gate` re-discharges the proof on every change
  touching the policy, the compiler, or the contract, and asserts the constant the
  on-chain contract enforces (`window_cap.saturating_mul(N)`) equals the certified
  multiplier. Verified to go **red on contract drift, red on certificate tamper**, green
  clean. Change the deployed bound without re-proving it (or vice-versa) → the build
  fails.

Why it matters: it turns *"the agent stays within budget"* from an operational claim
into a checkable fact, and then *keeps* it true under change. The bound travels with
the agent, so a counterparty, an auditor, or a regulator can confirm the limit holds
without access to our infrastructure. Same posture as proof-carrying code, applied to
autonomous money movement.

**The enforced bound is now on-chain state (proven on testnet).** The contract no
longer uses a source literal: the multiplier is stored per session
(`window_cap_multiplier`, pinned to `PROVED_WINDOW_MULTIPLIER` and bound to the
policy `ssl_hash`) and read by the hot path. On Stellar **testnet**, a session
installed with the certified `ssl_hash` `0415df30…e35e3be` reads back
`window_cap_multiplier: 2`, matching `agent_wallet.cert.json` — so an auditor checks
the on-chain bound against the certificate directly.
Contract [`CCJXPLDP…RDHN`](https://stellar.expert/explorer/testnet/contract/CCJXPLDPFMHYJIN6PTYQUNCP2ZTS52JK4WVRBKRHLXF2S6JFFVKYRDHN)
· install [tx](https://stellar.expert/explorer/testnet/tx/6b57021b1be31372348731ab691eda025aa9a10ae75e9ff2c37f2a2dac007ae8).

Honest limits (stated, not hidden): the proof is only as strong as the policy spec —
it proves the *encoded* bound, not behaviour the spec never described. The contract
enforces the stored per-session bound but does not re-run the SMT proof on-chain
(z3 on-chain is infeasible), so the residual trust is "the installed multiplier equals
the certified one" — made auditable by the on-chain record + CI gate, not eliminated.
The **mainnet** wallet still runs the prior literal-`2` contract pending a deliberate
redeploy. The certificate is off-chain by design.

📄 **Read the paper:** **[AXL: A Standalone Proof-Carrying Compiler for Agent Spending Bounds](https://github.com/Galmanus/slippay/blob/main/docs/paper/axl.pdf)**
&nbsp;·&nbsp; [LaTeX source](https://github.com/Galmanus/slippay/blob/main/docs/paper/axl.tex)

Docs: [AXL language](./docs/axl/README.md) · [compiler](./docs/axl/compiler.md) · [proofs & limits](./docs/axl/proofs-and-limits.md) · [the gate](./.github/workflows/axl-gate.yml).

---

## Status (verified on chain)

Mainnet is Stellar `PUBLIC`. The testnet/mainnet seam is stated explicitly — nothing
below is dressed up as live when it isn't.

| Component | Network | Address / status |
|---|---|---|
| Subscription v0.2 autocharge (SEP-41 allowance, no per-period signature) | **mainnet** | `CAQZECYTKQGUJETQRRBONGQA2DJBNQVYCSKBYCKXOVQOEEOMHKBTJZEP` (wasm `f8cfed71…`) |
| Subscription v0.4 (autocharge + attestation gate + 2.97% on-chain platform fee) — the live rail | **mainnet** | `CD2RFNOLMIKZN4EETDCGULGMD4ANS56IIUDIBLOE24P4JRZM2GCVFV2U` (wasm `4312612c…`) |
| Smart wallet (WebAuthn/passkey custom account) | **mainnet** | wasm `8e9b6760…`; per-user instances deployed on demand by the gas-sponsor relayer |
| Checkout (atomic fee split) | testnet | `CBO2COBZUTHH4II4JCQRZVO4RKDUIUH4MXZTAWOYVUZIVYI47UIDQCWQ` — client flow now WYSIWYS-gated |
| ZK proof-of-mandate + proof-of-KYC (Groth16) | **mainnet** | verifier `CBDS2YSL…` live, zero-PII (age + sanctions); circuits open at [slippay-zk](https://github.com/Galmanus/slippay-zk) |
| Comex treasury — corporate non-custodial wallet (Privy EVM) + USDC send/receive, WYSIWYS-gated | **Base mainnet**, live | in production at `app.slippay.cc/comex` · 74 tests · adversarially reviewed |
| Comex câmbio R$→USD buy via **4P** (licensed FX partner, settles USDC on Base) | **Base**, live | **functional on-chain** — verified end-to-end: a real R$ Pix on-ramp settled USDC to the company wallet on Base, confirmed on-chain. Fees shown transparently (exact dollar rate + Slippay 2.8%). USD→R$ sell pending 4P off-ramp endpoint |
| `@slippay/mcp` (agent MCP server) · `@slippay/attester` (integrity oracle) | npm | v0.2.0 · v0.1.0 |
| **AXL** — agent spend bounds as z3-proven, offline-verifiable proof-carrying certificates ([deep dive](#axl--agent-spend-limits-as-proof-carrying-theorems)) | off-chain (portable by design) | Rust → z3; `certify` / `verify-cert`; built + tested |

Live services: `https://app.slippay.cc` (web) · `https://app.slippay.cc/api/health` (api).
The deployed contracts are **not** third-party audited.

---

## How the layers compose

```
agent / human / company commits a recipient + amount + (for agents) a tool surface
        │
        ▼
WYSIWYS gate ── decode the built tx → assert destination/amount → human confirm
        │        → re-derive hash locally → sign client-side   (never blind-sign)
        ▼
@slippay/attester ── ed25519 verdict over 44 bytes (id‖charges_done‖not_after),
        │              fail-closed, off-chain; signs only if the action is in-surface
        ▼
subscription contract  autocharge_attested ── on-chain ed25519_verify (fail-closed) [testnet]
        │              autocharge           ── pulls via the buyer's one SEP-41 allowance [mainnet]
        ▼
relayer (fee-payer only, never custodies) runs the off-chain autocharge scheduler
        │
        ▼
@slippay/mcp exposes the whole rail as agent verbs behind a role membrane

AXL is orthogonal: the spending bound itself is a theorem (z3), re-checkable
offline via a proof-carrying certificate.
```

Full picture: [`docs/concepts/architecture.md`](./docs/concepts/architecture.md).

---

## Multi-chain

Stellar is the live settlement chain for the consumer + agent rails and all the ZK
work. Base was added for the comex treasury behind a chain-agnostic adapter, so the
live Stellar product is never at risk and the same non-custodial core serves both.

- **`ChainAdapter`** (`apps/web/src/lib/chain`) — pages talk to one interface
  (`payOneTime`, `approveRecurring`, address checks); the active chain is chosen by
  `VITE_CHAIN`. Stellar and Base adapters implement it side by side.
- **Comex on Base** — the corporate treasury surface runs on Base because the
  licensed FX partner (4P) settles USDC there, against Circle's native USDC
  (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) — **no contract to deploy**. Wallet =
  Privy embedded EVM wallet (email + MFA, non-custodial, non-biometric); the WYSIWYS
  gate is ported to Base with viem (`apps/web/src/lib/baseAuthorize.ts`).
- **CCTP** — Circle's Cross-Chain Transfer Protocol is live on Stellar mainnet,
  giving native USDC movement between Stellar and other chains without wrapped-token
  bridges when cross-chain settlement is needed.

---

## Security model

Non-custodial is only as strong as the signing moment. SlipPay treats that moment
as the threat surface and hardens it the same way everywhere.

**The WYSIWYS signing gate** — the standard signing path is `decode → assert →
human confirm → local hash → sign`. It is live on the comex treasury and the
checkout; the remaining consumer paths (e.g. the off-ramp and subscription pages)
are being migrated behind the same orchestrator so it becomes the single
chokepoint for every signature:
- `apps/web/src/lib/txguard.ts` (Stellar): decode an XDR, re-derive its hash
  locally, assert a single payment matches `{destination, amount, asset}` (rejects
  NaN, multi-payment smuggling, wrong asset, receiver substitution, amount drift).
- `apps/web/src/lib/authorizeTx.ts` (Stellar) / `baseAuthorize.ts` (Base, viem ERC-20
  decode + assert): the orchestrator the UI must call for any signature. Signing is
  unreachable without an explicit confirm.

**Non-custodial guarantees, enforced:**
- the client never holds a server-side signing/authorization key (CI-checkable: no
  `AUTHORIZATION_PRIVATE` / service-role secret in the web bundle);
- the relayer sponsors gas only and validates sponsorable ops fail-closed;
- corporate (comex) wallets are user-owned (Privy embedded), not server wallets.

**Process, not vibes:**
- a written **threat model** precedes each money path (STRIDE pre-mortem, ranked,
  with concrete mitigations) — see [`docs/superpowers/specs`](./docs/superpowers/specs) and the comex design doc;
- an **adversarial review** pass attacks each path before it ships; findings are
  fixed and re-verified (the live checkout's blind-signing gap and the comex
  câmbio's receiver-pinning gap were both caught and closed this way);
- **edge hardening**: HTTPS-only with HSTS, `X-Frame-Options`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`; zero external render-blocking CDN
  dependencies (fonts self-hosted) so a CDN outage can never blank or hang the app.

Contract-level audits and the key-custody model live in
[`docs/security`](./docs/security/key-custody.md). For responsible vulnerability disclosure, security SLAs, and the incident response runbook, see [SECURITY.md](./SECURITY.md).

---

## Repo layout

```
slippay/
  apps/
    web/             react SPA · three surfaces (human · agent · comex), checkout, dashboard
    listener/        node + stellar-sdk · Horizon SSE watcher + webhook delivery
    shopify-connector/ · vtex-connector/   commerce integrations
  packages/
    shared/          ts types + zod schemas + chain constants (USDC issuers/mints)
    slippay-mcp/     @slippay/mcp · MCP server, agent verbs behind a role membrane
    slippay-attester/@slippay/attester · agent-integrity attestation oracle (AIA)
  contracts/
    subscription/    recurring debit: v0.2 autocharge (mainnet), v0.4 attested gate
    smart-wallet/    WebAuthn/passkey custom account + agent session keys
    checkout/        atomic fee-split payment
    receipt/         payment receipt primitive
  axl-compiler/      rust · AXL DSL → proof-carrying certificates (z3)
  supabase/
    functions/api/   deno + hono REST endpoints (build unsigned XDR; never custodial)
    migrations/      schema, RLS, pg_cron, subscriptions
  scripts/           e2e + deploy + autocharge scheduler
  docs/              full documentation (start at docs/README.md)
```

---

## Quickstart

```sh
# Pre-reqs: node 22+, pnpm 9, deno 2.x, supabase CLI, rust + soroban (for contracts)
git clone git@github.com:Galmanus/slippay.git
cd slippay && pnpm install

pnpm supabase:start && pnpm supabase:reset          # local postgres + auth + schema

# in separate terminals:
cd supabase/functions/api && deno run --allow-all --watch index.ts   # API (Deno + Hono)
cd apps/listener && pnpm dev                                          # Horizon listener
cd apps/web && pnpm dev                                               # web → http://localhost:5173
```

Tests:

```sh
pnpm -r test                                  # listener + packages + web unit tests
pnpm api:test                                 # deno API tests
cd contracts/subscription && cargo test --release
cd axl-compiler && cargo test
```

Path-specific quickstarts: [human](./docs/quickstart-human.md) · [agent](./docs/quickstart-agent.md).

---

## Documentation

Start at [`docs/README.md`](./docs/README.md). Highlights:

- **Concepts** — [architecture](./docs/concepts/architecture.md) · [non-custodial settlement](./docs/concepts/non-custodial-settlement.md) · [proof-bounded settlement](./docs/concepts/proof-bounded-settlement.md) · [agent-integrity attestation](./docs/concepts/agent-integrity-attestation.md) · [regulatory](./docs/concepts/regulatory.md)
- **Contracts** — [overview](./docs/contracts/README.md) · [subscription](./docs/contracts/subscription.md) · [smart wallet](./docs/contracts/smart-wallet.md) · [checkout](./docs/contracts/checkout.md)
- **AXL** — [language](./docs/axl/README.md) · [compiler](./docs/axl/compiler.md) · [proofs and limits](./docs/axl/proofs-and-limits.md)
- **Packages** — [`@slippay/mcp`](./docs/packages/slippay-mcp.md) · [`@slippay/attester`](./docs/packages/slippay-attester.md)
- **Zero-knowledge** — [proof-bounded settlement](./docs/concepts/proof-bounded-settlement.md) · circuits + verifier: [github.com/Galmanus/slippay-zk](https://github.com/Galmanus/slippay-zk)
- **Comex** — [go-live checklist (Base)](./docs/comex-go-live-checklist.md)
- **Security** — [key custody](./docs/security/key-custody.md) · audits [001](./docs/security/audit-001.md)–[006](./docs/security/audit-006.md)
- **API** — [authentication](./docs/api-reference/authentication.md) · [orders](./docs/api-reference/orders.md) · [subscriptions](./docs/api-reference/subscriptions.md) · [merchants](./docs/api-reference/merchants.md) · [webhooks](./docs/api-reference/webhooks.md) · [errors](./docs/api-reference/errors.md) · [OpenAPI](./docs/openapi.yaml)
- **Ops** — [deploy](./docs/ops/deploy.md)

---

## Deploy

`app.slippay.cc` and `api.slippay.cc` run on a single VPS under PM2 + nginx (Deno
serves the API and the built web `dist/`). The web app is built locally and
rsync'd to the server — not Vercel, not GitHub Actions. See
[`docs/ops/deploy.md`](./docs/ops/deploy.md).

## License

Apache-2.0 for the open-source contracts and packages (see
[`docs/scf/OPEN_SOURCE.md`](./docs/scf/OPEN_SOURCE.md)). Authorship and IP:
[`IP_OWNERSHIP.md`](./IP_OWNERSHIP.md).

## Contributing

Solo-founder repo. Issues and PRs welcome at
[github.com/Galmanus/slippay/issues](https://github.com/Galmanus/slippay/issues).
Every claim in these docs should be verifiable against the code; if a doc says
something the code does not do, that is a bug worth an issue.
