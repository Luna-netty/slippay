// 4P Finance ramp surface (on-ramp Pix->crypto today; off-ramp lives in the
// existing PagFinance integration). Provider-specific because 4P is a plain REST
// API with an x-api-key held server-side — never proxied to the browser.
//
// Mount: api.route("/v1/4p", fourp)
//   GET  /v1/4p/status            (public) — is 4P configured?
//   POST /v1/4p/webhook           (public, 4P server-to-server, two-step pull)
//   POST /v1/4p/quote             (authed) — BRL -> crypto price
//   POST /v1/4p/onramp            (authed) — create Pix charge -> wallet
//   GET  /v1/4p/onramp/:id        (authed) — status from the webhook store
//
// Dormant until FOURP_API_KEY is set in the API env.

import { Hono, type Context } from "hono";
import { z } from "zod";
import { rateLimit } from "../middleware/rate_limit.ts";
import { FourPClient, FourPError } from "../lib/fourp/client.ts";
import { getRampTx, saveRampTx } from "../lib/ramp/store.ts";
import { isAllowedOrigin } from "@slippay/shared";

const r = new Hono();

// 4P's documented webhook source IP (allowlist as defense-in-depth).
const FOURP_WEBHOOK_IP = "44.196.63.157";

function client(): FourPClient | null {
  const apiKey = Deno.env.get("FOURP_API_KEY")?.trim();
  if (!apiKey) return null;
  return new FourPClient({
    apiKey,
    baseUrl: Deno.env.get("FOURP_BASE_URL")?.trim() || "https://api.4p.finance",
    chain: Deno.env.get("FOURP_CHAIN")?.trim() || "Base",
    asset: Deno.env.get("FOURP_ASSET")?.trim() || "USDC",
  });
}

function webhookBase(): string {
  return Deno.env.get("FOURP_WEBHOOK_BASE")?.trim() || "https://api.slippay.cc/api";
}

function fail(c: Context, e: unknown): Response {
  if (e instanceof FourPError) return c.json({ error: "fourp_error", message: e.message }, 502);
  return c.json({ error: "ramp_error", message: String((e as Error)?.message ?? e) }, 502);
}

// ── public ──────────────────────────────────────────────────────────────────

r.get("/status", (c) => {
  const cl = client();
  if (!cl) return c.json({ enabled: false });
  return c.json({ enabled: true, provider: "4p", chain: cl.chain, asset: cl.asset, rails: ["pix"] });
});

// 4P posts only a notification token; we pull the real status via the API key.
r.post("/webhook", async (c) => {
  const cl = client();
  if (!cl) return c.json({ error: "ramp_disabled" }, 503);

  // Defense-in-depth: prefer requests from 4P's documented egress IP.
  const xff = (c.req.header("x-forwarded-for") ?? "").split(",").map((s) => s.trim());
  if (xff.length && !xff.includes(FOURP_WEBHOOK_IP)) {
    // log-and-continue: token resolution below is the real auth
    console.log(`4p webhook from unexpected ip chain: ${xff.join(",")}`);
  }

  let token: string | undefined;
  try {
    const body = await c.req.json();
    token = body?.token ?? body?.notification_token ?? body?.notificationToken;
  } catch { /* token may be in query */ }
  token = token ?? c.req.query("token") ?? c.req.query("notification_token");
  if (!token) return c.json({ error: "missing_token" }, 400);

  try {
    const n = await cl.getNotification(token); // resolves only for real 4P tokens
    const key = n.custom_id || n.txid;
    if (!key) return c.json({ error: "no_id" }, 422);
    await saveRampTx({
      gatewayId: key,
      provider: "4p",
      transactionId: n.txid,
      transactionType: "PIX_PURCHASE",
      transactionStatus: n.status, // e.g. "paid"
      reaisAmount: n.amount ? Number(n.amount) : undefined,
      raw: n,
    });
    return c.json({ ok: true, id: key });
  } catch (e) {
    return fail(c, e);
  }
});

// ── comex-facing (public, origin-gated + rate-limited) ───────────────────────
// The comex user authenticates with Privy, not a Slippay API key/JWT, so these
// can't sit behind requireApiKeyOrJwt. The 4P x-api-key stays server-side; the
// browser only sends the buyer's request. Origin allowlist + rate limit prevent
// off-app abuse. Charges are self-paid in R$, so there is no fund-theft vector.
function originGate(c: Context, next: () => Promise<void>) {
  const cand = c.req.header("origin") ?? c.req.header("referer");
  if (!cand) return c.json({ error: "origin_required" }, 403);
  let o: string;
  try { o = new URL(cand).origin; } catch { return c.json({ error: "origin_not_allowed" }, 403); }
  if (!isAllowedOrigin(o)) return c.json({ error: "origin_not_allowed" }, 403);
  return next();
}
r.use("/quote", originGate, rateLimit({ capacity: 20, refillPerSec: 20 / 60, scope: "4p_quote" }));
r.use("/onramp", originGate, rateLimit({ capacity: 10, refillPerSec: 10 / 60, scope: "4p_onramp" }));
r.use("/onramp/*", originGate, rateLimit({ capacity: 30, refillPerSec: 30 / 60, scope: "4p_onramp_status" }));

