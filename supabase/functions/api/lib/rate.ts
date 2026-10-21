let cache: { value: number; expires: number } | null = null;
const TTL_MS = 60_000;

export function _resetCacheForTest() { cache = null; }

export async function getBrlPerUsdc(): Promise<number> {
  // Allow a fixed override in tests/CI to avoid hitting CoinGecko.
  const override = Deno.env.get("RATE_BRL_USDC");
  if (override) {
    const v = parseFloat(override);
    if (v > 0) return v;
  }
  if (cache && cache.expires > Date.now()) return cache.value;
  const value = await fetchCoinGecko();
  cache = { value, expires: Date.now() + TTL_MS };
  return value;
}

async function fetchCoinGecko(): Promise<number> {
  const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=brl");
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const j = await r.json() as { "usd-coin"?: { brl?: number } };
  const v = j["usd-coin"]?.brl;
  if (typeof v !== "number" || v <= 0) throw new Error("bad rate response");
  return v;
}
