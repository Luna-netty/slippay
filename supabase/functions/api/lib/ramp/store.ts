/**
 * Ramp transaction store — the local mirror of provider webhook status.
 *
 * Charge-model providers (CriptoPix) don't expose a GET-by-id endpoint; status
 * arrives via webhook. This module persists those webhooks to `ramp_transactions`
 * and serves them back to the Anchor read methods. Service-role only.
 */

import { serviceClient } from "../supabase.ts";
import type { RampTxRecord } from "./types.ts";

export type { RampTxRecord };

/** A CriptoPix webhook body (see docs: webhook/instrucoes). */
export interface CnopWebhookBody {
  ids?: {
    businessId?: string;
    transactionId?: string;
    partnerTransactionId?: string;
    afterPaymentId?: string;
    endToEndId?: string;
    brCode?: string;
    gatewayId?: string;
    hashWeb3?: string;
  };
  transactionPayload?: {
    userId?: string;
    userCpf?: string;
    userPixKey?: string;
    userWalletAddress?: string;
    productName?: string;
    quantity?: number;
    unitPrice?: number;
    usdtAmount?: number;
    reaisAmount?: number;
  };
  transactionType?: string;
  transactionStatus?: string;
  transactionErrorType?: string;
  transactionErrorMessage?: string;
}

/** A CriptoPix id field is "-NOT-UPDATED"-suffixed when the flow didn't set it. */
function clean(v: string | undefined): string | undefined {
  if (!v || v.endsWith("-NOT-UPDATED")) return undefined;
  return v;
}

/** Upsert a CriptoPix webhook into the store. Keyed by gateway_id; falls back to
 * partner_transaction_id when the gateway id is absent (error flows). Returns the
 * key used, or null when neither id is usable. */
export async function upsertRampTxFromWebhook(
  body: CnopWebhookBody,
  provider = "criptopix",
): Promise<string | null> {
  const ids = body.ids ?? {};
  const p = body.transactionPayload ?? {};
  const gatewayId = clean(ids.gatewayId);
  const partnerTxId = clean(ids.partnerTransactionId);
  // gateway_id is the primary key; without it we can't upsert deterministically.
  const key = gatewayId ?? partnerTxId;
  if (!key) return null;

  const row = {
    gateway_id: key,
    partner_transaction_id: partnerTxId ?? null,
    transaction_id: clean(ids.transactionId) ?? null,
    business_id: clean(ids.businessId) ?? null,
    provider,
    transaction_type: body.transactionType ?? null,
    transaction_status: body.transactionStatus ?? null,
    error_type: body.transactionErrorType ?? null,
    error_message: body.transactionErrorMessage ?? null,
    user_id: p.userId ?? null,
    usdt_amount: p.usdtAmount ?? null,
    reais_amount: p.reaisAmount ?? null,
    br_code: clean(ids.brCode) ?? null,
    hash_web3: clean(ids.hashWeb3) ?? null,
    end_to_end_id: clean(ids.endToEndId) ?? null,
    after_payment_id: clean(ids.afterPaymentId) ?? null,
    raw: body,
    updated_at: new Date().toISOString(),
  };

  const sb = serviceClient();
  const { error } = await sb.from("ramp_transactions").upsert(row, {
    onConflict: "gateway_id",
  });
  if (error) throw new Error(`ramp_transactions upsert failed: ${error.message}`);
  return key;
}

/** Generic upsert for any provider (e.g. 4P Finance). Keyed by gatewayId. */
export async function saveRampTx(rec: {
  gatewayId: string;
  provider: string;
  transactionId?: string;
  transactionType?: string;
  transactionStatus?: string;
  partnerTransactionId?: string;
  userId?: string;
  reaisAmount?: number;
  usdtAmount?: number;
  errorMessage?: string;
  raw?: unknown;
}): Promise<void> {
  const sb = serviceClient();
  const { error } = await sb.from("ramp_transactions").upsert({
    gateway_id: rec.gatewayId,
    provider: rec.provider,
    transaction_id: rec.transactionId ?? null,
    transaction_type: rec.transactionType ?? null,
    transaction_status: rec.transactionStatus ?? null,
    partner_transaction_id: rec.partnerTransactionId ?? null,
    user_id: rec.userId ?? null,
    reais_amount: rec.reaisAmount ?? null,
    usdt_amount: rec.usdtAmount ?? null,
    error_message: rec.errorMessage ?? null,
    raw: rec.raw ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "gateway_id" });
  // Best-effort status mirror: a missing table (migration not applied yet) must
  // not break charge creation. Log and continue.
  if (error) console.error(`ramp_transactions saveRampTx skipped: ${error.message}`);
}

/** Read a stored ramp transaction by gateway id (or partner transaction id). */
export async function getRampTx(id: string): Promise<RampTxRecord | null> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("ramp_transactions")
    .select("*")
    .or(`gateway_id.eq.${id},partner_transaction_id.eq.${id}`)
    .maybeSingle();
  // Missing table / read error: treat as "not found" so status polling degrades
  // gracefully instead of 500ing before the migration is applied.
  if (error) { console.error(`ramp_transactions read skipped: ${error.message}`); return null; }
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    gatewayId: r.gateway_id as string,
    partnerTransactionId: (r.partner_transaction_id as string) ?? undefined,
    transactionId: (r.transaction_id as string) ?? undefined,
    businessId: (r.business_id as string) ?? undefined,
    provider: r.provider as string,
    transactionType: (r.transaction_type as string) ?? undefined,
    transactionStatus: (r.transaction_status as string) ?? undefined,
    errorType: (r.error_type as string) ?? undefined,
    errorMessage: (r.error_message as string) ?? undefined,
    userId: (r.user_id as string) ?? undefined,
    usdtAmount: r.usdt_amount != null ? Number(r.usdt_amount) : undefined,
    reaisAmount: r.reais_amount != null ? Number(r.reais_amount) : undefined,
    brCode: (r.br_code as string) ?? undefined,
    hashWeb3: (r.hash_web3 as string) ?? undefined,
    endToEndId: (r.end_to_end_id as string) ?? undefined,
    afterPaymentId: (r.after_payment_id as string) ?? undefined,
  };
}
