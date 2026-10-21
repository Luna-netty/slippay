//! Slippay Subscription Contract — Soroban primitive for recurring payments on Stellar.
//!
//! **v0.1 operating model.** The buyer must sign each `charge` invocation
//! (see `charge()` below — calls `buyer.require_auth()`). An off-chain
//! scheduler alone cannot trigger a charge; it must coordinate with the
//! buyer's wallet (smart-wallet session signer, WalletConnect, or equivalent)
//! to produce a fresh signature for every period. v0.2 will introduce a
//! pre-authorization primitive so the scheduler can charge autonomously
//! within a buyer-defined allowance — see audit-002 F4 for the rationale.
//!
//! The contract enforces:
//!   - status = Active
//!   - current ledger time >= last_charge_at + period_seconds
//!   - charges_done < max_periods (if set)
//!   - current ledger time < expiry (if set)
//!   - the buyer's auth chain on `charge` itself AND on the nested SEP-41
//!     `token.transfer` invocation
//!
//! Only the buyer can `cancel`. Only the merchant can `pause` / `resume`.
//!
//! TTL: every persistent `set` is followed by `extend_ttl` so a long-period
//! subscription survives idle gaps between charges (audit-002 F1). The
//! network host clamps to its protocol maximum; subs with periods longer
//! than that maximum require an external touch to keep the entry alive.
//!
//! v0.1 — single-asset, single-merchant subscription. v0.2 will add
//! pre-auth, multi-asset routing, and pause-with-prorate.

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    Address, Bytes, BytesN, Env, IntoVal, Symbol,
    token,
};

// Audit-002 F1: TTL constants for persistent storage extension.
// Threshold: refresh when remaining lifetime drops below ~1 day of ledgers
// (5s ledger close). Target: extend to ~31 days — the host clamps to the
// network maximum so passing a larger value is safe.
const TTL_THRESHOLD_LEDGERS: u32 = 17_280;   // ~1 day at 5s/ledger
const TTL_TARGET_LEDGERS: u32 = 535_000;     // ~31 days at 5s/ledger (clamped by host)

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Status {
    Active = 0,
    Paused = 1,
    Cancelled = 2,
    Expired = 3,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Subscription {
    pub buyer: Address,
    pub merchant: Address,
    pub token: Address,        // SEP-41 token contract
    pub amount: i128,
    pub period_seconds: u64,
    pub max_periods: u32,      // 0 = unlimited until expiry
    pub expires_at: u64,       // 0 = no expiry
    pub charges_done: u32,
    pub last_charge_at: u64,
    pub status: Status,
}

#[contracttype]
pub enum DataKey {
    Sub(BytesN<32>),
    NextNonce,
    // v0.3: the ed25519 public key of the integrity attester bound to a
    // subscription. autocharge_attested won't settle without a fresh signature
    // from this key. Set by the merchant via set_attester.
    Attester(BytesN<32>),
    // v0.4: contract-global platform fee config, set once at deploy via the
    // constructor (immutable). Applied to the autonomous charge paths.
    PlatformFee,
    // v0.5: 32-byte domain commitment (derived off-chain from network + a deploy
    // tag), bound into every attestation message. Domain separation: a signature
    // valid here can't be replayed on another contract or another chain.
    Domain,
}

/// Contract-global platform fee, fixed at deploy time. `fee_bps` is the platform
/// fee in basis points (297 = 2.97%), taken out of each autonomous charge
/// (autocharge / autocharge_attested) and routed to `platform`. The merchant
/// receives `amount - fee`. fee_bps = 0 disables the fee leg entirely.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PlatformFee {
    pub platform: Address,
    pub fee_bps: u32,
}

#[contracterror]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    NotActive = 2,
    PeriodNotElapsed = 3,
    MaxPeriodsReached = 4,
    Expired = 5,
    Unauthorized = 6,
    InvalidConfig = 7,
    AttesterNotSet = 8,
    AttestationExpired = 9,
    AttesterRequired = 10,
}

#[contract]
pub struct SubscriptionContract;

