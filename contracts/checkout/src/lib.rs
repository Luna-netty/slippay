#![no_std]
//! SlipPay Checkout — the "Stripe of stablecoin" revenue primitive.
//!
//! A single, atomic payment that splits on-chain: the merchant receives the net,
//! SlipPay receives its fee — and the fee is INESCAPABLE. The fee recipient and
//! basis points are fixed at deploy (constructor) and read from instance storage on
//! every pay; the caller cannot route around them. Either both legs settle or none does.
//!
//! # Canonical Fee Specification
//! This contract is the authoritative on-chain implementation of the fee arithmetic
//! formalised in `docs/fees.md`. Integrators and merchants should refer to that document
//! for the complete repository-wide accounting identities.
//!
//! # Fee Arithmetic and Rounding
//! - **Rate Unit & Range:** `fee_bps` is denominated in basis points (1 bp = 0.01% = 0.0001).
//!   The legal range is `0 <= fee_bps <= 10_000` (0% to 100%). Deployments with `fee_bps > 10_000`
//!   panic with `Error::BadConfig` at construction time.
//! - **The Equations:**
//!   ```text
//!   fee = amount * fee_bps / 10_000
//!   net = amount - fee
//!   ```
//! - **Rounding Direction:** Integer division truncates towards zero (floor division). Any
//!   fractional remainder `r = (amount * fee_bps) % 10_000` is discarded from the fee and
//!   remains with the merchant. Thus, inexact division favours the merchant by up to 1 base
//!   unit (stroop). SlipPay never overcharges the agreed fee rate.
//! - **Conservation Identity:** `net + fee == amount` holds identically for all amounts.
//!   Zero dust variance is created or lost.
//!
//! # Edge Cases & Behaviors
//! - **Zero Fee / Micro-Payments (`fee == 0`):** When `amount * fee_bps < 10_000` (e.g., small
//!   micro-payments or `fee_bps == 0`), `fee` rounds down to 0 and `net == amount`. The second
//!   transfer to `fee_to` is skipped entirely (`if fee > 0`), executing only a single atomic
//!   transfer to the merchant.
//! - **Zero Net (`net == 0`):** If `fee_bps == 10_000` (100% take), `fee == amount` and `net == 0`.
//!   The merchant receives a valid 0-amount SEP-41 transfer, and the fee recipient receives the entire charge.
//! - **Invalid Amounts:** Charges with `amount <= 0` panic with `Error::BadAmount`.
//!
//! # Atomicity & Token Revert Guarantee
//! The payer authorizes the transaction once via `from.require_auth()`. Both nested SEP-41
//! transfers (`client.transfer`) execute within a single Soroban invocation. If either leg fails
//! (e.g., insufficient balance, missing allowance, or invalid token contract), Soroban rolls back
//! the entire transaction atomically; funds never move partially.
//!
//! # Mapping to Off-Chain Ledger
//! The on-chain integer split `amount - fee` mirrors the off-chain `orders.usdc_amount - orders.fee_usdc`
//! ledger equation persisted by the API routes (`supabase/functions/api/routes/orders.ts`).
//!
//! # Deployed Instances
//! - **Testnet:** `CBO2COBZUTHH4II4JCQRZVO4RKDUIUH4MXZTAWOYVUZIVYI47UIDQCWQ` (`fee_bps = 300`, deployed 2026-06-05)
//! - **Mainnet:** Pending deployment with canonical `DEFAULT_PLATFORM_FEE_BP = 297` (2.97%).

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env, Symbol};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    BadConfig = 1,
    BadAmount = 2,
}

#[contracttype]
enum DataKey {
    FeeTo,
    FeeBps,
}

#[contract]
pub struct Checkout;

#[contractimpl]
impl Checkout {
    /// Set the SlipPay fee recipient + basis points once, at deploy. Immutable.
    ///
    /// # Invariants
    /// - Rejects `fee_bps > 10_000` with `Error::BadConfig`.
    /// - Writes immutable `FeeTo` and `FeeBps` to instance storage.
    pub fn __constructor(env: Env, fee_to: Address, fee_bps: u32) {
        if fee_bps > 10_000 {
            panic_with(&env, Error::BadConfig);
        }
        env.storage().instance().set(&DataKey::FeeTo, &fee_to);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
    }

    /// One charge → two atomic transfers: net to merchant, fee to SlipPay.
    ///
    /// # Semantics & Atomicity
    /// - Rejects `amount <= 0` with `Error::BadAmount`.
    /// - Calculates `fee = amount * fee_bps / 10_000` (truncates towards zero; dust favours merchant).
    /// - Derives `net = amount - fee` guaranteeing `net + fee == amount`.
    /// - Transfers `net` to `merchant`.
    /// - If `fee > 0`, transfers `fee` to `fee_to`. If `fee == 0`, second transfer is omitted.
    /// - Emits event `checkout_paid` with payload `(merchant, amount, net, fee)`.
    /// - Returns the captured `fee`.
    pub fn pay(env: Env, from: Address, merchant: Address, token: Address, amount: i128) -> i128 {
        from.require_auth();
        if amount <= 0 {
            panic_with(&env, Error::BadAmount);
        }

        let fee_to: Address = env.storage().instance().get(&DataKey::FeeTo)
            .unwrap_or_else(|| panic_with(&env, Error::BadConfig));
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps)
            .unwrap_or_else(|| panic_with(&env, Error::BadConfig));

        let fee: i128 = amount * (fee_bps as i128) / 10_000;
        let net: i128 = amount - fee;

        let client = token::Client::new(&env, &token);
        client.transfer(&from, &merchant, &net);
        if fee > 0 {
            client.transfer(&from, &fee_to, &fee);
        }

        env.events().publish(
            (Symbol::new(&env, "checkout_paid"), from),
            (merchant, amount, net, fee),
        );
        fee
    }

    pub fn fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
    }
    pub fn fee_to(env: Env) -> Address {
        env.storage().instance().get(&DataKey::FeeTo).unwrap()
    }
}

fn panic_with(env: &Env, e: Error) -> ! {
    soroban_sdk::panic_with_error!(env, e)
}
