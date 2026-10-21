#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, IntoVal,
};

const DAY: u64 = 86_400;

struct Fixture<'a> {
    env: Env,
    contract: SubscriptionContractClient<'a>,
    buyer: Address,
    merchant: Address,
    platform: Address,
    token: Address,
    token_admin: Address,
    sac_admin: StellarAssetClient<'a>,
    sac_user: TokenClient<'a>,
}

// Default fixture: platform fee disabled (fee_bps = 0) so the existing
// behaviour (merchant receives the full amount) is unchanged.
const TEST_DOMAIN: [u8; 32] = [0xD0u8; 32];

fn setup<'a>() -> Fixture<'a> {
    setup_with_fee(0)
}

fn setup_with_fee<'a>(fee_bps: u32) -> Fixture<'a> {
    let env = Env::default();
    // mock_all_auths_allowing_non_root_auth permits nested contract auth like
    // SAC.transfer requiring the buyer's auth — mock_all_auths alone only
    // mocks root-level calls and rejects sub-invocations.
    env.mock_all_auths_allowing_non_root_auth();

    let buyer = Address::generate(&env);
    let merchant = Address::generate(&env);
    let platform = Address::generate(&env);
    let token_admin = Address::generate(&env);

    // Issue a SAC-style asset (testutils mints freely via admin client).
    let issuer = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = issuer.address();
    let sac_admin = StellarAssetClient::new(&env, &token_addr);
    let sac_user = TokenClient::new(&env, &token_addr);

    // Mint 1000 tokens to buyer so charges have funds.
    sac_admin.mint(&buyer, &1_000_000_000_i128); // 100 with 7 decimals

    // Deploy with the platform fee config bound at construction.
    let contract_id = env.register(SubscriptionContract, (platform.clone(), fee_bps, BytesN::from_array(&env, &TEST_DOMAIN)));
    let contract = SubscriptionContractClient::new(&env, &contract_id);

    Fixture {
        env, contract, buyer, merchant, platform,
        token: token_addr, token_admin, sac_admin, sac_user,
    }
}

#[test]
fn create_then_charge_then_cancel() {
    let f = setup();
    let id = BytesN::from_array(&f.env, &[1u8; 32]);

    f.env.ledger().with_mut(|l| { l.timestamp = 1_000_000; });

    let returned_id = f.contract.create(
        &f.buyer, &f.merchant, &f.token,
        &10_000_000_i128, // 1.0 token
        &(30 * DAY), &12, &0, &id,
    );
    assert_eq!(returned_id, id);

    // First charge succeeds because last_charge_at is initialized to (now - period).
    let next = f.contract.charge(&id);
    assert_eq!(next, 1_000_000 + 30 * DAY);

    // Second charge same instant fails (PeriodNotElapsed).
    let res = f.contract.try_charge(&id);
    assert!(res.is_err());

    // Advance ledger 30 days.
    f.env.ledger().with_mut(|l| { l.timestamp += 30 * DAY; });
    let next2 = f.contract.charge(&id);
    assert_eq!(next2, 1_000_000 + 60 * DAY);

    // Buyer cancels.
    f.contract.cancel(&id);
    let sub = f.contract.get(&id);
    assert_eq!(sub.status, Status::Cancelled);
    assert_eq!(sub.charges_done, 2);

    // Charge after cancel fails.
    let res = f.contract.try_charge(&id);
    assert!(res.is_err());
}

