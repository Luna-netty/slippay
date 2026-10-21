//! M2 + M3 spike tests for slippay-smart-wallet.
//!
//! Public-surface tests (init / install / revoke / get) use
//! `mock_all_auths` so the wallet's `__check_auth` is bypassed and we
//! exercise only the storage logic. The policy-match path (M3) is tested
//! directly against the `try_match_policy` helper, with `env.as_contract`
//! to put the wallet's storage in scope. Real secp256r1 signature
//! verification is exercised in the M4 testnet end-to-end run.

#![cfg(test)]
// The crate is `#![no_std]`; the `testutils` feature links std for the host
// test build, so `std` is available here for filesystem reads (used by the
// harness↔ABI regression test below).
extern crate std;
use super::*;
use soroban_sdk::{
    auth::{Context, ContractContext},
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, Env, IntoVal, Symbol, Vec,
};

/// SECURITY_AUDIT C3 · default absolute per-charge ceiling for tests. Chosen
/// generously above every amount/cap exercised in the existing suite (max
/// per-charge cap used is 35_000_000) so pre-C3 tests keep passing unchanged.
/// The dedicated C3 tests deploy with a TIGHT ceiling to exercise the guard.
const TEST_MAX_ABS: i128 = 1_000_000_000;

/// SECURITY_AUDIT C2 · `deploy` now registers WITH constructor args, so init is
/// ATOMIC with deploy — there is no separate `wallet.init(...)` step and no
/// un-inited window. Uses a fresh random admin and the generous default
/// ceiling. Tests that assert on a specific admin use `deploy_with_admin`;
/// tests that exercise the C3 ceiling use `deploy_with_ceiling`.
fn deploy(env: &Env) -> (Address, SmartWalletClient<'_>) {
    deploy_with(env, &Address::generate(env), TEST_MAX_ABS)
}

/// Deploy with a caller-chosen admin (atomic constructor) and the default
/// generous ceiling. Used by tests that need the admin address to assert on
/// (e.g. merchant==admin / admin-in-allowlist rejection).
fn deploy_with_admin<'a>(env: &'a Env, admin: &Address) -> (Address, SmartWalletClient<'a>) {
    deploy_with(env, admin, TEST_MAX_ABS)
}

/// Deploy with a caller-chosen absolute per-charge ceiling (atomic
/// constructor). Used by the C3 ceiling tests. Admin is a fresh random address.
fn deploy_with_ceiling(env: &Env, ceiling: i128) -> (Address, SmartWalletClient<'_>) {
    deploy_with(env, &Address::generate(env), ceiling)
}

fn deploy_with<'a>(
    env: &'a Env,
    admin: &Address,
    ceiling: i128,
) -> (Address, SmartWalletClient<'a>) {
    let id = env.register(
        SmartWallet,
        (dummy_pubkey(env), dummy_cred_id(env), admin.clone(), ceiling),
    );
    let client = SmartWalletClient::new(env, &id);
    (id, client)
}

fn dummy_pubkey(env: &Env) -> BytesN<65> {
    // First byte 0x04 = uncompressed X9.62 prefix; remaining 64 bytes are
    // garbage X||Y. Tests that exercise the policy-match path never invoke
    // secp256r1_verify so the value is irrelevant beyond shape.
    let mut bytes = [0u8; 65];
    bytes[0] = 0x04;
    for (i, b) in bytes.iter_mut().enumerate().skip(1) {
        *b = i as u8;
    }
    BytesN::from_array(env, &bytes)
}

fn dummy_cred_id(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[2u8; 32])
}

// ──────────────────────────────────────────────────────────────────────
// M2 public-surface tests
// ──────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────
// C2: atomic deploy+init via __constructor (no un-inited front-run window)
// ──────────────────────────────────────────────────────────────────────

/// SECURITY_AUDIT C2: the constructor runs ATOMICALLY at deploy, so the wallet
/// is fully initialized the instant it exists — there is no separate init step
/// and no window a front-runner can exploit. We prove the state landed by
/// reading it back through the public surface immediately after register, with
/// NO intervening init call.
#[test]
fn constructor_initializes_atomically() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_id, wallet) = deploy_with_admin(&env, &admin);

    // Usable immediately post-deploy with no init call: install a policy and
    // read it back. If the constructor had not run, install_policy would error
    // NotInitialized (no admin / no ceiling in instance storage).
    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    wallet.install_policy(&merchant, &token, &100, &150, &60, &0);
    let policy = wallet.get_policy(&merchant);
    assert_eq!(policy.merchant, merchant);
    assert_eq!(policy.amount_per_charge, 100);
}

/// SECURITY_AUDIT C2: the standalone `init` is now a guarded no-op. The
/// constructor already ran at deploy, so ANY direct `init` call — including a
/// front-runner attempting the old C2 exploit (claim ownership in the
/// deploy→init window) — must error `AlreadyInitialized`. It can never reset
/// state or re-claim the wallet.
#[test]
fn init_after_constructor_is_rejected() {
    let env = Env::default();
    let (_id, wallet) = deploy(&env);
    // A would-be front-runner's init attempt with their own pubkey/admin.
    let attacker = Address::generate(&env);
    let res = wallet.try_init(&dummy_pubkey(&env), &dummy_cred_id(&env), &attacker);
    assert!(res.is_err(), "init after constructor must reject (no re-claim)");
    // The guarded no-op panics with the AlreadyInitialized contract error;
    // assert on the soroban Error code carried back through try_init.
    match res {
        Err(Ok(e)) => assert_eq!(
            e,
            soroban_sdk::Error::from(Error::AlreadyInitialized),
            "must reject with AlreadyInitialized"
        ),
        other => panic!("expected AlreadyInitialized, got {:?}", other),
    }
}

/// SECURITY_AUDIT C3: a constructor with a non-positive absolute ceiling is
/// rejected (a zero/negative ceiling would make every install impossible and
/// is a misconfiguration). Uses `try_register`-equivalent: the construct panics,
/// surfaced via a direct register attempt wrapped in the test harness.
#[test]
#[should_panic(expected = "#10")] // InvalidConfig = 10
fn constructor_rejects_nonpositive_ceiling() {
    let env = Env::default();
    let admin = Address::generate(&env);
    // ceiling = 0 → constructor must panic (InvalidConfig).
    let _ = env.register(
        SmartWallet,
        (dummy_pubkey(&env), dummy_cred_id(&env), admin, 0i128),
    );
}

#[test]
fn install_and_get_policy() {
    let env = Env::default();
    env.mock_all_auths();

    let (_id, wallet) = deploy(&env);

    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    wallet.install_policy(
        &merchant,
        &token,
        &29_000_000,            // 29.0 USDC (7 decimals)
        &35_000_000,            // cap 35.0 USDC
        &(30 * 24 * 60 * 60),   // 30 days
        &0,                      // no expiry
    );

    let policy = wallet.get_policy(&merchant);
    assert_eq!(policy.merchant, merchant);
    assert_eq!(policy.token, token);
    assert_eq!(policy.amount_per_charge, 29_000_000);
    assert_eq!(policy.max_per_charge, 35_000_000);
    assert_eq!(policy.interval_seconds, 2_592_000);
    assert_eq!(policy.expires_at, 0);
    assert_eq!(policy.last_charge_at, 0);
    assert!(!policy.revoked);
}

#[test]
fn revoke_flips_flag() {
    let env = Env::default();
    env.mock_all_auths();

    let (_id, wallet) = deploy(&env);

    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    wallet.install_policy(&merchant, &token, &10, &10, &60, &0);

    wallet.revoke_policy(&merchant);
    let policy = wallet.get_policy(&merchant);
    assert!(policy.revoked, "revoke_policy must set revoked=true");
}

#[test]
fn install_with_invalid_config_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy(&env);

    let merchant = Address::generate(&env);
    let token = Address::generate(&env);

    assert!(wallet.try_install_policy(&merchant, &token, &0, &10, &60, &0).is_err());
    assert!(wallet.try_install_policy(&merchant, &token, &10, &5, &60, &0).is_err());
    assert!(wallet.try_install_policy(&merchant, &token, &10, &10, &30, &0).is_err());
}

#[test]
fn revoke_nonexistent_policy_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy(&env);

    let merchant = Address::generate(&env);
    assert!(wallet.try_revoke_policy(&merchant).is_err());
}

// ──────────────────────────────────────────────────────────────────────
// M3 policy-match tests (direct against try_match_policy)
// ──────────────────────────────────────────────────────────────────────

fn make_transfer_ctx(
    env: &Env,
    token: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) -> ContractContext {
    ContractContext {
        contract: token.clone(),
        fn_name: Symbol::new(env, "transfer"),
        args: vec![&env, from.into_val(env), to.into_val(env), amount.into_val(env)],
    }
}

