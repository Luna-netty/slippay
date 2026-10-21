"""Adversarial TDD for the TEE attestation envelope.

Each test is one threat: a tampered field, a wrong policy, an untrusted binary,
a replay. The good-path test pins that an honest envelope verifies, so a verifier
bug that rejects everything (vacuously "secure") is caught too.

Run: `python3 -m pytest agents/tee/test_tee.py -v`
  or `python3 agents/tee/test_tee.py`  (falls back to a tiny runner)
"""

import dataclasses
import hashlib
import hmac
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tee import (  # noqa: E402
    SIG_BACKEND,
    AnchorRecord,
    Envelope,
    MockEnclave,
    _verify_signature,
    anchor_record,
    binding_digest,
    canonicalize_decision,
    verify_envelope,
)

# A measurement the verifier trusts (mock value; a real one is PCR/SEV-SNP hex).
GOOD_MEASUREMENT = "pcr0:" + "ab" * 24  # 48-byte-ish hex, shape only
UNTRUSTED_MEASUREMENT = "pcr0:" + "ff" * 24
POLICY_HASH = "a" * 64  # sha256 hex of the governing .ssl (== on-chain ssl_hash)
WRONG_POLICY_HASH = "b" * 64
MODEL_ID = "claude-opus-4-8"
DECISION = {"action": "settle", "order": "ord_123", "usdcAmount": "49.90", "ok": True}
NONCE = "nonce-0001"

TRUSTED = [GOOD_MEASUREMENT, "pcr0:" + "cd" * 24]


def _fixture():
    """Fresh enclave + a freshly attested good envelope + the verifier's pubkey."""
    enclave = MockEnclave(measurement=GOOD_MEASUREMENT)
    env = enclave.attest(
        policy_hash=POLICY_HASH, model_id=MODEL_ID, decision=DECISION, nonce=NONCE
    )
    return enclave, env, enclave.attestation_pubkey()


# ---------------------------------------------------------------------------
# good path
# ---------------------------------------------------------------------------
def test_good_envelope_verifies():
    _enclave, env, pk = _fixture()
    ok, reason = verify_envelope(env, POLICY_HASH, TRUSTED, pk, seen_nonces=set())
    assert ok is True, reason
    assert reason == "ok"


# ---------------------------------------------------------------------------
# tamper: decision
# ---------------------------------------------------------------------------
def test_tampered_decision_is_rejected():
    _enclave, env, pk = _fixture()
    # Flip the amount in the canonical bytes. Signature was over the original
    # binding digest; the recomputed digest now differs → signature fails.
    forged = canonicalize_decision(
        {**DECISION, "usdcAmount": "4990.00"}  # 100x heist
    )
    tampered = dataclasses.replace(env, decision=forged)
    ok, reason = verify_envelope(tampered, POLICY_HASH, TRUSTED, pk, seen_nonces=set())
    assert ok is False
    assert reason == "bad_signature", reason


# ---------------------------------------------------------------------------
# algorithm-confusion: attacker downgrades sig_alg to the symmetric stand-in and
# forges a MAC over a tampered decision using the PUBLIC ed25519 key as the
# "secret" (the JWT alg=HS256-with-RSA-public-key class, CVE-2015-9235 family).
# verify_envelope must NOT dispatch on the attacker-controlled env.sig_alg.
# ---------------------------------------------------------------------------
def test_sig_alg_confusion_forgery_is_rejected():
    """Active backend is ed25519. Attacker rewrites the decision (100x heist),
    flips sig_alg to 'hmac-sha256-standin', and forges a MAC keyed on the public
    ed25519 key (public by definition — on the trust list, on-chain). Pre-fix this
    returned (True, 'ok'). It must be rejected."""
    assert SIG_BACKEND == "ed25519", "this regression assumes the real backend"
    _enclave, env, pk = _fixture()  # pk is the PUBLIC ed25519 key bytes
    forged_dec = canonicalize_decision({**DECISION, "usdcAmount": "4990.00"})
    # Forge a MAC the way the vulnerable HMAC branch would have recomputed it,
    # over the digest the recompute path would derive for the downgraded alg.
    fd = binding_digest(
        POLICY_HASH, MODEL_ID, GOOD_MEASUREMENT, forged_dec, NONCE,
        "hmac-sha256-standin",
    )
    forged_sig = hmac.new(pk, fd, hashlib.sha256).digest()
    forged = dataclasses.replace(
        env, decision=forged_dec, signature=forged_sig, sig_alg="hmac-sha256-standin"
    )
    ok, reason = verify_envelope(forged, POLICY_HASH, TRUSTED, pk, seen_nonces=set())
    assert ok is False, "ALGORITHM-CONFUSION FORGERY ACCEPTED"
    # Primary gate (sig_alg pinning) fires first.
    assert reason == "sig_alg_not_allowed", reason


