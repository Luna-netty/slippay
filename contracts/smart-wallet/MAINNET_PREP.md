# Slippay Smart Wallet · Mainnet Prep Checklist

Companion to `SECURITY_AUDIT.md`. The audit catalogs *what* is broken;
this doc tracks the deployment *checklist*. Block-numbered items must
complete before the corresponding mainnet milestone.

**Today's status:** v0.1 testnet only. The C1 and H3 fixes are in (template
`CBFBZ6K2...XDZP45`, wasm hash `e6ceb9c1d46a...e994821`). Verified
end-to-end on testnet: drain via non-policy transfer is now rejected.

---

## Milestone A · Hardened testnet (current)

Status: **COMPLETE** as of 2026-05-28 16:20 BRT.

- [x] C1 fix · `__check_auth` default-deny on fall-through
- [x] H3 fix · install_policy rejects `merchant == admin` and `merchant == contract`
- [x] Tests · 15/15 passing
- [x] Redeploy testnet · template above
- [x] e2e verification · under-cap pass + over-cap reject + non-policy reject

---

## Milestone B · Mainnet rehearsal (target: 2026-06-02, D-6)

Goal: same demo flow against Stellar mainnet, capped at small XLM
amounts, so any mainnet-only behaviour breaks early.

- [ ] **Pre-flight:** confirm `slippay-mainnet-deployer` has ≥10 XLM
- [ ] Generalize `parseTxHash` regex to handle mainnet URLs (audit L3)
- [ ] Add `NETWORK=public` env support to deploy script + spike server
- [ ] Deploy wasm to mainnet (cost: ~1 XLM)
- [ ] Run a single fresh wallet deploy + init + install_policy on mainnet
- [ ] Verify policy_installed event visible on stellar.expert/public
- [ ] Single within-cap charge on mainnet (cost: ~0.05 XLM in fees)
- [ ] Single over-cap charge rejection on mainnet
- [ ] Single non-policy address rejection on mainnet (C1 verification)
- [ ] Document mainnet contract id in DEPLOYED.md alongside testnet

**Hard limit for this milestone:** per-wallet fund cap at 5 XLM. If the
admin balance drops below 100 XLM during rehearsal, stop. Investigate.

---

## Milestone C · Public spike endpoint (target: 2026-06-04, D-4)

Goal: a URL the mentor can open from their phone in Rio without Manuel
running a server on his laptop.

- [ ] Deploy spike server behind nginx on `spike.slippay.cc` (or
      equivalent subdomain on the prod box per memory
      `reference_slippay_deploy`)
- [ ] HTTPS via Let's Encrypt (audit H4)
- [ ] Replace CORS `*` with explicit origin allow-list (audit S1)
- [ ] Add per-IP rate limit: 1 spike per IP per 24h, 10 charges per IP
      per hour (audit S1)
- [ ] Move deployer secret from disk to env var loaded from a sealed
      file at boot only (audit H5). Cache keypair in process memory;
      do not re-read per request.
- [ ] Add daily admin-spend cap (env var `MAX_DAILY_XLM_SPEND`, default
      100 XLM). Spike server refuses requests once it has spent that
      much in a rolling 24h window.
- [ ] Authenticate `/charge` so only a known caller can trigger pulls
      (audit S2). For v0.1, "known caller" = a bearer token shared with
      the operator only.
- [ ] systemd unit + log rotation + restart-on-fail
- [ ] Health check endpoint at `/api/policy-checkout/health` (just
      returns 200)

**Done criteria:** the mentor can open `https://spike.slippay.cc/s/demo`
on their phone, tap, see active in ~25s with mainnet links.

---

## Milestone D · USDC narrative swap (target: 2026-06-05, D-3)

Goal: amounts read "USDC 0.29" instead of "0.029 XLM" so the pitch line
"subscription billing in USDC" is true on the page.

- [ ] On testnet: deploy a test USDC issuer keypair, fund via friendbot
- [ ] Deploy SAC for that USDC asset (`stellar contract asset deploy`)
- [ ] Update `DEMO_TOKEN` in server to the test USDC SAC address
- [ ] Mint test USDC to wallet via SAC.transfer after deploy (replaces
      the native-XLM funding step)
- [ ] Change demo registry amount labels: "USDC 0.29 / 30s" or move to
      "USDC 29.00 / 30 days" if longer intervals fit demo timing
