import { Hono } from "hono";

// Public subscription-intelligence snapshot, sourced from the SlipPay Dune
// dashboard (dune.com/slippay/subscription-intelligence). Public on purpose —
// the whole thesis is "verifiable on-chain, audit it yourself", so no auth.
//
// Two-layer honesty contract:
//   1. If the Dune query IDs / API key aren't configured yet, we return
//      { configured: false } — never fabricated numbers. Per Wave's rule,
//      the dashboard isn't published until >=1 real mainnet charge exists,
//      so this is the expected state until then.
//   2. When configured, we cache Dune results for 1h (TTL) so the site can
//      poll cheaply and Dune's rate limit isn't hit on every pageview.
//
// GET /v1/metrics/dune-snapshot
const r = new Hono();

const DASHBOARD_URL = "https://dune.com/slippay/subscription-intelligence";
const CONTRACT_ID = "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN";
const TTL_MS = 60 * 60 * 1000; // 1h

// Maps our 4 metrics to their Dune query IDs (set once the queries are
// published + saved on Dune). Empty string = not yet wired.
const QUERY_IDS: Record<string, string> = {
  active_subscriptions: Deno.env.get("DUNE_Q_ACTIVE") ?? "",
  mrr_usd: Deno.env.get("DUNE_Q_MRR") ?? "",
  churn_30d: Deno.env.get("DUNE_Q_CHURN") ?? "",
  cohort_retention: Deno.env.get("DUNE_Q_COHORT") ?? "",
};

let cache: { at: number; body: unknown } | null = null;

async function fetchDuneLatest(queryId: string, apiKey: string): Promise<unknown> {
  // Latest cached execution result — does not trigger a new run (cheap + fast).
  const res = await fetch(`https://api.dune.com/api/v1/query/${queryId}/results`, {
    headers: { "X-Dune-API-Key": apiKey },
  });
  if (!res.ok) throw new Error(`dune ${queryId} -> ${res.status}`);
  const json = await res.json();
  // Single-value queries return one row; we surface rows verbatim and let the
  // caller pick. Keeps the endpoint dumb — no metric-specific shaping here.
  return json?.result?.rows ?? [];
}

r.get("/dune-snapshot", async (c) => {
  const apiKey = Deno.env.get("DUNE_API_KEY") ?? "";
  const wired = Object.values(QUERY_IDS).filter(Boolean).length;

  // Honest unconfigured state — no fabricated numbers.
  if (!apiKey || wired === 0) {
    return c.json({
      configured: false,
      contract_id: CONTRACT_ID,
      dashboard_url: DASHBOARD_URL,
      note: "Dashboard not published yet — published once real mainnet subscription data exists.",
    });
  }

  if (cache && Date.now() - cache.at < TTL_MS) return c.json(cache.body);

  const metrics: Record<string, unknown> = {};
  for (const [name, id] of Object.entries(QUERY_IDS)) {
    if (!id) { metrics[name] = null; continue; }
    try {
      metrics[name] = await fetchDuneLatest(id, apiKey);
    } catch (e) {
      metrics[name] = { error: String(e) };
    }
  }

  const body = {
    configured: true,
    contract_id: CONTRACT_ID,
    dashboard_url: DASHBOARD_URL,
    fetched_at: new Date().toISOString(),
    metrics,
  };
  cache = { at: Date.now(), body };
  return c.json(body);
});

export default r;