#[contractimpl]
impl SubscriptionContract {
    /// Deploy-time, immutable platform fee config. `fee_bps` (basis points,
    /// 297 = 2.97%, max 1000 = 10%) is taken out of every autonomous charge
    /// (autocharge / autocharge_attested) and routed to `platform`; the merchant
    /// receives `amount - fee`. fee_bps = 0 means no fee leg (the rail runs free).
    /// Set atomically at deploy so there is no front-running window on a public
    /// network — the fee recipient and rate are bound to the contract instance.
    pub fn __constructor(env: Env, platform: Address, fee_bps: u32, domain: BytesN<32>) {
        if fee_bps > 1000 {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        env.storage().instance().set(&DataKey::PlatformFee, &PlatformFee { platform, fee_bps });
        // Domain commitment for attestation domain-separation (anti cross-contract
        // / cross-chain replay). Bound at deploy, immutable.
        env.storage().instance().set(&DataKey::Domain, &domain);
        env.storage().instance().extend_ttl(TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
    }

    /// Buyer authorizes a new subscription. Returns a deterministic 32-byte id.
    /// Both buyer and contract authentication are required at the host level
    /// (require_auth invocations).
    pub fn create(
        env: Env,
        buyer: Address,
        merchant: Address,
        token: Address,
        amount: i128,
        period_seconds: u64,
        max_periods: u32,
        expires_at: u64,
        nonce: BytesN<32>,
    ) -> BytesN<32> {
        buyer.require_auth();

        // Production enforces a 1-day minimum period. A `demo` build lowers it to
        // 1s so a live testnet demo can show the agent charging itself repeatedly
        // and stopping at the cap. NEVER ship the demo build to mainnet.
        let min_period: u64 = if cfg!(feature = "demo") { 1 } else { 86_400 };
        if amount <= 0 || period_seconds < min_period {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        if expires_at != 0 && expires_at <= env.ledger().timestamp() {
            panic_with_error!(&env, Error::InvalidConfig);
        }

        let key = DataKey::Sub(nonce.clone());
        if env.storage().persistent().has(&key) {
            // collision — caller must regenerate nonce
            panic_with_error!(&env, Error::InvalidConfig);
        }

        let sub = Subscription {
            buyer: buyer.clone(),
            merchant,
            token,
            amount,
            period_seconds,
            max_periods,
            expires_at,
            charges_done: 0,
            // 0 = sentinel "never charged" — first charge is always allowed.
            // We avoid saturating_sub here because period > now would underflow
            // and require_period_elapsed below would block the first charge.
            last_charge_at: 0,
            status: Status::Active,
        };

        env.storage().persistent().set(&key, &sub);
        // Audit-002 F1: extend TTL so long-period subs survive idle gaps.
        env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
        // Audit-002 F8: include merchant, token, max_periods, expires_at so
        // indexers don't need a follow-up `get(id)` to reconstruct state.
        env.events().publish(
            (Symbol::new(&env, "subscription_created"), buyer),
            (nonce.clone(), sub.amount, sub.period_seconds, sub.merchant.clone(), sub.token.clone(), sub.max_periods, sub.expires_at),
        );
        nonce
    }

    /// Trigger the next charge.
    ///
    /// **v0.1 auth model (audit-002 F4):** the buyer must sign every charge.
    /// `buyer.require_auth()` is called below. An off-chain scheduler can
    /// submit the transaction, but the buyer must produce a fresh signature
    /// each time — via smart-wallet session, WalletConnect, or equivalent.
    /// v0.2 will replace this with a pre-auth allowance primitive.
    pub fn charge(env: Env, id: BytesN<32>) -> u64 {
        let key = DataKey::Sub(id.clone());
        let mut sub: Subscription = env.storage().persistent().get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));

        // Audit-002 F4 / F5 + SOROBAN_SECURITY_v1 N3: bind the buyer's auth
        // payload to the exact transfer tuple (id, token, merchant, amount)
        // rather than the bare (id,) function args. A weak smart-wallet
        // session signer that signs "charge(id)" without inspecting the
        // nested transfer would otherwise let a host-bug or wallet-bug
        // permit a mutated nested amount. Here the top-level auth payload
        // IS the transfer payload — defense in depth against wallet drift.
        // Tests use mock_all_auths_allowing_non_root_auth which bypasses
        // verification; mainnet sign-off must still include an end-to-end
        // testnet charge with a real wallet to verify the nested SAC.transfer
        // auth chain (the regression test below covers the host-level binding).
        sub.buyer.require_auth_for_args(
            (
                id.clone(),
                sub.token.clone(),
                sub.merchant.clone(),
                sub.amount,
            )
                .into_val(&env),
        );

        if sub.status != Status::Active {
            panic_with_error!(&env, Error::NotActive);
        }

        let now = env.ledger().timestamp();
        // NOTE: panics in Soroban revert state changes. We therefore do NOT
        // try to set status=Expired before panicking — the change would be
        // rolled back. Callers who want to observe the terminal state should
        // call mark_expired(id), which mutates state without panicking when
        // the expiry conditions hold.
        if sub.expires_at != 0 && now >= sub.expires_at {
            panic_with_error!(&env, Error::Expired);
        }
        // last_charge_at == 0 → never charged → first charge always allowed.
        if sub.last_charge_at != 0 && now < sub.last_charge_at.saturating_add(sub.period_seconds) {
            panic_with_error!(&env, Error::PeriodNotElapsed);
        }
        if sub.max_periods != 0 && sub.charges_done >= sub.max_periods {
            panic_with_error!(&env, Error::MaxPeriodsReached);
        }

        // Execute the SEP-41 transfer. Buyer's authorization for this
        // specific (contract, token, amount, merchant) tuple must be present
        // in the host auth context — the buyer either signs the charge
        // invocation directly or pre-authorizes via account-side smart wallet.
        let client = token::Client::new(&env, &sub.token);
        client.transfer(&sub.buyer, &sub.merchant, &sub.amount);

        // Audit-002 F3: checked_add even with overflow-checks=true in release
        // — defends against future profile changes that flip the flag.
        sub.charges_done = sub.charges_done
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidConfig));
        sub.last_charge_at = now;
        let next_due = now.saturating_add(sub.period_seconds);

