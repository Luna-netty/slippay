// Audit-005 · H1 — trustworthy client-IP derivation.
//
// THREAT: the previous code took `X-Forwarded-For.split(",")[0]` (the
// LEFT-MOST hop). XFF is appended to by each proxy, so the left-most entry is
// whatever the *client* sent — fully attacker-controlled. A caller rotating
// `X-Forwarded-For: <random>` on every request defeats every per-IP limiter
// and mints unbounded pending orders. We must never trust the left-most hop.
//
// CORRECT MODEL: our own nginx is the only trusted proxy. nginx APPENDS the
// real socket peer as the RIGHT-MOST hop of XFF. So with one trusted proxy,
// the rightmost hop is the genuine client IP; everything to its left is
// forgeable. We read a fixed depth from the RIGHT, configurable via
// TRUSTED_PROXY_HOPS (default 1 = "nginx is the only proxy in front of us").
//
// BEST: when the server exposes the real connection remote address we use it
// directly and ignore headers entirely. Deno's `Deno.serve` passes the
// connection info as the second handler argument, which Hono surfaces as
// `c.env.remoteAddr` (see hono/adapter/deno getConnInfo). When that is present
// (production), the XFF parsing below is only a fallback for setups where the
// remote addr is the proxy's loopback rather than the real client.

// How many proxy hops we trust between us and the public internet. Our nginx
// adds exactly one hop (the real client socket addr), so default 1.
const TRUSTED_PROXY_HOPS = (() => {
  const raw = Deno.env.get("TRUSTED_PROXY_HOPS");
  const n = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
})();

// Minimal shape we need from a request. Hono's `c.req` and a raw `Request`
// both satisfy this via the `header()` accessor we add a thin adapter for.
interface HeaderReader {
  header(name: string): string | undefined;
}

// Connection info as surfaced by Hono's Deno adapter (`c.env`). Optional —
// callers that can't thread it fall back to header parsing.
export interface ConnInfo {
  remoteAddr?: { hostname?: string } | null;
}

/**
 * Derive a trustworthy client identifier for rate-limiting / abuse buckets.
 *
 * Resolution order:
 *   1. Real connection remote address (`connInfo.remoteAddr.hostname`) when the
 *      server exposes it AND it is not a loopback/proxy address. This is the
 *      socket peer and cannot be spoofed by headers.
 *   2. The X-Forwarded-For hop at TRUSTED_PROXY_HOPS depth FROM THE RIGHT
 *      (rightmost = nearest trusted proxy = real client appended by our nginx).
 *      Never the left-most (client-forgeable) hop.
 *   3. The X-Real-IP header (set by our nginx) as a secondary signal.
 *   4. A constant "anon" bucket — a shared bucket is safe (it only over-limits,
 *      never under-limits); we NEVER fall back to an attacker-controlled value.
 *
 * @param req      something exposing `.header(name)` (Hono `c.req` or adapter)
 * @param connInfo optional Deno connection info (`c.env` in Hono on Deno)
 */
export function clientIp(req: HeaderReader, connInfo?: ConnInfo): string {
  // 1. Trust the real socket peer when present and routable. If the backend
  //    sits directly behind the public internet this is the client; if it
  //    sits behind nginx on loopback, remoteAddr is 127.0.0.1 and we fall
  //    through to header parsing (nginx is then the trusted hop source).
  const remote = connInfo?.remoteAddr?.hostname?.trim();
  if (remote && !isLoopback(remote)) return remote;

  // 2. Rightmost trusted hop of XFF.
  const xff = req.header("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length >= TRUSTED_PROXY_HOPS) {
      // index from the right: hops.length - TRUSTED_PROXY_HOPS
      const ip = hops[hops.length - TRUSTED_PROXY_HOPS];
      if (ip) return ip;
    }
    // Fewer hops than expected → the chain is shorter than our trusted
    // topology, so the rightmost entry is NOT guaranteed to be our nginx's
    // appended client addr. Do NOT trust it; fall through.
  }

  // 3. X-Real-IP (our nginx sets this; not client-forgeable in our topology).
  const realIp = req.header("x-real-ip")?.trim();
  if (realIp) return realIp;

  // 4. Constant bucket. Shared, never attacker-controlled.
  return "anon";
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost" ||
    host.startsWith("127.");
}