#[test]
fn policy_match_authorizes_within_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);

    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    wallet.install_policy(&merchant, &token, &100, &150, &60, &0);

    let ctx = make_transfer_ctx(&env, &token, &id, &merchant, 100);
    env.as_contract(&id, || {
        let r = super::try_match_policy(&env, &ctx);
        assert!(matches!(r, Ok(true)), "expected Ok(true), got {:?}", r);
    });
}

#[test]
fn policy_match_rejects_over_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);

    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    wallet.install_policy(&merchant, &token, &100, &150, &60, &0);

    let ctx = make_transfer_ctx(&env, &token, &id, &merchant, 200);
    env.as_contract(&id, || {
        let r = super::try_match_policy(&env, &ctx);
        assert!(matches!(r, Err(Error::AmountExceedsCap)));
    });
}

#[test]
fn policy_match_rejects_revoked() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);

    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    wallet.install_policy(&merchant, &token, &100, &150, &60, &0);
    wallet.revoke_policy(&merchant);

    let ctx = make_transfer_ctx(&env, &token, &id, &merchant, 100);
    env.as_contract(&id, || {
        let r = super::try_match_policy(&env, &ctx);
        assert!(matches!(r, Err(Error::PolicyRevoked)));
    });
}

#[test]
fn policy_match_rejects_expired() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);

    env.ledger().with_mut(|li| { li.timestamp = 1_000; });
    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    wallet.install_policy(&merchant, &token, &100, &150, &60, &2_000);

    // Advance past expiry.
    env.ledger().with_mut(|li| { li.timestamp = 3_000; });

    let ctx = make_transfer_ctx(&env, &token, &id, &merchant, 100);
    env.as_contract(&id, || {
        let r = super::try_match_policy(&env, &ctx);
        assert!(matches!(r, Err(Error::PolicyExpired)));
    });
}

#[test]
fn policy_match_enforces_interval() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);

    env.ledger().with_mut(|li| { li.timestamp = 1_000; });
    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    wallet.install_policy(&merchant, &token, &100, &150, &600, &0);

    let ctx = make_transfer_ctx(&env, &token, &id, &merchant, 100);

    // First call succeeds and bumps last_charge_at.
    env.as_contract(&id, || {
        let r = super::try_match_policy(&env, &ctx);
        assert!(matches!(r, Ok(true)), "first call must succeed: {:?}", r);
    });

    // Immediate second call: interval not elapsed.
    env.as_contract(&id, || {
        let r = super::try_match_policy(&env, &ctx);
        assert!(matches!(r, Err(Error::PeriodNotElapsed)), "second call must reject: {:?}", r);
    });

    // Advance past interval.
    env.ledger().with_mut(|li| { li.timestamp = 1_000 + 700; });
    env.as_contract(&id, || {
        let r = super::try_match_policy(&env, &ctx);
        assert!(matches!(r, Ok(true)), "third call after interval must succeed: {:?}", r);
    });
}

#[test]
fn policy_match_returns_false_for_unknown_merchant() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, _wallet) = deploy(&env);

    let unknown_merchant = Address::generate(&env);
    let token = Address::generate(&env);
    let ctx = make_transfer_ctx(&env, &token, &id, &unknown_merchant, 100);
    env.as_contract(&id, || {
        let r = super::try_match_policy(&env, &ctx);
        assert!(matches!(r, Ok(false)), "unknown merchant must return Ok(false): {:?}", r);
    });
}

#[test]
fn policy_match_returns_false_for_wrong_token() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);

    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    let other_token = Address::generate(&env);
    wallet.install_policy(&merchant, &token, &100, &150, &60, &0);

    // Same merchant + amount, but the transfer is on a different token —
    // policy must not authorize cross-asset transfers.
    let ctx = make_transfer_ctx(&env, &other_token, &id, &merchant, 100);
    env.as_contract(&id, || {
        let r = super::try_match_policy(&env, &ctx);
        assert!(matches!(r, Ok(false)));
    });
}

#[test]
fn install_rejects_max_above_multiplier() {
    // SECURITY_AUDIT N1: cap on max_per_charge prevents a compromised
    // admin from installing max=i128::MAX and draining the wallet in one
    // transfer.
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy(&env);

    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    // amount=100, max=2000 → max == amount * 20, must reject (10x cap)
    let r = wallet.try_install_policy(&merchant, &token, &100, &2_000, &60, &0);
    assert!(r.is_err(), "max > amount*10 must be rejected");
    // amount=100, max=1000 → max == amount * 10, must accept (boundary)
    wallet.install_policy(&merchant, &token, &100, &1_000, &60, &0);
}

// ──────────────────────────────────────────────────────────────────────
// C3: immutable absolute per-charge ceiling, independent of the ratio guards
// ──────────────────────────────────────────────────────────────────────

/// SECURITY_AUDIT C3: install_policy must reject an `amount_per_charge` above
/// the immutable absolute ceiling, EVEN when the ratio guard (max <= amount*10)
/// passes trivially. This is the exact compromised-admin drain the C3 finding
/// describes: set amount = balance, max = amount (ratio 1x, passes N1), but the
/// absolute ceiling bites.
#[test]
fn install_policy_rejects_amount_above_absolute_ceiling() {
    let env = Env::default();
    env.mock_all_auths();
    // Tight ceiling: 1_000. A compromised admin tries amount = max = 5_000
    // (ratio 1x → N1 passes), which must be rejected by the absolute ceiling.
    let (_id, wallet) = deploy_with_ceiling(&env, 1_000);

    let merchant = Address::generate(&env);
    let token = Address::generate(&env);

    let r = wallet.try_install_policy(&merchant, &token, &5_000, &5_000, &60, &0);
    assert!(r.is_err(), "amount above absolute ceiling must be rejected");
    match r {
        Err(Ok(e)) => assert_eq!(
            e,
            soroban_sdk::Error::from(Error::ExceedsAbsoluteCeiling),
            "must reject with ExceedsAbsoluteCeiling"
        ),
        other => panic!("expected ExceedsAbsoluteCeiling, got {:?}", other),
    }
}

/// SECURITY_AUDIT C3: install_policy must also reject a `max_per_charge` above
/// the absolute ceiling even when `amount_per_charge` is within it. Here
/// amount=200 (within ceiling 1_000), max=2_000 (ratio 10x → N1 passes), but
/// max exceeds the absolute ceiling → reject.
#[test]
fn install_policy_rejects_max_above_absolute_ceiling() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy_with_ceiling(&env, 1_000);

    let merchant = Address::generate(&env);
    let token = Address::generate(&env);

    let r = wallet.try_install_policy(&merchant, &token, &200, &2_000, &60, &0);
    assert!(r.is_err(), "max above absolute ceiling must be rejected");
    match r {
        Err(Ok(e)) => assert_eq!(e, soroban_sdk::Error::from(Error::ExceedsAbsoluteCeiling)),
        other => panic!("expected ExceedsAbsoluteCeiling, got {:?}", other),
    }
}

/// SECURITY_AUDIT C3: within-ceiling install_policy still passes (the guard does
/// not break the legitimate path). amount=200, max=1_000 (== ceiling, boundary),
/// ratio 5x (N1 passes) → accept.
#[test]
fn install_policy_within_absolute_ceiling_passes() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy_with_ceiling(&env, 1_000);

    let merchant = Address::generate(&env);
    let token = Address::generate(&env);

    // Boundary: max == ceiling must be accepted.
    wallet.install_policy(&merchant, &token, &200, &1_000, &60, &0);
    let p = wallet.get_policy(&merchant);
    assert_eq!(p.max_per_charge, 1_000, "within-ceiling install must land");
}

/// SECURITY_AUDIT C3: install_agent_session must reject a `per_tx_cap` above the
/// absolute ceiling even when the A2.3 ratio guard (window_cap <= per_tx*100)
/// passes. per_tx=5_000 > ceiling 1_000, window_cap=5_000 (ratio 1x) → reject.
#[test]
fn install_agent_session_rejects_per_tx_above_absolute_ceiling() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy_with_ceiling(&env, 1_000);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let pk = agent_pk(&env);
    let (_to, allow) = one_recipient(&env);

    let r = wallet.try_install_agent_session(&pk, &token, &5_000, &600, &5_000, &0, &allow, &ssl_h(&env));
    assert!(r.is_err(), "per_tx_cap above absolute ceiling must be rejected");
    match r {
        Err(Ok(e)) => assert_eq!(
            e,
            soroban_sdk::Error::from(Error::ExceedsAbsoluteCeiling),
            "must reject with ExceedsAbsoluteCeiling"
        ),
        other => panic!("expected ExceedsAbsoluteCeiling, got {:?}", other),
    }
}

