// Audit-004 · C6 — token-bucket rate limiter applied to every API route.
//
// Keyed by client identity: for authenticated routes, by `merchant.id`; for
// unauthenticated routes, by `x-forwarded-for` first hop (or socket IP).
// In-memory implementation is fine for a single-container deployment; for
// multi-pod, swap to Redis or a Supabase pg-cron-cleaned table.
//
// Defaults:
//  - 60 requests/min per key for general API routes (orders, subscriptions,
//    merchants)
//  - 5 requests/min and 100 requests/day per IP for /v1/ask (audit-004 C7).
//    Enforced via a stricter limiter applied locally in the ask route.
//
// Window: a classic token-bucket of `capacity` tokens that refill at
// `refillPerSec` tokens/second. Exhausted callers get 429 with a
// `retry-after` header.

import type { Context, Next } from "hono";
import { clientIp, type ConnInfo } from "../lib/client_ip.ts";

export interface Bucket {
  tokens: number;
  lastRefill: number; // ms epoch
}

export interface LimiterConfig {
  capacity: number;
  refillPerSec: number;
  /** How to derive the key. Default: x-forwarded-for first hop || "anon". */
  key?: (c: Context) => string;
  /** Identifier for diagnostic 429 body. */
  scope?: string;
  /** Maximum number of buckets tracked before LRU eviction. Defaults to 10,000. */
  maxBuckets?: number;
}

export const DEFAULT_MAX_BUCKETS = 10_000;
const SWEEP_INTERVAL_MS = 60_000;
const BUCKET_TTL_MS = 5 * 60_000;

// Module-level LRU map preserving insertion/access order.
const buckets: Map<string, Bucket> = new Map();
let lastSweep = Date.now();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function sweepBuckets(ttlMs = BUCKET_TTL_MS) {
  const now = Date.now();
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (now - b.lastRefill > ttlMs) {
      buckets.delete(k);
    }
  }
}

export function ensureSweepTimer() {
  if (sweepTimer === null && typeof setInterval !== "undefined") {
    sweepTimer = setInterval(() => sweepBuckets(), SWEEP_INTERVAL_MS);
    try {
      if (typeof (sweepTimer as any)?.unref === "function") {
        (sweepTimer as any).unref();
      } else if (typeof (globalThis as any).Deno?.unrefTimer === "function") {
        (globalThis as any).Deno.unrefTimer(sweepTimer);
      }
    } catch {
      // ignore
    }
  }
}

function sweepIfDue() {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  sweepBuckets();
}

// Audit-005 · H1 — derive the bucket key from the trusted connection IP, NOT
// the client-forgeable left-most X-Forwarded-For hop. See lib/client_ip.ts.
// On Deno, Hono exposes the connection info (with remoteAddr) as `c.env`.
function defaultKey(c: Context): string {
  return clientIp(c.req, c.env as ConnInfo | undefined);
}

export function rateLimit(cfg: LimiterConfig) {
  const { capacity, refillPerSec } = cfg;
  const keyFn = cfg.key ?? defaultKey;
  const scope = cfg.scope ?? "default";

  return async (c: Context, next: Next) => {
    ensureSweepTimer();
    sweepIfDue();

    const maxBuckets = cfg.maxBuckets ?? (
      typeof Deno !== "undefined" && Deno.env?.get("RATE_LIMIT_MAX_BUCKETS")
        ? parseInt(Deno.env.get("RATE_LIMIT_MAX_BUCKETS")!) || DEFAULT_MAX_BUCKETS
        : DEFAULT_MAX_BUCKETS
    );

    const id = `${scope}:${keyFn(c)}`;
    const now = Date.now();

    let bucket = buckets.get(id);
    if (bucket) {
      // Re-insert to refresh position to most-recently used (MRU)
      buckets.delete(id);
    } else {
      // If at capacity, evict the least recently used (first in Map)
      if (buckets.size >= maxBuckets) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey && oldestKey !== id) {
          buckets.delete(oldestKey);
        }
      }

      // If still at capacity (e.g. maxBuckets === 0), fail closed with 429
      if (buckets.size >= maxBuckets) {
        return c.json(
          { error: "rate_limited", scope, reason: "capacity_exceeded", retry_after_sec: 1 },
          429,
          { "retry-after": "1" },
        );
      }

      bucket = { tokens: capacity, lastRefill: now };
    }

    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const retrySec = Math.ceil((1 - bucket.tokens) / refillPerSec);
      buckets.set(id, bucket);
      return c.json(
        { error: "rate_limited", scope, retry_after_sec: retrySec },
        429,
        { "retry-after": String(retrySec) },
      );
    }

    bucket.tokens -= 1;
    buckets.set(id, bucket);
    await next();
  };
}

/** Derive a key bound to the authenticated merchant.id; falls back to IP. */
export function merchantKey(c: Context): string {
  const m = c.get("merchant") as { id?: string } | undefined;
  return m?.id ?? defaultKey(c);
}

/** Visible for tests. */
export function __resetBuckets() {
  buckets.clear();
  lastSweep = Date.now();
  if (sweepTimer !== null) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

export function __getBucketCount(): number {
  return buckets.size;
}

export function __hasBucket(id: string): boolean {
  return buckets.has(id);
}

export function __getBucket(id: string): Bucket | undefined {
  return buckets.get(id);
}
