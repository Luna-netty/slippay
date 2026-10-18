// SettlementAgent — enforcement core ("the teeth").
//
// Decides whether an observed on-chain payment validly settles an order. This
// is a pure decision function: it proposes a settlement, it does NOT move money
// (the transfer already happened on-chain; the wallet contract bounded it). Its
// job is to bind a real payment to the order the buyer consented to.
//
// The recipient check is the fix for the live redirection hole at
// supabase/functions/api/routes/orders.ts:130, where merchant_stellar_address is
// resolved at read time. Settlement verifies the payment landed on the recipient
// PINNED ON THE ORDER at charge time (order.consentedRecipient), so rotating the
// merchant address after consent cannot redirect a buyer's funds.
//
// `prove`, decidable → code: every check here is deterministic arithmetic/equality,
// never an LLM judge.

const dec = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`non-numeric amount: ${s}`);
  return n;
};

// Returns { ok, reason }. Order: binding (memo) → security (recipient) →
// value (amount, asset) → replay.
export function verifySettlement(payment, order, settledTxHashes) {
  // 1. binding — is this payment even for this order?
  if (payment.memo !== order.memo) return { ok: false, reason: "memo_mismatch" };

  // 2. recipient — funds must land on the CONSENTED recipient, not a rotated one.
  if (payment.destination !== order.consentedRecipient) {
    return { ok: false, reason: "recipient_drift" };
  }

  // 3. value — at least the invoiced amount, in the invoiced asset.
  if (payment.asset !== order.asset) return { ok: false, reason: "asset_mismatch" };
  if (dec(payment.amount) < dec(order.usdcAmount)) return { ok: false, reason: "amount_short" };

  // 4. replay — a tx settles at most one order, once.
  if (settledTxHashes.has(payment.txHash)) return { ok: false, reason: "replay" };

  return { ok: true, reason: "ok" };
}
