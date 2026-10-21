# Fee Arithmetic and Rounding Specification

This specification formalizes the canonical arithmetic, rounding direction,
persisted ledger identities, and overpayment policy for SlipPay platform fees.

Every implementation in this repository—the API routes, the payment matcher,
the Solana client SDK, and the Soroban checkout contract—must conform to
the rules defined here.

---

## 1. Rate Unit and Bounds

Platform fees are denominated in **basis points** (`bp`):

$$\text{1 bp} = 0.01\% = 10^{-4} = 0.0001$$

### Defined Bounds

| Constant / Bound | Value | Percentage | Enforcement Location |
|---|---|---|---|
| **Minimum Rate** | `0 bp` | 0.00% | `orders.platform_fee_bp >= 0` CHECK constraint |
| **Default Rate** | `297 bp` | 2.97% | `DEFAULT_PLATFORM_FEE_BP` in `@slippay/shared` |
| **Merchant Config Max** | `1000 bp` | 10.00% | `orders_platform_fee_bp_check` DB constraint |
| **Protocol Hard Ceiling** | `10000 bp` | 100.00% | Smart contract constructor (`CheckoutError::BadConfig`) |

* **Per-Merchant Override:** The fee rate is stored on `merchants.platform_fee_bp` and defaults to `297` (`DEFAULT_PLATFORM_FEE_BP`).
* **Order Snapshot:** When an order is created, `orders.platform_fee_bp` snapshots the merchant's current fee rate, making the fee for that order immutable.

---

## 2. Canonical Fee Formula

Fee math is executed in **integer base units** (Stellar stroops, Solana lamport-equivalents, or Soroban integer units) to eliminate IEEE-754 floating-point inaccuracies.

### The Equations

Given:
* $\text{gross}$ = Total amount authorized/paid by the buyer in integer base units ($10^7$ stroops for Stellar USDC, $10^6$ units for Solana USDC).
* $\text{fee\_bp}$ = Fee rate in basis points ($0 \le \text{fee\_bp} \le 10000$).

The platform fee is:

$$\text{fee} = \left\lfloor \frac{\text{gross} \times \text{fee\_bp}}{10000} \right\rfloor$$

The merchant net share is:

$$\text{net} = \text{gross} - \text{fee}$$

---

## 3. The Fundamental Accounting Identity

The two splits must always sum to the gross amount:

$$\text{net} + \text{fee} \equiv \text{gross}$$

### Conservation of Funds
* **Zero Dust Variance:** No base units are created or lost during the split.
* **Never calculate net independently via division:** Computing $\text{net} = \lfloor \text{gross} \times (10000 - \text{fee\_bp}) / 10000 \rfloor$ produces a 1-unit dust mismatch when division is inexact ($\text{net} + \text{fee} = \text{gross} - 1$). The net share **must** always be derived as $\text{gross} - \text{fee}$.

---

## 4. Rounding Direction and Beneficiary

* **Rounding Direction:** Integer floor division ($\lfloor \cdot \rfloor$), truncating towards zero.
* **Beneficiary:** **The Merchant.**
* **Dust Policy:** Any remainder $r = (\text{gross} \times \text{fee\_bp}) \pmod{10000}$ that cannot be evenly divided is discarded from the platform fee. The platform fee rounds down; the merchant retains the fractional dust.
* **Guarantee:** SlipPay never overcharges the merchant beyond the mathematically contracted fee.

---

## 5. Persisted Columns and Ledger Identities

In the database schema (`orders` table), amounts are persisted with exact decimal scale:

```
               [ Buyer Pays Gross ]
                  (usdc_amount)
                        |
        +---------------+---------------+
        |                               |
        v                               v
[ Merchant Net Share ]         [ SlipPay Platform Fee ]
(usdc_amount - fee_usdc)              (fee_usdc)
```

| Table Column | SQL Type | Description | Invariant Constraint |
|---|---|---|---|
| `usdc_amount` | `numeric(20,7)` | Total gross USDC paid by buyer | `usdc_amount > 0` |
| `platform_fee_bp` | `integer` | Snapshot of fee basis points | `0 <= platform_fee_bp <= 1000` |
| `fee_usdc` | `numeric(20,7)` | Calculated platform fee | `fee_usdc >= 0`, `scale <= 7` |