#[test]
fn autocharge_pulls_from_allowance_and_respects_period() {
    let f = setup();
    let id = BytesN::from_array(&f.env, &[9u8; 32]);
    f.env.ledger().with_mut(|l| { l.timestamp = 1_000_000; });

    f.contract.create(
        &f.buyer, &f.merchant, &f.token,
        &10_000_000_i128, &(30 * DAY), &12, &0, &id,
    );

    // Buyer pre-approves the subscription contract as spender — the ONE signature.
    let exp = f.env.ledger().sequence() + 100_000;
    f.sac_user.approve(&f.buyer, &f.contract.address, &100_000_000_i128, &exp);

    let merch_before = f.sac_user.balance(&f.merchant);
    let buyer_before = f.sac_user.balance(&f.buyer);

    let next = f.contract.autocharge(&id);
    assert_eq!(next, 1_000_000 + 30 * DAY);
    assert_eq!(f.sac_user.balance(&f.merchant), merch_before + 10_000_000);
    assert_eq!(f.sac_user.balance(&f.buyer), buyer_before - 10_000_000);
    // Allowance is debited by the pulled amount.
    assert_eq!(f.sac_user.allowance(&f.buyer, &f.contract.address), 90_000_000);

    // Second autocharge within the period fails (period gate still holds).
    assert!(f.contract.try_autocharge(&id).is_err());

    // After the period, it charges again WITHOUT a new buyer signature.
    f.env.ledger().with_mut(|l| { l.timestamp += 30 * DAY; });
    f.contract.autocharge(&id);
    assert_eq!(f.sac_user.balance(&f.merchant), merch_before + 20_000_000);
}

#[test]
fn autocharge_needs_no_signature_at_charge_time() {
    let f = setup();
    let id = BytesN::from_array(&f.env, &[7u8; 32]);
    f.env.ledger().with_mut(|l| { l.timestamp = 1_000_000; });

    f.contract.create(
        &f.buyer, &f.merchant, &f.token,
        &10_000_000_i128, &(30 * DAY), &0, &0, &id,
    );
    let exp = f.env.ledger().sequence() + 100_000;
    f.sac_user.approve(&f.buyer, &f.contract.address, &100_000_000_i128, &exp);

    // Clear ALL mocked auths: no buyer, no relayer signature in the context.
    // The standing allowance is the only authorization — this is autonomy.
    f.env.set_auths(&[]);

    let merch_before = f.sac_user.balance(&f.merchant);
    f.contract.autocharge(&id);
    assert_eq!(f.sac_user.balance(&f.merchant), merch_before + 10_000_000);
}

// --- v0.3 attested autonomous charge (the on-chain integrity gate) ---

fn sign_attestation(domain: &[u8; 32], seed: &[u8; 32], id: &[u8; 32], charges_done: u32, not_after: u64) -> ([u8; 32], [u8; 64]) {
    use ed25519_dalek::{Signer, SigningKey};
    let sk = SigningKey::from_bytes(seed);
    let pk = sk.verifying_key().to_bytes();
    // message = domain (32) || id (32) || charges_done (4 BE) || not_after (8 BE) — matches the contract.
    let mut msg = [0u8; 76];
    msg[..32].copy_from_slice(domain);
    msg[32..64].copy_from_slice(id);
    msg[64..68].copy_from_slice(&charges_done.to_be_bytes());
    msg[68..].copy_from_slice(&not_after.to_be_bytes());
    (pk, sk.sign(&msg).to_bytes())
}

fn setup_attested<'a>(id_arr: &[u8; 32]) -> (Fixture<'a>, BytesN<32>) {
    let f = setup();
    let id = BytesN::from_array(&f.env, id_arr);
    f.env.ledger().with_mut(|l| { l.timestamp = 1_000_000; });
    f.contract.create(&f.buyer, &f.merchant, &f.token, &10_000_000_i128, &(30 * DAY), &0, &0, &id);
    let exp = f.env.ledger().sequence() + 100_000;
    f.sac_user.approve(&f.buyer, &f.contract.address, &100_000_000_i128, &exp);
    (f, id)
}

