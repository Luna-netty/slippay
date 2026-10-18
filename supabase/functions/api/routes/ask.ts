import { Hono, type Context } from "hono";
import { isAllowedOrigin } from "@slippay/shared";
import { askSlippayStream } from "../lib/ask.ts";
import { rateLimit } from "../middleware/rate_limit.ts";

const r = new Hono();

// Audit-004 · C7 — defense in depth for the unauth Claude-CLI-spawning route:
//  1. Aggressive per-IP rate limit on top of the global limiter
//  2. Referer/Origin allowlist so it only serves the landing page, not random
//     scripts on the open internet
//  3. Concurrency semaphore so a flash flood of valid IPs still can't OOM
//     the container by spawning N concurrent subprocesses
//  4. Question length cap (already present, kept)
const MAX_CONCURRENT_SUBPROCESSES = 4;
let inFlight = 0;

// Audit-005 · M2 — process-wide daily spawn cap. The concurrency semaphore
// alone only bounds *instantaneous* spawns; a header-less or distributed
// caller can still sustain a high spawn rate over time (quota burn + CPU/RAM
// on the shared payment container). This counter caps total subprocess spawns
// per UTC day across the whole process, independent of source IP. Tune via
// ASK_MAX_SPAWNS_PER_DAY. Resets when the UTC day string rolls over.
const MAX_SPAWNS_PER_DAY = (() => {
  const raw = Deno.env.get("ASK_MAX_SPAWNS_PER_DAY");
  const n = raw ? Number.parseInt(raw, 10) : 500;
  return Number.isFinite(n) && n > 0 ? n : 500;
})();
let spawnDay = "";          // UTC day string, e.g. "2026-06-01"
let spawnsToday = 0;

/** Returns true (and increments) if a spawn is allowed for the current UTC
 *  day; false once the daily cap is reached. Self-resets on day rollover. */
function tryReserveSpawn(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== spawnDay) {
    spawnDay = today;
    spawnsToday = 0;
  }
  if (spawnsToday >= MAX_SPAWNS_PER_DAY) return false;
  spawnsToday += 1;
  return true;
}

// Token bucket: 5 req/min sustained, burst 5. Daily-ish cap via second
// limiter below (smaller refill).
r.use("*", rateLimit({ capacity: 5, refillPerSec: 5 / 60, scope: "ask_per_minute" }));
r.use("*", rateLimit({ capacity: 100, refillPerSec: 100 / 86_400, scope: "ask_per_day" }));

// POST /v1/ask — Ask Slippay AI chat widget endpoint.
// Public (no auth required) — intended to be called from the landing page.
// Streams Server-Sent Events: text deltas, citations, usage, done, or error.
//
// Request body: { question: string, history?: [{role, content}] }
//
// SSE event types streamed:
//   {type: "text", text: "..."}             — token-by-token answer text
//   {type: "citation", citation: {...}}     — citation pointing to a doc
//   {type: "usage", usage: {...}}           — final token usage (cost tracking)
//   {type: "done"}                          — end of stream
//   {type: "error", error: "..."}           — fatal error mid-stream
r.post("/", async (c) => {
  // Audit-005 · M2 — FAIL-CLOSED origin gate. Previously this was fail-OPEN:
  // a header-less client (no Origin AND no Referer) passed straight through,
  // so anything off the open internet (curl, a bot, an agent) could spawn the
  // Claude CLI subprocess. Browsers always set Origin (or at least Referer)
  // on cross-origin POSTs; a legitimate same-app fetch will carry one. So we
  // now REJECT when both are absent, and when present require an allowed
  // origin. The CORS allowlist in index.ts is advisory (CORS only constrains
  // what the browser exposes to JS, not whether the request reaches us).
  const origin = c.req.header("origin");
  const referer = c.req.header("referer");
  const candidate = origin ?? referer;
  if (!candidate) {
    return c.json({ error: "origin_required" }, 403);
  }
  let candidateOrigin: string;
  try {
    candidateOrigin = new URL(candidate).origin;
  } catch {
    return c.json({ error: "origin_not_allowed" }, 403);
  }
  if (!isAllowedOrigin(candidateOrigin)) {
    return c.json({ error: "origin_not_allowed" }, 403);
  }

  // Process-wide daily spawn cap (independent of IP / origin). Reserve a slot
  // up front; release it if we bail before spawning so we don't burn budget
  // on rejected requests.
  if (!tryReserveSpawn()) {
    return c.json(
      { error: "daily_limit_reached", detail: "Ask Slippay daily capacity reached; try again tomorrow." },
      429,
      { "retry-after": "3600" },
    );
  }
  let spawnReserved = true;
  const releaseSpawn = () => {
    if (spawnReserved) {
      spawnReserved = false;
      if (spawnsToday > 0) spawnsToday -= 1;
    }
  };

  if (inFlight >= MAX_CONCURRENT_SUBPROCESSES) {
    releaseSpawn();
    return c.json({ error: "busy", detail: "too many concurrent requests; retry shortly" }, 503);
  }
  inFlight += 1;
  try {
    return await handleAsk(c, releaseSpawn);
  } finally {
    inFlight -= 1;
  }
});

async function handleAsk(c: Context, releaseSpawn: () => void) {
  let body: { question?: string; history?: unknown };
  try {
    body = await c.req.json();
  } catch {
    releaseSpawn();
    return c.json({ error: "invalid_json" }, 400);
  }
  const question = (body.question ?? "").toString().trim();
  if (!question || question.length > 4000) {
    releaseSpawn();
    return c.json({ error: "invalid_question", detail: "expected 1-4000 chars" }, 400);
  }
  const history = Array.isArray(body.history)
    ? (body.history as Array<{ role: "user" | "assistant"; content: string }>)
      .filter(h => (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
      .slice(-10)  // limit to last 10 turns for cost
    : undefined;

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await askSlippayStream({ question, history });
  } catch (e: unknown) {
    releaseSpawn();
    const msg = String((e as Error).message ?? e);
    if (msg.includes("CLAUDE_CODE_OAUTH_TOKEN") || msg.includes("ANTHROPIC_API_KEY")) {
      return c.json({ error: "service_unavailable", detail: "Ask Slippay engine not configured. Contact admin." }, 503);
    }
    return c.json({ error: "stream_failed", detail: msg }, 500);
  }

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    },
  });
}

export default r;
