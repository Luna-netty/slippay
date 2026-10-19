import { signWebhook } from "./crypto.js";
import { log } from "./log.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSafeWebhookUrl, validateWebhookUrl, pinnedDispatcher } from "./ssrf.js";
import { randomUUID } from "node:crypto";

const SCHEDUL = [60, 300, 1800, 7200, 43200, 86400];

// Response body bytes we read+keep (rest is discarded after abort). Audit-003 L13.
const MAX_RESPONSE_BODY_BYTES = 64 * 1024;
// Hard ceiling on a single delivery attempt (per-call timeout).
const REQUEST_TIMEOUT_MS = 10_000;
// How long a claim is visible before another worker may reclaim it.
// Must exceed REQUEST_TIMEOUT_MS so a live attempt is never reclaimed out from under it.
const CLAIM_VISIBILITY_MS = REQUEST_TIMEOUT_MS * 3;

export function nextBackoff(attempt: number): number | null {
  return SCHEDULE[attempt] ?? null;
}

export interface DeliverArgs {
  url: string;
  secret: string;
  deliveryId: string;
  payload: unknown;
  // Dev-only escape hatch (config.allowLocalWebhooks). Defaults false so the
  // SSRF guard is fail-closed on EVERY network. Audit-003 L1.
  allowLocal?: boolean;
}

export interface DeliverResult {
  status: "sent" | "failed";
  code?: number;
  body?: string;
}

export async function deliverOnce(args: DeliverArgs): Promise<DeliverResult> {
  const allowLocal = args.allowLocal ?? false;

  // Always resolve + validate + pin to defeat DNS rebinding (audit-003 L1).
  // When allowLocal is set (dev-only flag) the lightweight path inside
  // validateWebhookUrl skips the blocklist/https/port/local checks so local
  // mock servers (example.com, localhost) work without DNS round-trips.
  const validation = await validateWebhookUrl(args.url, allowLocal);
  if (!validation.safe) {
    return { status: "failed", body: `unsafe_url:${validation.reason}` };
  }
  const dispatcher = pinnedDispatcher(validation.target);

  const body = JSON.stringify(args.payload);
  const t = Math.floor(Date.now() / 1000);
  const sig = await signWebhook(args.secret, body, t);

  try {
    // dispatcher carries the undici Agent we use to pin DNS on mainnet; cast
    // through `any` to bridge the undici v8 / @types/node undici-types skew.
    const fetchOpts: RequestInit & { dispatcher?: any } = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slippay-signature": sig,
        "x-slippay-delivery-id": args.deliveryId,
      },
      body,
      // 3xx is not acceptable for a webhook receiver. Following a redirect
      // would also re-resolve DNS without our pinning. Audit-003 L1+L13.
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (dispatcher) fetchOpts.dispatcher = dispatcher;
    const r = await fetch(args.url, fetchOpts as RequestInit);

    // Treat any 3xx (now visible via manual mode) as failure.
    if (r.status >= 300 && r.status < 400) {
      return { status: "failed", code: r.status, body: "redirect_not_allowed" };
    }

    // Read body with a hard size cap so a slow/malicious endpoint can't stall
    // or OOM the worker (audit-003 L13). Discard remainder.
    const text = await readCappedBody(r, MAX_RESPONSE_BODY_BYTES);
    return { status: r.ok ? "sent" : "failed", code: r.status, body: text.slice(0, 500) };
  } catch (e) {
    return { status: "failed", body: String(e).slice(0, 500) };
  }
}

async function readCappedBody(r: { body: ReadableStream<Uint8Array> | null }, max: number): Promise<string> {
  if (!r.body) return "";
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        // discard remainder; abort the stream
        try { await reader.cancel(); } catch { /* noop */ }
        const take = max - (total - value.byteLength);
        chunks.push(value.subarray(0, Math.max(0, take)));
        break;
      }
      chunks.push(value);
    }
  } catch { /* swallow stream errors; return what we have */ }
  return new TextDecoder().decode(concat(chunks));
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const c of chunks) n += c.byteLength;
  const out = new Uint8Array(n);
  let i = 0;
  for (const c of chunks) { out.set(c, i); i += c.byteLength; }
  return out;
}

export interface ClaimedDelivery {
  id: string;
  order_id: string;
  payload: unknown;
  attempt_n: number;
  status: string;
  owner_id?: string | null;
  orders?: {
    merchants?: { webhook_url?: string; webhook_secret?: string; network?: string } | null;
  } | null;
}

/**
 * Reclaim deliveries whose claim (delivering + visibility deadline) has expired.
 * A crashed worker leaves a row stuck in 'delivering'; this returns it to the
 * pool by resetting it to 'failed' with its next_attempt_at in the past.
 */