const QuoteSchema = z.object({ amountBrl: z.number().positive() });

r.post("/quote", async (c) => {
  const cl = client();
  if (!cl) return c.json({ error: "ramp_disabled" }, 503);
  let input: z.infer<typeof QuoteSchema>;
  try {
    input = QuoteSchema.parse(await c.req.json());
  } catch (e) {
    return c.json({ error: "validation_error", issues: (e as { issues?: unknown }).issues }, 400);
  }
  try {
    const q = await cl.quote(String(input.amountBrl));
    // Slippay spread (default 2.8%). Applied to the displayed crypto output.
    // NOTE: real capture requires 4P to settle the NET amount (fee field) or a
    // rev-share — on a direct-to-user on-ramp the Pix lands at 4P, not Slippay.
    const bps = Number(Deno.env.get("FOURP_MARGIN_BPS"));
    const marginBps = Number.isFinite(bps) && bps >= 0 && bps <= 1000 ? bps : 280;
    // Capture the gross (4P) price per asset before applying our margin, so the
    // client can show the user the exact dollar rate AND the fee transparently.
    const map = q.quote ?? {};
    const gross: Record<string, number> = {};
    const netBps = 10_000 - marginBps;
    for (const k of Object.keys(map)) {
      gross[k] = map[k].price;
      // Integer basis points: net multiplier (10_000 - marginBps).
      // Explicit rounding direction: round down (Math.floor) to native USDC precision (6 decimals),
      // in the platform's disfavour, eliminating 8-decimal toFixed string truncation.
      const net = Math.floor(gross[k] * netBps * 1e2) / 1e6;
      map[k] = {
        ...map[k],
        price: net,
      };
    }
    return c.json({ quote: q, gross, marginBps });
  } catch (e) {
    return fail(c, e);
  }
});

const OnrampSchema = z.object({
  amountBrl: z.number().min(0.01),
  receiverWallet: z.string().min(1),
  email: z.string().email(),
  cpf: z.string().optional(),
  cnpj: z.string().optional(),
  customId: z.string().min(1).optional(),
  description: z.string().max(140).optional(),
  chain: z.string().optional(),
  asset: z.string().optional(),
});

r.post("/onramp", async (c) => {
  const cl = client();
  if (!cl) return c.json({ error: "ramp_disabled" }, 503);
  let input: z.infer<typeof OnrampSchema>;
  try {
    input = OnrampSchema.parse(await c.req.json());
  } catch (e) {
    return c.json({ error: "validation_error", issues: (e as { issues?: unknown }).issues }, 400);
  }
  if (!input.cpf && !input.cnpj) {
    return c.json({ error: "validation_error", message: "cpf or cnpj required" }, 400);
  }
  const customId = input.customId ?? `slp-${crypto.randomUUID()}`;
  try {
    const order = await cl.createOnramp({
      cpf: input.cpf,
      cnpj: input.cnpj,
      email: input.email,
      amountBrl: input.amountBrl,
      receiverWallet: input.receiverWallet,
      customId,
      description: input.description ?? "Slippay on-ramp",
      notificationUrl: `${webhookBase()}/v1/4p/webhook?cid=${encodeURIComponent(customId)}`,
      chain: input.chain,
      asset: input.asset,
    });
    // seed the store so /onramp/:id works before the first webhook
    await saveRampTx({
      gatewayId: customId,
      provider: "4p",
      transactionId: order.txid,
      transactionType: "PIX_PURCHASE",
      transactionStatus: order.status || "pending",
      reaisAmount: input.amountBrl,
      raw: order,
    });
    return c.json({
      order: { id: customId, txid: order.txid, pixCopiaECola: order.pixCopiaECola, status: order.status },
    }, 201);
  } catch (e) {
    return fail(c, e);
  }
});

r.get("/onramp/:id", async (c) => {
  if (!client()) return c.json({ error: "ramp_disabled" }, 503);
  try {
    const rec = await getRampTx(c.req.param("id"));
    if (!rec) return c.json({ error: "not_found" }, 404);
    return c.json({ order: rec });
  } catch (e) {
    return fail(c, e);
  }
});