/// SECURITY_AUDIT C3: within-ceiling install_agent_session still passes.
/// per_tx=1_000 (== ceiling, boundary), window_cap=1_000 → accept.
#[test]
fn install_agent_session_within_absolute_ceiling_passes() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy_with_ceiling(&env, 1_000);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let pk = agent_pk(&env);
    let (_to, allow) = one_recipient(&env);

    // Boundary: per_tx_cap == ceiling must be accepted.
    wallet.install_agent_session(&pk, &token, &1_000, &600, &1_000, &0, &allow, &ssl_h(&env));
    let s = wallet.get_agent_session(&pk);
    assert_eq!(s.per_tx_cap, 1_000, "within-ceiling session install must land");
}

#[test]
fn install_rejects_merchant_equals_admin() {
    // SECURITY_AUDIT H3: refuse to install a policy where the admin is
    // also the merchant — would let a compromised admin drain the wallet
    // to themselves.
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_id, wallet) = deploy_with_admin(&env, &admin);

    let token = Address::generate(&env);
    // merchant == admin → must reject
    let r = wallet.try_install_policy(&admin, &token, &10, &10, &60, &0);
    assert!(r.is_err(), "merchant==admin must be rejected");
}

#[test]
fn install_rejects_merchant_equals_wallet_self() {
    // SECURITY_AUDIT H3: same guard, but for the wallet's own contract
    // address. Would let an attacker route funds in a self-loop pattern.
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);

    let token = Address::generate(&env);
    let r = wallet.try_install_policy(&id, &token, &10, &10, &60, &0);
    assert!(r.is_err(), "merchant==wallet must be rejected");
}

#[test]
fn policy_match_returns_false_for_non_transfer_fn() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);

    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    wallet.install_policy(&merchant, &token, &100, &150, &60, &0);

    let ctx = ContractContext {
        contract: token,
        fn_name: Symbol::new(&env, "burn"),
        args: vec![&env, id.into_val(&env), 100i128.into_val(&env)],
    };
    env.as_contract(&id, || {
        let r = super::try_match_policy(&env, &ctx);
        assert!(matches!(r, Ok(false)));
    });
}

// ──────────────────────────────────────────────────────────────────────
// Agent session tests (delegated push grant with windowed budget)
// ──────────────────────────────────────────────────────────────────────

fn agent_pk(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

/// Stand-in governing-spec hash for tests that don't assert on provenance.
fn ssl_h(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0xABu8; 32])
}

/// A non-empty allowlist with a single fresh recipient. A2 forbids installing
/// with an empty allowlist, so every install helper now threads a recipient.
/// Tests that need to assert on the recipient build their own and pass it
/// through `install_session_to`.
fn one_recipient(env: &Env) -> (Address, Vec<Address>) {
    let to = Address::generate(env);
    (to.clone(), vec![env, to])
}

#[test]
fn install_and_get_agent_session() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy(&env);

    let token = Address::generate(&env);
    let (recipient, allow) = one_recipient(&env);
    wallet.install_agent_session(
        &agent_pk(&env),
        &token,
        &10_000_000,   // per_tx_cap 10 USDC
        &86_400,       // 24h window
        &50_000_000,   // window_cap 50 USDC
        &0,            // no expiry
        &allow,
        &ssl_h(&env),
    );

    let s = wallet.get_agent_session(&agent_pk(&env));
    assert_eq!(s.session_pubkey, agent_pk(&env));
    assert_eq!(s.token, token);
    assert_eq!(s.per_tx_cap, 10_000_000);
    assert_eq!(s.window_seconds, 86_400);
    assert_eq!(s.window_cap, 50_000_000);
    assert_eq!(s.cur_spent, 0);
    assert_eq!(s.prev_spent, 0);
    assert_eq!(s.expires_at, 0);
    assert!(!s.revoked);
    assert_eq!(s.allow_recipients.len(), 1, "allowlist threaded through");
    assert_eq!(s.allow_recipients.get(0).unwrap(), recipient);
}

/// SSL/Axl provenance: the session must record the sha256 of the .ssl spec
/// that governed the agent at install time, so any spend is provably tied to a
/// specific, immutable governing policy (the on-chain half of the drift proof).
#[test]
fn agent_session_records_ssl_hash() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy(&env);

    let token = Address::generate(&env);
    let (_recipient, allow) = one_recipient(&env);
    let ssl_hash = BytesN::from_array(&env, &[0x5a; 32]);
    wallet.install_agent_session(
        &agent_pk(&env),
        &token,
        &10_000_000,
        &86_400,
        &50_000_000,
        &0,
        &allow,
        &ssl_hash,
    );

    let s = wallet.get_agent_session(&agent_pk(&env));
    assert_eq!(s.ssl_hash, ssl_hash, "ssl_hash (governing spec provenance) must round-trip on the session");
}

/// REGRESSION (testnet e2e harness ↔ ABI binding): `ssl_hash` is a REQUIRED
/// positional on `install_agent_session` (added in the C3 audit). The typed unit
/// tests thread it via the generated client, but the raw-CLI testnet harness
/// (`scripts/e2e-agent-wallet-testnet.mjs`) builds the `stellar contract invoke`
/// command as a string the spec validator never sees at compile time. A rewrite
/// of that harness dropped `--ssl_hash`, so the invoke would fail with a
/// missing-argument error on testnet and the e2e could never pass — invisible to
/// `cargo test` because the harness is off-chain.
///
/// This test binds the harness to the ABI: it reads the harness source and
/// asserts the `install_agent_session` invoke carries `--ssl_hash`. If the arg
/// is dropped again (or the ABI re-requires it without a harness update), this
/// fails here, in the suite that gates the change. No on-chain call is made.
#[test]
fn testnet_e2e_harness_threads_ssl_hash_into_install_invoke() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let harness_path = std::path::Path::new(manifest_dir)
        .join("../../scripts/e2e-agent-wallet-testnet.mjs");
    let src = std::fs::read_to_string(&harness_path).unwrap_or_else(|e| {
        panic!("cannot read testnet e2e harness at {:?}: {}", harness_path, e)
    });

    // Find the `install_agent_session` invoke command. The harness emits exactly
    // one such CLI call; locate it and bound the inspected slice to that command
    // (terminated by the `|| true` guard the harness wraps each invoke in).
    let inv_at = src
        .find("install_agent_session")
        .expect("harness must invoke install_agent_session");
    let tail = &src[inv_at..];
    let cmd_end = tail.find("|| true").unwrap_or(tail.len());
    let invoke_cmd = &tail[..cmd_end];

    assert!(
        invoke_cmd.contains("--ssl_hash"),
        "testnet e2e harness invoke of install_agent_session is missing the now-required \
         --ssl_hash arg; the on-chain e2e would fail with a missing-argument error. \
         Invoke command inspected:\n{}",
        invoke_cmd
    );
}

/// SECURITY_AUDIT (agent-session reinstall): installing over an EXISTING session
/// pubkey silently reset cur_spent/prev_spent/epoch_start and un-revoked it,
/// defeating the proved 2*window_cap exposure bound (which assumes the
/// accumulator starts at (0,0) and only grows). Reinstall must be REJECTED so a
/// session pubkey's accumulator can never be reset — a new delegation uses a new pubkey.
#[test]
fn reinstall_of_existing_agent_session_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy(&env);
    let (_to, allow) = one_recipient(&env);
    let token = Address::generate(&env);
    wallet.install_agent_session(&agent_pk(&env), &token, &10, &600, &25, &0, &allow, &ssl_h(&env));
    let r = wallet.try_install_agent_session(&agent_pk(&env), &token, &10, &600, &25, &0, &allow, &ssl_h(&env));
    assert!(r.is_err(), "reinstall of an existing session pubkey must be rejected (no silent budget reset)");
}

/// Install with a single fresh recipient in the allowlist; returns the
/// recipient so the caller can build matching transfer contexts.
fn install_session(env: &Env, wallet: &SmartWalletClient, token: &Address, per_tx: i128, window_s: u64, window_cap: i128, expires_at: u64) -> Address {
    let (to, allow) = one_recipient(env);
    wallet.install_agent_session(&agent_pk(env), token, &per_tx, &window_s, &window_cap, &expires_at, &allow, &ssl_h(env));
    to
}

/// Install with a caller-supplied recipient allowlist.
fn install_session_to(env: &Env, wallet: &SmartWalletClient, token: &Address, per_tx: i128, window_s: u64, window_cap: i128, expires_at: u64, allow: &Vec<Address>) {
    wallet.install_agent_session(&agent_pk(env), token, &per_tx, &window_s, &window_cap, &expires_at, allow, &ssl_h(env));
}

