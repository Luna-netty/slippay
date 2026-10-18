//! Tests for slippay-receipt — the verifiable recurring-charge receipt ledger.
//!
//! Strict TDD: each behavior in the API spec has a dedicated test. Public
//! surface (open_mandate / record / get_*) uses `mock_all_auths` to exercise
//! the storage + hash-chain logic; one test uses `MockAuth` (mirroring the
//! sibling subscription contract's pattern) to prove `require_auth` is bound
//! to the mandate's recorder.
//!
//! The hash-chain math is verified by INDEPENDENT recomputation in-test using
//! the same sdk `env.crypto().sha256` the contract uses, proving determinism
//! and that any third party can verify the chain from public receipts alone.

#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Events, MockAuth, MockAuthInvoke},
    vec, Address, Bytes, BytesN, Env, IntoVal, Symbol,
};

fn deploy(env: &Env) -> (Address, ReceiptClient<'_>) {
    let id = env.register(Receipt, ());
    let client = ReceiptClient::new(env, &id);
    (id, client)
}

/// Independent reference implementation of the contract's head function.
/// `new_head = sha256( commitment(32) || prev_head(32) || period_index.to_be_bytes()(4) )`.
/// A third party with only the public receipts can run exactly this.
fn ref_head(
    env: &Env,
    commitment: &BytesN<32>,
    prev_head: &BytesN<32>,
    period_index: u32,
) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.append(&Bytes::from_array(env, &commitment.to_array()));
    buf.append(&Bytes::from_array(env, &prev_head.to_array()));
    buf.append(&Bytes::from_array(env, &period_index.to_be_bytes()));
    env.crypto().sha256(&buf).into()
}

fn zero32(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

// ──────────────────────────────────────────────────────────────────────
// 1. open_mandate persistence + AlreadyExists
// ──────────────────────────────────────────────────────────────────────

#[test]
fn open_mandate_persists_and_rejects_duplicate() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, c) = deploy(&env);

    let mandate_id = BytesN::from_array(&env, &[7u8; 32]);
    let recorder = Address::generate(&env);

    c.open_mandate(&mandate_id, &recorder);

    let m = c.get_mandate(&mandate_id);
    assert_eq!(m.recorder, recorder);
    assert_eq!(m.head, zero32(&env), "fresh head must be 32 zero bytes");
    assert_eq!(m.count, 0);
    assert_eq!(c.get_head(&mandate_id), zero32(&env));
    assert_eq!(c.get_count(&mandate_id), 0);

    // second open for same id must reject AlreadyExists
    let res = c.try_open_mandate(&mandate_id, &recorder);
    assert!(res.is_err(), "duplicate open_mandate must reject");
    assert_eq!(res.err().unwrap().unwrap(), Error::AlreadyExists.into());
}

// ──────────────────────────────────────────────────────────────────────
// 2. record at period 0 chains correctly + event carries no amount
// ──────────────────────────────────────────────────────────────────────

#[test]
fn record_period_zero_chains_and_emits_no_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, c) = deploy(&env);

    let mandate_id = BytesN::from_array(&env, &[1u8; 32]);
    let recorder = Address::generate(&env);
    c.open_mandate(&mandate_id, &recorder);

    let commitment = BytesN::from_array(&env, &[9u8; 32]);
    let returned = c.record(&mandate_id, &0u32, &commitment);

    let expected = ref_head(&env, &commitment, &zero32(&env), 0u32);
    assert_eq!(returned, expected, "head must match independent sha256 recompute");

    // Assert the event NOW, before any further invocation: `env.events().all()`
    // returns only the events of the LAST contract call, so a subsequent get_*
    // would clear it.
    //
    // Event: topics = ("receipt", mandate_id); data = (period_index, commitment,
    // new_head). The data tuple is EXACTLY (u32, BytesN<32>, BytesN<32>) — there
    // is no i128 amount field anywhere. Exact-equality on the whole event would
    // fail if any amount were ever appended.
    let expected_events = vec![
        &env,
        (
            id.clone(),
            (Symbol::new(&env, "receipt"), mandate_id.clone()).into_val(&env),
            (0u32, commitment.clone(), expected.clone()).into_val(&env),
        ),
    ];
    assert_eq!(env.events().all(), expected_events);

    assert_eq!(c.get_head(&mandate_id), expected);
    assert_eq!(c.get_count(&mandate_id), 1, "count must advance to 1");
}

// ──────────────────────────────────────────────────────────────────────
// 3. two sequential records chain: head_1 depends on head_0
// ──────────────────────────────────────────────────────────────────────

