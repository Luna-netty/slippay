// FX quote engine — Pix (BRL) -> USDC. This is the real margin layer: SlipPay
// quotes the mid-market rate x (1 + spread) and keeps the difference. The spread
// fires on EVERY conversion (including users who only hold dollars), which is why
// it scales ~10x vs a per-transfer rail fee. Configurable via VITE_FX_SPREAD_BPS
// (default 190 = 1.90% — the price decided + shown on the landing; still ~3x
// cheaper than a bank's ~5% IOF+spread, while capturing healthy margin).
//
// HONEST STATE: this computes and records the SlipPay-quoted rate + captured
// margin. The margin is actually pocketed when BRL settles through a SlipPay-owned
// or rev-share anchor; while the conversion routes through a 3rd-party on-ramp,
// this is the pricing + measurement layer that makes the spread live the moment
// the anchor is connected.

const SPREAD_BPS = Number(import.meta.env.VITE_FX_SPREAD_BPS ?? 190);
const RATE_URL = "https://open.er-api.com/v6/latest/USD";
const FALLBACK_BRL_PER_USD = 5.4;

export const SPREAD_PCT = SPREAD_BPS / 100;

export interface Quote {
  brlIn: number;
  midRate: number;     // BRL per USD (mid-market)
  quotedRate: number;  // BRL per USD the user effectively pays (mid x (1+spread))
  spreadBps: number;
  usdcOut: number;     // USDC received at the SlipPay rate
  usdcAtMid: number;   // USDC at mid-market (for comparison)
  marginUsd: number;   // SlipPay's captured margin (USD)
  marginBrl: number;   // ...in BRL
  stale: boolean;      // live rate fetch failed -> fallback used
  ts: string;
}

let cache: { rate: number; at: number } | null = null;
// Cache the in-flight promise, not just the resolved value: concurrent cold
// callers (several components mounting in one frame) share a single request.
let inflight: Promise<{ rate: number; stale: boolean }> | null = null;

async function fetchMidRate(): Promise<{ rate: number; stale: boolean }> {
  try {
    const r = await fetch(RATE_URL);
    const j = await r.json();
    const rate = Number(j?.rates?.BRL);
    if (rate > 0) { cache = { rate, at: Date.now() }; return { rate, stale: false }; }
  } catch { /* fall through to fallback */ }
  return { rate: FALLBACK_BRL_PER_USD, stale: true };
}

export async function midRateBRLperUSD(): Promise<{ rate: number; stale: boolean }> {
  if (cache && Date.now() - cache.at < 60_000) return { rate: cache.rate, stale: false };
  if (inflight) return inflight;
  inflight = fetchMidRate().finally(() => { inflight = null; });
  return inflight;
}

export async function quoteBRLtoUSDC(brlIn: number, spreadBps = SPREAD_BPS): Promise<Quote> {
  const { rate: midRate, stale } = await midRateBRLperUSD();
  const quotedRate = midRate * (1 + spreadBps / 10000);
  const usdcOut = brlIn > 0 ? brlIn / quotedRate : 0;
  const usdcAtMid = brlIn > 0 ? brlIn / midRate : 0;
  const marginUsd = usdcAtMid - usdcOut;
  return {
    brlIn, midRate, quotedRate, spreadBps,
    usdcOut, usdcAtMid, marginUsd, marginBrl: marginUsd * quotedRate,
    stale, ts: new Date().toISOString(),
  };
}

// Best-effort margin ledger: records the conversion intent + captured spread so
// revenue is measured per conversion. Lands in the backend ledger when the route
// exists; silently no-ops otherwise (measurement must never block the flow).
export async function recordConversionIntent(q: Quote, walletId?: string): Promise<void> {
  const base = (import.meta.env.VITE_RELAYER_BASE as string | undefined) ?? "https://api.slippay.cc/api/v1/relayer";
  try {
    await fetch(`${base.replace(/\/relayer$/, "")}/onramp/intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brlIn: q.brlIn, midRate: q.midRate, quotedRate: q.quotedRate, spreadBps: q.spreadBps,
        usdcOut: q.usdcOut, marginUsd: q.marginUsd, walletId: walletId ?? null, ts: q.ts,
      }),
      keepalive: true,
    });
  } catch { /* measurement is best-effort */ }
}
