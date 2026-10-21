import { Hono } from "hono";
import { cors } from "hono/cors";
import { errorMiddleware } from "./middleware/error.ts";
import { rateLimit } from "./middleware/rate_limit.ts";
import merchants from "./routes/merchants.ts";
import orders from "./routes/orders.ts";
import subscriptions from "./routes/subscriptions.ts";
import ask from "./routes/ask.ts";
import x402 from "./routes/x402.ts";
import billing from "./routes/billing.ts";
import metrics from "./routes/metrics.ts";
import relayer from "./routes/relayer.ts";
import ramp from "./routes/ramp.ts";
import offramp from "./routes/offramp.ts";
import { ALLOWED_ORIGINS_SET } from "@slippay/shared";
import fourp from "./routes/fourp.ts";

const api = new Hono().basePath("/api");
api.use("*", errorMiddleware);
// Audit-004 · M2: CORS allowlist (was "*"). The web app + landing on
// app.slippay.cc / slippay.cc need access; everything else stays denied so
// that the unauthenticated public endpoints (e.g. /v1/orders/:id?t=...) can't
// be invoked from random origins.
api.use("*", cors({
  origin: (origin) => (origin && ALLOWED_ORIGINS_SET.has(origin)) ? origin : "",
  allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowHeaders: ["authorization", "content-type"],
}));
// Audit-004 · C6: global token-bucket per IP applied to every /api/* request
// as the outer guardrail. Per-route limiters (e.g. /v1/ask) compose on top.
api.use("*", rateLimit({ capacity: 120, refillPerSec: 2, scope: "global" }));

api.get("/health", (c) => c.json({ ok: true }));
api.route("/v1/merchants", merchants);
api.route("/v1/orders", orders);
api.route("/v1/subscriptions", subscriptions);
api.route("/v1/billing", billing);
api.route("/v1/metrics", metrics);
api.route("/v1/ask", ask);
// x402 protocol surface — both merchant-side resource management and the
// unauthenticated payer-side gated GET share this base path.
api.route("/v1/x402-resources", x402);
api.route("/v1/x402", x402);
// Gas-sponsor relayer for the biometric payment flow (pays network fees only;
// user funds stay in the Face-ID-controlled passkey wallet — see relayer.ts).
api.route("/v1/relayer", relayer);
// Ramp provider webhooks (CriptoPix status -> ramp_transactions store).
api.route("/v1/ramp", ramp);
// On/off-ramp surface (quote, on-ramp, off-ramp, status) — provider-agnostic.
api.route("/v1/offramp", offramp);
// 4P Finance ramp (on-ramp Pix->wallet; dormant until FOURP_API_KEY set).
api.route("/v1/4p", fourp);

const app = new Hono();
app.route("/", api);

// Shopify connector (PM2 slippay-shopify on :4001) — reverse-proxied here so
// it rides api.slippay.cc's TLS without an nginx edit (no root on this box).
// Raw body bytes pass through untouched: both HMAC verifications (Shopify's
// x-shopify-hmac-sha256, SlipPay's x-slippay-signature) happen in the
// connector against the exact bytes.
const SHOPIFY_CONNECTOR = Deno.env.get("SHOPIFY_CONNECTOR_URL") ?? "http://localhost:4001";
app.all("/shopify/*", async (c) => {
  const url = new URL(c.req.url);
  const target = `${SHOPIFY_CONNECTOR}${url.pathname}${url.search}`;
  const body = (c.req.method === "GET" || c.req.method === "HEAD")
    ? undefined
    : await c.req.arrayBuffer();
  const r = await fetch(target, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body,
    redirect: "manual",
  });
  return new Response(r.body, { status: r.status, headers: r.headers });
});

const WEB_DIST = Deno.env.get("WEB_DIST") ??
  new URL("../../../apps/web/dist/", import.meta.url).pathname;

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  webp: "image/webp",
  xml: "application/xml; charset=utf-8",
};

// Canonical hostnames:
//   - app.slippay.cc  → landing + SPA (static files from apps/web/dist)
//   - api.slippay.cc  → REST API only; non-/api/* requests redirect to app.
//
// Nginx aliases both hostnames to this Deno backend on :8080 (Mario's vhost
// edit). Routing by Host header here splits the surface cleanly without
// requiring two nginx vhosts.
const APP_HOST   = "app.slippay.cc";
const API_HOST   = "api.slippay.cc";
const APP_ORIGIN = "https://app.slippay.cc";

app.get("*", async (c) => {
  const host = (c.req.header("host") ?? "").toLowerCase();
  const path = c.req.path === "/" ? "/index.html" : c.req.path;
  const ext = (path.split(".").pop() ?? "").toLowerCase();

  // api.slippay.cc — serve API only. Non-/api/* paths get a 301 to the app
  // origin. GET / returns service-info JSON for crawlers / health checks.
  if (host === API_HOST || host.startsWith(API_HOST + ":")) {
    if (c.req.path === "/" || c.req.path === "/index.html") {
      return c.json({
        service: "slippay-api",
        status: "ok",
        canonical_app: APP_ORIGIN,
        health: "/api/health",
        repo: "https://github.com/Galmanus/slippay",
      });
    }
    // Any other non-/api/* path on api.slippay.cc → redirect to app origin.
    return c.redirect(`${APP_ORIGIN}${c.req.path}`, 301);
  }

  // Docs moved to GitBook (slippay.gitbook.io/slippay-docs). Redirect the old
  // in-app /docs paths to the docs home so existing links don't 404. GitBook's
  // section slugs differ from the old file paths, so we send everything to the
  // docs root rather than guessing deep slugs.
  if (c.req.path === "/docs" || c.req.path.startsWith("/docs/")) {
    return c.redirect("https://slippay.gitbook.io/slippay-docs", 301);
  }

  // app.slippay.cc (and any other host alias) — serve static + SPA fallback.
  try {
    const file = await Deno.readFile(`${WEB_DIST}${path}`);
    return new Response(file, {
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "cache-control": ext === "html" ? "no-cache" : "public, max-age=31536000",
      },
    });
  } catch {
    // SPA fallback — serve index.html for client-side routes
    const file = await Deno.readFile(`${WEB_DIST}/index.html`);
    return new Response(file, {
      headers: { "content-type": MIME.html, "cache-control": "no-cache" },
    });
  }
});

if (import.meta.main) {
  const port = Number(Deno.env.get("PORT") ?? 8000);
  try {
    if (Deno.env.get("SUPABASE_URL") && Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      const { assertSchemaExposed } = await import("./lib/supabase.ts");
      await assertSchemaExposed();
    }
  } catch (err) {
    console.error("Startup database schema verification failed:", err);
    Deno.exit(1);
  }
  Deno.serve({ port }, app.fetch);
}

export default app;
