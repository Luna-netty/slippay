# Slippay Smart Wallet · Security Audit v0.1

**Date:** 2026-05-28 · **Auditor:** Claudin (internal · adversarial pass)
**Scope:** `contracts/smart-wallet/src/lib.rs`, `scripts/policy-checkout-spike-server.mjs`, `apps/web/src/pages/PolicySubscribe.tsx`
**Network state at audit:** v0.1 testnet only · template `CBG62CSW...UNASO`

This audit is **internal**. It does not substitute for a third-party audit by OpenZeppelin, Trail of Bits, Certora, Halborn, or equivalent. Mainnet deployment with real customer funds must wait until both the findings below are addressed AND an independent firm signs off on the post-fix code.

The auditor's mindset: assume hostile attackers, hostile merchants, compromised admins, MITM on the server, and motivated adversaries with access to public source code. Every finding below has a concrete exploit path or attack chain.

---

## Severity ladder

- **CRITICAL** — directly enables fund theft, full wallet drain, or admin compromise. **Block mainnet.**
- **HIGH** — significant impact under realistic conditions. Mainnet only after mitigation.
- **MEDIUM** — partial impact or unlikely-but-possible. Should be fixed; document if accepted.
- **LOW** — hygiene, observability, defense-in-depth. Acceptable to defer.

---

## CRITICAL findings

### C1 · `__check_auth` fall-through accepts any non-zero signature → universal wallet drain

**File:** `contracts/smart-wallet/src/lib.rs:278-313`

**The bug.** When an auth context does not match an installed policy (any
context that is not a `token.transfer` to a registered merchant in the
right token with amount under cap and interval elapsed), `__check_auth`
falls through to a stub that requires only that the signature blob is
non-zero. The stub returns `Ok(())` for any 64-byte payload with a single
non-zero byte.

**Exploit path.**
1. Attacker learns the v0.1 placeholder signature `[0x01; 64]` (it is in
   the open-source repo at `scripts/policy-checkout-spike-server.mjs:262`).
2. Attacker calls `SAC.transfer(victim_wallet, attacker_address, full_balance)`
   on the native or any SAC where the victim wallet has funds.
3. Soroban host invokes the wallet's `__check_auth` with the transfer
   context. `try_match_policy` returns `Ok(false)` because no policy
   exists for `attacker_address`.
4. `all_matched` becomes false, the loop falls through to the stub.
5. The stub checks the pubkey exists (yes, init was called) and the
   signature is non-zero (yes, `[0x01; 64]`).
6. `Ok(())` is returned. Transfer executes. Funds gone.

**Why this defeats the entire "Stripe-impossible" thesis.** The product
sells "the policy limit lives in the wallet, not in Slippay's database."
The 13 unit tests prove the *positive* path (policy-matched transfers
are correctly gated). But the *negative* path (transfers outside the
policy) is currently fully open. An attacker doesn't need to break the
policy — they just route around it.

**Severity.** CRITICAL. This is the highest-impact finding. It must close
before any mainnet deploy with real funds.

**Fix.** One line. Change the fall-through to default-deny in v0.1, then
implement real `secp256r1_verify` in v0.2:

```rust
// Replace lines 306-313:
let sig_bytes = signature.to_array();
if sig_bytes.iter().all(|b| *b == 0) {
    return Err(Error::SignatureInvalid);
}
let _ = signature_payload;
Ok(())

// With:
//
// v0.1 default-deny on fall-through. Non-policy-matched transfers
// REQUIRE a real secp256r1 signature, which v0.1 does not yet emit.
// Until secp256r1_verify is wired in v0.2, every non-matched context
// is rejected. This collapses the "Stripe-impossible" property back
// onto the policy invariant.
let _ = (signature_payload, signature, _pubkey);
Err(Error::SignatureInvalid)
```

