# Fee arithmetic and rounding rule

This document is the canonical specification for how SlipPay computes its platform fee. Every
implementation — the Stellar listener matcher, the Solana client, the on-chain checkout contract,
and the orders API — must agree with this document. The test suite in issue 79 uses the
worked examples below as its acceptance vectors.

## Rate unit

The fee rate is expressed in **basis points** (b). One basis point is one-hundredth of a
percent (1 bp = 0.01%), so 10,000 bp = 100%.

- The rate is an integer in the range **0 ≤ b < 10,000**.
- A negative rate, a non-integer rate, or a rate ≥ 10,000 is invalid. Implementations

must reject such a rate rather than coerce it.

  In the listener this is the `fee_bp_invalid` ignore reason; in the Solana client it throws ``invalid_fee_bp``;

  in the contract the constructor rejects `fee_bps > 10_000`.

### Defined Bounds

| Constant / Bound | Value | Percentage | Enforcement Location |
|---|---|---|---|
| **Minimum Rate** | `0 bp` | 0.00% | `orders.platform_fee_bp >= 0` CHECK constraint |
| **Default Rate** | `297 bp` | 2.97% | `DEFAULT_PLATFORM_FEE_BP` in `@slippay/shared` |
| **Merchant Config Max** | `1000 bp` | 10.00% | `orders_platform_fee_bp_check` DB constraint |
| **Protocol Hard Ceiling** | `10000 bp` | 100.00% | Smart contract constructor (`CheckoutError::BadConfig`) |

* **Per-Merchant Override:** The fee rate is stored on `merchants.platform_fee_bp` and defaults to `297` (`DEFAULT_PLATFORM_FEE_BP`).
* **Order Snapshot:** When an order is created, `orders.platform_fee_bp` snapshots the merchant's current fee rate, making the fee for that order immutable.

## Formula

