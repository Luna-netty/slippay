//! Slippay Receipt — a verifiable recurring-charge receipt ledger.
//!
//! **What this is.** A tamper-evident hash chain that proves a recurring
//! payment happened and commits to its amount WITHOUT revealing the amount
//! on-chain. It is designed for OFF-CHAIN-settled recurring charges — e.g. a
//! Pix BRL debit — where the money never touches Stellar. For each billing
//! period the recorder publishes one opaque 32-byte `commitment`; the contract
//! chains it into a running `head` (`sha256` over commitment ‖ previous head ‖
//! period index) and stores nothing else about the charge. The amount and the
//! blinding factor are computed and held OFF-CHAIN by the payer/merchant; the
//! contract NEVER sees them.
//!
//! **The product property this enables.** A third party (auditor, the payer, a
//! regulator) who is later handed `(amount, blinding)` for a given period can
//! recompute the commitment and check it against the public chain — proving
//! both that the charge occurred and what its amount was — WITHOUT that amount
//! having ever been visible on-chain to anyone else. This is selective
//! disclosure over an immutable, gap-free, replay-proof ledger.
//!
//! **HONEST scope / privacy limit.** The value is hidden end-to-end ONLY when
//! settlement is off-chain (Pix, ACH, internal ledger). If settlement is an
//! on-chain SAC / SEP-41 `transfer`, the amount LEAKS at the transfer event —
//! that is out of this contract's scope. This contract is the
//! receipt/attestation layer, NOT a confidential-transfer primitive. It makes
//! no cryptographic claim about hiding on-chain transfers, and it does not
//! perform any transfer itself.
//!
//! **Off-chain commitment convention (NOT enforced here).** By convention the
//! caller computes, off-chain:
//!
//! ```text
//! commitment = sha256( amount_i128_be(16) ‖ blinding(32) ‖ mandate_id(32) ‖ period_index_be(4) )
//! ```
//!
//! The contract treats `commitment` as fully OPAQUE — it neither knows nor
//! checks this formula. Opening and verification happen entirely off-chain.
//! Binding (a different amount cannot open the same commitment) and hiding (the
//! commitment reveals nothing about the amount without the blinding) come from
//! sha256 plus a high-entropy `blinding`; the contract relies on, but does not
//! enforce, the caller using a uniformly random 32-byte blinding per period.
//!
//! **Chain layout (enforced here).** For period `i` with stored previous head
//! `prev` (the genesis head is 32 zero bytes):
//!
//! ```text
//! new_head = sha256( commitment(32) ‖ prev(32) ‖ period_index_be(4) )   // 68 bytes
//! ```
//!
//! The three parts are appended in exactly that order. Because each head
//! depends on the previous head, rewriting any past commitment changes every
//! subsequent head — the tamper-evidence property.
//!
//! TTL: every persistent `set` is followed by `extend_ttl`, mirroring the
//! audit-002 F1 pattern from `slippay-subscription`.

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Bytes, BytesN,
    Env, Symbol,
};

// Mirror of slippay-subscription audit-002 F1 TTL constants. The host clamps
// to its protocol maximum so passing a generous target is safe.
const TTL_THRESHOLD_LEDGERS: u32 = 17_280; // ~1 day at 5s/ledger
const TTL_TARGET_LEDGERS: u32 = 535_000; // ~31 days at 5s/ledger (clamped)

/// A recurring-charge mandate: an append-only, gap-free receipt chain keyed by
/// `mandate_id`. `head` is the running chain tip (32 zero bytes before the
/// first `record`); `count` is the number of receipts recorded so far and is
/// also the next expected `period_index`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Mandate {
    /// The only address authorized to append receipts to this mandate.
    pub recorder: Address,
    /// Running chain tip. 32 zero bytes at genesis (count == 0).
    pub head: BytesN<32>,
    /// Number of receipts recorded; also the next expected `period_index`.
    pub count: u32,
}

#[contracttype]
pub enum DataKey {
    /// Mandate state, keyed verbatim by its 32-byte id.
    Mandate(BytesN<32>),
}

