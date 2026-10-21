// USDC -> BRL/Pix off-ramp (and on-ramp) surface, provider-agnostic.
//
// All handlers route through the configured `Anchor` provider (Etherfuse today;
// see lib/ramp/index.ts). The entire surface stays dormant — every authed
// endpoint returns 503 `offramp_disabled` — until ETHERFUSE_ENABLED=1 and
// ETHERFUSE_API_KEY are set in the API env. GET /status is public so the web
// app can show or hide the cash-out UI without a round trip per action.
//
// Etherfuse specifics baked into the flow:
//   - customer identity is the buyer's Stellar public key (wallet-based);
//   - KYC is hosted (iframe) — the client opens getKycUrl();
//   - off-ramp is deferred-signed: createOffRamp returns an unsigned tx the
//     user's passkey wallet signs + submits (via the existing relayer flow),
//     then we poll getOffRampTransaction for settlement.

import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireApiKeyOrJwt } from "../middleware/auth_any.ts";
import { applyMargin, getRampProvider } from "../lib/ramp/index.ts";
import { AnchorError, type Anchor } from "../lib/ramp/types.ts";

const r = new Hono();

// Map a thrown error to a JSON response. AnchorError carries an upstream
// statusCode + machine code; anything else is an opaque 502 (no leak).
function fail(c: Context, e: unknown): Response {
  if (e instanceof AnchorError) {
    const status = (e.statusCode >= 400 && e.statusCode <= 599)
      ? e.statusCode
      : 502;
    return c.json({ error: e.code, message: e.message }, status as 400);
  }
  return c.json({ error: "offramp_error" }, 502);
}

// Resolve the provider, or return a 503 Response when the integration is off.
function provider(c: Context): Anchor | Response {
  const p = getRampProvider();
  if (!p) return c.json({ error: "offramp_disabled" }, 503);
  return p;
}

// Public: lets the web app decide whether to render the cash-out flow.
r.get("/status", (c) => {
  const p = getRampProvider();
  if (!p) return c.json({ enabled: false });
  return c.json({
    enabled: true,
    provider: p.name,
    displayName: p.displayName,
    currencies: p.supportedCurrencies,
    rails: p.supportedRails,
    capabilities: p.capabilities,
  });
});

// Everything below requires auth.
r.use("/*", requireApiKeyOrJwt);

const QuoteSchema = z.object({
  fromCurrency: z.string().min(2), // e.g. "USDC"
  toCurrency: z.string().min(3), // e.g. "BRL"
  fromAmount: z.string().optional(),
  toAmount: z.string().optional(),
  customerId: z.string().optional(),
  stellarAddress: z.string().optional(),
  resourceId: z.string().optional(),
});

r.post("/quote", async (c) => {
  const p = provider(c);
  if (p instanceof Response) return p;
  let input: z.infer<typeof QuoteSchema>;
  try {
    input = QuoteSchema.parse(await c.req.json());
  } catch (e) {
    return c.json({ error: "validation_error", issues: (e as { issues?: unknown }).issues }, 400);
  }
  try {
    // applyMargin embeds Slippay's spread (SLIPPAY_RAMP_MARGIN_BPS, default
    // 1.9%) into the quote — on-ramp and off-ramp alike.
    return c.json({ quote: applyMargin(await p.getQuote(input)) });
  } catch (e) {
    return fail(c, e);
  }
});

const CustomerSchema = z.object({
  email: z.string().email().optional(),
  country: z.string().optional(),
  publicKey: z.string().optional(),
  name: z.string().optional(),
  taxId: z.string().optional(),
  taxIdCountry: z.string().optional(),
});

r.post("/customer", async (c) => {
  const p = provider(c);
  if (p instanceof Response) return p;
  let input: z.infer<typeof CustomerSchema>;
  try {
    input = CustomerSchema.parse(await c.req.json());
  } catch (e) {
    return c.json({ error: "validation_error", issues: (e as { issues?: unknown }).issues }, 400);
  }
  try {
    return c.json({ customer: await p.createCustomer(input) });
  } catch (e) {
    return fail(c, e);
  }
});

// Hosted KYC / onboarding URL (iframe). publicKey is the wallet identity.
r.get("/kyc-url", async (c) => {
  const p = provider(c);
  if (p instanceof Response) return p;
  if (!p.getKycUrl) return c.json({ error: "unsupported" }, 501);
  const customerId = c.req.query("customerId") ?? "";
  const publicKey = c.req.query("publicKey") ?? undefined;
  const bankAccountId = c.req.query("bankAccountId") ?? undefined;
  if (!customerId) return c.json({ error: "missing_customer_id" }, 400);
  try {
    return c.json({ url: await p.getKycUrl(customerId, publicKey, bankAccountId) });
  } catch (e) {
    return fail(c, e);
  }
});