/// The hard real-time-window ceiling is computed from the SESSION's stored
/// `window_cap_multiplier` (pinned to the AXL-proved `PROVED_WINDOW_MULTIPLIER`
/// and bound to `ssl_hash`), not from a source literal. This test proves the
/// enforcement reads that field: it installs normally (multiplier pinned to 2),
/// confirms a first charge of `window_cap` is admitted, then tampers the STORED
/// multiplier to 0 on an otherwise-identical session and shows the same charge
/// is now REJECTED. If the hot path used a literal `2`, the tampered case would
/// still be admitted and this test would fail — that is exactly what makes the
/// bound on-chain state rather than a baked-in constant.
#[test]
fn hard_ceiling_reads_stored_window_cap_multiplier_not_a_literal() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    let token = Address::generate(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);

    // window_cap = 100, per_tx = 100, W = 600s. From a fresh (0,0) state a
    // charge of 100 passes the weighted check (0+0+100 <= 100) so the hard
    // ceiling is the ONLY gate that can differ by multiplier.
    let to = install_session(&env, &wallet, &token, 100, 600, 100, 0);

    // The proved multiplier is pinned into the session and bound to ssl_hash.
    let s0 = wallet.get_agent_session(&agent_pk(&env));
    assert_eq!(
        s0.window_cap_multiplier,
        super::PROVED_WINDOW_MULTIPLIER,
        "install must pin the AXL-proved multiplier into the session"
    );

    // Baseline: under the pinned multiplier (2 → ceiling 200), the 100 charge is
    // admitted by the hard ceiling.
    let baseline = env.as_contract(&id, || {
        super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 100)
    });
    assert!(
        matches!(baseline, Ok(true)),
        "a 100 charge under multiplier 2 (ceiling 200) must be admitted, got {:?}",
        baseline
    );

    // Re-install a clean session on a fresh wallet, then TAMPER the stored
    // multiplier to 0 (ceiling 0). White-box: we write session storage directly
    // to bypass install validation precisely to prove the runtime reads it.
    let env2 = Env::default();
    env2.mock_all_auths();
    let (id2, wallet2) = deploy(&env2);
    let token2 = Address::generate(&env2);
    env2.ledger().with_mut(|li| li.timestamp = 1_000);
    let to2 = install_session(&env2, &wallet2, &token2, 100, 600, 100, 0);

    env2.as_contract(&id2, || {
        let key = super::DataKey::AgentSession(agent_pk(&env2));
        let mut sess: super::AgentSession =
            env2.storage().persistent().get(&key).expect("session present");
        sess.window_cap_multiplier = 0; // ceiling becomes 0 → fail-closed
        env2.storage().persistent().set(&key, &sess);
    });

    // Same 100 charge, same weighted check (passes), but stored multiplier 0 →
    // hard ceiling 0 → MUST be rejected. A literal-2 hot path would admit it.
    let tampered = env2.as_contract(&id2, || {
        super::try_authorize_agent_transfer(&env2, &agent_pk(&env2), &token2, &to2, 100)
    });
    assert!(
        !matches!(tampered, Ok(true)),
        "with stored multiplier 0 the hard ceiling is 0 and the charge must be \
         rejected; admitting it proves the hot path ignored the stored field \
         (used a literal). verdict={:?}",
        tampered
    );
}

#[test]
fn agent_authorizes_within_caps_and_tracks_spend() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let to = install_session(&env, &wallet, &token, 10, 600, 25, 0);

    env.as_contract(&id, || {
        let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 10);
        assert!(matches!(r, Ok(true)), "within caps must authorize: {:?}", r);
    });
    let s = wallet.get_agent_session(&agent_pk(&env));
    assert_eq!(s.cur_spent, 10, "spend must be tracked");
    assert_eq!(s.epoch_start, 1_000);
}

#[test]
fn agent_rejects_over_per_tx_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let to = install_session(&env, &wallet, &token, 10, 600, 25, 0);

    env.as_contract(&id, || {
        let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 11);
        assert!(matches!(r, Err(Error::AmountExceedsCap)), "got {:?}", r);
    });
}

#[test]
fn agent_rejects_over_window_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let to = install_session(&env, &wallet, &token, 10, 600, 25, 0);

    env.as_contract(&id, || {
        assert!(matches!(super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 10), Ok(true)));
        assert!(matches!(super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 10), Ok(true)));
        // 20 + 10 = 30 > window_cap 25 → reject, leaving spent at 20.
        let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 10);
        assert!(matches!(r, Err(Error::WindowCapExceeded)), "got {:?}", r);
    });
    assert_eq!(wallet.get_agent_session(&agent_pk(&env)).cur_spent, 20, "rejected charge must not be counted");
}

#[test]
fn agent_window_resets_after_window_elapses() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let to = install_session(&env, &wallet, &token, 10, 600, 25, 0);

    env.as_contract(&id, || {
        assert!(matches!(super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 10), Ok(true)));
    });
    // Advance >= 2W so the sliding window resets cleanly (prev_spent dropped).
    env.ledger().with_mut(|li| li.timestamp = 1_000 + 1_201);
    env.as_contract(&id, || {
        let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 10);
        assert!(matches!(r, Ok(true)), "new window must authorize: {:?}", r);
    });
    let s = wallet.get_agent_session(&agent_pk(&env));
    assert_eq!(s.cur_spent, 10, "spend must reset on new window");
    assert_eq!(s.prev_spent, 0, "prev_spent must be dropped after >= 2W");
    assert_eq!(s.epoch_start, 1_000 + 1_201, "epoch must roll to current time");
}

#[test]
fn agent_rejects_revoked_session() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let to = install_session(&env, &wallet, &token, 10, 600, 25, 0);
    wallet.revoke_agent_session(&agent_pk(&env));

    env.as_contract(&id, || {
        let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 10);
        assert!(matches!(r, Err(Error::SessionRevoked)), "got {:?}", r);
    });
}

#[test]
fn install_agent_session_rejects_invalid_config() {
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let pk = agent_pk(&env);

    // A2: a non-empty allowlist is now mandatory, so config-invalidity tests
    // thread a valid recipient to isolate the config check under test.
    let (_to, allow) = one_recipient(&env);
    // per_tx_cap <= 0
    assert!(wallet.try_install_agent_session(&pk, &token, &0, &600, &25, &0, &allow, &ssl_h(&env)).is_err());
    // window_cap < per_tx_cap (a single allowed tx can't fit the window)
    assert!(wallet.try_install_agent_session(&pk, &token, &10, &600, &5, &0, &allow, &ssl_h(&env)).is_err());
    // window_seconds below floor — would silently disable the aggregate cap
    // (window rolls every call), collapsing to per-tx-only enforcement
    assert!(wallet.try_install_agent_session(&pk, &token, &10, &30, &25, &0, &allow, &ssl_h(&env)).is_err());
    // expires_at already in the past
    assert!(wallet.try_install_agent_session(&pk, &token, &10, &600, &25, &500, &allow, &ssl_h(&env)).is_err());
    // boundary valid config is accepted (window_cap == per_tx_cap, floor window)
    wallet.install_agent_session(&pk, &token, &10, &60, &10, &0, &allow, &ssl_h(&env));
}

// ──────────────────────────────────────────────────────────────────────
// A2: install_agent_session admin-blast-radius parity with the policy path
// ──────────────────────────────────────────────────────────────────────

#[test]
fn install_agent_session_rejects_empty_allowlist() {
    // A2.1: an open allowlist + a stolen hot key = drain to any address.
    // Reject an empty allowlist at install time.
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let pk = agent_pk(&env);

    let empty = Vec::new(&env);
    let r = wallet.try_install_agent_session(&pk, &token, &10, &600, &25, &0, &empty, &ssl_h(&env));
    assert!(r.is_err(), "empty allowlist must be rejected");
}

#[test]
fn install_agent_session_rejects_admin_in_allowlist() {
    // A2.2 (H3 analog): a compromised admin must not name itself as a
    // recipient and drain the wallet to itself via the agent path.
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_id, wallet) = deploy_with_admin(&env, &admin);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let pk = agent_pk(&env);

    let allow = vec![&env, admin.clone()];
    let r = wallet.try_install_agent_session(&pk, &token, &10, &600, &25, &0, &allow, &ssl_h(&env));
    assert!(r.is_err(), "admin in allowlist must be rejected");
}

#[test]
fn install_agent_session_rejects_self_in_allowlist() {
    // A2.2 (H3 analog): the wallet's own address must not be an allowed
    // recipient (self-loop drain pattern).
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let pk = agent_pk(&env);

    let allow = vec![&env, id.clone()];
    let r = wallet.try_install_agent_session(&pk, &token, &10, &600, &25, &0, &allow, &ssl_h(&env));
    assert!(r.is_err(), "wallet self in allowlist must be rejected");
}