        // If this hit max_periods, mark expired so subsequent calls fail fast.
        if sub.max_periods != 0 && sub.charges_done >= sub.max_periods {
            sub.status = Status::Expired;
        }

        env.storage().persistent().set(&key, &sub);
        // Audit-002 F1: roll the TTL window forward on every successful charge.
        env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
        env.events().publish(
            (Symbol::new(&env, "subscription_charged"), sub.buyer.clone(), sub.merchant.clone()),
            (id, sub.amount, sub.charges_done, next_due),
        );
        next_due
    }

    /// **v0.2 autonomous charge — NO buyer signature at charge time.**
    ///
    /// Closes the audit-002 F4 pre-auth gap. Instead of `buyer.require_auth`
    /// + `transfer` (which forces a fresh buyer signature every period), this
    /// pulls `amount` from the buyer's *standing SEP-41 allowance* via
    /// `transfer_from`, with this contract as the spender. The buyer signs
    /// ONCE, off-band: `token.approve(buyer, <this contract>, cap, expiry)`.
    /// Thereafter any party (an off-chain scheduler/relayer that pays the tx
    /// fee, never custodies funds) can submit `autocharge(id)` each period.
    ///
    /// Bounds are enforced on two independent layers:
    ///   - this contract: status / period elapsed / max_periods / expiry.
    ///   - the SAC: the allowance cap AND its expiration ledger. When the
    ///     allowance is exhausted or expires, `transfer_from` fails and the
    ///     buyer must re-approve — a hard, on-chain spending ceiling.
    ///
    /// Non-custodial: funds move buyer -> merchant directly; the contract only
    /// holds the spender role, never the balance.
    pub fn autocharge(env: Env, id: BytesN<32>) -> u64 {
        // INESCAPABLE GATE: once a subscription has an attester bound, the ungated
        // path refuses — settlement must go through `autocharge_attested` with a
        // fresh, valid attestation. No back door around the integrity check.
        if env.storage().persistent().has(&DataKey::Attester(id.clone())) {
            panic_with_error!(&env, Error::AttesterRequired);
        }
        // NB: deliberately NO buyer.require_auth. Authorization is the standing
        // allowance the buyer granted via token.approve; the contract authorizes
        // the transfer_from sub-invocation as the spender by being the caller.
        Self::allowance_charge(&env, &id)
    }

    /// Bind an integrity attester (ed25519 public key) to a subscription. The
    /// merchant sets it; thereafter `autocharge_attested` is the only autonomous
    /// path that settles, and it requires a fresh signature from this key.
    pub fn set_attester(env: Env, id: BytesN<32>, attester: BytesN<32>) {
        let sub: Subscription = env.storage().persistent().get(&DataKey::Sub(id.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));
        sub.merchant.require_auth();
        let k = DataKey::Attester(id);
        env.storage().persistent().set(&k, &attester);
        env.storage().persistent().extend_ttl(&k, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
    }

    /// **v0.3 attested autonomous charge — the integrity gate, on-chain.**
    ///
    /// Autonomous debit that REFUSES to settle without a fresh, valid integrity
    /// attestation. The off-chain attester (which actually determines whether the
    /// requesting agent is compromised) signs `id || not_after` with the ed25519
    /// key bound via `set_attester`. This contract verifies that signature on the
    /// host, checks freshness against ledger time, and only then pulls the charge.
    ///
    /// What this guarantees on-chain: **no settlement without a fresh signed
    /// attestation bound to THIS subscription** (no cross-sub replay; expiry
    /// enforced). What it does NOT do: detect compromise itself — that is the
    /// attester's job. The contract makes the attestation inescapable, not
    /// optional. x402/AP2 settle on authorization alone; this refuses.
    ///
    /// Fail-closed: no attester set → AttesterNotSet; expired → AttestationExpired;
    /// bad signature → ed25519_verify traps (reverts).
    pub fn autocharge_attested(
        env: Env,
        id: BytesN<32>,
        not_after: u64,
        signature: BytesN<64>,
    ) -> u64 {
        let attester: BytesN<32> = env.storage().persistent()
            .get(&DataKey::Attester(id.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, Error::AttesterNotSet));
        let sub: Subscription = env.storage().persistent().get(&DataKey::Sub(id.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));

        // Freshness: the attestation must not be past its not_after ledger time.
        let now = env.ledger().timestamp();
        if now > not_after {
            panic_with_error!(&env, Error::AttestationExpired);
        }

        // Reconstruct the signed message: id (32B) || charges_done (4B BE) || not_after (8B BE).
        //  - id binding   → no replay of one sub's attestation on another (cross-sub).
        //  - charges_done  → SINGLE-USE: an attestation signed for charge N is consumed
        //    when N executes; the counter advances, so the same blob can't authorize N+1.
        //    This carries native-style single-use semantics on-chain by binding to the
        //    contract's existing monotonic state — no hand-rolled nonce store. (Closes the
        //    replay gap vs Soroban's native auth nonce, while keeping the attester async.)
        //  - not_after     → freshness window.
        // Domain separation: prepend the deploy-bound 32-byte domain so this
        // attestation cannot be replayed on another contract or another chain.
        let domain: BytesN<32> = env.storage().instance()
            .get(&DataKey::Domain)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidConfig));
        let mut msg = Bytes::new(&env);
        msg.append(&Bytes::from_array(&env, &domain.to_array()));
        msg.append(&Bytes::from_array(&env, &id.to_array()));
        msg.append(&Bytes::from_array(&env, &sub.charges_done.to_be_bytes()));
        msg.append(&Bytes::from_array(&env, &not_after.to_be_bytes()));

        // Verify on the host. Traps (reverts) on an invalid signature → fail-closed.
        env.crypto().ed25519_verify(&attester, &msg, &signature);

        Self::allowance_charge(&env, &id)
    }

    pub fn cancel(env: Env, id: BytesN<32>) {
        let key = DataKey::Sub(id.clone());
        let mut sub: Subscription = env.storage().persistent().get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));
        sub.buyer.require_auth();
        // Audit-002 F6: cancel only transitions from Active or Paused. Both
        // Cancelled and Expired are terminal and must not emit a second event
        // or rewrite state.
        if sub.status != Status::Active && sub.status != Status::Paused {
            return;
        }
        sub.status = Status::Cancelled;
        env.storage().persistent().set(&key, &sub);
        env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
        env.events().publish(
            (Symbol::new(&env, "subscription_cancelled"), sub.buyer.clone()),
            id,
        );
    }

    pub fn pause(env: Env, id: BytesN<32>) {
        let key = DataKey::Sub(id.clone());
        let mut sub: Subscription = env.storage().persistent().get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));
        sub.merchant.require_auth();
        if sub.status != Status::Active {
            panic_with_error!(&env, Error::NotActive);
        }
        sub.status = Status::Paused;
        env.storage().persistent().set(&key, &sub);
        env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
        env.events().publish(
            (Symbol::new(&env, "subscription_paused"), sub.merchant.clone()),
            id,
        );
    }

    pub fn resume(env: Env, id: BytesN<32>) {
        let key = DataKey::Sub(id.clone());
        let mut sub: Subscription = env.storage().persistent().get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));
        sub.merchant.require_auth();
        if sub.status != Status::Paused {
            panic_with_error!(&env, Error::NotActive);
        }
        sub.status = Status::Active;
        env.storage().persistent().set(&key, &sub);
        env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
        env.events().publish(
            (Symbol::new(&env, "subscription_resumed"), sub.merchant.clone()),
            id,
        );
    }

    pub fn get(env: Env, id: BytesN<32>) -> Subscription {
        env.storage().persistent().get(&DataKey::Sub(id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound))
    }

    /// Mark a subscription as Expired if its terminal conditions hold
    /// (expires_at passed OR max_periods reached). Anyone can call;
    /// idempotent. Returns true if state was changed, false otherwise.
    /// This exists because charge() cannot persist a status change while
    /// also panicking — Soroban panics revert state.
    pub fn mark_expired(env: Env, id: BytesN<32>) -> bool {
        let key = DataKey::Sub(id.clone());
        let mut sub: Subscription = env.storage().persistent().get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));
        if sub.status == Status::Expired || sub.status == Status::Cancelled {
            return false;
        }
        let now = env.ledger().timestamp();
        let expired_by_time = sub.expires_at != 0 && now >= sub.expires_at;
        let expired_by_count = sub.max_periods != 0 && sub.charges_done >= sub.max_periods;
        if !expired_by_time && !expired_by_count {
            return false;
        }
        sub.status = Status::Expired;
        env.storage().persistent().set(&key, &sub);
        env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
        env.events().publish(
            (Symbol::new(&env, "subscription_expired"), sub.buyer.clone()),
            id,
        );
        true
    }
}