def test_verify_signature_refuses_standin_under_real_backend():
    """Belt-and-suspenders inner defence: even called directly (bypassing the
    sig_alg gate), _verify_signature must refuse the symmetric stand-in while the
    real ed25519 backend is active, so the public-key-as-MAC-secret forgery dies
    here too. README line: 'a real verifier must refuse hmac-sha256-standin'."""
    assert SIG_BACKEND == "ed25519"
    _enclave, env, pk = _fixture()
    digest = binding_digest(
        env.policy_hash, env.model_id, env.enclave_measurement, env.decision,
        env.nonce, "hmac-sha256-standin",
    )
    forged_mac = hmac.new(pk, digest, hashlib.sha256).digest()
    assert _verify_signature(pk, digest, forged_mac, "hmac-sha256-standin") is False


def test_sig_alg_is_bound_into_digest():
    """Belt-and-suspenders digest binding: flipping sig_alg alone moves the
    binding digest, so the signature can't survive an algorithm swap even if a
    caller forgot to pin expected_sig_alg."""
    d_ed = binding_digest("p", "m", "e", b"d", "n", "ed25519")
    d_hmac = binding_digest("p", "m", "e", b"d", "n", "hmac-sha256-standin")
    assert d_ed != d_hmac


def test_unknown_expected_sig_alg_rejects_honest_envelope():
    """If the caller pins an algorithm the envelope doesn't claim, gate 0 rejects
    even an otherwise-valid envelope — pinning is enforced, not advisory."""
    _enclave, env, pk = _fixture()
    ok, reason = verify_envelope(
        env, POLICY_HASH, TRUSTED, pk, expected_sig_alg="some-other-alg",
        seen_nonces=set(),
    )
    assert ok is False
    assert reason == "sig_alg_not_allowed", reason


# ---------------------------------------------------------------------------
# tamper / mismatch: policy_hash
# ---------------------------------------------------------------------------
def test_wrong_expected_policy_hash_is_rejected():
    """Verifier demands policy A; envelope was produced under policy B."""
    _enclave, env, pk = _fixture()
    ok, reason = verify_envelope(env, WRONG_POLICY_HASH, TRUSTED, pk, seen_nonces=set())
    assert ok is False
    assert reason == "policy_hash_mismatch", reason


def test_tampered_policy_hash_in_envelope_is_rejected():
    """Attacker rewrites the envelope's policy_hash to match the demand. The
    signature was over the ORIGINAL policy_hash, so the digest moves → sig fails.
    (If they also fix the demand to the forged value, gate 1 passes but gate 3
    still rejects — there is no policy_hash an attacker can set without the key.)"""
    _enclave, env, pk = _fixture()
    tampered = dataclasses.replace(env, policy_hash=WRONG_POLICY_HASH)
    # Verifier happens to demand the forged value, so gate 1 (mismatch) passes:
    ok, reason = verify_envelope(
        tampered, WRONG_POLICY_HASH, TRUSTED, pk, seen_nonces=set()
    )
    assert ok is False
    assert reason == "bad_signature", reason


# ---------------------------------------------------------------------------
# tamper / mismatch: measurement
# ---------------------------------------------------------------------------
def test_untrusted_measurement_is_rejected():
    """Honestly-signed envelope from a binary whose measurement isn't trusted."""
    rogue = MockEnclave(measurement=UNTRUSTED_MEASUREMENT)
    env = rogue.attest(
        policy_hash=POLICY_HASH, model_id=MODEL_ID, decision=DECISION, nonce=NONCE
    )
    ok, reason = verify_envelope(
        env, POLICY_HASH, TRUSTED, rogue.attestation_pubkey(), seen_nonces=set()
    )
    assert ok is False
    assert reason == "untrusted_measurement", reason


def test_tampered_measurement_in_envelope_is_rejected():
    """Attacker swaps the measurement string to a trusted one without re-signing.
    Gate 2 (membership) passes, but the sig was over the original measurement →
    gate 3 fails. Proves you can't relabel a rogue binary as a blessed one."""
    rogue = MockEnclave(measurement=UNTRUSTED_MEASUREMENT)
    env = rogue.attest(
        policy_hash=POLICY_HASH, model_id=MODEL_ID, decision=DECISION, nonce=NONCE
    )
    tampered = dataclasses.replace(env, enclave_measurement=GOOD_MEASUREMENT)
    ok, reason = verify_envelope(
        tampered, POLICY_HASH, TRUSTED, rogue.attestation_pubkey(), seen_nonces=set()
    )
    assert ok is False
    assert reason == "bad_signature", reason


# ---------------------------------------------------------------------------
# tamper: nonce
# ---------------------------------------------------------------------------
def test_tampered_nonce_is_rejected():
    """Changing the nonce after signing moves the digest → sig fails."""
    _enclave, env, pk = _fixture()
    tampered = dataclasses.replace(env, nonce="nonce-9999")
    ok, reason = verify_envelope(tampered, POLICY_HASH, TRUSTED, pk, seen_nonces=set())
    assert ok is False
    assert reason == "bad_signature", reason


