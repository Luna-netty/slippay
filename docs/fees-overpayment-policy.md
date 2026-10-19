# Overpayment Policy

## Summary

SlipPay accepts and records overpayments. When a payment arrives with a received amount greater than the order's expected net amount, the order is marked paid and the surplus is persisted against the order. The surplus is never silently discarded.

Overpayment is a normal event: a payer transposing digits, a customer paying twice for the same memo, or a payer estimating a fee. The policy below defines how those cases are handled.

## Policy: accept and record

SlipPay uses the **accept-and-record** policy:

1. The order is marked `paid` when `receivedStroops >= expectedStroops`.
2. The `paid` outcome carries `expected`, `received` and
   `surplus` (in stroops). `surplus = received - expected`.
3. The expected amount, received amount and surplus are persisted
   against the order so the reconciliation surface reflects the
   actual amount received.
4. The surplus is not refunded automatically and is not credited
   automatically. It is recorded and available for a merchant-initiated
   refund or credit decision.
5. A surplus at or above the alert threshold raises an alert,
   because a large surplus usually indicates a duplicate payment or a
   transposed amount.

## Tolerances

Money comparisons use stroops (integers), so there is no floating-point
rounding tolerance in the matcher. The only tolerance is the overpayment
threshold below, which is policy and is recorded here.

The alert threshold is defined as a constant in the matcher
`OVERPAYMENT_ALERT_THRESHOLD_STROOPS`. Any surplus strictly greater than
this threshold raises an alert. A surplus at or below the threshold is
still recorded but does not alert.

## Reference

The policy is implemented in `apps/listener/src/matcher.ts` in the
`matchPaymentToOrder` function. See the `paid` outcome and the
`OVERPAYMENT_ALERT_THRESHOLD_STROOPS` constant there.