#[test]
fn install_agent_session_rejects_window_cap_above_multiplier() {
    // A2.3: a window can't be unboundedly larger than a single transfer.
    // window_cap <= per_tx_cap * MAX_WINDOW_MULTIPLIER (100).
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let pk = agent_pk(&env);
    let (_to, allow) = one_recipient(&env);

    // per_tx=10, window_cap=1001 → 1001 > 10*100, must reject.
    let r = wallet.try_install_agent_session(&pk, &token, &10, &600, &1_001, &0, &allow, &ssl_h(&env));
    assert!(r.is_err(), "window_cap > per_tx_cap*100 must be rejected");
    // per_tx=10, window_cap=1000 → boundary == 10*100, must accept.
    wallet.install_agent_session(&pk, &token, &10, &600, &1_000, &0, &allow, &ssl_h(&env));
}

#[test]
fn install_agent_session_accepts_valid_nonempty_allowlist() {
    // A2: the happy path — a valid non-empty allowlist install succeeds.
    let env = Env::default();
    env.mock_all_auths();
    let (_id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let pk = agent_pk(&env);
    let (recipient, allow) = one_recipient(&env);

    wallet.install_agent_session(&pk, &token, &10, &600, &25, &0, &allow, &ssl_h(&env));
    let s = wallet.get_agent_session(&pk);
    assert_eq!(s.allow_recipients.len(), 1);
    assert_eq!(s.allow_recipients.get(0).unwrap(), recipient);
}

#[test]
fn agent_rejects_expired_session() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let to = install_session(&env, &wallet, &token, 10, 600, 25, 2_000);

    env.ledger().with_mut(|li| li.timestamp = 3_000);
    env.as_contract(&id, || {
        let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 10);
        assert!(matches!(r, Err(Error::SessionExpired)), "got {:?}", r);
    });
}

fn session_with_allowlist(env: &Env, allow: Vec<Address>) -> super::AgentSession {
    super::AgentSession {
        session_pubkey: agent_pk(env),
        token: Address::generate(env),
        per_tx_cap: 10,
        window_seconds: 600,
        window_cap: 25,
        epoch_start: 0,
        cur_spent: 0,
        prev_spent: 0,
        expires_at: 0,
        revoked: false,
        allow_recipients: allow,
        ssl_hash: ssl_h(env),
        window_cap_multiplier: super::PROVED_WINDOW_MULTIPLIER,
    }
}

#[test]
fn recipient_allowed_open_list_allows_any() {
    let env = Env::default();
    let s = session_with_allowlist(&env, Vec::new(&env));
    let anyone = Address::generate(&env);
    assert!(super::recipient_allowed(&s, &anyone), "empty allowlist must allow any recipient");
}

#[test]
fn recipient_allowed_restricts_to_listed() {
    let env = Env::default();
    let listed = Address::generate(&env);
    let other = Address::generate(&env);
    let s = session_with_allowlist(&env, vec![&env, listed.clone()]);
    assert!(super::recipient_allowed(&s, &listed), "listed recipient must be allowed");
    assert!(!super::recipient_allowed(&s, &other), "unlisted recipient must be rejected");
}

#[test]
fn agent_context_authorizes_allowed_recipient_within_budget() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let to = Address::generate(&env);
    wallet.install_agent_session(&agent_pk(&env), &token, &10, &600, &25, &0, &vec![&env, to.clone()], &ssl_h(&env));

    let ctx = make_transfer_ctx(&env, &token, &id, &to, 10);
    env.as_contract(&id, || {
        let r = super::try_authorize_agent_context(&env, &agent_pk(&env), &ctx);
        assert!(matches!(r, Ok(true)), "allowed recipient within budget must authorize: {:?}", r);
    });
}

#[test]
fn agent_context_rejects_unlisted_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let listed = Address::generate(&env);
    let unlisted = Address::generate(&env);
    wallet.install_agent_session(&agent_pk(&env), &token, &10, &600, &25, &0, &vec![&env, listed.clone()], &ssl_h(&env));

    let ctx = make_transfer_ctx(&env, &token, &id, &unlisted, 10);
    env.as_contract(&id, || {
        let r = super::try_authorize_agent_context(&env, &agent_pk(&env), &ctx);
        assert!(matches!(r, Err(Error::RecipientNotAllowed)), "got {:?}", r);
    });
}

#[test]
fn agent_context_ignores_non_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    install_session(&env, &wallet, &token, 10, 600, 25, 0);

    let ctx = ContractContext {
        contract: token,
        fn_name: Symbol::new(&env, "burn"),
        args: vec![&env, id.into_val(&env), 100i128.into_val(&env)],
    };
    env.as_contract(&id, || {
        let r = super::try_authorize_agent_context(&env, &agent_pk(&env), &ctx);
        assert!(matches!(r, Ok(false)), "non-transfer must fall through: {:?}", r);
    });
}

// ──────────────────────────────────────────────────────────────────────
// A5: allowlist enforced AT the budget chokepoint, not only in the wrapper
// ──────────────────────────────────────────────────────────────────────

#[test]
fn agent_transfer_chokepoint_rejects_unlisted_recipient_directly() {
    // A5: even calling the budget chokepoint directly (bypassing the
    // context wrapper), a non-allowlisted recipient must be rejected.
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let listed = Address::generate(&env);
    let unlisted = Address::generate(&env);
    install_session_to(&env, &wallet, &token, 10, 600, 25, 0, &vec![&env, listed.clone()]);

    env.as_contract(&id, || {
        // listed recipient authorizes
        let ok = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &listed, 10);
        assert!(matches!(ok, Ok(true)), "listed recipient must authorize: {:?}", ok);
        // unlisted recipient rejected at the chokepoint itself
        let bad = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &unlisted, 10);
        assert!(matches!(bad, Err(Error::RecipientNotAllowed)), "got {:?}", bad);
    });
    // the rejected unlisted transfer must not have consumed budget
    assert_eq!(wallet.get_agent_session(&agent_pk(&env)).cur_spent, 10, "only the listed transfer counts");
}

// ──────────────────────────────────────────────────────────────────────
// A3: sliding-window counter bounds the 2x-burst across an epoch boundary
// ──────────────────────────────────────────────────────────────────────

#[test]
fn agent_sliding_window_bounds_2x_burst_across_boundary() {
    // Spend window_cap near the end of an epoch, then immediately after the
    // boundary a second window_cap must be REJECTED: the weighted estimate
    // from the previous epoch still counts at the start of the new epoch.
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    // W = 600, window_cap = 100, per_tx = 100.
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let to = install_session(&env, &wallet, &token, 100, 600, 100, 0);

    // Spend the full window_cap at the very start of epoch [1000, 1600).
    env.as_contract(&id, || {
        let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 100);
        assert!(matches!(r, Ok(true)), "first full spend must authorize: {:?}", r);
    });

    // Cross the boundary into the adjacent epoch. At now=1600 the epoch rolls
    // (elapsed = 600 >= W, < 2W): prev_spent <- 100, cur_spent <- 0,
    // epoch_start <- 1600, elapsed_in_epoch = 0, weighted_prev = 100 at full
    // weight → estimate = 100, projected = 200 > window_cap 100 → must reject.
    // This is the core A3 guarantee: the immediate post-boundary burst is
    // bounded by the previous epoch's spend (no clean 2x).
    env.ledger().with_mut(|li| li.timestamp = 1_600);
    env.as_contract(&id, || {
        let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 100);
        assert!(matches!(r, Err(Error::WindowCapExceeded)), "2x burst across boundary must be bounded: {:?}", r);
    });
    // A full window_cap remains inadmissible right up until the previous epoch
    // fully decays (>= 2W from the original spend at 1000).
    env.ledger().with_mut(|li| li.timestamp = 2_199); // elapsed 1199 < 2W
    env.as_contract(&id, || {
        let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 100);
        assert!(matches!(r, Err(Error::WindowCapExceeded)),
            "full window_cap before 2W must still be bounded: {:?}", r);
    });
}