#[contracterror]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    /// `open_mandate` called for a `mandate_id` that already exists.
    AlreadyExists = 1,
    /// `record`/`get_*` referenced a `mandate_id` that was never opened.
    NotFound = 2,
    /// `record` called with `period_index != mandate.count` — a gap, a replay,
    /// or an out-of-order append. Enforces strict monotonic, gap-free indexing.
    BadPeriod = 3,
}

#[contract]
pub struct Receipt;

#[contractimpl]
impl Receipt {
    /// Open a new mandate. Requires `recorder`'s authorization. Rejects with
    /// `AlreadyExists` if a mandate with this id already exists. Initializes
    /// `head` to 32 zero bytes and `count` to 0, emits `mandate_opened`, and
    /// extends TTL.
    pub fn open_mandate(env: Env, mandate_id: BytesN<32>, recorder: Address) {
        recorder.require_auth();

        let key = DataKey::Mandate(mandate_id.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::AlreadyExists);
        }

        let mandate = Mandate {
            recorder: recorder.clone(),
            head: BytesN::from_array(&env, &[0u8; 32]),
            count: 0,
        };
        env.storage().persistent().set(&key, &mandate);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);

        env.events()
            .publish((Symbol::new(&env, "mandate_opened"), mandate_id), recorder);
    }

    /// Append one receipt for the next period. Loads the mandate (`NotFound` if
    /// absent), requires the mandate's `recorder` to authorize, and requires
    /// `period_index == mandate.count` (`BadPeriod` otherwise — no gaps, no
    /// replay, no reordering).
    ///
    /// Computes `new_head = sha256( commitment(32) ‖ prev_head(32) ‖
    /// period_index_be(4) )`, stores it, advances `count` to `period_index +
    /// 1`, extends TTL, emits a `receipt` event carrying `(period_index,
    /// commitment, new_head)` — and NO amount, ever — and returns `new_head`.
    ///
    /// `commitment` is OPAQUE to the contract (see module docs for the
    /// off-chain `commitment` formula and the off-chain opening/verification
    /// convention).
    pub fn record(
        env: Env,
        mandate_id: BytesN<32>,
        period_index: u32,
        commitment: BytesN<32>,
    ) -> BytesN<32> {
        let key = DataKey::Mandate(mandate_id.clone());
        let mut mandate: Mandate = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));

        mandate.recorder.require_auth();

        if period_index != mandate.count {
            panic_with_error!(&env, Error::BadPeriod);
        }

        // new_head = sha256( commitment(32) || prev_head(32) || period_index_be(4) )
        let mut buf = Bytes::new(&env);
        buf.append(&Bytes::from_array(&env, &commitment.to_array()));
        buf.append(&Bytes::from_array(&env, &mandate.head.to_array()));
        buf.append(&Bytes::from_array(&env, &period_index.to_be_bytes()));
        let new_head: BytesN<32> = env.crypto().sha256(&buf).into();

        mandate.head = new_head.clone();
        mandate.count = period_index + 1;
        env.storage().persistent().set(&key, &mandate);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_TARGET_LEDGERS);

        env.events().publish(
            (Symbol::new(&env, "receipt"), mandate_id),
            (period_index, commitment, new_head.clone()),
        );

        new_head
    }

    /// Current chain tip for a mandate. Panics `NotFound` if absent.
    pub fn get_head(env: Env, mandate_id: BytesN<32>) -> BytesN<32> {
        Self::load(&env, &mandate_id).head
    }

    /// Number of receipts recorded (also the next expected `period_index`).
    /// Panics `NotFound` if absent.
    pub fn get_count(env: Env, mandate_id: BytesN<32>) -> u32 {
        Self::load(&env, &mandate_id).count
    }

    /// Full mandate record. Panics `NotFound` if absent.
    pub fn get_mandate(env: Env, mandate_id: BytesN<32>) -> Mandate {
        Self::load(&env, &mandate_id)
    }
}

impl Receipt {
    fn load(env: &Env, mandate_id: &BytesN<32>) -> Mandate {
        env.storage()
            .persistent()
            .get(&DataKey::Mandate(mandate_id.clone()))
            .unwrap_or_else(|| panic_with_error!(env, Error::NotFound))
    }
}

#[cfg(test)]
mod test;