- [ ] On mainnet: source real USDC (Circle USDC contract:
      `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`).
      Fund admin G-account with $50 USDC via anchor. Distribute $1 per
      demo wallet at deploy time.

---

## Milestone E · Close Gap 2 (target: 2026-06-06, D-2)

The harder cryptographic work. **OPTIONAL for Rio demo** — the v0.1
spike framing ("trusted setup oracle, v0.2 is passkey") is honest and
defensible if Manuel decides to ship Rio without this.

- [ ] WebAuthn passkey creation in the browser
  - `navigator.credentials.create()` with `pubKeyCredParams: [{ alg: -7 }]` (ES256)
  - Extract COSE pubkey, convert to 65-byte uncompressed X9.62
  - Store credential id in localStorage (or remote)
- [ ] WebAuthn signing in the browser
  - `navigator.credentials.get()` with challenge = Soroban payload hash
  - Convert DER signature → raw r||s (64 bytes)
  - Send authenticatorData + clientDataJSON + signature to server
- [ ] Contract change: `__check_auth` runs real `secp256r1_verify`
  - But also implement WebAuthn unwrapping:
    `payload_check = sha256(authData || sha256(clientDataJSON))`
    must equal Soroban's `signature_payload`
  - Verify clientDataJSON contains the right challenge
  - Then run `secp256r1_verify(pubkey, payload_check, signature)`
- [ ] Server change: pass authData + clientDataJSON through to the
      contract as part of the auth signature struct (not just 64 bytes
      anymore — wrap in a struct)
- [ ] Tests for the WebAuthn unwrap path

**Effort estimate:** 2-3 days focused. **Risk:** the WebAuthn-to-Soroban
mapping has subtle bugs in production-grade implementations (passkey-kit
took multiple iterations to land cleanly). Schedule with buffer.

---

## Milestone F · Pre-demo polish (target: 2026-06-07, D-1)

- [ ] Read SECURITY_AUDIT.md aloud to operator one more time; ensure
      everyone knows what is and isn't in v0.1
- [ ] Run the demo URL on 3 devices: iPhone Safari, Android Chrome,
      desktop browser. Confirm no crashes
- [ ] Set up a QR code generator for `https://spike.slippay.cc/s/demo`
      so mentor scans rather than types
- [ ] Have a fallback URL on testnet in case mainnet does anything
      unexpected during the demo
- [ ] Pre-fund the admin with extra XLM (target ≥500 XLM) so spam during
      the demo doesn't drain it

---

## Milestone G · Pre-customer (NOT before 2026-Q3 unless circumstances change)

These are the gates between "demo at conferences" and "real customer
funds in production." None of these are required for Rio.

- [ ] Third-party audit (OpenZeppelin, Trail of Bits, Halborn, Certora)
- [ ] All HIGH and MEDIUM findings from SECURITY_AUDIT.md closed
- [ ] Multi-sig admin (2-of-3 OR migration to passkey-as-admin per v0.2)
- [ ] Wallet upgrade mechanism (audit M4) decided and documented
- [ ] Bug bounty program live (Immunefi or equivalent)
- [ ] Monitoring + alerts: every policy install, every charge over $X,
      any unexpected error rate
- [ ] Insurance / reserve fund for incident response
- [ ] Legal review with the BCB Res 561 framing (memory
      `project_slippay_repositioning_561`)

---

## Hard gates · do not cross without each one

| gate | block until |
|---|---|
| Mainnet rehearsal | C1+H3 fixes verified on testnet · MILESTONE A |
| Public spike URL | mainnet rehearsal passed · MILESTONE B |
| Customer onboarding | third-party audit signed off · MILESTONE G |

Anything crossing these gates is a deliberate operator decision, not a
default progression. Document the override in the commit message.

---

## Open questions for the operator (need answers before B)

1. Is `slippay-mainnet-deployer` the right key for the spike server's
   admin? Or should we generate a fresh admin keypair to limit blast
   radius if compromised?
2. Subdomain choice: `spike.slippay.cc`, `pay.slippay.cc`,
   `checkout.slippay.cc`? DNS and cert need to land before public
   deploy.
3. For Rio demo: do you want to go testnet-only (lower risk, requires
   explanation) or mainnet with $1-5 caps (higher impact, requires
   milestones B and C done)? Decision affects 3 days of work.

Default recommendation if no preference stated: **testnet for Rio demo
+ visible disclaimer + screenshot of testnet artifact**. Mainnet
rehearsal continues in parallel for v0.2.
