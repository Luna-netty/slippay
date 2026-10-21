// BillingAgent — enforcement core ("the teeth").
//
// Proposes a charge intent for a subscription. It NEVER moves money and never
// self-authorizes: the intent it emits flows to AuthorityAgent (authorize) then
// SettlementAgent (settle). Its teeth are the eligibility checks — it cannot
// bill early, past max_periods, when expired, or when inactive. A compromised
// BillingAgent can at worst propose; Authority + the on-chain cap bound the rest.
//
// The emitted intent shape matches AuthorityAgent.authorizeIntent's input, so the
// agent chain composes: Billing.proposeCharge -> Authority.authorizeIntent ->
// Settlement.verifySettlement.

export function proposeCharge(sub, now, nonce) {
  if (sub.status !== "active") return { ok: false, reason: "not_active" };
  if (sub.expiresAt && now >= sub.expiresAt) return { ok: false, reason: "expired" };
  if (sub.maxPeriods && sub.chargesDone >= sub.maxPeriods) {
    return { ok: false, reason: "max_periods_reached" };
  }
  // First charge (lastChargeAt 0) is due immediately; later charges only once a
  // full period has elapsed — no early billing.
  if (sub.lastChargeAt && now < sub.lastChargeAt + sub.periodSeconds) {
    return { ok: false, reason: "period_not_elapsed" };
  }
  const intent = {
    mandateId: sub.mandateId,
    amount: sub.consentedAmount,        // the consented amount, never invented
    recipient: sub.consentedRecipient,  // the consented recipient, never rotated
    token: sub.token,
    periodIndex: sub.chargesDone + 1,
    nonce,
  };
  return { ok: true, intent };
}