r.get("/customer/:id/kyc", async (c) => {
  const p = provider(c);
  if (p instanceof Response) return p;
  const id = c.req.param("id");
  const publicKey = c.req.query("publicKey") ?? undefined;
  try {
    return c.json({ status: await p.getKycStatus(id, publicKey) });
  } catch (e) {
    return fail(c, e);
  }
});

r.get("/customer/:id/fiat-accounts", async (c) => {
  const p = provider(c);
  if (p instanceof Response) return p;
  try {
    return c.json({ accounts: await p.getFiatAccounts(c.req.param("id")) });
  } catch (e) {
    return fail(c, e);
  }
});

const OffRampSchema = z.object({
  customerId: z.string().min(1),
  quoteId: z.string().min(1),
  stellarAddress: z.string().min(1),
  fromCurrency: z.string().min(2),
  toCurrency: z.string().min(3),
  amount: z.string().min(1),
  fiatAccountId: z.string().min(1),
  memo: z.string().optional(),
});

r.post("/order", async (c) => {
  const p = provider(c);
  if (p instanceof Response) return p;
  let input: z.infer<typeof OffRampSchema>;
  try {
    input = OffRampSchema.parse(await c.req.json());
  } catch (e) {
    return c.json({ error: "validation_error", issues: (e as { issues?: unknown }).issues }, 400);
  }
  try {
    return c.json({ order: await p.createOffRamp(input) }, 201);
  } catch (e) {
    return fail(c, e);
  }
});

r.get("/order/:id", async (c) => {
  const p = provider(c);
  if (p instanceof Response) return p;
  try {
    const tx = await p.getOffRampTransaction(c.req.param("id"));
    if (!tx) return c.json({ error: "not_found" }, 404);
    return c.json({ order: tx });
  } catch (e) {
    return fail(c, e);
  }
});

// ── On-ramp (fiat Pix -> crypto) ────────────────────────────────────────────
// Charge-model providers (CriptoPix) need inline payer identity (CPF + DOB);
// passed via `identity`. The response carries `paymentInstructions.pixCode`
// (the Pix copy-paste / brCode) to render for the payer.
const OnRampSchema = z.object({
  customerId: z.string().min(1),
  quoteId: z.string().min(1),
  stellarAddress: z.string().min(1),
  fromCurrency: z.string().min(3), // e.g. "BRL"
  toCurrency: z.string().min(2), // e.g. "USDC"
  amount: z.string().min(1),
  memo: z.string().optional(),
  bankAccountId: z.string().optional(),
  identity: z.object({
    name: z.string(),
    email: z.string(),
    taxId: z.string(),
    taxIdCountry: z.string().optional(),
    birthDate: z.string().optional(),
  }).optional(),
});

r.post("/onramp", async (c) => {
  const p = provider(c);
  if (p instanceof Response) return p;
  let input: z.infer<typeof OnRampSchema>;
  try {
    input = OnRampSchema.parse(await c.req.json());
  } catch (e) {
    return c.json({ error: "validation_error", issues: (e as { issues?: unknown }).issues }, 400);
  }
  try {
    return c.json({ order: await p.createOnRamp(input) }, 201);
  } catch (e) {
    return fail(c, e);
  }
});

r.get("/onramp/:id", async (c) => {
  const p = provider(c);
  if (p instanceof Response) return p;
  try {
    const tx = await p.getOnRampTransaction(c.req.param("id"));
    if (!tx) return c.json({ error: "not_found" }, 404);
    return c.json({ order: tx });
  } catch (e) {
    return fail(c, e);
  }
});

// Diagnostic: list rampable assets (confirms the USDC identifier on Stellar).
r.get("/assets", async (c) => {
  const p = provider(c);
  if (p instanceof Response) return p;
  const anyp = p as unknown as {
    getAssets?: (b: string, cur: string, w: string) => Promise<unknown>;
  };
  if (!anyp.getAssets) return c.json({ error: "unsupported" }, 501);
  const blockchain = c.req.query("blockchain") ?? "stellar";
  const currency = c.req.query("currency") ?? "brl";
  const wallet = c.req.query("wallet") ?? "";
  try {
    return c.json({ assets: await anyp.getAssets(blockchain, currency, wallet) });
  } catch (e) {
    return fail(c, e);
  }
});

export default r;