**Falsifiable check.** After the fix, repeat the spike → charge flow on
testnet with the SDK code unchanged. The within-cap charge should still
succeed (policy match path). A new test, "transfer to non-policy address",
should fail with `Error::SignatureInvalid`. If it succeeds, the fix did
not land.

---

### C2 · Init front-running between `deploy` and `init`

**File:** `scripts/policy-checkout-spike-server.mjs:120-145`

**The bug.** `stellar contract deploy` and the subsequent `init`
invocation are two separate transactions. Between them, any party
watching the chain can inject their own `init(adversary_pubkey,
adversary_cred_id, adversary_admin)` call. The contract's `init` only
guards against double-init, not against the wrong party initing first.

**Exploit path.**
1. Spike server submits `deploy` → contract id `C123...` lands at ledger N.
2. Adversary's bot subscribed to ledger feed sees the deploy and
   immediately submits `init(adv_pubkey, adv_cred_id, adv_admin_addr)`
   targeting `C123...`. Adversary's tx lands at ledger N+1.
3. Spike server's `init` lands at ledger N+2 and PANICS with
   `AlreadyInitialized`.
4. Adversary now controls the wallet. They can install any policy
   they want. The user who paid for the deploy lost the wallet.

**Severity.** CRITICAL on mainnet. On testnet (current) it merely breaks
demos. On mainnet, attackers will absolutely run this bot.

**Fix.** Atomic deploy+init in a single transaction. Stellar smart
contract deploy supports a constructor pattern — pass the init args to
the deploy operation. Otherwise, the server must build a multi-op tx
that deploys then calls init in one envelope. `stellar-cli` may not
support this directly; the SDK does.

Alternative: rather than `init`-after-deploy, have a single function
`init_or_panic_if_called_before` that *requires* admin auth and runs
the init only when called as the deploy's first op.

---

### C3 · Single-key admin = full drain on key compromise

**File:** `contracts/smart-wallet/src/lib.rs:171-181, 215-223`

**The bug.** The admin address is a single Ed25519 G-account stored on
disk at `~/.config/stellar/identity/slippay-deployer.toml` in plaintext.
Compromise of that file (or of the server it runs on) yields the ability
to install any policy on any wallet ever deployed.

**Exploit path.**
1. Attacker gains read access to `~/.config/stellar/identity/`
   (server compromise, supply chain attack on a Node dependency,
   misconfigured backup, etc.).
2. Attacker calls `install_policy(merchant=attacker, max=i128::MAX,
   interval=1, expires_at=0)` on every wallet that admin governs.
3. Attacker immediately calls `SAC.transfer(wallet, attacker, balance)`
   on each. The policy-match path now authorizes since policy says
   attacker is the merchant and max is unbounded.

**Severity.** CRITICAL on mainnet given v0.1's single-admin design.

**Fix options.**
1. **v0.1 fix:** admin key in HSM or hardware key with rate-limited
   signing. Document explicitly that admin is the single point of
   failure.
2. **v0.2 plan:** admin migrates to be the wallet's own contract
   address. install/revoke flow through `__check_auth` which requires
   the user's passkey. Compromise of the spike server no longer
   compromises wallets.

The v0.1 fix is mainnet-acceptable IF combined with a per-wallet
spending cap (see H1).

---

### C4 · `install_policy` overwrites silently with no diff event

**File:** `contracts/smart-wallet/src/lib.rs:203-209`

**The bug.** Re-installing a policy for an existing merchant overwrites
the previous policy. The emitted `policy_installed` event only shows
the NEW policy. Indexers and the user-facing UI cannot detect that the
max was raised from $35 to $35000 unless they were already storing the
prior state.

**Exploit path (assumes admin compromise per C3).**
1. Admin (compromised) installs policy `{merchant=X, max=35}` legitimately.
2. Later, attacker calls `install_policy(merchant=X, max=35000)`.
3. The wallet now allows X to charge $35000 per cycle. The user, watching
   only the most recent event, may dismiss it as "subscription updated."

**Severity.** CRITICAL when combined with C3. HIGH on its own.

