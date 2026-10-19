import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchOutcome, OrderForMatch } from "./matcher.js";
import { log } from "./log.js";

// Overpayment policy (docs/fees/overpayment-policy.md):
//   accept-and-record. The excess is persisted on the order as the
//   surplus, and a surplus at or above the threshold raises an alert.
// The matcher is the source of truth for the comparison tolerance; this
// constant must match the one referenced in matcher.ts.
export const OVERPAYMENT_ALERT_THRESHOLD_STROOPS = 10000000; // 10 USDC (7 decimals)

export async function reconcileMatch(
  db: SupabaseClient,
  order: OrderForMatch & { merchant_id: string },
  outcome: MatchOutcome,
  txHash: string,
) {
  if (outcome.outcome === "ignore") return;

  const newStatus = outcome.outcome === "paid" ? "paid" : "underpaid";

  // Allow underpaid → paid transition (audit-003 L3). Without this, a partial
  // payment followed by a top-up leaves the order stuck in underpaid forever
  // and silently drops the second event. The transition matrix here is
  // explicit: only forward transitions, never backward.
  const allowedPriorStatuses = newStatus === "paid"
    ? ["pending", "underpaid"]
    : ["pending"];

  // Overpayment is accepted and recorded: persist expected, received and the
  // surplus so the reconciliation surface can refund/credit later.
  const isPaid = outcome.outcome === "paid";
  const expectedStroops = isPaid ? outcome.expected : null;
  const receivedStroops = isPaid ? outcome.received : null;
  const surplusStroops = isPaid ? outcome.surplus : null;
  const hasSurplus = isPaid && surplusStroops != null && surplusStroops > 0;

  const updatePatch: Record<string, unknown> = {
    status: newStatus,
    tx_hash: txHash,
    paid_at: newStatus === "paid" ? new Date().toISOString() : null,
  };
  if (isPaid) {
    updatePatch.expected_stroops = expectedStroops;
    updatePatch.received_stroops = receivedStroops;
    updatePatch.surplus_stroops = surplusStroops;
  }

  const { data, error } = await db.from("orders")
    .update(updatePatch)
    .eq("id", order.id)
    .in("status", allowedPriorStatuses)
    .select("*").single();

  if (error || !data) {
    log("warn", "reconcile_skipped", { order_id: order.id, error: error?.message ?? "no_pending_row" });
    return;
  }

  const subscriptionId: string | null = data.subscription_id ?? null;

  // If this order was generated from a subscription and was successfully paid,
  // bump charges_done. If it hits max_periods, expire the subscription.
  if (subscriptionId && newStatus === "paid") {
    const { data: sub, error: subFetchErr } = await db.from("subscriptions")
      .select("charges_done, max_periods, status").eq("id", subscriptionId).maybeSingle();
    if (sub && !subFetchErr) {
      const nextCount = (sub.charges_done ?? 0) + 1;
      const reachedMax = sub.max_periods != null && nextCount >= sub.max_periods;
      const patch: Record<string, unknown> = {
        charges_done: nextCount,
        last_charge_at: new Date().toISOString(),
      };
      if (reachedMax) patch.status = "expired";
      const { error: subUpdErr } = await db.from("subscriptions")
        .update(patch).eq("id", subscriptionId);
      if (subUpdErr) {
        log("error", "subscription_update_failed", { subscription_id: subscriptionId, error: subUpdErr.message });
      }
    }
  }

  const payload = {
    type: outcome.outcome === "paid"
      ? (subscriptionId ? "subscription.charged" : "order.paid")
      : "order.underpaid",
    data: {
      id: order.id,
      subscription_id: subscriptionId,
      external_ref: data.external_ref,
      brl_amount: data.brl_amount,
      usdc_amount: data.usdc_amount,
      tx_hash: txHash,
      memo: order.memo,
      paid_at: data.paid_at,
      ...(outcome.outcome === "underpaid" ? { expected: outcome.expected, received: outcome.received } : {}),
      ...(isPaid ? { expected: expectedStroops, received: receivedStroops, surplus: surplusStroops } : {}),
    },
  };

  const { error: webhookError } = await db.from("webhook_deliveries").insert({
    order_id: order.id,
    type: payload.type,
    payload,
  });

  if (webhookError) {
    // 23505 = unique_violation. With the partial unique index on
    // webhook_deliveries(order_id, type) for terminal types, duplicate
    // inserts on Horizon stream replay are expected and silent (audit-003 L3).
    const code = (webhookError as { code?: string }).code;
    if (code === "23505") {
      log("info", "webhook_insert_dedup", { order_id: order.id, type: payload.type });
    } else {
      log("error", "webhook_insert_failed", { order_id: order.id, error: webhookError.message });
    }
  }

  // Alert when the surplus is large enough to suggest a duplicate or a
  // transposed amount. The alert is recorded as a webhook delivery so it
  // surfaces on the merchant's reconciliation feed and is deduped on replay.
  if (hasSurplus && surplusStroops >= OVERPAYMENT_ALERT_THRESHOLD_STROOPS) {
    const alertPayload = {
      type: "order.overpaid_alert",
      data: {
        id: order.id,
        subscription_id: subscriptionId,
        external_ref: data.external_ref,
        tx_hash: txHash,
        memo: order.memo,
        expected: expectedStroops,
        received: receivedStroops,
        surplus: surplusStroops,
        threshold: OVERPAYMENT_ALERT_THRESHOLD_STROOPS,
      },
    };
    const { error: alertError } = await db.from("webhook_deliveries").insert({
      order_id: order.id,
      type: alertPayload.type,
      payload: alertPayload,
    });
    if (alertError) {
      const code = (alertError as { code?: string }).code;
      if (code === "23505") {
        log("info", "overpayment_alert_dedup", { order_id: order.id });
      } else {
        log("warn", "overpayment_alert_failed", { order_id: order.id, error: alertError.message });
      }
    }
    log("warn", "overpayment_alert", {
      order_id: order.id,
      expected: expectedStroops,
      received: receivedStroops,
      surplus: surplusStroops,
    });
  }

  log("info", "order_reconciled", {
    order_id: order.id,
    subscription_id: subscriptionId,
    status: newStatus,
    tx_hash: txHash,
    ...(isPaid ? { expected: expectedStroops, received: receivedStroops, surplus: surplusStroops } : {}),
  });
}