#[test]
fn autocharge_attested_settles_with_valid_attestation() {
    let id_arr = [3u8; 32];
    let (f, id) = setup_attested(&id_arr);

    let not_after = 2_000_000u64; // now is 1_000_000 → fresh
    let (pk, sig) = sign_attestation(&TEST_DOMAIN, &[1u8; 32], &id_arr, 0, not_after);
    f.contract.set_attester(&id, &BytesN::from_array(&f.env, &pk));

    let before = f.sac_user.balance(&f.merchant);
    f.contract.autocharge_attested(&id, &not_after, &BytesN::from_array(&f.env, &sig));
    assert_eq!(f.sac_user.balance(&f.merchant), before + 10_000_000);
}

#[test]
fn autocharge_attested_rejects_without_attester() {
    let id_arr = [4u8; 32];
    let (f, id) = setup_attested(&id_arr);
    let not_after = 2_000_000u64;
    let (_pk, sig) = sign_attestation(&TEST_DOMAIN, &[1u8; 32], &id_arr, 0, not_after);
    // No set_attester → AttesterNotSet.
    assert!(f.contract.try_autocharge_attested(&id, &not_after, &BytesN::from_array(&f.env, &sig)).is_err());
}

#[test]
fn autocharge_attested_rejects_expired_attestation() {
    let id_arr = [5u8; 32];
    let (f, id) = setup_attested(&id_arr);
    let not_after = 500_000u64; // BEFORE now (1_000_000) → expired
    let (pk, sig) = sign_attestation(&TEST_DOMAIN, &[1u8; 32], &id_arr, 0, not_after);
    f.contract.set_attester(&id, &BytesN::from_array(&f.env, &pk));
    assert!(f.contract.try_autocharge_attested(&id, &not_after, &BytesN::from_array(&f.env, &sig)).is_err());
}

#[test]
fn autocharge_attested_rejects_tampered_signature() {
    let id_arr = [6u8; 32];
    let (f, id) = setup_attested(&id_arr);
    let not_after = 2_000_000u64;
    let (pk, _sig) = sign_attestation(&TEST_DOMAIN, &[1u8; 32], &id_arr, 0, not_after);
    f.contract.set_attester(&id, &BytesN::from_array(&f.env, &pk));
    // A signature over a DIFFERENT not_after — valid ed25519 but wrong message.
    let (_pk2, wrong_sig) = sign_attestation(&TEST_DOMAIN, &[1u8; 32], &id_arr, 0, 1_999_999u64);
    assert!(f.contract.try_autocharge_attested(&id, &not_after, &BytesN::from_array(&f.env, &wrong_sig)).is_err());
}

#[test]
fn autocharge_attested_attestation_is_single_use_per_charge() {
    let id_arr = [8u8; 32];
    let (f, id) = setup_attested(&id_arr);
    let na = 9_999_999u64; // far-future not_after — so freshness is NOT the limiter; single-use is.
    let (pk, sig0) = sign_attestation(&TEST_DOMAIN, &[1u8; 32], &id_arr, 0, na); // bound to charge #0
    f.contract.set_attester(&id, &BytesN::from_array(&f.env, &pk));

    let before = f.sac_user.balance(&f.merchant);
    f.contract.autocharge_attested(&id, &na, &BytesN::from_array(&f.env, &sig0));
    assert_eq!(f.sac_user.balance(&f.merchant), before + 10_000_000);

    // advance past the period — the period gate alone would now allow a 2nd charge.
    f.env.ledger().with_mut(|l| { l.timestamp += 30 * DAY; });

    // REPLAY the charge-#0 attestation → must FAIL: charges_done is now 1, the signed
    // message no longer matches, ed25519 traps. Native-style single-use, on-chain.
    assert!(f.contract.try_autocharge_attested(&id, &na, &BytesN::from_array(&f.env, &sig0)).is_err());

    // a FRESH attestation bound to charge #1 settles — proves single-use, not frozen.
    let (_pk, sig1) = sign_attestation(&TEST_DOMAIN, &[1u8; 32], &id_arr, 1, na);
    f.contract.autocharge_attested(&id, &na, &BytesN::from_array(&f.env, &sig1));
    assert_eq!(f.sac_user.balance(&f.merchant), before + 20_000_000);
}