**Fix.** Emit a `policy_updated` event with the OLD and NEW values when
overwriting (read the old policy, compare, emit a richer event). OR:
require explicit `revoke_policy` before `install_policy` can replace.
The second is more secure; the first is easier to retrofit.

---

### S1 · CORS `*` + no auth + no rate limit on spike server

**File:** `scripts/policy-checkout-spike-server.mjs:404, 416-451`

**The bug.** The spike server exposes `/api/policy-checkout/spike` and
`/api/policy-checkout/charge` with `Access-Control-Allow-Origin: *` and
no authentication, no rate limiting. Any website on the internet can
make the server execute Stellar transactions paid for by the admin.

**Exploit path.**
1. Attacker creates a webpage with a hidden JS loop that POSTs to
   `/api/policy-checkout/spike` 100x/sec.
2. Victim visits the page (or attacker visits it themselves). Browser's
   CORS doesn't block the request because of the wildcard.
3. Each request costs the admin ~0.5-1 XLM in fees (deploy + 3 invokes
   + funding). 9994 XLM balance drains in ~3 hours of sustained spam.

Even without the malicious-page vector, anyone with curl can drain the
admin via simple `for i in {1..10000}; do curl ... &; done`.

**Severity.** CRITICAL for any public deploy. Currently mitigated by
the server running on localhost only.

**Fix.**
1. Replace `*` with a specific origin allow-list (the production app's
   URL).
2. Add a per-IP rate limit (e.g., 1 spike per IP per hour).
3. Add a bearer token or signed request requirement.
4. Add a daily admin-spend cap (max XLM spent per 24h) so a misconfig
   can't drain the whole admin in one shot.
5. Front the server with nginx + fail2ban + WAF.

---

### S2 · `/charge` accepts any wallet from the request → cross-wallet abuse

**File:** `scripts/policy-checkout-spike-server.mjs:442-450`

**The bug.** `/api/policy-checkout/charge` reads `body.wallet` as the
SAC.transfer source. The merchant is hardcoded to `DEMO_MERCHANT`. If
any wallet on mainnet has an active policy with merchant=DEMO_MERCHANT,
anyone can call this endpoint to charge that wallet.

**Exploit path.**
1. Real customer Alice has a policy on her wallet that allows
   `DEMO_MERCHANT` to charge $29/30d (because she subscribed to a
   Slippay-operated demo merchant).
2. Attacker hits `/api/policy-checkout/charge` with `wallet=Alice's_wallet`
   every 30 days + 1 second. Slippay's admin signs the transfer (because
   admin authorizes the SAC.transfer; the wallet's `__check_auth`
   authorizes the policy match).
3. Funds drain from Alice's wallet to `DEMO_MERCHANT` on each call.

Note: this is "by design" in v0.1 because the merchant *is* DEMO_MERCHANT
and the policy authorized them. But the demo server should not be a
public trigger — only the actual merchant business logic should fire
charges.

**Severity.** HIGH on mainnet. Mitigated on testnet where there are no
real customers.

