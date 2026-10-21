# SlipPay Checkout — Deployment, Semantics & Proof

The "Stripe of stablecoin" revenue primitive on Soroban. A single customer payment
triggers an atomic split on-chain: net proceeds to the merchant, platform fee to SlipPay.
Fee recipient and rate are immutable, fixed at deploy time via the constructor—making
the fee inescapable.

---

## 1. Contract Specification

* **Source:** [`contracts/checkout/src/lib.rs`](src/lib.rs)
* **Wasm Size:** 5,256 bytes, 4 exported functions:
  * `__constructor(fee_to: Address, fee_bps: u32)`
  * `pay(from: Address, merchant: Address, token: Address, amount: i128) -> i128`
  * `fee_bps() -> u32`
  * `fee_to() -> Address`
* **Canonical Fee Rule:** Authoritative on-chain implementation of [`docs/fees.md`](../../docs/fees.md).

---

## 2. Fee Semantics, Rounding & Limits

| Parameter / Rule | Value / Behavior | Enforcement |
|---|---|---|
| **Rate Unit** | Basis points (`bp`, 1 bp = 0.01% = 0.0001) | Parameter `fee_bps` |
| **Permitted Range** | `0 <= fee_bps <= 10_000` (0% to 100%) | `__constructor` rejects `> 10_000` with `Error::BadConfig` |
| **Formula** | `fee = amount * fee_bps / 10_000`<br>`net = amount - fee` | Integer arithmetic in `i128` |
| **Rounding Direction** | Truncating floor division toward zero | Inexact division remainder discards from fee; favours merchant |
| **Dust Beneficiary** | **Merchant** | Receives up to 1 base unit (stroop) of fractional dust; platform never overcharges |
| **Conservation Identity** | `net + fee == amount` | Always 0 dust variance; no tokens created or trapped |
| **Zero Fee / Micro-Payments** | When `amount * fee_bps < 10_000`, `fee == 0` | Contract omits transfer to `fee_to` (`if fee > 0`), executing single transfer |
| **Zero Net** | When `fee_bps == 10_000`, `net == 0` | Contract executes 0-amount transfer to merchant, full amount to `fee_to` |
| **Invalid Amount** | When `amount <= 0` | Panics with `Error::BadAmount` |
| **Atomicity** | All-or-nothing rollback | Single Soroban invocation with `from.require_auth()`; token failure aborts whole call |
| **Off-Chain Ledger Mapping** | On-chain `amount - fee` mirrors off-chain `orders.usdc_amount - orders.fee_usdc` | Exact decimal correspondence with API persistence |

---

## 3. Testnet Deployment (2026-06-05)

* **Network:** Stellar Testnet (`https://horizon-testnet.stellar.org`)
* **Contract ID:** `CBO2COBZUTHH4II4JCQRZVO4RKDUIUH4MXZTAWOYVUZIVYI47UIDQCWQ`
* **Fee Recipient (`fee_to`):** `GBVMU64N5JK3NICY3ZRPXVW4RQIQFHLBPW5UI4F55KVJPZJS3SIOWJF4` (`slippay-fee`)
* **Configured Fee:** `fee_bps = 300` (3.00%)
* **Token Used in Proof:** Native SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
* **Proof Transaction:**
  * Hash: `e142cd0bbaa19adfe1b74d3629ea7788f06abca8a0ba6ba121e6f41c67390941`
  * Outcome: Buyer paid 10 XLM → Merchant received +9.7 XLM (97%), SlipPay Fee received +0.3 XLM (3%) in a single atomic invocation.

---

## 4. Mainnet Path

* **Planned Deployment:** Same audited contract bytecode.
* **Constructor Parameters:** Mainnet `slippay-fee` address + canonical default `DEFAULT_PLATFORM_FEE_BP = 297` (2.97%) to match off-chain API default.
* **Token:** Circle USDC Stellar Asset Contract (SAC).
* **Payment Flow:** Merchant creates charge (`amount`) → QR encodes `{checkout_contract, merchant, token, amount}` → Payer approves via passkey (`/pay`) → Contract invokes `pay()` with atomic split.