Given a gross amount `G` (in the smallest integer unit of the asset — stroops for Stellar

USDC, 6-decimal base units for Solana USDC, and the token's base unit on Soroban) and a
rate `b` in basis-points:

```
fee      = floor(G * b / 10,000)
net      = G - fee
```

The formula is evaluated in **integer arithmetic** only. No floating-point is permitted at
the money boundary. Implementations use `BigInt` (TypeScript) or `i128` (Soroban) so that
the product `G * b` cannot overflow for any realistic amount.

## Rounding direction and who bears it

The fee is **truncated toward zero** (floor for non-negative amounts). The remainder of an
inexact division is retained by the **merchant**. In other words, the fee is always the
largest integer not exceeding the mathematically exact fee, and the merchant never receives
less than the exact net rounded down. This is conservative for the merchant and cannot produce
dust: the two legs always sum to the gross amount exactly.

```net + fee = G  (always, exactly)
```

The remainder of an inexact division is at most 9,000 basis-point-units of the gross
denominator (that is, less than one basis-point of `G — at most 9999/10000 of a basis
point), so it is always sub-cent and never accumulates into a visible amount on a single
payment.

### Conservation of Funds
* **Zero Dust Variance:** No base units are created or lost during the split.
* **Never calculate net independently via division:** Computing $\text{net} = \lfloor \text{gross} \times (10000 - \text{fee\_bp}) / 10000 \rfloor$ produces a 1-unit dust mismatch when division is inexact ($\text{net} + \text{fee} = \text{gross} - 1$). The net share **must** always be derived as $\text{gross} - \text{fee}$.

## Persisted columns and identities

When an order is settled, the following values are persisted in the `orders` table. They
identity must hold for every paid order:

| column            | meaning                                         |
||-------------------|--------------------------------------------------------------|
| `usdc_amount`    | gross amount `G` the payer is charged (decimal string)          |
| `platform_fee_bp` | the rate `b` applied to this order (integer)                |
| `net_amount`      | merchant share, `G - fee`                                   |
| `fee_amount`      | platform share, `floor(G * b / 10,000)`                       |

The identity `net_amount + fee_amount = usdc_amount` is invariant and is asserted by the
test suite. Amounts are stored as decimal strings at the asset's native precision
(7 fractional digits for Stellar USDC, 6 for Solana USDC, the token's decimals for Soroban)
and compared as integers.

## Overpayment policy

An overpayment is any payment whose received amount is greater than or equal to the
expected merchant share. The order is considered **paid** and the excess is not refunded
automatically; it is reconciled out of band by the operator (issue 74). The fee is computed
against the order's gross amount, *not* against the received amount, so an overpayment
does not inflate the fee.

An underpayment is any payment whose received amount is strictly less than the expected
merchant share. The order is marked `underpaid` and the expected and received amounts are
recorded for reconciliation.

## Worked examples

All examples use a rate of `b = 100` (1.00%) unless noted otherwise. Amounts are shown in
the asset's human decimal form and in its base unit.

### Example 1 — exact division (Stellar, 7 dp)

- Gross: `10.0000000` USDC = `100_000_000` stroops

- Rate: `100` bp

- Fee: `floor(100_000_000 * 100 / 10000) = 1_000_000` stroops = `1.0000000` USDC

- Net: `10_000_000` stroops = `9.0000000` USDC

- Identity: `9.0000000 + 1.0000000 = 10.0000000` ✓

### Example 2 — inexact division, remainder to merchant (Stellar, 7 dp)

- Gross: `0.0000001` USDC = `1` stroop

- Rate: `100` bp

- Exact fee: `1 * 100 / 10000 = 0.01` stroop

- Fee: `floor(0.01) = 0` stroops

- Net: `1 - 0 = 1` stroop = `0.0000001` USDC, so the merchant keeps the remainder

- Identity: `0.0000001 + 0.0000000 = 0.0000001` ✓

### Example 3 — inexact division, remainder to merchant (Stellar, 7 dp)

- Gross: `12.3456789` USDC = `123_445_6789` stroops

- Rate: `100` b`

- Exact fee: `123_445_6789 * 100 / 10_000 = 1_234_456.789` stroops

- Fee: `floor(1234456.789) = 1_234_456` stroops = `0.1234560` USDC, remainder `0.789`

  stroops retained by the merchant

- Net: `123_445_6789 - 1_234_456 = 122_211_2333` stroops = `12.2211233` USDC

- Identity: `12.2211233 + 0.1234560 = 12.3456789` ✓

### Example 4 — inexact division (Solana, 6 dp)

- Gross: `12.500000` USDC = `12_300_000` units

- Rate: `100` b`

- Exact fee: `12_300_000 * 100 / 10_000 = 123_000` units (exact)

- Fee: `123_000` units = `0.123000` USDC

- Net: `12_177_000` units = `12.177000` USDC, so the merchant keeps the remainder

- Identity: `12.177000 + 0.123000 = 12.500000` ✓

### Example 5 — inexact division (Solana, 6 dp)

- Gross: `0.000001` USDC = `1` unit

- Rate: `100` bp

- Exact fee: `1 * 100 / 10_000 = 0.01` units

- Fee: `floor(0.01) = 0` units

- Net: `1` unit = `0.000001` USDC, remainder retained by the merchant

- Identity: `0.000001 + 0.000000 = 0.000001` ✓

### Example 6 — zero rate

- Gross: `100.0000000` USDC = `1_000_000_000` stroops

- Rate: `0` b`

- Fee: `0` stroops

- Net: `1_000_000_000` stroops = `100.0000000` USDC, merchant keeps everything

- Identity: `100.0000000 + 0.0000000 = 100.0000000` ✓

### Example 7 — overpayment

- Order gross: `10.0000000` USDC = `100_000_000` stroops

- Rate: `100` b`

- Expected merchant share: `9.0000000` USDC = `90_000_000` stroops

- Received: `10.5000000` USDC = `105_000_000` stroops

- Outcome: `paid` (any received ≥ share is paid); the excess `0.5000000` USDC is reconciled

  out of band (issue 74). The fee is computed from the order gross, not the received amount.

### Example 8 — underpayment

- Order gross: `10.0000000` USDC = `100_000_000` stroops

- Rate: `100` b`

- Expected merchant share: `9.0000000` USDC = `90_000_000` stroops

- Received: `8.9999999` USDC = `89_999_999` stroops

- Outcome: `underpaid`; expected `9.0000000`, received `8.9999999`. The order is not

  settled and is recorded for reconciliation.

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

## Implementation map

Each implementation cites this document as its source of truth:

- `apps/listener/src/matcher.ts` — Stellar matcher (BigInt stroops)

- `apps/web/src/lib/chain/solana/usdc.ts` — Solana client (BigInt base units)

- `contracts/checkout/src/lib.rs` — on-chain checkout contract (i128 base units)

- `src/routes/orders.ts` — orders API (creation and persistence)

The merchant-facing API reference links here for the definitive rule on fees and

overpayment.