#[test]
fn agent_sliding_window_decays_prev_epoch_linearly() {
    // Prove the weighted estimate decays linearly across the adjacent epoch:
    // a charge that crosses the boundary rolls the epoch (prev_spent carries
    // the old spend), then a partial charge that fits the *decayed* estimate
    // is admitted partway through the new epoch.
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    // W = 1000, window_cap = 100, per_tx = 100.
    env.ledger().with_mut(|li| li.timestamp = 0);
    let token = Address::generate(&env);
    let to = install_session(&env, &wallet, &token, 100, 1_000, 100, 0);

    // Spend 80 in epoch [0, 1000).
    env.as_contract(&id, || {
        assert!(matches!(super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 80), Ok(true)));
    });

    // At now=1500: elapsed=1500 >= W, < 2W → roll: prev_spent=80, cur_spent=0,
    // epoch_start=1500. elapsed_in_epoch=0 → weighted_prev = 80*(1000-0)/1000 =
    // 80. A 20-unit charge: projected = 80 + 20 = 100 == cap → admitted; a
    // 21-unit charge would be 101 > 100 → rejected. Test the boundary by first
    // rejecting 21, then admitting 20.
    env.ledger().with_mut(|li| li.timestamp = 1_500);
    env.as_contract(&id, || {
        // 21 over the decayed budget at fraction 0 → reject (does not roll/persist)
        let over = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 21);
        assert!(matches!(over, Err(Error::WindowCapExceeded)), "got {:?}", over);
        // 20 exactly fits → admit, rolls epoch and persists
        let ok = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 20);
        assert!(matches!(ok, Ok(true)), "20 fits decayed budget: {:?}", ok);
    });
    let s = wallet.get_agent_session(&agent_pk(&env));
    assert_eq!(s.prev_spent, 80, "prev epoch carried");
    assert_eq!(s.cur_spent, 20, "current epoch charged");
    assert_eq!(s.epoch_start, 1_500);

    // Now at now=2000 (halfway into epoch [1500,2500), elapsed_in_epoch=500):
    // weighted_prev = 80 * (1000-500)/1000 = 40; estimate = 40 + 20 = 60;
    // a 40-unit charge → projected 100 == cap → admitted (decay freed budget).
    env.ledger().with_mut(|li| li.timestamp = 2_000);
    env.as_contract(&id, || {
        let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 40);
        assert!(matches!(r, Ok(true)), "decayed prev weight frees budget mid-epoch: {:?}", r);
    });
}

#[test]
fn agent_sliding_window_resets_after_two_windows() {
    // A full window later (>= 2W elapsed), prev_spent is dropped and the
    // window resets cleanly.
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let token = Address::generate(&env);
    let to = install_session(&env, &wallet, &token, 100, 600, 100, 0);

    env.as_contract(&id, || {
        assert!(matches!(super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 100), Ok(true)));
    });
    // Jump >= 2W ahead: 1000 + 1200 = 2200.
    env.ledger().with_mut(|li| li.timestamp = 2_200);
    env.as_contract(&id, || {
        let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, 100);
        assert!(matches!(r, Ok(true)), "clean reset after >=2W must authorize: {:?}", r);
    });
    let s = wallet.get_agent_session(&agent_pk(&env));
    assert_eq!(s.cur_spent, 100);
    assert_eq!(s.prev_spent, 0, "prev_spent dropped after >= 2W");
    assert_eq!(s.epoch_start, 2_200);
}

#[test]
fn agent_sliding_window_hard_ceiling_caps_delayed_straddle() {
    // N-A3. The weighted estimate counts cur_spent at full weight regardless of
    // *when* in the epoch it was spent, so a "delayed straddle" (spend late in
    // one epoch, roll, spend early in the next) places spend > window_cap into a
    // single real W-length interval while the weighted estimate stays <= cap.
    // The fix adds a hard UN-weighted ceiling: prev_spent + cur_spent + amount
    // <= 2 * window_cap, making the worst-case real-window spend provably bounded
    // by 2 * window_cap.
    //
    // Part 1 — public-API reproduction of the auditor's exact delayed-straddle
    // schedule (W=12, cap=12, per_tx=12, scaled x5 because install enforces
    // window_seconds >= 60: W=60, timestamps x5, amounts unchanged). It confirms
    // the under-bound (real-window spend 6+1+6=13 > cap=12) AND that the on-chain
    // un-weighted state never exceeds 2*cap.
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    let token = Address::generate(&env);
    env.ledger().with_mut(|li| li.timestamp = 60);
    let to = install_session(&env, &wallet, &token, 12, 60, 12, 0);

    // Auditor steps, scaled x5: t=60 amt=1, t=110 amt=6, t=125 amt=1 (rolls into
    // epoch2: prev<-7), t=145 amt=6. All admitted by the weighted estimate.
    for (t, a) in [(60u64, 1i128), (110, 6), (125, 1), (145, 6)] {
        env.ledger().with_mut(|li| li.timestamp = t);
        env.as_contract(&id, || {
            let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, a);
            assert!(matches!(r, Ok(true)), "straddle step t={} amt={} must admit: {:?}", t, a, r);
        });
    }
    let s = wallet.get_agent_session(&agent_pk(&env));
    // Real-time window [110,170) (width W=60) captured 6 + 1 + 6 = 13 > cap 12:
    // the documented under-bound. But prev+cur stays well inside 2*cap.
    assert_eq!(s.prev_spent, 7, "epoch1 spend carried");
    assert_eq!(s.cur_spent, 7, "epoch2 spend accumulated");
    assert!(
        s.prev_spent + s.cur_spent <= 2 * s.window_cap,
        "un-weighted state must stay <= 2*window_cap: {} > {}",
        s.prev_spent + s.cur_spent,
        2 * s.window_cap
    );

    // Part 2 — the hard ceiling REJECTS. Through valid install+authorize the
    // invariants prev<=cap, cur<=cap, amount<=cap keep prev+cur+amount <= 2*cap,
    // so the ceiling is a defense-in-depth guard: it bites only if some state has
    // prev_spent above window_cap. Construct exactly that state directly (the same
    // direct-struct pattern used elsewhere in this file) — far into the epoch so
    // the weighted estimate has decayed to ~0 and would ADMIT, while the
    // un-weighted ceiling must REJECT. Pre-fix (no ceiling) this returned Ok(true);
    // post-fix it must be WindowCapExceeded.
    let (to2, allow2) = one_recipient(&env);
    let token2 = Address::generate(&env);
    let straddled = super::AgentSession {
        session_pubkey: agent_pk(&env),
        token: token2.clone(),
        per_tx_cap: 12,
        window_seconds: 60,
        window_cap: 12,
        epoch_start: 1_000,
        cur_spent: 0,
        // prev_spent inflated above window_cap (the only way the ceiling binds
        // tighter than the weighted check): models a worst-case straddle residue
        // the ceiling must contain.
        prev_spent: 20,
        expires_at: 0,
        revoked: false,
        allow_recipients: allow2,
        ssl_hash: ssl_h(&env),
        window_cap_multiplier: super::PROVED_WINDOW_MULTIPLIER,
    };
    env.as_contract(&id, || {
        let key = super::DataKey::AgentSession(agent_pk(&env));
        env.storage().persistent().set(&key, &straddled);
    });
    // now = 1_059: elapsed_in_epoch = 59, remaining = 1, weighted_prev =
    // floor(20*1/60) = 0 → weighted estimate = 0 + 12 = 12 == cap → ADMITS.
    // Un-weighted: prev+cur+amount = 20 + 0 + 12 = 32 > 2*cap (24) → ceiling REJECTS.
    env.ledger().with_mut(|li| li.timestamp = 1_059);
    env.as_contract(&id, || {
        let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token2, &to2, 12);
        assert!(
            matches!(r, Err(Error::WindowCapExceeded)),
            "hard 2x ceiling must reject the over-2*window_cap straddle the weighted check admits: {:?}",
            r
        );
    });
    // Boundary: a charge that lands exactly at 2*cap is admitted (steady-state
    // sits at the ceiling). prev+cur+amount = 20 + 0 + 4 = 24 == 2*cap → admit.
    env.as_contract(&id, || {
        let r = super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token2, &to2, 4);
        assert!(matches!(r, Ok(true)), "exactly 2*window_cap must admit: {:?}", r);
    });
}

// ──────────────────────────────────────────────────────────────────────
// A1: extracted pull-policy helper, tested multi-context
// ──────────────────────────────────────────────────────────────────────

#[test]
fn pull_policy_authorizes_multi_context_all_match() {
    // Two transfer contexts, each matching its own active policy → the pull
    // path authorizes (Ok(true)).
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let token = Address::generate(&env);
    wallet.install_policy(&m1, &token, &100, &150, &60, &0);
    wallet.install_policy(&m2, &token, &100, &150, &60, &0);

    let ctxs: Vec<Context> = vec![
        &env,
        Context::Contract(make_transfer_ctx(&env, &token, &id, &m1, 100)),
        Context::Contract(make_transfer_ctx(&env, &token, &id, &m2, 100)),
    ];
    env.as_contract(&id, || {
        let r = super::pull_policy_authorizes(&env, &ctxs);
        assert!(matches!(r, Ok(true)), "both contexts match → authorize: {:?}", r);
    });
}

