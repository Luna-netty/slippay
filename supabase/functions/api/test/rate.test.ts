import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getBrlPerUsdc, _resetCacheForTest } from "../lib/rate.ts";

Deno.test("getBrlPerUsdc returns positive number from CoinGecko fallback", { sanitizeOps: false, sanitizeResources: false }, async () => {
  _resetCacheForTest();
  const r = await getBrlPerUsdc();
  assert(r > 0);
});

Deno.test("getBrlPerUsdc caches within ttl", { sanitizeOps: false, sanitizeResources: false }, async () => {
  _resetCacheForTest();
  const a = await getBrlPerUsdc();
  const b = await getBrlPerUsdc();
  assertEquals(a, b);
});