#[test]
fn two_records_chain_sequentially() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, c) = deploy(&env);

    let mandate_id = BytesN::from_array(&env, &[2u8; 32]);
    let recorder = Address::generate(&env);
    c.open_mandate(&mandate_id, &recorder);

    let commitment0 = BytesN::from_array(&env, &[10u8; 32]);
    let head0 = c.record(&mandate_id, &0u32, &commitment0);
    assert_eq!(head0, ref_head(&env, &commitment0, &zero32(&env), 0u32));

    let commitment1 = BytesN::from_array(&env, &[20u8; 32]);
    let head1 = c.record(&mandate_id, &1u32, &commitment1);

    // head_1 must be sha256(commitment1 || head_0 || 1u32.to_be_bytes())
    let expected1 = ref_head(&env, &commitment1, &head0, 1u32);
    assert_eq!(head1, expected1, "head_1 must depend on head_0");
    assert_ne!(head1, head0, "chain must advance");
    assert_eq!(c.get_count(&mandate_id), 2);
    assert_eq!(c.get_head(&mandate_id), head1);
}

// ──────────────────────────────────────────────────────────────────────
// 4. wrong period_index → BadPeriod (no gaps, no replay)
// ──────────────────────────────────────────────────────────────────────

#[test]
fn wrong_period_index_rejects_bad_period() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, c) = deploy(&env);

    let mandate_id = BytesN::from_array(&env, &[3u8; 32]);
    let recorder = Address::generate(&env);
    c.open_mandate(&mandate_id, &recorder);

    let commitment = BytesN::from_array(&env, &[5u8; 32]);

    // count == 0: a gap (period 5) must reject
    let gap = c.try_record(&mandate_id, &5u32, &commitment);
    assert_eq!(gap.err().unwrap().unwrap(), Error::BadPeriod.into(), "gap must reject BadPeriod");

    // record period 0 legitimately → count becomes 1
    c.record(&mandate_id, &0u32, &commitment);
    assert_eq!(c.get_count(&mandate_id), 1);

    // replay period 0 (count==1 now) must reject
    let replay = c.try_record(&mandate_id, &0u32, &commitment);
    assert_eq!(replay.err().unwrap().unwrap(), Error::BadPeriod.into(), "replay must reject BadPeriod");

    // skipping ahead (period 2 when count==1) must reject
    let skip = c.try_record(&mandate_id, &2u32, &commitment);
    assert_eq!(skip.err().unwrap().unwrap(), Error::BadPeriod.into(), "forward gap must reject BadPeriod");

    // count is unchanged by the rejected attempts
    assert_eq!(c.get_count(&mandate_id), 1);
}

// ──────────────────────────────────────────────────────────────────────
// 5. tamper-evidence: different commitment at same period → different head
// ──────────────────────────────────────────────────────────────────────

#[test]
fn tamper_evidence_different_commitment_different_head() {
    let env = Env::default();
    env.mock_all_auths();

    // Two independent mandates, identical prev_head (zero) and period (0),
    // but different commitments → heads must differ. (Proves a chain can't be
    // silently rewritten to a different value at the same position.)
    let (_id, c) = deploy(&env);

    let m_a = BytesN::from_array(&env, &[40u8; 32]);
    let m_b = BytesN::from_array(&env, &[41u8; 32]);
    let recorder = Address::generate(&env);
    c.open_mandate(&m_a, &recorder);
    c.open_mandate(&m_b, &recorder);

    let commitment_a = BytesN::from_array(&env, &[100u8; 32]);
    let commitment_b = BytesN::from_array(&env, &[200u8; 32]);

    let head_a = c.record(&m_a, &0u32, &commitment_a);
    let head_b = c.record(&m_b, &0u32, &commitment_b);

    assert_ne!(
        head_a, head_b,
        "different commitment at same period must yield different head"
    );
}

// ──────────────────────────────────────────────────────────────────────
// 6. record on non-existent mandate → NotFound
// ──────────────────────────────────────────────────────────────────────

#[test]
fn record_nonexistent_mandate_rejects_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, c) = deploy(&env);

    let mandate_id = BytesN::from_array(&env, &[55u8; 32]);
    let commitment = BytesN::from_array(&env, &[1u8; 32]);

    let res = c.try_record(&mandate_id, &0u32, &commitment);
    assert_eq!(res.err().unwrap().unwrap(), Error::NotFound.into(), "record on absent mandate must reject NotFound");
}

#[test]
fn get_head_count_on_absent_mandate_panic() {
    let env = Env::default();
    let (_id, c) = deploy(&env);
    let mandate_id = BytesN::from_array(&env, &[66u8; 32]);
    assert!(c.try_get_head(&mandate_id).is_err());
    assert!(c.try_get_count(&mandate_id).is_err());
    assert!(c.try_get_mandate(&mandate_id).is_err());
}

