"""TEE attestation envelope — provenance of which policy+model computed a money
decision, bound by a deterministic digest, signed by a (mock) enclave, anchored
on-chain next to the wallet's ``ssl_hash``.

This is **Mechanism 3** of Slippay's agent-integrity stack. It extends the
``ssl_hash`` idea already pinned on-chain
(`contracts/smart-wallet/src/lib.rs:162` — sha256 of the governing `.ssl` spec)
from *which policy* to *which policy ran inside which attested binary on which
declared model when it produced this exact decision*.

WHAT THIS GIVES YOU (and what it does NOT) — see README.md for the long form:

- It binds, non-repudiably, four facts to one decision: the policy hash, the
  model id, the enclave measurement (PCR / launch measurement), and a nonce.
  A verifier can later prove the bytes of a money decision were produced under a
  declared policy + model inside a binary whose measurement is on a trust list.
- It does NOT prove the decision was *correct*. TEE attests **provenance, not
  correctness** — a buggy or adversarial-but-honestly-declared model produces a
  perfectly valid envelope. "Provably the declared model" != "provably right".
- It is NOT trustless. TEE roots trust in the hardware vendor (AWS Nitro / AMD).
  The chain of trust terminates at a vendor root cert, not at math you can check
  without trusting a manufacturer. Disanalogy with a zk-proof: a zk-proof needs
  no trusted party for soundness; a TEE attestation is only as sound as the
  vendor's key custody and the absence of a hardware/microcode break.
- The signature here is produced by a **MOCK** enclave (`MockEnclave`). No Nitro
  / SEV-SNP hardware exists in this environment, so the real vendor attestation
  document (the CBOR/COSE Nitro doc, or the SEV-SNP ATTESTATION_REPORT) and its
  certificate-chain verification up to the AWS/AMD root are **not** performed.
  That step is infra-gated and explicitly out of scope. See README.md.

The verification logic, canonicalization, digest binding, and replay defence are
real and tested. Only the *origin of trust in the measurement+signature* is
mocked.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass, field
from typing import Iterable, Mapping, Optional, Tuple

# ---------------------------------------------------------------------------
# Signature backend selection.
#
# Preference: ed25519 from the `cryptography` lib (same curve the on-chain
# wallet uses for agent sessions — `AgentAuth.session_pubkey` is a 32-byte
# ed25519 key, lib.rs:170). If `cryptography` is unavailable we fall back to a
# CLEARLY LABELLED HMAC-SHA256 stand-in. The stand-in is NOT a real attestation
# signature scheme: it is symmetric, so "verify" would require the verifier to
# hold the signing secret. It exists only so the module and its tests run on a
# box without `cryptography`. Never ship the HMAC path to anything real.
# ---------------------------------------------------------------------------
try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey,
        Ed25519PublicKey,
    )
    from cryptography.exceptions import InvalidSignature

    SIG_BACKEND = "ed25519"
except Exception:  # pragma: no cover - exercised only on boxes without cryptography
    Ed25519PrivateKey = None  # type: ignore
    Ed25519PublicKey = None  # type: ignore

    class InvalidSignature(Exception):  # type: ignore
        pass

    SIG_BACKEND = "hmac-sha256-standin"


# ---------------------------------------------------------------------------
# (a) The envelope.
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Envelope:
    """The attestation envelope a real enclave would emit alongside a decision.

    Every field is a fact the enclave commits to. ``signature`` covers the
    sha256 *binding digest* over the other five fields, so any single-bit change
    to any committed field invalidates the signature.

    Fields:
      policy_hash:          sha256 (hex) of the governing `.ssl` spec. The SAME
                            value pinned on-chain as the wallet session's
                            ``ssl_hash`` (lib.rs:162). This is the join key
                            between the envelope and the on-chain anchor.
      model_id:             the declared model that ran inside the enclave, e.g.
                            "claude-opus-4-8" or a pinned weights digest. What
                            "provenance" means here: provably THIS id, not a
                            silent swap to a cheaper/uncensored model.
      enclave_measurement:  the enclave's launch measurement. On AWS Nitro this
                            is a PCR set (PCR0/1/2 are SHA-384 hex). On AMD
                            SEV-SNP it is the ATTESTATION_REPORT.MEASUREMENT.
                            Opaque hex here; the verifier checks set-membership
                            against a trust list of known-good measurements.
      decision:            the money decision, as CANONICAL BYTES. The enclave
                            attests the exact bytes it emitted. Stored bytes so
                            there is no "which serialization?" ambiguity at
                            verify time — the producer canonicalizes once.
      nonce:               per-decision unique value. Replay defence: a verifier
                            tracks seen nonces and accepts each at most once,
                            mirroring the wallet's nonce-once rule and the
                            AuthorityAgent's `seen_nonces`.
      signature:           enclave signature over `binding_digest(...)`. bytes.
      sig_alg:             "ed25519" or "hmac-sha256-standin" — records which
                            backend produced `signature` so a verifier can refuse
                            a stand-in signature in a context that requires real
                            asymmetric attestation.
    """

    policy_hash: str
    model_id: str
    enclave_measurement: str
    decision: bytes
    nonce: str
    signature: bytes
    sig_alg: str = SIG_BACKEND


# ---------------------------------------------------------------------------
# (b) Deterministic canonicalization + sha256 binding.
# ---------------------------------------------------------------------------
def canonicalize_decision(decision: Mapping) -> bytes:
    """Turn a decision dict into canonical bytes.

    Determinism is the whole point: the same logical decision MUST produce the
    same bytes on the producer and on every verifier, forever, or the signature
    check is meaningless. We use JSON with:
      - sort_keys=True            (key order can't change the bytes)
      - separators without spaces (no incidental whitespace drift)
      - ensure_ascii=True         (stable byte width regardless of locale)
      - UTF-8 encode
    A frozen, declared serialization is a security property, not a convenience —
    cf. the on-chain payload being "fixed-order typed scalars" in
    `agents/authority/README.md` so free-text fields can never branch a decision.

    Accepts a mapping (canonicalizes it) or pre-canonicalized bytes (returns as
    is) so callers can pass either form.
    """
    if isinstance(decision, (bytes, bytearray)):
        return bytes(decision)
    return json.dumps(
        decision,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")


def binding_digest(
    policy_hash: str,
    model_id: str,
    enclave_measurement: str,
    decision: bytes,
    nonce: str,
    sig_alg: str = SIG_BACKEND,
) -> bytes:
    """sha256 over the six committed fields, length-prefixed and domain-tagged.

    Why length-prefixing: naive concatenation `a || b` lets ("ab","c") and
    ("a","bc") collide. We prefix each field with its big-endian uint32 length
    and tag the hash with a domain-separation constant so a digest from this
    construction can never be confused with a digest computed elsewhere over the
    same raw bytes. This is the field-binding hole that bites home-rolled
    signing schemes; closing it is cheap.

    ``sig_alg`` is a committed field (the sixth) so the chosen algorithm is bound
    into the signature itself: flipping ``sig_alg`` after signing moves the digest
    and breaks the signature. This is the belt to ``verify_envelope``'s
    suspenders against the JWT-style algorithm-confusion attack (a verifier that
    dispatches on an attacker-controlled ``sig_alg`` — e.g. claiming the symmetric
    HMAC stand-in and supplying the *public* ed25519 key as the MAC secret —
    would otherwise accept a forged decision). The domain-tag is versioned to v2
    because the digest construction changed; a v1 digest must never be confused
    with a v2 one.
    """

    def lp(b: bytes) -> bytes:
        return len(b).to_bytes(4, "big") + b

    h = hashlib.sha256()
    h.update(b"slippay/tee/envelope/v2\x00")  # domain separation tag (v2: +sig_alg)
    h.update(lp(policy_hash.encode("utf-8")))
    h.update(lp(model_id.encode("utf-8")))
    h.update(lp(enclave_measurement.encode("utf-8")))
    h.update(lp(decision))
    h.update(lp(nonce.encode("utf-8")))
    h.update(lp(sig_alg.encode("utf-8")))
    return h.digest()


# ---------------------------------------------------------------------------
# (c) Sign / verify + the MOCK enclave (attestation producer).
# ---------------------------------------------------------------------------
class MockEnclave:
    """A stand-in for a genuine TEE.

    A REAL enclave (AWS Nitro / AMD SEV-SNP) would:
      1. boot a measured image → produce PCRs / a launch measurement,
      2. hold a signing key whose use is gated by that measurement,
      3. emit a vendor attestation document (Nitro: COSE_Sign1 CBOR signed by an
         AWS-rooted cert chain; SEV-SNP: ATTESTATION_REPORT signed by the VCEK,
         chained to the AMD root via ASK/ARK).
    A verifier would then validate that vendor document and chain BEFORE trusting
    the measurement or the key. NONE of step 3 happens here. This class fabricates
    a measurement and signs with a self-held key. It is a MOCK. See README.md.
    """

    def __init__(self, measurement: str, signing_key: Optional[object] = None):
        self.measurement = measurement
        if SIG_BACKEND == "ed25519":
            self._sk = signing_key or Ed25519PrivateKey.generate()
            self._pk = self._sk.public_key()
        else:  # HMAC stand-in: the "key" is a per-instance symmetric secret.
            # Random per instance so two distinct mock enclaves genuinely differ
            # (a fixed shared secret would make every "enclave" the same key —
            # an artefact of the stand-in, not a real property). Symmetric: the
            # verifier must hold this same secret to verify. Never ship.
            import os

            self._sk = signing_key or os.urandom(32)
            self._pk = self._sk  # symmetric: verify needs the same secret

    # The value a verifier puts on its trust list (asymmetric: pubkey bytes;
    # standin: the shared secret). Returned as bytes either way.
    def attestation_pubkey(self) -> bytes:
        if SIG_BACKEND == "ed25519":
            from cryptography.hazmat.primitives import serialization

            return self._pk.public_bytes(
                encoding=serialization.Encoding.Raw,
                format=serialization.PublicFormat.Raw,
            )
        return self._pk  # type: ignore[return-value]

    def _sign(self, digest: bytes) -> bytes:
        if SIG_BACKEND == "ed25519":
            return self._sk.sign(digest)
        return hmac.new(self._sk, digest, hashlib.sha256).digest()  # type: ignore[arg-type]

    def attest(
        self,
        policy_hash: str,
        model_id: str,
        decision: Mapping,
        nonce: str,
    ) -> Envelope:
        """Produce a signed envelope for one decision. The enclave canonicalizes
        the decision exactly once, here, so the attested bytes are unambiguous."""
        canon = canonicalize_decision(decision)
        digest = binding_digest(
            policy_hash, model_id, self.measurement, canon, nonce, SIG_BACKEND
        )
        sig = self._sign(digest)
        return Envelope(
            policy_hash=policy_hash,
            model_id=model_id,
            enclave_measurement=self.measurement,
            decision=canon,
            nonce=nonce,
            signature=sig,
            sig_alg=SIG_BACKEND,
        )


def _verify_signature(pubkey: bytes, digest: bytes, signature: bytes, sig_alg: str) -> bool:
    """Backend-dispatched signature check. Constant-time where it matters.

    Algorithm-confusion defence: when the real asymmetric backend is active
    (``SIG_BACKEND == "ed25519"``) this hard-fails any ``sig_alg ==
    "hmac-sha256-standin"``. The HMAC branch treats ``pubkey`` as a *symmetric
    secret*; if it stayed reachable while ed25519 is the real backend, an attacker
    who knows the (public-by-definition) ed25519 key could forge a valid MAC over
    an arbitrary tampered decision — the JWT ``alg=HS256``-with-RSA-public-key
    confusion class (CVE-2015-9235 family). The README states this requirement
    ("a real verifier must refuse hmac-sha256-standin"); this is its enforcement.
    """
    if sig_alg == "ed25519":
        if SIG_BACKEND != "ed25519":
            return False  # can't verify an ed25519 sig without the lib present
        try:
            Ed25519PublicKey.from_public_bytes(pubkey).verify(signature, digest)
            return True
        except (InvalidSignature, ValueError):
            return False
    elif sig_alg == "hmac-sha256-standin":
        if SIG_BACKEND == "ed25519":
            # Real asymmetric backend is active — the symmetric stand-in must not
            # be reachable. Refusing here closes the public-key-as-MAC-secret
            # forgery even if a caller forgot to pin expected_sig_alg.
            return False
        expected = hmac.new(pubkey, digest, hashlib.sha256).digest()
        return hmac.compare_digest(expected, signature)
    return False


# ---------------------------------------------------------------------------
# (d) verify_envelope.
# ---------------------------------------------------------------------------
def verify_envelope(
    env: Envelope,
    expected_policy_hash: str,
    trusted_measurements: Iterable[str],
    attestation_pubkey: bytes,
    *,
    expected_sig_alg: str = SIG_BACKEND,
    seen_nonces: Optional[set] = None,
) -> Tuple[bool, str]:
    """Return ``(ok, reason)``. ``ok`` is True only if EVERY gate passes.

    Gate order is chosen so the cheapest, most-specific rejections come first and
    the reason string is the first failing gate (useful for audit logs):

      0. sig_alg       — the envelope's declared algorithm must equal the
                         caller-pinned ``expected_sig_alg`` (defaults to the
                         active ``SIG_BACKEND``). ``env.sig_alg`` is an
                         attacker-controllable field that is NOT covered by any
                         other gate's trust root; dispatching the signature check
                         on it without pinning is the JWT ``alg`` confusion hole.
                         Pinning out-of-band here is the primary fix; a verifier
                         must never let the envelope choose its own algorithm.
      1. policy_hash   — envelope must claim the policy the caller demands. A
                         decision under a different (e.g. weakened) policy is
                         rejected even if perfectly signed.
      2. measurement   — the enclave measurement must be on the trust list. An
                         honestly-signed envelope from an UNKNOWN binary is
                         rejected; this is the membership check that a real
                         verifier does AFTER validating the vendor doc (the
                         vendor-doc validation itself is infra-gated, not here).
      3. signature     — the enclave signature must verify over the recomputed
                         binding digest. Recomputation from the envelope's own
                         fields (now INCLUDING sig_alg) is what makes a tampered
                         `decision` (or any other committed field) fail: the
                         digest moves, the sig doesn't.
      4. replay        — if a nonce set is supplied, the nonce must be unseen.
                         Accepted nonces are recorded (side effect) so the same
                         envelope can't settle twice. Matches the wallet's
                         nonce-once rule and AuthorityAgent.seen_nonces.

    `attestation_pubkey` is the verifier's trusted key for this enclave. In a
    real deployment it is bound to the measurement via the vendor attestation
    doc; here the caller supplies it directly (that binding is the mocked part).
    """
    # 0. sig_alg pinning — pin the algorithm out-of-band; never trust env.sig_alg
    #    to pick the verification path. This is the primary algorithm-confusion
    #    fix (the digest binding of sig_alg below and the _verify_signature
    #    hard-fail are belt-and-suspenders).
    if not hmac.compare_digest(env.sig_alg, expected_sig_alg):
        return (False, "sig_alg_not_allowed")

    # 1. policy_hash
    if not hmac.compare_digest(env.policy_hash, expected_policy_hash):
        return (False, "policy_hash_mismatch")

    # 2. measurement membership
    if env.enclave_measurement not in set(trusted_measurements):
        return (False, "untrusted_measurement")

    # 3. signature over recomputed digest (catches any committed-field tamper)
    digest = binding_digest(
        env.policy_hash,
        env.model_id,
        env.enclave_measurement,
        env.decision,
        env.nonce,
        env.sig_alg,
    )
    if not _verify_signature(attestation_pubkey, digest, env.signature, env.sig_alg):
        return (False, "bad_signature")

    # 4. replay
    if seen_nonces is not None:
        if env.nonce in seen_nonces:
            return (False, "replay")
        seen_nonces.add(env.nonce)

    return (True, "ok")


# ---------------------------------------------------------------------------
# (e) On-chain anchor record format.
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class AnchorRecord:
    """What gets written on-chain next to the wallet session's ``ssl_hash``.

    Design constraint: chains are an expensive, public, append-only KV store. You
    do NOT put the decision bytes, the model weights, or PII on chain. You put a
    fixed-width COMMITMENT — the binding digest — plus the small set of opaque
    ids needed to (a) find the off-chain envelope and (b) check it against a
    governance trust list, and a timestamp for ordering/expiry.

    The ``policy_hash`` field is the join key to ``WalletSession.ssl_hash``
    (lib.rs:162): same value, so a chain indexer can co-locate "this session is
    governed by policy P" with "decision D under session S was produced by model
    M inside attested binary E". The chain stores the commitment; the *evidence*
    is the off-chain envelope that opens it — exactly the pattern already stated
    for ssl_hash ("the diff, not the hash, is the compliance evidence").

    On-chain encoding sketch (Soroban-side, mirrors the BytesN<32> style already
    in the wallet):
        struct AttestationAnchor {
            policy_hash:  BytesN<32>,  // == WalletSession.ssl_hash
            model_id_hash:BytesN<32>,  // sha256(model_id) — id kept off-chain
            measurement:  BytesN<48>,  // SHA-384 PCR / SEV-SNP measurement
            binding_digest:BytesN<32>, // == binding_digest(...) of the envelope
            nonce_hash:   BytesN<32>,  // sha256(nonce) — replay key, no raw nonce
            ts:           u64,
        }
    """

    policy_hash: str
    model_id_hash: str
    measurement: str
    binding_digest: str  # hex
    nonce_hash: str
    ts: int = 0


def anchor_record(env: Envelope, ts: int = 0) -> AnchorRecord:
    """Project a verified envelope to its minimal on-chain commitment.

    Note what is and is NOT here: the decision bytes and the raw nonce never go
    on chain — only their hashes / the binding digest. The chain proves "a
    decision with THIS commitment, under THIS policy, by THIS model-id-hash,
    inside THIS measurement, existed at THIS time"; revealing the decision is an
    off-chain disclosure against the commitment.
    """
    digest = binding_digest(
        env.policy_hash,
        env.model_id,
        env.enclave_measurement,
        env.decision,
        env.nonce,
        env.sig_alg,
    )
    return AnchorRecord(
        policy_hash=env.policy_hash,
        model_id_hash=hashlib.sha256(env.model_id.encode("utf-8")).hexdigest(),
        measurement=env.enclave_measurement,
        binding_digest=digest.hex(),
        nonce_hash=hashlib.sha256(env.nonce.encode("utf-8")).hexdigest(),
        ts=ts,
    )
