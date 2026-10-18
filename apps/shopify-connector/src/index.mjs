// SlipPay × Shopify — connector.
//
// Three integration modes on one zero-dep server (node 18+):
//
// A) PUBLIC OAUTH APP (multi-shop, distributable by install link):
//    GET  /shopify/install?shop=x.myshopify.com  → Shopify OAuth authorize
//    GET  /shopify/oauth/callback                → token exchange, webhook
//         registration, redirect to per-shop settings page
//    GET/POST /shopify/settings                  → merchant pastes SlipPay creds
//    POST /shopify/gdpr/*                        → mandatory compliance hooks
//    Requires SHOPIFY_APP_KEY + SHOPIFY_APP_SECRET (from the Partner app).
//
// B) LEGACY SINGLE-SHOP custom app (env SHOPIFY_SHOP/ACCESS_TOKEN/WEBHOOK_SECRET)
//    — kept working as the fallback when a webhook's shop has no OAuth record.
//
// Both A and B share the same money path:
//    orders/create (HMAC verified) → SlipPay order (external_ref=shopify:<id>)
//    → buyer pays via /shopify/pay/<order_number> → SlipPay order.paid
//    (signature verified) → mark the Shopify order paid via Admin API.
//
// C) Payments App scaffold (/payment_sessions etc.) — future official gateway.
//
// State persists to STATE_FILE. Run: node src/index.mjs

import http from "node:http";
import { createHmac, timingSafeEqual, randomUUID, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 4001);
const SLIPPAY_API_BASE = process.env.SLIPPAY_API_BASE ?? "https://api.slippay.cc";
// Public base of THIS connector as seen by Shopify/browsers.
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://api.slippay.cc/shopify";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2024-10";
// OAuth app credentials (Partner dashboard → app → Client credentials).
const APP_KEY = process.env.SHOPIFY_APP_KEY ?? "";
const APP_SECRET = process.env.SHOPIFY_APP_SECRET ?? "";
const OAUTH_SCOPES = process.env.SHOPIFY_APP_SCOPES ?? "read_orders,write_orders";
// Default SlipPay merchant credentials (used when a shop has none of its own).
const SLIPPAY_API_KEY = process.env.SLIPPAY_API_KEY ?? "";
const SLIPPAY_WEBHOOK_SECRET = process.env.SLIPPAY_WEBHOOK_SECRET ?? "";
// Legacy single-shop custom app (mode B).
const LEGACY_SHOP = process.env.SHOPIFY_SHOP ?? "";
const LEGACY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN ?? "";
const LEGACY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET ?? "";
const GATEWAY_MATCH = (process.env.SLIPPAY_GATEWAY_MATCH ?? "slippay").toLowerCase();
const STATE_FILE = process.env.STATE_FILE ?? "./shopify-connector-state.json";
const WEBHOOK_TOLERANCE_S = 300;
export const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 1_048_576);
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

// ---------- state ----------
function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
const state = { orders: {}, sessions: {}, shops: {}, nonces: {}, ...loadState() };
function saveState() {
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_FILE);
}