// ── off-ramp (USDC -> R$ via Pix) ─────────────────────────────────────────────
// Sell flow: the user signs a USDC transfer to 4P's receiver wallet (returned by
// createOfframp), and 4P pays out R$ to the destination Pix key. The frontend
// pins the receiver (VITE_4P_OFFRAMP_RECEIVER) and asserts it before signing.
r.use("/offramp", originGate, rateLimit({ capacity: 10, refillPerSec: 10 / 60, scope: "4p_offramp" }));
r.use("/offramp/*", originGate, rateLimit({ capacity: 30, refillPerSec: 30 / 60, scope: "4p_offramp_status" }));

const OfframpQuoteSchema = z.object({ amountUsdc: z.number().positive() });

r.post("/offramp/quote", async (c) => {
  const cl = client();
  if (!cl) return c.json({ error: "ramp_disabled" }, 503);
  let input: z.infer<typeof OfframpQuoteSchema>;
  try {
    input = OfframpQuoteSchema.parse(await c.req.json());
  } catch (e) {
    return c.json({ error: "validation_error", issues: (e as { issues?: unknown }).issues }, 400);
  }
  try {
    const q = await cl.quoteOfframp(String(input.amountUsdc));
    const bps = Number(Deno.env.get("FOURP_MARGIN_BPS"));
    const marginBps = Number.isFinite(bps) && bps >= 0 && bps <= 1000 ? bps : 280;
    const entry = q.quote ? Object.values(q.quote)[0] : undefined;
    const brlGross = entry?.price;
    const brlOut = typeof brlGross === "number"
      ? Number((brlGross * (1 - marginBps / 10_000)).toFixed(2))
      : null;
    return c.json({ brlOut, receiver: Deno.env.get("FOURP_OFFRAMP_RECEIVER")?.trim() || null, asset: cl.asset, marginBps });
  } catch (e) {
    return fail(c, e);
  }
});

const OfframpSchema = z.object({
  amountUsdc: z.number().min(0.01),
  pixKey: z.string().min(1),
  senderWallet: z.string().min(1),
  email: z.string().email(),
  cpf: z.string().optional(),
  cnpj: z.string().optional(),
  customId: z.string().min(1).optional(),
});

r.post("/offramp", async (c) => {
  const cl = client();
  if (!cl) return c.json({ error: "ramp_disabled" }, 503);
  let input: z.infer<typeof OfframpSchema>;
  try {
    input = OfframpSchema.parse(await c.req.json());
  } catch (e) {
    return c.json({ error: "validation_error", issues: (e as { issues?: unknown }).issues }, 400);
  }
  if (!input.cpf && !input.cnpj) {
    return c.json({ error: "validation_error", message: "cpf or cnpj required" }, 400);
  }
  const customId = input.customId ?? `slp-off-${crypto.randomUUID()}`;
  try {
    const order = await cl.createOfframp({
      personDocument: (input.cnpj ?? input.cpf) as string,
      email: input.email,
      amountCrypto: input.amountUsdc,
      senderWallet: input.senderWallet,
      destinationPixKey: input.pixKey,
      customId,
      notificationUrl: `${webhookBase()}/v1/4p/webhook?cid=${encodeURIComponent(customId)}`,
    });
    // Security: if a receiver is pinned server-side, reject a mismatch before the
    // client is ever asked to sign (defense-in-depth alongside the client pin).
    const pinned = Deno.env.get("FOURP_OFFRAMP_RECEIVER")?.trim();
    if (pinned && order.receiver_wallet && order.receiver_wallet.toLowerCase() !== pinned.toLowerCase()) {
      return c.json({ error: "receiver_mismatch", message: "4P receiver did not match the pinned address" }, 502);
    }
    await saveRampTx({
      gatewayId: customId,
      provider: "4p",
      transactionId: order.txid,
      transactionType: "CRYPTO_PIX",
      transactionStatus: "pending",
      reaisAmount: order.amount_brl ? Number(order.amount_brl) : undefined,
      raw: order,
    });
    return c.json({ id: customId, receiver: order.receiver_wallet, amount: String(order.amount_crypto) }, 201);
  } catch (e) {
    return fail(c, e);
  }
});

r.get("/offramp/:id", async (c) => {
  if (!client()) return c.json({ error: "ramp_disabled" }, 503);
  try {
    const rec = await getRampTx(c.req.param("id"));
    if (!rec) return c.json({ error: "not_found" }, 404);
    return c.json({ transactionStatus: rec.transactionStatus });
  } catch (e) {
    return fail(c, e);
  }
});

export default r;