// ──────────────────────────────────────────────────────────────────────
// 7. auth: require_auth is bound to the mandate's recorder
// ──────────────────────────────────────────────────────────────────────

#[test]
fn record_requires_recorder_auth() {
    let env = Env::default();
    let (_id, c) = deploy(&env);

    let mandate_id = BytesN::from_array(&env, &[77u8; 32]);
    let recorder = Address::generate(&env);

    // open the mandate with explicit MockAuth bound to the recorder.
    c.mock_auths(&[MockAuth {
        address: &recorder,
        invoke: &MockAuthInvoke {
            contract: &c.address,
            fn_name: "open_mandate",
            args: (mandate_id.clone(), recorder.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }])
    .open_mandate(&mandate_id, &recorder);

    let commitment = BytesN::from_array(&env, &[3u8; 32]);

    // record with auth correctly bound to recorder → succeeds.
    c.mock_auths(&[MockAuth {
        address: &recorder,
        invoke: &MockAuthInvoke {
            contract: &c.address,
            fn_name: "record",
            args: (mandate_id.clone(), 0u32, commitment.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }])
    .record(&mandate_id, &0u32, &commitment);
    assert_eq!(c.get_count(&mandate_id), 1);

    // record where the ONLY supplied auth is for a different (attacker) address
    // → the recorder's require_auth is unsatisfied, so it must reject.
    let attacker = Address::generate(&env);
    let res = c
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &c.address,
                fn_name: "record",
                args: (mandate_id.clone(), 1u32, commitment.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_record(&mandate_id, &1u32, &commitment);
    assert!(res.is_err(), "record without the recorder's auth must reject");
    assert_eq!(c.get_count(&mandate_id), 1, "rejected record must not advance the chain");
}

// ──────────────────────────────────────────────────────────────────────
// 8. off-chain verification demo: selective disclosure round-trip
// ──────────────────────────────────────────────────────────────────────

/// Off-chain commitment formula, documented in lib.rs:
/// `commitment = sha256( amount(16 = i128 be) || blinding(32) || mandate_id(32) || period_index(4 be) )`.
/// The contract NEVER computes this — it only stores the opaque result. This
/// helper proves a third party who later receives `(amount, blinding)` can
/// reopen the commitment and verify it against the public receipt.
fn ref_commitment(
    env: &Env,
    amount: i128,
    blinding: &BytesN<32>,
    mandate_id: &BytesN<32>,
    period_index: u32,
) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.append(&Bytes::from_array(env, &amount.to_be_bytes()));
    buf.append(&Bytes::from_array(env, &blinding.to_array()));
    buf.append(&Bytes::from_array(env, &mandate_id.to_array()));
    buf.append(&Bytes::from_array(env, &period_index.to_be_bytes()));
    env.crypto().sha256(&buf).into()
}

#[test]
fn off_chain_verification_and_selective_disclosure() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, c) = deploy(&env);

    let mandate_id = BytesN::from_array(&env, &[88u8; 32]);
    let recorder = Address::generate(&env);
    c.open_mandate(&mandate_id, &recorder);

    // OFF-CHAIN: payer holds a secret amount (e.g. R$ 49.90 = 4990 cents) and a
    // random blinding factor. The amount NEVER touches the chain.
    let amount: i128 = 4990;
    let blinding = BytesN::random(&env);
    let period_index = 0u32;

    let commitment = ref_commitment(&env, amount, &blinding, &mandate_id, period_index);

    // ON-CHAIN: only the opaque commitment is recorded.
    let head = c.record(&mandate_id, &period_index, &commitment);

    // A third party with ONLY the public receipt (commitment, prev_head=zero,
    // period) recomputes and verifies the head — no secret needed.
    let verified_head = ref_head(&env, &commitment, &zero32(&env), period_index);
    assert_eq!(head, verified_head, "public chain is independently verifiable");

    // SELECTIVE DISCLOSURE: later the payer reveals (amount, blinding). The
    // verifier reopens the commitment and confirms it matches the on-chain one.
    let reopened = ref_commitment(&env, amount, &blinding, &mandate_id, period_index);
    assert_eq!(reopened, commitment, "opening (amount, blinding) reproduces the commitment");

    // A wrong amount must NOT open the commitment → binding holds.
    let wrong = ref_commitment(&env, amount + 1, &blinding, &mandate_id, period_index);
    assert_ne!(wrong, commitment, "a different amount cannot open the same commitment");
}