// --- v0.4 platform fee on the autonomous rail ---

#[test]
fn plain_autocharge_rejected_when_attester_is_set() {
    // The integrity gate must be INESCAPABLE: once a subscription has an attester
    // bound, the plain (ungated) autocharge path must refuse — closing the back
    // door so the only way to settle is a fresh, valid attestation.
    let id_arr = [9u8; 32];
    let (f, id) = setup_attested(&id_arr);
    let (pk, _sig) = sign_attestation(&TEST_DOMAIN, &[1u8; 32], &id_arr, 0, 2_000_000u64);
    f.contract.set_attester(&id, &BytesN::from_array(&f.env, &pk));
    assert!(f.contract.try_autocharge(&id).is_err());
}

#[test]
fn attestation_bound_to_domain_rejects_foreign_domain() {
    // Domain separation / anti cross-contract & cross-chain replay: a signature
    // made for a DIFFERENT domain must be refused here; only this contract's own
    // domain settles. Same attester key in both — only the domain differs.
    let id_arr = [11u8; 32];
    let (f, id) = setup_attested(&id_arr);
    let not_after = 2_000_000u64;
    let foreign: [u8; 32] = [0xEEu8; 32];
    let (pk, bad) = sign_attestation(&foreign, &[1u8; 32], &id_arr, 0, not_after);
    f.contract.set_attester(&id, &BytesN::from_array(&f.env, &pk));
    assert!(f.contract.try_autocharge_attested(&id, &not_after, &BytesN::from_array(&f.env, &bad)).is_err());
    // same key, correct (this contract's) domain → settles
    let (_pk, good) = sign_attestation(&TEST_DOMAIN, &[1u8; 32], &id_arr, 0, not_after);
    let before = f.sac_user.balance(&f.merchant);
    f.contract.autocharge_attested(&id, &not_after, &BytesN::from_array(&f.env, &good));
    assert_eq!(f.sac_user.balance(&f.merchant), before + 10_000_000);
}

#[test]
fn autocharge_splits_platform_fee() {
    // The autonomous rail captures the platform fee out of each charge: the
    // merchant receives amount - fee, the platform receives fee, the buyer's
    // total debit is unchanged (amount), and the whole amount is pulled from the
    // standing allowance. This is the inescapable on-chain capture.
    let f = setup_with_fee(297); // 2.97%
    let id = BytesN::from_array(&f.env, &[20u8; 32]);
    f.env.ledger().with_mut(|l| { l.timestamp = 1_000_000; });
    f.contract.create(
        &f.buyer, &f.merchant, &f.token,
        &10_000_000_i128, &(30 * DAY), &0, &0, &id,
    );
    let exp = f.env.ledger().sequence() + 100_000;
    f.sac_user.approve(&f.buyer, &f.contract.address, &100_000_000_i128, &exp);

    let merch_before = f.sac_user.balance(&f.merchant);
    let plat_before = f.sac_user.balance(&f.platform);
    let buyer_before = f.sac_user.balance(&f.buyer);

    f.contract.autocharge(&id);

    let fee = 10_000_000_i128 * 297 / 10_000; // 297_000
    assert_eq!(f.sac_user.balance(&f.merchant), merch_before + 10_000_000 - fee);
    assert_eq!(f.sac_user.balance(&f.platform), plat_before + fee);
    assert_eq!(f.sac_user.balance(&f.buyer), buyer_before - 10_000_000);
    // Whole amount (merchant leg + fee leg) is debited from the one allowance.
    assert_eq!(f.sac_user.allowance(&f.buyer, &f.contract.address), 90_000_000);
}