#[test]
fn pull_policy_authorizes_multi_context_one_unmatched() {
    // One matching context + one with no policy → not all-match (Ok(false)).
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);

    let m1 = Address::generate(&env);
    let unknown = Address::generate(&env);
    let token = Address::generate(&env);
    wallet.install_policy(&m1, &token, &100, &150, &60, &0);

    let ctxs: Vec<Context> = vec![
        &env,
        Context::Contract(make_transfer_ctx(&env, &token, &id, &m1, 100)),
        Context::Contract(make_transfer_ctx(&env, &token, &id, &unknown, 100)),
    ];
    env.as_contract(&id, || {
        let r = super::pull_policy_authorizes(&env, &ctxs);
        assert!(matches!(r, Ok(false)), "one unmatched context → not all-match: {:?}", r);
    });
}

#[test]
fn pull_policy_authorizes_propagates_policy_violation_err() {
    // A context that matches a policy that EXISTS but is violated (over cap)
    // must propagate Err, not fall through to Ok(false).
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);

    let m1 = Address::generate(&env);
    let token = Address::generate(&env);
    wallet.install_policy(&m1, &token, &100, &150, &60, &0);

    let ctxs: Vec<Context> = vec![
        &env,
        Context::Contract(make_transfer_ctx(&env, &token, &id, &m1, 500)), // over cap 150
    ];
    env.as_contract(&id, || {
        let r = super::pull_policy_authorizes(&env, &ctxs);
        assert!(matches!(r, Err(Error::AmountExceedsCap)), "policy violation must propagate Err: {:?}", r);
    });
}

// ─────────────────────────────────────────────────────────────────────────
// REAL WebAuthn assertion verification (the "biometric pays" core).
// Generates a real secp256r1/P-256 key, builds a genuine WebAuthn assertion
// (authenticatorData + clientDataJSON with the base64url challenge + ECDSA
// signature over SHA256(authData || SHA256(clientData))), and proves the
// contract's __check_auth path (verify_webauthn) ACCEPTS it — and rejects a
// mismatched challenge. This is what a Face ID / fingerprint tap produces.
// ─────────────────────────────────────────────────────────────────────────
#[test]
fn webauthn_assertion_verifies_and_binds_to_payload() {
    use p256::ecdsa::{signature::Signer, Signature, SigningKey};
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    use sha2::{Digest, Sha256};

    let env = Env::default();

    // The device passkey (deterministic seed for a reproducible test).
    let signing = SigningKey::from_slice(&[0x11u8; 32]).unwrap();
    let vk = signing.verifying_key();
    let ep = vk.to_encoded_point(false); // 0x04 || X || Y = 65 bytes
    let pk_arr: [u8; 65] = ep.as_bytes().try_into().unwrap();
    let pubkey = BytesN::from_array(&env, &pk_arr);

    // Host auth payload (Soroban gives __check_auth a Hash<32>).
    let payload = env.crypto().sha256(&Bytes::from_array(&env, &[0xABu8; 16]));
    let payload_arr = payload.to_array();

    // The frontend sets the WebAuthn challenge = base64url(payload). Reuse the
    // contract's own encoder so the bytes match exactly.
    let chal_bytes = crate::base64url_nopad(&env, &payload_arr);
    let chal_vec: std::vec::Vec<u8> = chal_bytes.iter().collect();
    let chal_str = std::str::from_utf8(&chal_vec).unwrap();
    let cdj = std::format!(
        "{{\"type\":\"webauthn.get\",\"challenge\":\"{}\",\"origin\":\"https://slippay.cc\"}}",
        chal_str
    );
    let client_data_json = Bytes::from_slice(&env, cdj.as_bytes());

    // authenticatorData: 37 bytes (rpIdHash[32] + flags + signCount). Content
    // is irrelevant to the signature check beyond being signed over.
    let ad = [0x49u8; 37];
    let authenticator_data = Bytes::from_array(&env, &ad);

    // Signature base = authData || SHA256(clientData); the authenticator signs
    // SHA256(base). p256's Signer hashes with SHA256 internally.
    let cd_hash = Sha256::digest(cdj.as_bytes());
    let mut base = std::vec::Vec::new();
    base.extend_from_slice(&ad);
    base.extend_from_slice(&cd_hash);
    let sig: Signature = signing.sign(&base);
    let sig_arr: [u8; 64] = sig.to_bytes().as_slice().try_into().unwrap();
    let signature = BytesN::from_array(&env, &sig_arr);

    // GOOD assertion → accepted.
    let good = WebAuthnAuth {
        authenticator_data: authenticator_data.clone(),
        client_data_json: client_data_json.clone(),
        signature: signature.clone(),
    };
    assert!(
        crate::verify_webauthn(&env, &pubkey, &payload, &good).is_ok(),
        "real WebAuthn assertion must verify"
    );

    // WRONG challenge (different payload) → rejected at the binding step,
    // before crypto. Proves replay/cross-tx defense.
    let other_payload = env.crypto().sha256(&Bytes::from_array(&env, &[0x01u8; 16]));
    assert_eq!(
        crate::verify_webauthn(&env, &pubkey, &other_payload, &good),
        Err(Error::SignatureInvalid),
        "assertion bound to a different payload must be rejected"
    );
}

// ──────────────────────────────────────────────────────────────────────
// CONFORMANCE: deployed enforcement upholds the axlc-proved 2×window_cap bound
//
// `axl-compiler/examples/agent_wallet_m3.axl` proves (via Z3) that the sliding-
// window policy's worst-case outflow over any real window is bounded by
// 2*window_cap (certified bound K=2 — NOT 1×). That proof is a statement about
// the SPEC. This module is the missing link: it asserts the DEPLOYED Rust
// enforcement (`try_authorize_agent_transfer`, lib.rs) actually upholds that
// same 2×window_cap bound, so the proof is load-bearing on shipped code, not a
// detached artifact. The CI `axlc-gate` workflow runs `axlc prove` on the spec
// AND this conformance suite together: if either drifts, the build fails.
//
// We drive the REAL contract path (not a re-implementation of the math): each
// case installs a session and feeds a deterministic seeded sweep of charges,
// each <= per_tx_cap, advancing the ledger clock. For every step we assert the
// two properties the proof claims about the deployed code:
//   (a) any charge that would push prev_spent + cur_spent + amount above
//       2*window_cap is REJECTED by the contract (the hard un-weighted ceiling,
//       N-A3, lib.rs ~993-1000), and
//   (b) after any ACCEPTED charge, the cumulative un-weighted spend over the
//       two live epochs (prev_spent + cur_spent) never exceeds 2*window_cap.
//
// No new crate deps: a tiny deterministic LCG generates the sweep (proptest is
// not a dev-dependency). The sweep is reproducible from a fixed seed list, so a
// failure is a stable repro, not a flaky one.
// ──────────────────────────────────────────────────────────────────────

/// Deterministic xorshift64* PRNG — std-only, no `rand` dep. Reproducible from
/// any non-zero seed so a conformance failure is a stable repro.
struct Lcg(u64);
impl Lcg {
    fn new(seed: u64) -> Self {
        // Avoid the zero fixed-point of xorshift; any non-zero state is fine.
        Lcg(seed | 1)
    }
    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// Uniform-ish in `[0, n]` inclusive (n small, modulo bias negligible for
    /// the tiny domains used here; this is a fuzz schedule, not a CSPRNG).
    fn in_incl(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next_u64() % (n + 1)
        }
    }
}