// ---------- helpers ----------
const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const html = (res, code, body) => {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
};
const redirect = (res, to) => { res.writeHead(302, { location: to }); res.end(); };
export class PayloadTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Payload exceeds maximum size of ${maxBytes} bytes`);
    this.name = "PayloadTooLargeError";
    this.statusCode = 413;
  }
}

export async function readRawBody(req, maxBytes = MAX_BODY_BYTES) {
  const declaredLength = Number(req?.headers?.["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new PayloadTooLargeError(maxBytes);
  }
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
    total += buf.length;
    if (total > maxBytes) {
      throw new PayloadTooLargeError(maxBytes);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}
const parse = (buf) => { try { return JSON.parse(buf.toString("utf8")); } catch { return {}; } };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function safeEqual(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) { timingSafeEqual(ba, ba); return false; }
  return timingSafeEqual(ba, bb);
}

// Shopify webhook HMAC: base64(HMAC-SHA256(secret, raw body)).
// OAuth-app webhooks are signed with the app secret; legacy custom-app
// webhooks with the custom app's API secret key. Accept either.
export function verifyShopifyWebhookHmac(rawBody, header, secrets = [APP_SECRET, LEGACY_WEBHOOK_SECRET]) {
  if (!header) return false;
  const list = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of list) {
    if (!secret) continue;
    const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
    if (safeEqual(digest, header)) return true;
  }
  return false;
}

// Shopify OAuth/App-URL query HMAC: hex HMAC-SHA256 over the sorted query
// string (minus hmac/signature), keyed with the app secret.
export function verifyShopifyQueryHmac(params, secret = APP_SECRET) {
  if (!secret) return false;
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const msg = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const digest = createHmac("sha256", secret).update(msg).digest("hex");
  return safeEqual(digest, hmac);
}

// SlipPay webhook signature: "t=<sec>,v1=<hex hmac over `${t}.${body}`>".
export function verifySlippaySig(rawBody, header, secrets) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=")));
  const t = Number(parts.t);
  if (!isFinite(t) || Math.abs(Math.floor(Date.now() / 1000) - t) > WEBHOOK_TOLERANCE_S) return false;
  for (const secret of secrets) {
    if (!secret) continue;
    const hex = createHmac("sha256", secret).update(`${t}.${rawBody.toString("utf8")}`).digest("hex");
    if (safeEqual(`t=${t},v1=${hex}`, header)) return true;
  }
  return false;
}

async function createSlippayOrder({ apiKey, amount, externalRef }) {
  const r = await fetch(`${SLIPPAY_API_BASE}/api/v1/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ brl_amount: Number(amount).toFixed(2), external_ref: externalRef }),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status !== 201) throw new Error(`slippay ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

// Per-shop credentials: OAuth record → legacy env → none.
function shopCreds(shop) {
  const rec = state.shops[shop];
  if (rec?.accessToken) {
    return {
      token: rec.accessToken,
      slippayApiKey: rec.slippayApiKey || SLIPPAY_API_KEY,
      slippayWebhookSecret: rec.slippayWebhookSecret || SLIPPAY_WEBHOOK_SECRET,
    };
  }
  if (shop === LEGACY_SHOP || !shop) {
    return { token: LEGACY_TOKEN, slippayApiKey: SLIPPAY_API_KEY, slippayWebhookSecret: SLIPPAY_WEBHOOK_SECRET };
  }
  return { token: "", slippayApiKey: SLIPPAY_API_KEY, slippayWebhookSecret: SLIPPAY_WEBHOOK_SECRET };
}

async function shopifyAdmin(shop, token, path, method = "GET", body) {
  if (!shop || !token) return { skipped: "no shop/token" };
  const r = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}${path}`, {
    method,
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

async function markShopifyOrderPaid(shop, token, orderId, { amount, currency, txHash }) {
  let out = await shopifyAdmin(shop, token, `/orders/${orderId}/transactions.json`, "POST", {
    transaction: { kind: "capture", status: "success" },
  });
  if (out.status >= 400) {
    out = await shopifyAdmin(shop, token, `/orders/${orderId}/transactions.json`, "POST", {
      transaction: { kind: "sale", status: "success", amount, currency, source: "external" },
    });
  }
  if (txHash) {
    await shopifyAdmin(shop, token, `/orders/${orderId}.json`, "PUT", {
      order: { id: orderId, note_attributes: [{ name: "slippay_tx", value: txHash }] },
    });
  }
  return out;
}

async function registerOrdersWebhook(shop, token) {
  const address = `${APP_BASE_URL}/orders-create`;
  const { data } = await shopifyAdmin(shop, token, "/webhooks.json");
  const dup = (data.webhooks ?? []).find(w => w.topic === "orders/create" && w.address === address);
  if (dup) return dup.id;
  const out = await shopifyAdmin(shop, token, "/webhooks.json", "POST", {
    webhook: { topic: "orders/create", address, format: "json" },
  });
  return out.data?.webhook?.id ?? null;
}

// ---------- settings page (mode A) ----------
function settingsUrl(shop) {
  const rec = state.shops[shop];
  return `${APP_BASE_URL}/settings?shop=${encodeURIComponent(shop)}&t=${rec?.settingsToken ?? ""}`;
}
function settingsPage(shop, saved = false) {
  const rec = state.shops[shop] ?? {};
  return `<!doctype html><meta charset="utf-8"><title>SlipPay · ${esc(shop)}</title>
<style>body{font-family:system-ui;max-width:560px;margin:48px auto;padding:0 16px;color:#111}
input{width:100%;padding:10px;margin:6px 0 16px;border:1px solid #bbb;border-radius:6px;font-family:monospace}
button{background:#111;color:#fff;border:0;padding:12px 24px;border-radius:6px;cursor:pointer}
.ok{background:#e6f6e6;border:1px solid #9c9;padding:10px;border-radius:6px;margin-bottom:16px}
code{background:#f2f2f2;padding:2px 5px;border-radius:4px}</style>
<h1>SlipPay</h1>
<p>Loja: <b>${esc(shop)}</b> · app instalado ✓ · webhook de pedidos ✓</p>
${saved ? '<div class="ok">Configuração salva.</div>' : ""}
<form method="post" action="${esc(settingsUrl(shop))}">
  <label>SlipPay API key (do seu dashboard SlipPay)</label>
  <input name="slippay_api_key" placeholder="sk_live_..." value="${esc(rec.slippayApiKey ?? "")}">
  <label>SlipPay webhook secret (do mesmo dashboard)</label>
  <input name="slippay_webhook_secret" placeholder="hex" value="${esc(rec.slippayWebhookSecret ?? "")}">
  <button>Salvar</button>
</form>
<p>Depois de salvar: no dashboard SlipPay, configure o webhook URL para
<code>${esc(APP_BASE_URL)}/slippay-webhook</code>. Crie também o método de
pagamento manual <code>SlipPay (USDC)</code> em Settings → Payments da sua loja,
com a instrução: <i>"Para pagar, acesse ${esc(APP_BASE_URL)}/pay/ seguido do
número do seu pedido"</i>.</p>
<p>Sem chave própria, a loja usa a conta SlipPay padrão do conector (se houver).</p>`;
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // The connector is reverse-proxied at /shopify/* — accept both forms.
  const path = url.pathname.replace(/^\/shopify(?=\/|$)/, "") || "/";
  const q = url.searchParams;

  // ---- mode A: OAuth install flow ----
  if (req.method === "GET" && (path === "/install" || path === "/app" || path === "/")) {
    const shop = (q.get("shop") ?? "").toLowerCase();
    if (!APP_KEY || !APP_SECRET) return json(res, 503, { error: "oauth app not configured (SHOPIFY_APP_KEY/SECRET)" });
    if (!SHOP_RE.test(shop)) {
      return html(res, 200, `<!doctype html><meta charset="utf-8"><title>SlipPay para Shopify</title>
<body style="font-family:system-ui;max-width:560px;margin:48px auto;padding:0 16px">
<h1>SlipPay para Shopify</h1>
<p>Receba em USDC (Stellar) na sua loja. Informe o domínio da loja pra instalar:</p>
<form method="get" action="${esc(APP_BASE_URL)}/install">
<input name="shop" placeholder="minha-loja.myshopify.com" style="width:100%;padding:10px;border:1px solid #bbb;border-radius:6px">
<button style="margin-top:12px;background:#111;color:#fff;border:0;padding:12px 24px;border-radius:6px">Instalar</button>
</form></body>`);
    }
    // Shopify opens the App URL with signed params; installed shops go to settings.
    if (path !== "/install" && state.shops[shop]?.accessToken && verifyShopifyQueryHmac(q)) {
      return redirect(res, settingsUrl(shop));
    }
    const nonce = randomBytes(16).toString("hex");
    state.nonces[nonce] = { shop, at: Date.now() };
    // GC nonces older than 10 min.
    for (const [n, v] of Object.entries(state.nonces)) if (Date.now() - v.at > 600_000) delete state.nonces[n];
    saveState();
    const authorize = `https://${shop}/admin/oauth/authorize?client_id=${APP_KEY}` +
      `&scope=${encodeURIComponent(OAUTH_SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(`${APP_BASE_URL}/oauth/callback`)}` +
      `&state=${nonce}`;
    return redirect(res, authorize);
  }

  if (req.method === "GET" && path === "/oauth/callback") {
    const shop = (q.get("shop") ?? "").toLowerCase();
    const code = q.get("code") ?? "";
    const nonce = q.get("state") ?? "";
    if (!SHOP_RE.test(shop)) return json(res, 400, { error: "bad shop" });
    if (!verifyShopifyQueryHmac(q)) return json(res, 401, { error: "bad oauth hmac" });
    if (!state.nonces[nonce] || state.nonces[nonce].shop !== shop) return json(res, 401, { error: "bad state nonce" });
    delete state.nonces[nonce];
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: APP_KEY, client_secret: APP_SECRET, code }),
    });
    const tok = await r.json().catch(() => ({}));
    if (!tok.access_token) return json(res, 502, { error: "token exchange failed", detail: tok });
    state.shops[shop] = {
      ...(state.shops[shop] ?? {}),
      accessToken: tok.access_token,
      scope: tok.scope,
      installedAt: new Date().toISOString(),
      settingsToken: state.shops[shop]?.settingsToken ?? randomBytes(16).toString("hex"),
    };
    saveState();
    const webhookId = await registerOrdersWebhook(shop, tok.access_token);
    console.log(`[oauth] installed on ${shop} (webhook ${webhookId})`);
    return redirect(res, settingsUrl(shop));
  }

  if (path === "/settings") {
    const shop = (q.get("shop") ?? "").toLowerCase();
    const rec = state.shops[shop];
    if (!rec || !safeEqual(q.get("t") ?? "", rec.settingsToken ?? "-")) {
      return json(res, 401, { error: "unauthorized (reinstall to get a fresh settings link)" });
    }
    if (req.method === "POST") {
      const body = new URLSearchParams((await readRawBody(req)).toString("utf8"));
      rec.slippayApiKey = (body.get("slippay_api_key") ?? "").trim();
      rec.slippayWebhookSecret = (body.get("slippay_webhook_secret") ?? "").trim();
      saveState();
      return html(res, 200, settingsPage(shop, true));
    }
    return html(res, 200, settingsPage(shop));
  }

  // ---- mandatory GDPR webhooks (public app requirement) ----
  if (req.method === "POST" && path.startsWith("/gdpr/")) {
    const sigHeader = req.headers["x-shopify-hmac-sha256"];
    if (!sigHeader) return json(res, 401, { error: "missing hmac" });
    const raw = await readRawBody(req);
    if (!verifyShopifyWebhookHmac(raw, sigHeader)) {
      return json(res, 401, { error: "bad hmac" });
    }
    // shop/redact: drop everything we hold for the shop.
    if (path === "/gdpr/shop-redact") {
      const shop = (parse(raw).shop_domain ?? "").toLowerCase();
      if (state.shops[shop]) { delete state.shops[shop]; saveState(); }
      for (const [k, o] of Object.entries(state.orders)) if (o.shop === shop) delete state.orders[k];
      saveState();
    }
    // customers/data_request + customers/redact: we store no customer PII
    // (order number + amounts only) — acknowledge.
    return json(res, 200, { received: true });
  }

  // ---- money path: orders/create webhook (modes A + B) ----
  if (req.method === "POST" && path === "/orders-create") {
    const sigHeader = req.headers["x-shopify-hmac-sha256"];
    if (!sigHeader) return json(res, 401, { error: "missing shopify hmac" });
    const raw = await readRawBody(req);
    if (!verifyShopifyWebhookHmac(raw, sigHeader)) {
      return json(res, 401, { error: "bad shopify hmac" });
    }
    const shop = ((req.headers["x-shopify-shop-domain"] ?? LEGACY_SHOP) + "").toLowerCase();
    const o = parse(raw);
    const gateways = (o.payment_gateway_names ?? []).map(g => String(g).toLowerCase());
    if (!gateways.some(g => g.includes(GATEWAY_MATCH))) {
      return json(res, 200, { ignored: "not a slippay order", gateways });
    }
    const key = String(o.id);
    if (state.orders[key]) return json(res, 200, { deduped: true });
    const creds = shopCreds(shop);
    if (!creds.slippayApiKey) return json(res, 200, { ok: false, error: "shop has no SlipPay api key configured" });
    try {
      const { order, checkout_url } = await createSlippayOrder({
        apiKey: creds.slippayApiKey,
        amount: o.total_price,
        externalRef: `shopify:${o.id}`,
      });
      state.orders[key] = {
        shop,
        shopifyOrderId: o.id,
        orderNumber: String(o.order_number ?? o.number ?? ""),
        name: o.name ?? "",
        amount: o.total_price,
        currency: o.currency,
        slippayOrderId: order.id,
        checkoutUrl: checkout_url,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      saveState();
      console.log(`[orders-create] ${shop} ${o.name} → slippay ${order.id}`);
      return json(res, 200, { ok: true, slippay_order: order.id });
    } catch (e) {
      console.error(`[orders-create] ${shop}: ${e.message ?? e}`);
      return json(res, 200, { ok: false, error: String(e.message ?? e) });
    }
  }

  // ---- buyer payment link ----
  if (req.method === "GET" && path.startsWith("/pay/")) {
    const wanted = decodeURIComponent(path.split("/").pop() ?? "").replace(/^#/, "");
    const hit = Object.values(state.orders).find(
      s => s.orderNumber === wanted || s.name === `#${wanted}` || String(s.shopifyOrderId) === wanted,
    );
    if (!hit) return json(res, 404, { error: "order not found (webhook may not have arrived yet — retry in a few seconds)" });
    return redirect(res, hit.checkoutUrl);
  }

  // ---- SlipPay order.paid → mark Shopify order paid ----
  if (req.method === "POST" && path === "/slippay-webhook") {
    const sigHeader = req.headers["x-slippay-signature"];
    if (!sigHeader) return json(res, 401, { error: "missing slippay signature" });
    const raw = await readRawBody(req);
    const allSecrets = [SLIPPAY_WEBHOOK_SECRET, ...Object.values(state.shops).map(s => s.slippayWebhookSecret)];
    if (!verifySlippaySig(raw, sigHeader, allSecrets)) {
      return json(res, 401, { error: "bad slippay signature" });
    }
    const b = parse(raw);
    if (b.type !== "order.paid") {
      return json(res, 200, { received: true, ignored: b.type });
    }
    const d = b.data ?? {};
    const hit = Object.entries(state.orders).find(([, s]) =>
      s.slippayOrderId === d.id || `shopify:${s.shopifyOrderId}` === d.external_ref);
    if (!hit) {
      return json(res, 200, { received: true, unmatched: d.id });
    }
    const [key, s] = hit;
    const creds = shopCreds(s.shop);
    if (!verifySlippaySig(raw, sigHeader, [creds.slippayWebhookSecret, SLIPPAY_WEBHOOK_SECRET])) {
      return json(res, 401, { error: "bad slippay signature" });
    }
    if (s.status === "paid") return json(res, 200, { received: true, deduped: true });
    const out = await markShopifyOrderPaid(s.shop, creds.token, s.shopifyOrderId, {
      amount: s.amount, currency: s.currency, txHash: d.tx_hash,
    });
    state.orders[key] = { ...s, status: "paid", txHash: d.tx_hash, paidAt: d.paid_at };
    saveState();
    console.log(`[order.paid] slippay ${d.id} → ${s.shop} ${s.name} marked paid (${out.status ?? "skipped"})`);
    return json(res, 200, { received: true, shopify: out });
  }

  // ---- mode C: Payments App scaffold ----
  if (req.method === "POST" && path === "/payment_sessions") {
    const raw = await readRawBody(req);
    const b = parse(raw);
    const sessionId = b.id ?? b.gid ?? randomUUID();
    if (state.sessions[sessionId]) {
      return json(res, 201, { redirect_url: state.sessions[sessionId].checkoutUrl });
    }
    const amount = b.amount ?? b.payment?.amount;
    const apiKey = b.merchant_settings?.api_key || SLIPPAY_API_KEY;
    if (!apiKey) return json(res, 400, { error: "missing SlipPay api_key" });
    try {
      const { order, checkout_url } = await createSlippayOrder({ apiKey, amount, externalRef: `shopify-session:${sessionId}` });
      state.sessions[sessionId] = { slippayOrderId: order.id, status: "pending", checkoutUrl: checkout_url };
      saveState();
      return json(res, 201, { redirect_url: checkout_url, slippay_order: order.id });
    } catch (e) {
      return json(res, 422, { error: String(e.message ?? e) });
    }
  }
  for (const kind of ["refund", "capture", "void"]) {
    if (req.method === "POST" && path === `/${kind}_sessions`) {
      const b = parse(await readRawBody(req));
      return json(res, 201, { id: b.id, code: `${kind}-acknowledged`, message: "non-custodial; settles on-chain at payment time" });
    }
  }

  if (req.method === "GET" && path === "/health") {
    return json(res, 200, {
      ok: true,
      slippay: SLIPPAY_API_BASE,
      oauthApp: Boolean(APP_KEY && APP_SECRET),
      installedShops: Object.keys(state.shops).length,
      legacyShop: Boolean(LEGACY_SHOP && LEGACY_TOKEN),
      hasSlippayKey: Boolean(SLIPPAY_API_KEY),
      verifiesShopifyHmac: Boolean(APP_SECRET || LEGACY_WEBHOOK_SECRET),
      verifiesSlippaySig: Boolean(SLIPPAY_WEBHOOK_SECRET),
      canMarkPaid: Boolean((LEGACY_SHOP && LEGACY_TOKEN) || Object.values(state.shops).some(s => s.accessToken)),
      orders: Object.keys(state.orders).length,
    });
  }
  json(res, 404, { error: "not_found", path: url.pathname });
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return json(res, 413, { error: "payload_too_large", message: err.message });
    }
    return json(res, 500, { error: "internal_error" });
  }
});

import { fileURLToPath } from "node:url";

if (process.env.SHOPIFY_CONNECTOR_NO_LISTEN !== "1" && process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`SlipPay×Shopify connector on :${PORT} → ${SLIPPAY_API_BASE} (oauth: ${APP_KEY ? "on" : "off"})`));
}