#[test]
fn autocharge_attested_splits_platform_fee() {
    // The attested (integrity-gated) path captures the fee too — this is the
    // path that monetizes the proof: a fee on every charge that only settles
    // with a fresh, valid integrity attestation.
    let f = setup_with_fee(297);
    let id_arr = [21u8; 32];
    let id = BytesN::from_array(&f.env, &id_arr);
    f.env.ledger().with_mut(|l| { l.timestamp = 1_000_000; });
    f.contract.create(&f.buyer, &f.merchant, &f.token, &10_000_000_i128, &(30 * DAY), &0, &0, &id);
    let exp = f.env.ledger().sequence() + 100_000;
    f.sac_user.approve(&f.buyer, &f.contract.address, &100_000_000_i128, &exp);

    let not_after = 2_000_000u64;
    let (pk, sig) = sign_attestation(&TEST_DOMAIN, &[1u8; 32], &id_arr, 0, not_after);
    f.contract.set_attester(&id, &BytesN::from_array(&f.env, &pk));

    let merch_before = f.sac_user.balance(&f.merchant);
    let plat_before = f.sac_user.balance(&f.platform);
    f.contract.autocharge_attested(&id, &not_after, &BytesN::from_array(&f.env, &sig));

    let fee = 10_000_000_i128 * 297 / 10_000;
    assert_eq!(f.sac_user.balance(&f.merchant), merch_before + 10_000_000 - fee);
    assert_eq!(f.sac_user.balance(&f.platform), plat_before + fee);
}

#[test]
#[should_panic]
fn constructor_rejects_excessive_fee_bps() {
    // fee_bps is capped at 1000 (10%); deploying with more must fail.
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let platform = Address::generate(&env);
    let _ = env.register(SubscriptionContract, (platform, 1001u32));
}

#[test]
fn max_periods_caps_charges() {
    let f = setup();
    let id = BytesN::from_array(&f.env, &[2u8; 32]);

    f.env.ledger().with_mut(|l| { l.timestamp = 1_000_000; });

    f.contract.create(
        &f.buyer, &f.merchant, &f.token,
        &1_000_000_i128, &(7 * DAY), &3, &0, &id,
    );

    // 3 successful charges, then expiry.
    f.contract.charge(&id);
    f.env.ledger().with_mut(|l| { l.timestamp += 7 * DAY; });
    f.contract.charge(&id);
    f.env.ledger().with_mut(|l| { l.timestamp += 7 * DAY; });
    f.contract.charge(&id);

    let sub = f.contract.get(&id);
    assert_eq!(sub.charges_done, 3);
    assert_eq!(sub.status, Status::Expired);

    // Fourth charge fails.
    f.env.ledger().with_mut(|l| { l.timestamp += 7 * DAY; });
    let res = f.contract.try_charge(&id);
    assert!(res.is_err());
}

#[test]
fn pause_blocks_charge_then_resume_unblocks() {
    let f = setup();
    let id = BytesN::from_array(&f.env, &[3u8; 32]);

    f.env.ledger().with_mut(|l| { l.timestamp = 1_000_000; });
    f.contract.create(
        &f.buyer, &f.merchant, &f.token,
        &500_000_i128, &(14 * DAY), &0, &0, &id,
    );

    f.contract.charge(&id);

    // Merchant pauses.
    f.contract.pause(&id);
    f.env.ledger().with_mut(|l| { l.timestamp += 14 * DAY; });
    let res = f.contract.try_charge(&id);
    assert!(res.is_err());

    // Merchant resumes; charge succeeds again.
    f.contract.resume(&id);
    f.contract.charge(&id);
    let sub = f.contract.get(&id);
    assert_eq!(sub.charges_done, 2);
}

#[test]
fn expiry_terminates_subscription() {
    let f = setup();
    let id = BytesN::from_array(&f.env, &[4u8; 32]);
    f.env.ledger().with_mut(|l| { l.timestamp = 1_000_000; });

    let expires_at = 1_000_000 + 10 * DAY;
    f.contract.create(
        &f.buyer, &f.merchant, &f.token,
        &100_000_i128, &(2 * DAY), &0, &expires_at, &id,
    );

    f.contract.charge(&id);
    f.env.ledger().with_mut(|l| { l.timestamp = expires_at + 1; });

    // charge() panics with Expired but cannot persist status (panic reverts).
    let res = f.contract.try_charge(&id);
    assert!(res.is_err());

    // Sub status remains Active in storage; explicit mark_expired() persists.
    let changed = f.contract.mark_expired(&id);
    assert!(changed);
    let sub = f.contract.get(&id);
    assert_eq!(sub.status, Status::Expired);

    // mark_expired is idempotent.
    assert!(!f.contract.mark_expired(&id));
}