# ---------------------------------------------------------------------------
# tamper: model_id (provenance is the whole point — bind it too)
# ---------------------------------------------------------------------------
def test_tampered_model_id_is_rejected():
    """Swap the declared model after signing (e.g. claim opus, ran a cheaper
    model). The model_id is a committed field → digest moves → sig fails."""
    _enclave, env, pk = _fixture()
    tampered = dataclasses.replace(env, model_id="some-cheaper-model")
    ok, reason = verify_envelope(tampered, POLICY_HASH, TRUSTED, pk, seen_nonces=set())
    assert ok is False
    assert reason == "bad_signature", reason


# ---------------------------------------------------------------------------
# replay
# ---------------------------------------------------------------------------
def test_replay_same_nonce_is_rejected():
    _enclave, env, pk = _fixture()
    seen = set()
    ok1, r1 = verify_envelope(env, POLICY_HASH, TRUSTED, pk, seen_nonces=seen)
    assert ok1 is True, r1
    # Same envelope, same nonce, second time → replay.
    ok2, r2 = verify_envelope(env, POLICY_HASH, TRUSTED, pk, seen_nonces=seen)
    assert ok2 is False
    assert r2 == "replay", r2


def test_distinct_nonces_both_accepted():
    """Replay defence rejects only repeats, not distinct decisions."""
    enclave = MockEnclave(measurement=GOOD_MEASUREMENT)
    pk = enclave.attestation_pubkey()
    seen = set()
    e1 = enclave.attest(POLICY_HASH, MODEL_ID, DECISION, "n-1")
    e2 = enclave.attest(POLICY_HASH, MODEL_ID, {**DECISION, "order": "ord_2"}, "n-2")
    assert verify_envelope(e1, POLICY_HASH, TRUSTED, pk, seen_nonces=seen)[0] is True
    assert verify_envelope(e2, POLICY_HASH, TRUSTED, pk, seen_nonces=seen)[0] is True


# ---------------------------------------------------------------------------
# wrong verifying key (a different enclave's pubkey must not validate)
# ---------------------------------------------------------------------------
def test_wrong_attestation_key_is_rejected():
    _enclave, env, _pk = _fixture()
    other = MockEnclave(measurement=GOOD_MEASUREMENT)  # different key
    ok, reason = verify_envelope(
        env, POLICY_HASH, TRUSTED, other.attestation_pubkey(), seen_nonces=set()
    )
    assert ok is False
    assert reason == "bad_signature", reason


# ---------------------------------------------------------------------------
# canonicalization determinism (the property the signature rests on)
# ---------------------------------------------------------------------------
def test_canonicalization_is_key_order_independent():
    a = canonicalize_decision({"x": 1, "y": 2, "z": 3})
    b = canonicalize_decision({"z": 3, "y": 2, "x": 1})
    assert a == b
    assert a == b'{"x":1,"y":2,"z":3}'


def test_binding_digest_is_field_separated():
    """Length-prefixing must prevent the ab|c == a|bc concatenation collision."""
    d1 = binding_digest("ab", "c", "m", b"d", "n")
    d2 = binding_digest("a", "bc", "m", b"d", "n")
    assert d1 != d2


# ---------------------------------------------------------------------------
# (e) on-chain anchor record format
# ---------------------------------------------------------------------------
def test_anchor_record_join_key_and_no_secrets():
    _enclave, env, _pk = _fixture()
    rec = anchor_record(env, ts=1700000000)
    assert isinstance(rec, AnchorRecord)
    # join key to WalletSession.ssl_hash (lib.rs:162)
    assert rec.policy_hash == POLICY_HASH
    # commitment equals the envelope's binding digest
    expected = binding_digest(
        env.policy_hash, env.model_id, env.enclave_measurement, env.decision, env.nonce
    ).hex()
    assert rec.binding_digest == expected
    # no raw decision bytes and no raw nonce leak on-chain
    blob = repr(rec)
    assert "settle" not in blob and "ord_123" not in blob  # decision content absent
    assert NONCE not in blob  # raw nonce absent (only its hash)
    assert rec.ts == 1700000000


def test_anchor_record_changes_when_decision_changes():
    enclave = MockEnclave(measurement=GOOD_MEASUREMENT)
    e1 = enclave.attest(POLICY_HASH, MODEL_ID, DECISION, "n-a")
    e2 = enclave.attest(POLICY_HASH, MODEL_ID, {**DECISION, "ok": False}, "n-b")
    assert anchor_record(e1).binding_digest != anchor_record(e2).binding_digest


# ---------------------------------------------------------------------------
# tiny fallback runner so the file works without pytest installed
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    failed = 0
    for fn in fns:
        try:
            fn()
            passed += 1
            print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{passed} passed, {failed} failed, {len(fns)} total")
    sys.exit(1 if failed else 0)
