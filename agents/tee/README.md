# TEE attestation envelope — provenance of which policy+model decided money

**Mechanism 3** of Slippay's agent-integrity stack. It answers one audit
question and only that question:

> *Which policy and which model, running inside which attested binary, produced
> these exact bytes of this money decision?*

It extends the on-chain `ssl_hash` idea — sha256 of the governing `.ssl` spec,
already pinned immutably on the wallet session
(`contracts/smart-wallet/src/lib.rs:162`) — from **which policy** to **which
policy + which model + which binary, bound to one specific decision**.

| file | role |
|---|---|
| `tee.py` | the envelope, canonicalization, digest binding, sign/verify, the **mock** producer, the on-chain anchor record |
| `test_tee.py` | 19 adversarial tests. `python3 -m pytest agents/tee/test_tee.py` → **19/19** |
| `README.md` | this file — the honesty contract |

Run: `python3 -m pytest agents/tee/test_tee.py -v` (or `python3 agents/tee/test_tee.py` for the no-pytest fallback runner).

---

## What this is

- **(a) `Envelope`** — `{ policy_hash, model_id, enclave_measurement, decision
  (canonical bytes), nonce, signature, sig_alg }`. Every field is a fact the
  enclave commits to.
- **(b) deterministic canonicalization + sha256 binding** — `canonicalize_decision`
  (sorted-keys, no-whitespace, ASCII, UTF-8) and `binding_digest`
  (domain-tagged, length-prefixed sha256 over the five committed fields).
  Length-prefixing closes the `"ab"+"c" == "a"+"bc"` concatenation collision.
- **(c) sign / verify + a MOCK producer** — `MockEnclave.attest(...)` signs the
  binding digest. Default and active backend in this environment is **ed25519**
  via the `cryptography` lib (the same curve the on-chain wallet uses for agent
  sessions, `lib.rs:170`). If `cryptography` is unavailable, a **clearly
  labelled HMAC-SHA256 stand-in** (`sig_alg="hmac-sha256-standin"`) is used so
  the module still runs — see the limits section; the stand-in is symmetric and
  must never ship.
- **(d) `verify_envelope(env, expected_policy_hash, trusted_measurements,
  attestation_pubkey, expected_sig_alg=SIG_BACKEND, seen_nonces=...) -> (ok,
  reason)`** — rejects an envelope whose declared algorithm is not the
  caller-pinned one (`sig_alg_not_allowed` — the algorithm is pinned
  out-of-band, NEVER chosen by the attacker-controlled `env.sig_alg`; this is the
  JWT-`alg`-confusion fix), a wrong expected policy (`policy_hash_mismatch`), an
  untrusted measurement (`untrusted_measurement`), any tampered committed field
  including the decision, model_id, measurement, nonce, policy_hash, or sig_alg
  (`bad_signature`, because the recomputed digest no longer matches the
  signature), and a replayed nonce (`replay`). `sig_alg` is now also a committed
  field inside `binding_digest`, so flipping it breaks the signature even if a
  caller forgets to pin `expected_sig_alg`.
- **(e) on-chain anchor record** — `AnchorRecord` / `anchor_record(env, ts)`.
  The minimal **commitment** written next to the session's `ssl_hash`:
  `policy_hash` (the join key, == `WalletSession.ssl_hash`), `model_id_hash`,
  `measurement`, `binding_digest`, `nonce_hash`, `ts`. The raw decision and the
  raw nonce never go on chain — only hashes / the commitment. Revealing the
  decision is an off-chain disclosure against that commitment, the same pattern
  already used for `ssl_hash` ("the diff, not the hash, is the evidence").

---

## HONESTY — read this before trusting anything here

### The real guarantee is infra-gated and is NOT delivered here.

A genuine TEE guarantee requires **running inside a real enclave** (AWS Nitro /
AMD SEV-SNP) and **verifying the vendor attestation chain**:

- **AWS Nitro:** the enclave emits an attestation document (COSE_Sign1 CBOR)
  signed by a cert chained to the **AWS Nitro root**; the verifier must validate
  that chain and the document's PCRs before trusting the measurement or key.