#[test]
fn charge_auth_binds_to_transfer_tuple() {
    // SOROBAN_SECURITY_v1 N3 (escalation of audit-002 F5):
    // buyer.require_auth_for_args at charge() binds the buyer's signed
    // payload to (id, token, merchant, amount). A wallet that signs the
    // wrong amount — even if the rest of the auth tree is correct — must
    // be rejected at the host level before token.transfer is reached.
    //
    // This test does NOT prove wallet UIs render the amount; that's the
    // mainnet sign-off step (real wallet, testnet charge). It proves the
    // contract-side binding is in place so a wallet bug cannot let a
    // mutated nested transfer payload succeed under a "looks-correct"
    // top-level sig.
    let f = setup();
    let id = BytesN::from_array(&f.env, &[7u8; 32]);

    f.env.ledger().with_mut(|l| { l.timestamp = 1_000_000; });

    // Create remains under the permissive env mock.
    let amount: i128 = 10_000_000;
    f.contract.create(
        &f.buyer, &f.merchant, &f.token,
        &amount, &(30 * DAY), &0, &0, &id,
    );

    // Strict auth: wrong amount in the signed payload — must reject.
    let bad_args = (
        id.clone(),
        f.token.clone(),
        f.merchant.clone(),
        amount + 1,
    ).into_val(&f.env);
    let res = f.contract
        .mock_auths(&[MockAuth {
            address: &f.buyer,
            invoke: &MockAuthInvoke {
                contract: &f.contract.address,
                fn_name: "charge",
                args: bad_args,
                sub_invokes: &[MockAuthInvoke {
                    contract: &f.token,
                    fn_name: "transfer",
                    args: (
                        f.buyer.clone(),
                        f.merchant.clone(),
                        amount,
                    ).into_val(&f.env),
                    sub_invokes: &[],
                }],
            },
        }])
        .try_charge(&id);
    assert!(res.is_err(), "auth bound to wrong amount must reject");

    // Strict auth: correct (id, token, merchant, amount) tuple + nested
    // transfer sub-invocation — must succeed.
    let good_args = (
        id.clone(),
        f.token.clone(),
        f.merchant.clone(),
        amount,
    ).into_val(&f.env);
    f.contract
        .mock_auths(&[MockAuth {
            address: &f.buyer,
            invoke: &MockAuthInvoke {
                contract: &f.contract.address,
                fn_name: "charge",
                args: good_args,
                sub_invokes: &[MockAuthInvoke {
                    contract: &f.token,
                    fn_name: "transfer",
                    args: (
                        f.buyer.clone(),
                        f.merchant.clone(),
                        amount,
                    ).into_val(&f.env),
                    sub_invokes: &[],
                }],
            },
        }])
        .charge(&id);

    let sub = f.contract.get(&id);
    assert_eq!(sub.charges_done, 1);
}

#[test]
fn invalid_config_rejected() {
    let f = setup();
    let id = BytesN::from_array(&f.env, &[5u8; 32]);
    let res = f.contract.try_create(
        &f.buyer, &f.merchant, &f.token,
        &0_i128, &(30 * DAY), &0, &0, &id,
    );
    assert!(res.is_err());

    let id2 = BytesN::from_array(&f.env, &[6u8; 32]);
    let res2 = f.contract.try_create(
        &f.buyer, &f.merchant, &f.token,
        &1_000_i128, &(60), &0, &0, &id2, // period < 1 day
    );
    assert!(res2.is_err());
}