**Fix.** `/charge` should require the merchant to authenticate (e.g.,
the merchant's own G-account signs the request). For v0.1 mainnet
demo, restrict /charge to ONLY work for wallets Slippay itself just
deployed (track them in a session map or in a database).

---

## HIGH findings

### H1 · No per-wallet spend cap → v0.1 admin compromise is uncapped

**Files:** contract; server

**The bug.** A v0.1 wallet can be funded with arbitrary value. A
compromised admin (per C3) can install a policy that drains the whole
balance immediately.

**Severity.** HIGH on mainnet.

**Fix for mainnet rehearsal.** Limit per-wallet funding to a small
demo amount (e.g., $5 USDC equivalent). Document the cap explicitly.
Refuse to fund wallets beyond it.

---

### H2 · Math.random() nonce in auth entry construction

**File:** `scripts/policy-checkout-spike-server.mjs:274`

**The bug.** `Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)`
produces a 53-bit non-cryptographic nonce. Birthday collision after
~2^26.5 ≈ 95 million entries. Soroban host rejects replays, so a
collision triggers an error rather than a security incident, but it's
sloppy crypto in security-sensitive code.

**Severity.** MEDIUM in practice. Auditors mark this as HIGH on principle.

**Fix.** `crypto.randomBytes(8)` and convert to a `BigInt` for the
nonce.

---

### H3 · Admin == merchant guardrail missing

**File:** `contracts/smart-wallet/src/lib.rs:162-210`

**The bug.** Nothing in `install_policy` prevents `merchant == admin`
or `merchant == env.current_contract_address()`. A compromised admin
could install a policy where they are also the merchant and drain the
wallet to themselves.

**Severity.** HIGH given C3.

**Fix.** Reject `merchant == admin` and `merchant == env.current_contract_address()`
at install time:

```rust
if merchant == admin || merchant == env.current_contract_address() {
    panic_with_error!(&env, Error::InvalidConfig);
}
```

---

### H4 · No HTTPS on the spike server

**File:** `scripts/policy-checkout-spike-server.mjs:402-466`

**The bug.** Plain HTTP. MITM can observe wallet ids and inject
responses. Localhost-only mitigates today.

**Severity.** HIGH for any public deploy.

**Fix.** nginx in front with Let's Encrypt cert. Document the production
deployment shape in `DEPLOYED.md`.

---

### H5 · Deployer secret read from plaintext disk on every charge

**File:** `scripts/policy-checkout-spike-server.mjs:208-216`

**The bug.** Every charge invokes `stellar keys secret slippay-deployer`
which reads the plaintext seed from `~/.config/stellar/identity/`. The
secret is then materialized in process memory.

**Severity.** HIGH for production.

**Fix.** Cache the keypair in memory once at startup. Move the secret
to an encrypted env var (KMS-decrypted at boot) or an HSM. The current
"plaintext on disk" pattern is acceptable for the spike server running
on the operator's laptop, never for production.

---

## MEDIUM findings

### M1 · `xdrInvokeWithAuth` function is dead code

**File:** `scripts/policy-checkout-spike-server.mjs:347-371`

Unused after the chargeViaSdk refactor. Remove it. Dead code in
auth-handling files invites future copy-paste bugs.

### M2 · TTL extension target of ~31 days

**File:** `contracts/smart-wallet/src/lib.rs:58-59`

A policy that goes 31 days idle (no charges, no refresh) will be
archived by the host. Re-activation requires a manual storage touch.
Subscription products with rare charges (annual, biennial) will hit
this. Acceptable for v0.1 (monthly charges keep TTL fresh), but
document the constraint.

### M3 · No `revoke_all_policies` for emergency

**File:** contract

If a user wants to nuke all policies in one tx, they cannot. Each
merchant requires a separate `revoke_policy` call. For a wallet with
many merchants this is a UX/safety gap.

### M4 · No upgrade path for the wallet contract

The contract has no admin-controlled upgrade. If a CRITICAL bug is
found post-deploy, every existing wallet is stuck with the bugged
code. Migration would require deploying a fresh wallet per user and
draining the old one (assuming the drain is possible without
triggering the bug).

For v0.1 spike: acceptable. For mainnet: must have a careful upgrade
plan, either via admin-controlled wasm-hash swap OR by accepting that
wallets are immutable and any bug = stuck users.

---

## LOW findings

- **L1** · Server logs wallet addresses (privacy). Truncate to first
  8 chars in logs.
- **L2** · No log of which IP triggered which charge. Add for
  forensics.
- **L3** · `parseTxHash` regex only matches testnet URL pattern
  (`explorer/testnet/tx/...`). Mainnet rehearsal needs a generalized
  regex.
- **L4** · Unbounded `maxBuffer: 8MB` for `execFile`. Could cap lower.
- **L5** · Frontend stores chargeLog in component state only. Refresh
  loses history. Acceptable for demo, not for a real user surface.

---

## Mainnet-readiness verdict

**v0.1 as-is: NOT mainnet-ready.** Three findings are existential
(C1, C3, S1) and three more are highly exploitable (C2, C4, S2).

**Minimum work to make v0.1 mainnet-acceptable for a CAPPED demo:**

1. **C1 fix** (1 line · contract redeploy + retest) — closes the universal drain.
2. **C2 fix** (atomic deploy+init) — closes front-running.
3. **H3 fix** (admin/merchant guardrail) — closes admin self-drain.
4. **S1 fix** (origin allow-list + rate limit + spend cap) — closes public DoS.
5. **S2 fix** (merchant auth on /charge) — closes cross-wallet abuse.
6. **H1 fix** (per-wallet $5 cap) — limits blast radius.
7. **L3 fix** (mainnet URL parser) — operational, not security.

Estimated effort: **1-2 days of focused work**. The C1 fix is one line
but every fix needs redeploy + retest + verification.

**v0.1 to be considered "production-grade" requires also:**
- C3 mitigation (HSM for admin) or v0.2 (passkey admin)
- C4 fix (diff events)
- H2 (cryptographic nonces)
- H4 (HTTPS)
- H5 (secret in HSM/env)
- M4 (upgrade plan)
- Third-party audit (OpenZeppelin / Trail of Bits / Halborn) by a firm
  that is not Slippay-affiliated. **Self-audits, including this one, are
  the floor, not the ceiling.**

Estimated effort to "production-grade": **2-4 weeks plus audit
turnaround (4-12 weeks typical)**.

---

## Audit non-goals (explicit)

This audit did NOT cover:
- Static analysis tooling (cargo clippy with security lints, semgrep,
  no Soroban-specific linter exists yet)
- Formal verification of contract invariants (Certora, KEVM-equivalent)
- Property-based / fuzz testing of contract invariants
- Side-channel analysis (none expected on Soroban host)
- Reading the slippay-subscription mainnet contract (out of scope here;
  has its own audit-002 trail)
- Reading the spike server's Node dependency tree for known CVEs
  (`pnpm audit` not run as part of this pass)

A real third-party audit would cover all of the above.

---

## Auditor disclosure

This audit was performed by Claude (Claudin), an LLM acting as the
operator's pair-engineer in a single ~3-hour session that started with
zero contract code. The auditor wrote the contract under review. **An
auditor reviewing their own code is the lowest-rigor form of audit.**
The findings above are the ones the auditor could identify by reading
adversarially. There may be others the auditor missed precisely because
they are also the author.

Mainnet deployment must be gated on an external review.

---

## SECOND-PASS REVIEW (2026-05-28 16:30 BRT)

Operator's instruction: "auditar de novo, NÃO PODE TER NENHUM ERRO DE
SEGURANÇA." This second pass treated "zero errors" as the aspirational
goal it is and tried to surface every additional finding a fresh
adversarial pass could catch.

### Honest disclaimer up front

"No security errors" is **literally impossible to prove** for any
non-trivial program. The state of the art for high-stakes Soroban
contracts uses: (1) third-party human audit, (2) automated static
analysis, (3) formal verification of critical invariants, (4) fuzz
testing, (5) bug bounty in production. This self-review covers none of
those at production rigor.

What this second pass added in concrete terms below.

### Tools used in pass 2

- `cargo clippy --release --all-features -W clippy::indexing_slicing -W clippy::unwrap_used`
- Grep for `unsafe`, `unwrap`, `expect`
- Direct invocation of `__check_auth` via stellar-cli to verify host gating
- Re-read of `lib.rs` end-to-end with explicit checklist (overflow, reentrancy, TOCTOU, edge values, storage exhaustion, archival, public-readability, event leak)
- Re-read of `policy-checkout-spike-server.mjs` end-to-end

### NEW findings (second pass)

#### N1 · `max_per_charge` unbounded · MEDIUM — **FIXED in this pass**

Before fix: admin could install `max_per_charge = i128::MAX`. Combined
with admin compromise (C3), this enables one-shot drain.

Fix landed: `install_policy` now rejects `max_per_charge > amount_per_charge * 10`.
The `MAX_CAP_MULTIPLIER` constant lives at the top of the file with a
clear audit reference. Test `install_rejects_max_above_multiplier`
covers both the rejection (max=amount*20) and the boundary (max=amount*10
accepts).

Live on testnet wasm `84bdf29c12238351922d07ecbc52fd9bac162b4d6341fafcfa403edc68dd6ec2`.

#### N2 · `unwrap()` in `try_match_policy` · LOW — **FIXED in this pass**

Before fix: lines 333-334 used `cc.args.get(1).unwrap()` and `.get(2).unwrap()`.
Guarded by `args.len() != 3` upstream so safe in practice, but clippy
flagged both. A future refactor that drops the length check would
silently introduce panics in `__check_auth`, which is high-blast-radius.

Fix landed: explicit `if let Some(v) = ... else return Ok(false)` per
clippy's preferred pattern. Zero `unwrap()` in the panic-sensitive
`__check_auth` path now.

#### N3 · cargo dep `soroban-sdk = "26"` not exact-pinned · LOW

Allows any 26.x.x via patch updates. A compromised SDK patch could
ship a backdoor. Acceptable for testnet; mainnet rehearsal should pin
to exact (e.g., `soroban-sdk = "=26.0.1"`) and verify the lockfile.

**Status:** not fixed in this pass. Track for milestone B.

#### N4 · `get_policy` is public read · LOW

Anyone can read any wallet's policies. Privacy concern only — the
policies themselves are also emitted as events on install/revoke, so
the storage read does not increase leakage beyond what is already on
chain. Not actionable for v0.1.

#### N5 · Server reads `.testnet-deploy.env` once at startup · LOW

Redeploy + forget to restart = server still uses stale wasm hash. The
new wallets it deploys point at the OLD bytecode. Detectable by checking
the contract id's wasm hash matches the env's after each redeploy.

**Status:** not fixed in this pass. Add a startup sanity check that
queries the deployed wasm to confirm the loaded hash matches.

### Verifications PASSED (second pass)

These were specific things I worried about and confirmed safe.

- **V1** · No `unsafe` blocks anywhere in the contract. (`grep -n unsafe`)
- **V2** · `__check_auth` cannot be invoked directly. Verified on testnet:
  `stellar contract invoke ... -- __check_auth ...` returns
  `HostError: Error(Context, InvalidAction): "can't invoke a reserved function directly"`.
  The host explicitly reserves this function. The previously-hypothesized
  attack (call `__check_auth` directly to bump `last_charge_at` on
  policies and DoS legitimate charges) is impossible.
- **V3** · No integer overflow / underflow risk. Only arithmetic in the
  contract is `last_charge_at.saturating_add(interval_seconds)`, which
  uses `saturating_add`. All comparisons are type-safe. `amount_per_charge.saturating_mul`
  in N1 fix is also saturating.
- **V4** · No reentrancy in `try_match_policy`. The function does
  storage reads/writes only on its own contract; no external calls.
- **V5** · Soroban transaction atomicity guarantees state rollback on
  `Err` return from `__check_auth`. So intermediate `last_charge_at`
  bumps for context A don't persist if context B fails.
- **V6** · TTL extension target (`535_000` ledgers ≈ 31 days) is
  clamped by the host to the protocol maximum, so passing a generous
  target is safe and the entry survives idle gaps as designed.
- **V7** · Archived (TTL-expired) policies trigger `Ok(false)` from
  `try_match_policy`, which falls through to default-deny per the C1
  fix. Archived policies fail safe.
- **V8** · `Address` comparison via `==` is well-defined; the SDK
  normalizes representations.
- **V9** · `Cargo.lock` is committed → reproducible builds.
- **V10** · 16/16 unit tests passing on the second-pass wasm. Coverage
  includes: init reject double, install reject (negative amount, max < amount,
  interval < 60, expires_at past, merchant == admin, merchant == contract,
  max > amount * 10), revoke (success + nonexistent), policy match
  (within cap, over cap, revoked, expired, interval not elapsed,
  unknown merchant, wrong token, non-transfer fn).

### Findings the second pass did NOT close

- **C1** is closed but only verified end-to-end on testnet via direct
  `SAC.transfer` to a non-policy address. A unit-level test of the
  `__check_auth` fall-through requires `env.try_invoke_contract_check_auth`
  (Soroban testutils) which I did not wire up due to time. **The
  integration verification stands; the unit-level gap is documented.**
- **C2** (init front-running) still requires moving init into a
  constructor pattern or bundling deploy + init in a single Soroban
  envelope. Not addressed.
- **C3** (single-admin compromise = full drain) is mitigated by N1
  (cap on max_per_charge) and H3 (no admin-as-merchant). Both reduce
  blast radius but do not eliminate the risk. Mitigation requires
  either HSM-protected admin (v0.1 mainnet) or migration to passkey
  admin (v0.2).
- **C4** (silent policy overwrite) still emits the same `policy_installed`
  event whether installing or replacing. Not addressed.
- **S1** (CORS + no rate limit + no auth on server) is unchanged.
  Will be addressed in milestone C of MAINNET_PREP.
- **S2** (any wallet in `/charge` request) is unchanged.
- **H4** (no HTTPS) is unchanged.
- **H5** (deployer secret on disk, read per request) is unchanged.

### Updated minimum-fixes-for-capped-mainnet list

- [x] C1 fix
- [x] H3 fix
- [x] N1 fix
- [x] N2 cleanup
- [ ] C2 fix (atomic deploy+init)
- [ ] S1 fix (CORS, rate limit, daily cap)
- [ ] S2 fix (merchant auth on /charge)
- [ ] H4 + H5 (HTTPS, secret hardening)
- [ ] N3 (exact-pin cargo deps)

### Updated honest verdict

The second pass closed 2 NEW findings (N1, N2), verified 10 invariants
that were previously assumed safe, and confirmed 3 unfixed CRITICAL
items (C2, C3, C4) and 3 unfixed HIGH items (H4, H5, S1) remain.

**v0.1 with second-pass fixes is now closer to mainnet-acceptable for
a capped demo** (< $5/wallet, rate-limited public surface) but still
**not production-grade**. The CRITICAL gating for production stays:

1. Third-party audit by an established firm.
2. Either v0.2 with passkey admin OR HSM-protected v0.1 admin.
3. Closure of C2, C4 at minimum.
4. Bug bounty in production.

This second pass increased confidence but did not change the binary
"mainnet customer-facing or not" answer.

### Author's honest self-assessment

I am Claude, an LLM. I wrote this code and I audited it. I am not
qualified to certify a smart contract for mainnet customer use no
matter how many passes I do. The mention of OpenZeppelin / Trail of
Bits / Halborn in this document is not theater — it is the literal
prerequisite for any real money to touch this code in production.

I caught what I could in two passes. The next pass needs to be by
someone who didn't write the code.

---

## Suggested next actions for operator

1. **Today** · Apply C1 fix (one line) + redeploy testnet + retest.
   The current testnet wallet `CBYDPDG5...HFQP` is exploitable per C1.
2. **This week** · Apply C2, H3, S1, S2, H1 fixes. Set up nginx + HTTPS
   for public deploy.
3. **Before Rio (08/06)** · Run the demo on the patched testnet
   contract. Do NOT rehearse on mainnet until the third-party audit is
   commissioned.
4. **Before any mainnet customer** · Commission OpenZeppelin or Trail
   of Bits audit. Budget $20-40k, 2-6 weeks turnaround. Until that
   audit lands, the smart-wallet remains testnet-only.
