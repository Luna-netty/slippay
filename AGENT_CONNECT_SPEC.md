# Slippay · Agent Connect — design spec

Turns the on-chain primitive `install_agent_session(...)` (already in
`contracts/smart-wallet/src/lib.rs:468`) into something a human can actually use:
grant an AI agent a **bounded, revocable spending allowance**, enforced on-chain.

The contract is the source of truth. This spec is the product/UX + protocol layer
that was missing (verified: zero references to agent sessions in `apps/web/src`).

On-chain function we target:
```
install_agent_session(session_pubkey: BytesN<32>, token: Address,
  per_tx_cap: i128, window_seconds: u64, window_cap: i128,
  expires_at: u64, allow_recipients: Vec<Address>, ssl_hash: BytesN<32>)
```
Called by the wallet admin (the human) → authorized by their passkey (Face ID).

---

## 1. "Connect Agent" screen (frontend)

Route: `/agents` (new). Sections:

- **Empty state**: "Give an AI agent a spending allowance. It pays for you,
  within limits you set — and can never exceed them or be unfrozen by us."
- **Connect**: two entry modes
  - paste/scan the agent's session pubkey (manual), OR
  - open an agent's connection request (deep link / QR — see §3).
- **Allowance form** (maps 1:1 to the contract args):
  - per-tx cap (USDC) → `per_tx_cap`
  - daily limit (USDC) → `window_cap`, with `window_seconds = 86400` preset
  - expires in (1d / 7d / 30d / custom) → `expires_at`
  - allowed recipients: "any (within budget)" (empty `allow_recipients`) or an
    explicit list (addresses / known merchants)
  - asset: USDC (`token`)
  - (advanced) attach policy → `ssl_hash` (see §4)
- **Review → confirm with Face ID** → `install_agent_session` on-chain.
- **Active sessions list**: per agent — caps, spent/remaining in current window,
  expiry, **Revoke** (on-chain) button. Remaining computed from chain state.

Reuses existing passkey infra (`lib/passkey.ts` already does passkey create +
relayer-sponsored submit for wallet creation). New: a passkey-signed
*contract-invoke* of `install_agent_session` / `revoke`.

## 2. Agent key custody — DECISION: (A) for MVP

The agent signs payments with an **ed25519 session key**. Where it lives:

- **(A) Agent-held hot key in a KMS — CHOSEN for MVP.** The agent generates +
  holds its ed25519 key in its own runtime, ideally a managed KMS (AWS KMS / GCP
  KMS / Vault). **Rationale: the contract already bounds the blast radius** —
  per_tx_cap, window_cap, allow_recipients, and the immutable
  `MaxAbsolutePerCharge`. A stolen session key can drain *at most* the cap until
  revoked/expired. That is the entire point of bounded delegation: the key is
  allowed to be hot because the on-chain guard makes a hot key survivable.
  - Failure mode (named): compromise → attacker spends up to the cap before the
    human revokes. Mitigations: small caps, short `expires_at`, recipient
    allowlist, anomaly alerts off-chain.
- **(B) TEE / enclave-held — roadmap.** Key never leaves an attested enclave
  (AWS Nitro / confidential VM); the agent attests its code. Stronger, and the
  attestation itself becomes a moat element (provable agent execution).
- **(C) MPC co-sign — roadmap.** Session key split (threshold) between agent and
  a Slippay co-signer that applies extra off-chain policy before co-signing.
  Adds a trust party for the *session* (wallet stays non-custodial).

Rotation = expiry (`expires_at`) → natural; revoke = on-chain, immediate.

## 3. Agent ↔ wallet handshake — "Agent Session Connect"

WalletConnect-style, but the thing being granted is a bounded money session.

1. Agent generates the ed25519 session keypair.
2. Agent builds a **session request** (a proposal, not a grant):
   ```json
   { "v":1, "session_pubkey":"<b64 ed25519>",
     "requested": { "token":"USDC", "per_tx_cap":"5", "window_seconds":86400,
       "window_cap":"50", "expires_at":<unix>, "allow_recipients":[...],
       "policy_uri":"https://.../policy.json" },
     "agent": { "name":"...", "domain":"..." }, "callback":"https://.../connected" }
   ```
   Encoded as `slippay://agent-connect?req=<b64>` and/or a QR + a web deep link
   `app.slippay.cc/agents/connect?req=<b64>`.
3. Human opens it in the Slippay app → sees the requested allowance → **can only
   tighten** (lower caps, trim recipients, shorten expiry) → confirms with Face
   ID → `install_agent_session` on-chain. The request is never auto-accepted.
4. App posts a **confirmation** to `callback`: wallet address, granted limits,
   `expires_at`, tx hash. The agent now knows the session is live and on what
   terms (which may be tighter than it asked).

Security stance: the request is a *proposal*; the human's on-chain install is the
truth. The agent never sees the passkey; the human never holds the session key.

## 4. `ssl_hash` — bind the session to a declared, verifiable policy

`install_agent_session` already takes `ssl_hash: BytesN<32>`. Use it to bind the
session to a **machine-readable agent policy** (an SSL spec — the declarative
policy language from Wave).

- **MVP**: `ssl_hash = sha256(canonical(policy.json))`. The policy doc (what the
  agent may do, intended recipients, caps) is published at `policy_uri`. Anyone
  can fetch it and verify the hash matches what's stored on-chain with the
  session → "this session was granted under exactly this policy." Portable,
  auditable.
- **Roadmap (the moat-relevant upgrade)**: don't just hash the policy — **prove
  it** with `axlc` (bind / constrain / prove / invariant + SMT). The policy
  carries a machine-checked proof of invariants ("never pays outside allowlist",
  "Σ spend ≤ window_cap") and the proof is bound to both `ssl_hash` AND the
  deployed contract WASM hash → the guarantee is **inescapable + bound-to-deploy**
  (the operator's own moat criterion: proof alone isn't the moat; making it
  inescapable + portable + bound-to-deploy is).

---

## Build order
1. **§1 Connect screen + §3 handshake** against the live contract, custody (A).
   The tangible, demoable piece. Needs: passkey-signed `install_agent_session`
   invoke + a sessions-list reading chain state.
2. **§4 MVP** (hash + publish + verify policy).
3. **§2 (B/C)** and **§4 axlc proof** as moat upgrades (informed by the moat
   workflow currently running).

## Honest status
- Contract primitive: built + self-audited (testnet). The prod `agent_wallet`
  (167) may be a variant; 167 was unreachable today — deployed state unverified.
- Everything in §1–§4 above: **not built yet**. This is the spec.