- **AMD SEV-SNP:** the guest gets an `ATTESTATION_REPORT` signed by the **VCEK**,
  chained to the **AMD root** via ASK/ARK; the verifier validates that chain and
  the `MEASUREMENT` field.

**None of that hardware or vendor-chain verification exists in this
environment.** There is no enclave here. `MockEnclave` fabricates a measurement
and signs with a self-held key. So what this module delivers is:

- the **envelope format**,
- the **canonicalization + digest binding**,
- the **verification logic** (policy / measurement-membership / signature /
  replay), and
- a **mock attestation producer**.

What it does **not** deliver: a real measurement, a real vendor attestation
document, or chain-of-trust validation up to AWS/AMD. The `attestation_pubkey`
the verifier trusts is, in a real system, **bound to the measurement by the
vendor document**. Here the caller supplies it directly — **that binding is the
mocked part.** Wiring a real enclave is a separate, infra-bearing task and is
out of scope for this mechanism.

### Even with real hardware, TEE attestation has two hard limits.

1. **It is NOT trustless.** A TEE roots trust in the **hardware vendor** (AWS /
   AMD). Soundness depends on the vendor's key custody and on the absence of a
   microcode / silicon break (and the field has a long history of such breaks).
   *Disanalogy with a zk-proof:* a zk-proof needs no trusted third party for
   soundness — you check math; a TEE attestation is exactly as sound as a
   manufacturer you cannot audit. If you need trustlessness, a TEE is the wrong
   tool.

2. **It attests PROVENANCE, not CORRECTNESS.** A valid envelope proves the
   decision bytes were produced under the declared policy + model inside an
   attested binary. It does **not** prove the decision was *right*. A model that
   is buggy, miscalibrated, or adversarial-but-honestly-declared produces a
   perfectly valid envelope for a bad decision. "Provably the declared model" is
   **not** "provably correct." This mechanism kills *silent model/policy swaps*
   and *post-hoc decision tampering*; it does **nothing** about a wrong decision
   from the right model.

### Failure modes named

- **Mock-as-real confusion.** Someone wires `MockEnclave` into a live path and
  believes they have TEE guarantees. They have none — no vendor chain. Guard
  (now enforced in code, not just asserted): `verify_envelope` pins the algorithm
  out-of-band via `expected_sig_alg` (default `SIG_BACKEND`) and rejects any
  mismatch *before* dispatch (`sig_alg_not_allowed`); and `_verify_signature`
  hard-fails `hmac-sha256-standin` whenever the real ed25519 backend is active.
  Together these refuse the symmetric stand-in on any real path — closing the
  algorithm-confusion forgery (downgrade `sig_alg`, then forge a MAC keyed on the
  *public* ed25519 key) that an earlier `env.sig_alg`-dispatching verifier
  accepted. A real verifier must still also require a validated vendor document,
  not a bare pubkey — that part remains infra-gated and out of scope.
- **HMAC stand-in is symmetric.** The fallback "signature" is a MAC: verifying it
  requires holding the signing secret, so any party that can verify can also
  forge. It exists only to keep the module runnable without `cryptography`. It
  is not an attestation scheme. Active backend here is **ed25519**, not this.
- **Replay state is the verifier's.** `seen_nonces` must be durable and shared
  across the real verifying fleet, or a replay slips through a fresh replica —
  same caveat as the wallet's nonce store and `AuthorityAgent.seen_nonces`.
- **Trust-list management is out of band.** `trusted_measurements` and the
  `attestation_pubkey↔measurement` binding are governance inputs; a stale or
  attacker-influenced trust list defeats gate 2 regardless of the crypto.

---

## Status

Logic + mock producer are tested **19/19**. **Not** wired to a real enclave and
**not** wired to the live charge path or to an on-chain write. Next steps, in
order of trust gained:

1. Run the decision inside a real Nitro / SEV-SNP enclave; replace the mock
   signature with the vendor attestation document.
2. In `verify_envelope`, validate the vendor document and chain to the AWS/AMD
   root, and derive `attestation_pubkey` + the trusted measurement **from** that
   document instead of taking them as caller-supplied arguments.
3. Persist `AnchorRecord` on-chain next to `WalletSession.ssl_hash` and have the
   off-chain indexer co-locate policy ↔ decision ↔ model ↔ measurement.
