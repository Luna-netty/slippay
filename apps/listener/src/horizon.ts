import { Horizon } from "@stellar/stellar-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchPaymentToOrder, type StellarPaymentEvent } from "./matcher.js";
import { reconcileMatch } from "./reconciler.js";
import { log } from "./log.js";
import { NETWORK } from "@slippay/shared";

const HORIZON: Record<"TESTNET" | "PUBLIC", string> = {
  TESTNET: NETWORK.testnet.horizon,
  PUBLIC:  NETWORK.mainnet.horizon,
};

const POLL_MS = Number(process.env.LISTENER_POLL_MS ?? "4000");
const PAGE_LIMIT = 200;
const ALIVE_LOG_MS = 60_000;

export interface AccountWatcherDeps {
  db: SupabaseClient;
  network: "TESTNET" | "PUBLIC";
  accountId: string;
}

// Polling watcher (replaces SSE .stream()). Horizon's streaming silently dies —
// the connection hangs with no `onerror`, no events, and no auto-reconnect, so a
// "online" listener stops confirming payments invisibly (observed 2026-06-26).
// Polling makes every tick a fresh HTTP GET: immune to silent-death, and a
// heartbeat log makes a stall visible. Latency (~POLL_MS) is fine — x402 buyers
// poll for tens of seconds. One poller per account is still gated by the lease.
export async function watchAccount({ db, network, accountId }: AccountWatcherDeps): Promise<() => void> {
  const server = new Horizon.Server(HORIZON[network]);

  // Resume cursor. If none, start at the current head so we don't replay history.
  const { data: stateRow } = await db.from("listener_state").select("paging_token").eq("account_id", accountId).maybeSingle();
  let cursor: string | undefined = stateRow?.paging_token ?? undefined;
  if (!cursor) {
    try {
      const head = await server.payments().forAccount(accountId).order("desc").limit(1).call();
      cursor = head.records[0]?.paging_token;
    } catch (e) { log("error", "head_fetch_error", { account: accountId, error: String(e) }); }
  }

  log("info", "poller_open", { account: accountId, cursor: cursor ?? "head", pollMs: POLL_MS });

  async function processRecord(raw: any): Promise<void> {
    if (raw.type !== "payment") return;
    const tx = await raw.transaction();
    const ev: StellarPaymentEvent = {
      memo_type: tx.memo_type,
      memo_b64: tx.memo ?? "",
      successful: tx.successful,
      asset_code: raw.asset_code,
      asset_issuer: raw.asset_issuer,
      to: raw.to,
      amount: raw.amount,
      hash: raw.transaction_hash,
    };
    const memoHex = ev.memo_type === "hash" ? Buffer.from(ev.memo_b64, "base64").toString("hex") : "";
    if (!memoHex) return;
    // The recipient lives on merchants.stellar_address (NOT on orders); the fee
    // is on the order (fallback to the merchant's). Selecting a non-existent
    // orders.merchant_stellar_address made this query fail and silently dropped
    // every match — the real cause of x402 non-confirmation (2026-06-26).
    const { data: order } = await db.from("orders")
      .select("id, merchant_id, memo, usdc_amount, platform_fee_bp, merchants ( stellar_address, platform_fee_bp )")
      .eq("memo", memoHex)
      .eq("status", "pending")
      .maybeSingle();
    if (order) {
      // PostgREST embeds a many-to-one relation as an object, but some setups
      // return a single-element array — handle both so stellar_address resolves.
      const mraw = (order as any).merchants;
      const merchant = (Array.isArray(mraw) ? mraw[0] : mraw) as { stellar_address: string; platform_fee_bp: number } | undefined;
      const orderForMatch = {
        id: order.id as string,
        merchant_id: order.merchant_id as string,
        memo: order.memo as string,
        // numeric columns come back as JS numbers; the matcher's stellarToStroops
        // needs a string (it .split()s) — coerce or it throws -> "amount_parse".
        usdc_amount: String(order.usdc_amount),
        merchant_stellar_address: merchant?.stellar_address as string,
        platform_fee_bp: ((order as any).platform_fee_bp ?? merchant?.platform_fee_bp ?? 0) as number,
      };
      const outcome = matchPaymentToOrder(ev, orderForMatch, network);
      await reconcileMatch(db, orderForMatch, outcome, ev.hash);
      log("info", "match_outcome", {
        account: accountId, hash: ev.hash, order_id: orderForMatch.id,
        outcome: outcome.outcome, reason: (outcome as any).reason ?? null,
        to: ev.to, pinned: orderForMatch.merchant_stellar_address, fee_bp: orderForMatch.platform_fee_bp,
      });
    }
  }

  let stopped = false;
  let lastAliveLog = 0;
  let consecutiveErrors = 0;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      let builder = server.payments().forAccount(accountId).order("asc").limit(PAGE_LIMIT);
      if (cursor) builder = builder.cursor(cursor);
      const page = await builder.call();
      for (const raw of page.records) {
        await processRecord(raw);
        cursor = raw.paging_token;
        await db.from("listener_state").upsert({ account_id: accountId, paging_token: cursor, updated_at: new Date().toISOString() });
      }
      consecutiveErrors = 0;
      const now = Date.now();
      if (now - lastAliveLog > ALIVE_LOG_MS) {
        log("info", "poller_alive", { account: accountId, cursor: cursor ?? "head" });
        lastAliveLog = now;
      }
    } catch (e) {
      consecutiveErrors++;
      log("error", "poll_error", { account: accountId, error: String(e), consecutive: consecutiveErrors });
    }
  }

  const iv = setInterval(() => { void tick(); }, POLL_MS);
  void tick();

  return () => { stopped = true; clearInterval(iv); };
}