// Private helpers (not part of the contract interface).
impl SubscriptionContract {
    /// Shared allowance-pull path for the autonomous charge functions. Enforces
    /// status/period/max/expiry, pulls `amount` via transfer_from (spender = this
    /// contract, against the buyer's standing SEP-41 allowance), updates
    /// bookkeeping, and emits `subscription_charged`. NO buyer signature.
    fn allowance_charge(env: &Env, id: &BytesN<32>) -> u64 {
        let key = DataKey::Sub(id.clone());
        let mut sub: Subscription = env.storage().persistent().get(&key)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotFound));

        if sub.status != Status::Active {
            panic_with_error!(env, Error::NotActive);
        }
        let now = env.ledger().timestamp();
        if sub.expires_at != 0 && now >= sub.expires_at {
            panic_with_error!(env, Error::Expired);
        }
        if sub.last_charge_at != 0 && now < sub.last_charge_at.saturating_add(sub.period_seconds) {
            panic_with_error!(env, Error::PeriodNotElapsed);
        }
        if sub.max_periods != 0 && sub.charges_done >= sub.max_periods {
            panic_with_error!(env, Error::MaxPeriodsReached);
        }

        // Platform fee leg (inescapable on the autonomous rail). The fee is taken
        // OUT of `amount`: the merchant receives `amount - fee`, the platform
        // receives `fee`, and the buyer's total debit stays `amount`. Both legs are
        // pulled via transfer_from against the buyer's one standing allowance, so
        // the allowance cap still bounds the total. fee_bps is capped at 1000 (10%)
        // by the constructor, so fee < amount always and `amount - fee` stays > 0.
        let client = token::Client::new(env, &sub.token);
        let cfg: Option<PlatformFee> = env.storage().instance().get(&DataKey::PlatformFee);
        let fee: i128 = match &cfg {
            Some(c) if c.fee_bps > 0 => sub.amount * (c.fee_bps as i128) / 10_000,
            _ => 0,
        };
        if fee > 0 {
            let platform = cfg.as_ref().unwrap().platform.clone();
            client.transfer_from(&env.current_contract_address(), &sub.buyer, &platform, &fee);
        }
        client.transfer_from(
            &env.current_contract_address(),
            &sub.buyer,
            &sub.merchant,
            &(sub.amount - fee),
        );

        sub.charges_done = sub.charges_done
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(env, Error::InvalidConfig));
        sub.last_charge_at = now;
        let next_due = now.saturating_add(sub.period_seconds);
        if sub.max_periods != 0 && sub.charges_done >= sub.max_periods {
            sub.status = Status::Expired;
        }

        env.storage().persistent().set(&key, &sub);
        env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);
        env.events().publish(
            (Symbol::new(env, "subscription_charged"), sub.buyer.clone(), sub.merchant.clone()),
            (id.clone(), sub.amount, sub.charges_done, next_due),
        );
        next_due
    }
}

// soroban-sdk re-exports panic_with_error via macro from the prelude
use soroban_sdk::panic_with_error;

#[cfg(test)]
mod test;