/// Run one deterministic conformance sweep against the DEPLOYED contract path.
///
/// Installs a session with the given caps, then issues `steps` charges. Each
/// charge amount is in `[0, per_tx]` (always <= per_tx_cap, per the proof's
/// install-time precondition) and the clock advances by a seeded jitter in
/// `[0, max_dt]` so epochs roll, straddle, and fully decay across the sweep.
///
/// Asserts, on the REAL contract state after each step:
///  (a) the contract's accept/reject decision is consistent with the proved
///      2×window_cap ceiling — a charge is rejected whenever
///      prev+cur+amount > 2*window_cap (read from the pre-charge state), and
///  (b) after every ACCEPTED charge, prev_spent + cur_spent <= 2*window_cap.
fn run_conformance_sweep(seed: u64, per_tx: i128, window_s: u64, window_cap: i128, steps: usize, max_dt: u64) {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    let token = Address::generate(&env);
    let mut now: u64 = 1_000;
    env.ledger().with_mut(|li| li.timestamp = now);
    let to = install_session(&env, &wallet, &token, per_tx, window_s, window_cap, 0);

    let two_cap = window_cap * 2;
    let mut rng = Lcg::new(seed);

    for step in 0..steps {
        // Advance the clock by a seeded jitter so the sweep exercises in-epoch,
        // boundary-crossing (straddle), and full-decay (>= 2W) transitions.
        now = now.saturating_add(rng.in_incl(max_dt));
        env.ledger().with_mut(|li| li.timestamp = now);

        let amount = rng.in_incl(per_tx as u64) as i128; // always <= per_tx_cap

        // Read the session state the contract will START from for this charge,
        // applying the SAME lazy epoch-roll the contract applies, so we know the
        // (prev, cur) the hard ceiling will actually test against.
        let pre = wallet.get_agent_session(&agent_pk(&env));
        let (eff_prev, eff_cur) = effective_prev_cur(&pre, now);
        // The proved hard ceiling (N-A3) tests prev + cur + amount <= 2*cap on
        // the rolled state. Predict the ceiling verdict from that.
        let unweighted = eff_prev + eff_cur + amount;
        let ceiling_would_reject = unweighted > two_cap;

        let verdict = env.as_contract(&id, || {
            super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, amount)
        });

        // (a) The proved ceiling must hold: if the un-weighted projected spend
        // exceeds 2*window_cap, the contract MUST NOT accept. (The contract may
        // ALSO reject for the tighter weighted check or per-tx/amount<=0 reasons;
        // we only require that it never ACCEPTS past the proved 2x ceiling.)
        if ceiling_would_reject {
            assert!(
                !matches!(verdict, Ok(true)),
                "CONFORMANCE (a) violated seed={} step={}: amount={} on (prev={}, cur={}) \
                 gives unweighted={} > 2*window_cap={}, but contract ACCEPTED (verdict={:?}). \
                 The deployed enforcement admitted a charge the axlc-proved 2x bound forbids.",
                seed, step, amount, eff_prev, eff_cur, unweighted, two_cap, verdict
            );
        }

        // (b) After any ACCEPTED charge, the live un-weighted state across the
        // two epochs must stay within 2*window_cap — the exact quantity the
        // axlc proof certifies as the worst-case real-window outflow bound.
        if matches!(verdict, Ok(true)) {
            let post = wallet.get_agent_session(&agent_pk(&env));
            assert!(
                post.prev_spent + post.cur_spent <= two_cap,
                "CONFORMANCE (b) violated seed={} step={}: after ACCEPT amount={}, \
                 prev_spent={} + cur_spent={} = {} > 2*window_cap={}. The deployed \
                 enforcement let cumulative spend exceed the axlc-proved bound.",
                seed, step, amount, post.prev_spent, post.cur_spent,
                post.prev_spent + post.cur_spent, two_cap
            );
            // Each accepted amount also respected the per-tx precondition the
            // proof assumes (amount <= per_tx_cap, and a strictly positive
            // charge — the contract rejects amount<=0 as InvalidConfig).
            assert!(amount > 0 && amount <= per_tx, "accepted amount out of [1, per_tx]");
        }
    }
}

/// Mirror the contract's LAZY epoch roll (lib.rs ~939-952) WITHOUT mutating:
/// given a session and `now`, return the (prev_spent, cur_spent) the contract
/// will use as the basis for the hard 2×window_cap ceiling on the next charge.
/// This is read-only bookkeeping to PREDICT the ceiling input — the accept/
/// reject decision itself is taken by the real contract, not here.
fn effective_prev_cur(s: &AgentSession, now: u64) -> (i128, i128) {
    let w = s.window_seconds;
    let elapsed = now.saturating_sub(s.epoch_start);
    if elapsed >= w {
        // Rolled: carry cur into prev if within one window of the boundary,
        // else drop it (fully decayed). cur resets to 0.
        let prev = if elapsed < w.saturating_mul(2) { s.cur_spent } else { 0 };
        (prev, 0)
    } else {
        (s.prev_spent, s.cur_spent)
    }
}

/// Conformance: across a deterministic seeded sweep of in-spec charge sequences,
/// the DEPLOYED contract never lets cumulative un-weighted spend over the two
/// live epochs exceed 2*window_cap, and never accepts a charge that would —
/// exactly the bound `axlc prove agent_wallet_m3.axl` certifies (K=2). Drives
/// the real `try_authorize_agent_transfer` path, not a re-implementation.
#[test]
fn conformance_deployed_enforcement_upholds_axlc_2x_bound() {
    // A spread of seeds × cap geometries × clock jitter. window_s = 60 (the
    // install-time floor) so epoch rolls are reachable within the sweep; per_tx
    // <= window_cap (install precondition). max_dt spans well past 2W (120) so
    // in-epoch, straddle, and full-decay transitions all occur.
    let configs: &[(i128, u64, i128)] = &[
        // (per_tx, window_seconds, window_cap)
        (10, 60, 25),     // window_cap = 2.5x per_tx
        (10, 60, 10),     // window_cap == per_tx (boundary geometry)
        (100, 60, 100),   // larger amounts, cap == per_tx
        (7, 60, 50),      // co-prime amounts vs caps to vary residues
        (13, 60, 13),     // tight: per_tx == window_cap, every charge near-cap
    ];
    let mut total_steps = 0usize;
    for (ci, &(per_tx, window_s, window_cap)) in configs.iter().enumerate() {
        // Several seeds per geometry → distinct charge/jitter schedules.
        for seed_base in [1u64, 7, 42, 1337, 0xDEAD_BEEF, 0x5151_5151] {
            let seed = seed_base
                .wrapping_mul(0x9E37_79B9_7F4A_7C15)
                .wrapping_add(ci as u64);
            let steps = 40;
            run_conformance_sweep(seed, per_tx, window_s, window_cap, steps, 120);
            total_steps += steps;
        }
    }
    // Guard against a vacuous pass: the sweep must actually have exercised the
    // enforcement path many times (5 geometries × 6 seeds × 40 steps = 1200).
    assert_eq!(total_steps, 5 * 6 * 40, "expected the full conformance sweep to run");
}

/// Conformance (exhaustive small-domain): for a small fixed geometry, sweep a
/// deterministic enumeration of (amount, dt) pairs and check the SAME two
/// properties as the seeded test, but over a dense, easily-audited grid rather
/// than a PRNG schedule. Belt-and-suspenders: if the LCG ever degenerated and
/// stopped covering the boundary cases, this dense grid still exercises them
/// (notably dt around W and 2W where the straddle/decay transitions live).
#[test]
fn conformance_exhaustive_small_domain_grid() {
    let env = Env::default();
    env.mock_all_auths();
    let (id, wallet) = deploy(&env);
    let token = Address::generate(&env);
    let per_tx: i128 = 4;
    let window_s: u64 = 60;
    let window_cap: i128 = 4;
    let two_cap = window_cap * 2;
    let mut now: u64 = 1_000;
    env.ledger().with_mut(|li| li.timestamp = now);
    let to = install_session(&env, &wallet, &token, per_tx, window_s, window_cap, 0);

    // A deterministic dense grid: cycle amounts 0..=per_tx and dt over the
    // boundary-relevant values {0, 1, 30 (mid), 59, 60 (=W), 61, 120 (=2W),
    // 121} so straddle and full-decay transitions are hit repeatedly.
    let dts: [u64; 8] = [0, 1, 30, 59, 60, 61, 120, 121];
    let mut covered = 0usize;
    for round in 0..16u64 {
        for amt in 0..=(per_tx as u64) {
            for &dt in dts.iter() {
                now = now.saturating_add(dt.wrapping_add(round % 3));
                env.ledger().with_mut(|li| li.timestamp = now);
                let amount = amt as i128;

                let pre = wallet.get_agent_session(&agent_pk(&env));
                let (eff_prev, eff_cur) = effective_prev_cur(&pre, now);
                let ceiling_would_reject = eff_prev + eff_cur + amount > two_cap;

                let verdict = env.as_contract(&id, || {
                    super::try_authorize_agent_transfer(&env, &agent_pk(&env), &token, &to, amount)
                });

                if ceiling_would_reject {
                    assert!(
                        !matches!(verdict, Ok(true)),
                        "CONFORMANCE grid (a): amount={} on (prev={}, cur={}) > 2*cap={} but ACCEPTED ({:?})",
                        amount, eff_prev, eff_cur, two_cap, verdict
                    );
                }
                if matches!(verdict, Ok(true)) {
                    let post = wallet.get_agent_session(&agent_pk(&env));
                    assert!(
                        post.prev_spent + post.cur_spent <= two_cap,
                        "CONFORMANCE grid (b): prev={} + cur={} > 2*cap={} after accept of {}",
                        post.prev_spent, post.cur_spent, two_cap, amount
                    );
                }
                covered += 1;
            }
        }
    }
    assert_eq!(covered, 16 * (per_tx as usize + 1) * dts.len(), "dense grid must cover every cell");
}