**Persisted Ledger Rule:**
$$\text{merchant\_net} = \text{orders.usdc\_amount} - \text{orders.fee\_usdc}$$

---

## 6. Overpayment and Underpayment Policy

### Overpayment (`received > expected`)
When a payer sends more than the expected amount (e.g., duplicate submission, transposed digits, or estimation buffer):
1. **Order State:** Marked as `paid` if $\text{received} \ge \text{expected}$.
2. **Surplus Ledger:** The surplus amount $\text{surplus} = \text{received} - \text{expected}$ must be computed and recorded.
3. **Alert Threshold:** Any surplus exceeding operational limits triggers an alert for reconciliation.
4. **Settlement Disposition:** The excess funds reside at the merchant's destination address (non-custodial). The merchant ledger credits the surplus.

### Underpayment (`received < expected`)
* Any transaction where $\text{received} < \text{expected}$ (even by 1 stroop / base unit) is marked `underpaid`.
* Floating-point comparisons must never be used to evaluate payment adequacy.

---

## 7. Worked Examples and Vectors

### Vector 1: Standard Exact Settlement
* **Gross:** `100.0000000 USDC` ($1,000,000,000$ stroops)
* **Fee Rate:** `297 bp` (2.97%)
* $\text{fee} = \lfloor 1,000,000,000 \times 297 / 10,000 \rfloor = 29,700,000 \text{ stroops}$ (`2.9700000 USDC`)
* $\text{net} = 1,000,000,000 - 29,700,000 = 970,300,000 \text{ stroops}$ (`97.0300000 USDC`)
* **Sum Check:** $970,300,000 + 29,700,000 = 1,000,000,000 \text{ stroops}$ (`100.0000000 USDC`) $\checkmark$

### Vector 2: Inexact Division (Fractional Remainder)
* **Gross:** `1.0000001 USDC` ($10,000,001$ stroops)
* **Fee Rate:** `297 bp` (2.97%)
* Raw product: $10,000,001 \times 297 = 2,970,000,297$
* $\text{fee} = \lfloor 2,970,000,297 / 10,000 \rfloor = 297,000 \text{ stroops}$ (`0.0297000 USDC`)
* Remainder: $297 / 10,000 = 0.0297 \text{ stroops}$ (discarded from fee)
* $\text{net} = 10,000,001 - 297,000 = 9,703,001 \text{ stroops}$ (`0.9703001 USDC`)
* **Sum Check:** $9,703,001 + 297,000 = 10,000,001 \text{ stroops}$ $\checkmark$
* *Note: The 0.0297 stroop remainder stays with the merchant.*

### Vector 3: Sub-Cent / Micro-Payment
* **Gross:** `0.0000001 USDC` ($1$ stroop)
* **Fee Rate:** `297 bp`
* $\text{fee} = \lfloor 1 \times 297 / 10,000 \rfloor = 0 \text{ stroops}$
* $\text{net} = 1 - 0 = 1 \text{ stroop}$
* **Sum Check:** $1 + 0 = 1 \text{ stroop}$ $\checkmark$

### Vector 4: Zero-Fee Account
* **Gross:** `50.0000000 USDC` ($500,000,000$ stroops)
* **Fee Rate:** `0 bp`
* $\text{fee} = 0 \text{ stroops}$
* $\text{net} = 500,000,000 \text{ stroops}$ (`50.0000000 USDC`)
* **Sum Check:** $500,000,000 + 0 = 500,000,000 \text{ stroops}$ $\checkmark$

---

## 8. Implementation Reference

The following implementations embody this specification:

1. **API Orders Route:** [`supabase/functions/api/routes/orders.ts`](../supabase/functions/api/routes/orders.ts)
   * Snapshots `platform_fee_bp` and computes `fee_usdc`.
2. **Listener Payment Matcher:** [`apps/listener/src/matcher.ts`](../apps/listener/src/matcher.ts)
   * Evaluates on-chain Stellar payment events against expected merchant net stroops.
3. **Solana Client SDK:** [`apps/web/src/lib/chain/solana/usdc.ts`](../apps/web/src/lib/chain/solana/usdc.ts)
   * Implements `splitFee(totalBaseUnits, platformFeeBp)`.
4. **Soroban Smart Contract:** [`contracts/checkout/src/lib.rs`](../contracts/checkout/src/lib.rs)
   * Enforces atomic on-chain fee splitting via SEP-41 token transfers.