export async function reclaimExpiredClaims(db: SupabaseClient): Promise<void> {
  const now = new Date().toISOString();
  await db.from("webhook_deliveries")
    .update({ status: "failed", owner_id: null, visible_at: null })
    .eq("status", "delivering")
    .lt("visible_at", now);
}

/**
 * Atomically claim up to `limit` due deliveries for this worker.
 *
 * Shape: select candidate ids, then for each do a conditional CAS update
 * (compare-and-swap) that only succeeds if the row is still queued/failed and
 * due. The update returns the row only if this worker won the claim. Two
 * concurrent workers cannot both claim the same row because the second update
 * sees status='delivering' and matches zero rows.
 */
export async function claimDeliveries(
  db: SupabaseClient,
  ownerId: string,
  limit = 50,
): Promise<ClaimedDelivery[]> {
  const now = new Date();
  const nowIso = now.toISOString();
  const visibleAt = new Date(now.getTime() + CLAIM_VISIBILITY_MS).toISOString();

  // Reclaim first so any row stranded by a crashed worker becomes a candidate.
  await reclaimExpiredClaims(db);

  const { data: candidates } = await db.from("webhook_deliveries")
    .select("id")
    .in("status", ["queued", "failed"])
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  if (!candidates || candidates.length === 0) return [];

  const claimedIds: string[] = [];
  for (const candidate of candidates) {
    // Compare-and-swap: only transition queued|failed -> delivering if the row
    // is still in a claimable state and due. Returns the row only on win.
    const { data: won } = await db.from("webhook_deliveries")
      .update({ status: "delivering", owner_id: ownerId, visible_at: visibleAt })
      .eq("id", candidate.id)
      .in("status", ["queued", "failed"])
      .lte("next_attempt_at", nowIso)
      .select("id");
    if (won && won.length > 0) claimedIds.push(candidate.id);
  }

  if (claimedIds.length === 0) return [];

  // Fetch the full rows (including merchant join) for the rows we own.
  const { data: rows } = await db.from("webhook_deliveries")
    .select("id, order_id, payload, attempt_n, status, owner_id, orders ( merchants ( webhook_url, webhook_secret, network ) )")
    .in("id", claimedIds);
  return (rows as ClaimedDelivery[] || []);
}

export function startWebhookWorker(db: SupabaseClient, allowLocal: boolean, ownerId: string = `worker-${randomUUID()}`) {
  let stopped = false;

  async function tick() {
    while (!stopped) {
      const rows = await claimDeliveries(db, ownerId, 50);

      if (!rows || rows.length === 0) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      for (const row of rows) {
        const merchant = row.orders?.merchants as { webhook_url?: string; webhook_secret?: string; network?: string } | null | undefined;
        if (!merchant?.webhook_url) {
          await db.from("webhook_deliveries").update({ status: "dead", response_body: "no_webhook_url", owner_id: null, visible_at: null }).eq("id", row.id).eq("owner_id", ownerId);
          continue;
        }
        // Sync pre-flight: cheap URL-shape rejection before DNS cost.
        if (!isSafeWebhookUrl(merchant.webhook_url, allowLocal)) {
          await db.from("webhook_deliveries").update({ status: "dead", response_body: "unsafe_url", owner_id: null, visible_at: null }).eq("id", row.id).eq("owner_id", ownerId);
          continue;
        }

        const result = await deliverOnce({
          url: merchant.webhook_url,
          secret: merchant.webhook_secret!,
          deliveryId: row.id as string,
          payload: row.payload,
          allowLocal,
        });

        const newAttempt = (row.attempt_n as number) + 1;
        if (result.status === "sent") {
          // Guard the write on owner_id so a reclaimed-and-re-claimed row can't
          // be overwritten by a stale worker.
          await db.from("webhook_deliveries").update({
            status: "sent",
            response_code: result.code,
            response_body: result.body,
            attempt_n: newAttempt,
            last_attempt_at: new Date().toISOString(),
            owner_id: null,
            visible_at: null,
          }).eq("id", row.id).eq("owner_id", ownerId);
          log("info", "webhook_sent", { id: row.id, code: result.code, owner: ownerId });
        } else {
          const backoff = nextBackoff(newAttempt - 1);
          await db.from("webhook_deliveries").update({
            status: backoff === null ? "dead" : "failed",
            response_code: result.code,
            response_body: result.body,
            attempt_n: newAttempt,
            last_attempt_at: new Date().toISOString(),
            next_attempt_at: backoff === null
              ? new Date().toISOString()
              : new Date(Date.now() + backoff * 1000).toISOString(),
            owner_id: null,
            visible_at: null,
          }).eq("id", row.id).eq("owner_id", ownerId);
          log("warn", "webhook_failed", { id: row.id, attempt: newAttempt, backoff, owner: ownerId });
        }
      }
    }
  }

  tick();
  return () => { stopped = true; };
}
