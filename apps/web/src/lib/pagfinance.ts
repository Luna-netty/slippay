// Minimal vendored client for the PagFinance off-ramp API (crypto -> PIX/boleto).
// Mirrors the @pagfinance/sdk PaymentsResource/AssetsResource surface with zero
// deps. The SDK is "crypto-free" (no signing) — signing stays in the host app
// via lib/wallet.ts + lib/stellar.ts, preserving Slippay's non-custodial model.

const BASE = import.meta.env.VITE_PAGFINANCE_BASE ?? "https://app.pag.finance";
const CLIENT_ID = import.meta.env.VITE_PAGFINANCE_CLIENT_ID ?? "slippay";
const APP_DOMAIN = import.meta.env.VITE_PAGFINANCE_DOMAIN ?? "app.slippay.cc";
const TOKEN_KEY = "pagfin_jwt";

function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setPagToken(t: string | null): void {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "x-client-id": CLIENT_ID,
    "x-app-name": "slippay",
    "x-app-version": "1.0.0",
    "x-app-domain": APP_DOMAIN,
    "blockchain": "stellar",
    ...(extra ?? {}),
  };
  const tok = getToken();
  if (tok) h["authorization"] = `Bearer ${tok}`;
  return h;
}

// PagFinance uses two success/error envelopes plus raw objects. Handle all three.
function unwrap<T>(j: unknown): T {
  if (j && typeof j === "object") {
    const o = j as Record<string, unknown>;
    if ("success" in o) {
      if (o.success === false) {
        const err = o.error as { message?: string } | string | undefined;
        const m = (o.message as string) ?? (typeof err === "string" ? err : err?.message) ?? "pagfinance_error";
        throw new Error(m);
      }
      return o.data as T;
    }
    if ("ok" in o) {
      if (o.ok === false) {
        const err = o.error as { message?: string } | string | undefined;
        throw new Error(typeof err === "string" ? err : (err?.message ?? "pagfinance_error"));
      }
      return o.data as T;
    }
  }
  return j as T; // raw (e.g. /api/gatewayConfig)
}

async function req<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined>; headers?: Record<string, string> } = {},
): Promise<T> {
  let url = `${BASE}${path}`;
  if (opts.query) {
    const qs = Object.entries(opts.query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: headers(opts.headers),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let j: unknown = null;
  try { j = text ? JSON.parse(text) : null; } catch { j = text; }
  if (!res.ok) {
    const o = (j ?? {}) as Record<string, unknown>;
    const err = o.error as { message?: string } | string | undefined;
    const msg = (o.message as string) || (typeof err === "string" ? err : err?.message) || `pagfinance_http_${res.status}`;
    if (res.status === 401) throw new Error(`pagfinance auth needed (401): ${msg}`);
    throw new Error(typeof msg === "string" ? msg : `pagfinance_http_${res.status}`);
  }
  return unwrap<T>(j);
}

// ---- minimal types ----
export interface PagAsset { id: number; symbol: string; name: string; address: string; decimals: number; chainName: string; status: boolean; }
export interface PagTransfer { id?: string | null; amount: number; currency: string; type: string; invoiceCode?: string | null; invoiceValue?: number; pixKey?: string; description?: string; payerName?: string | null; }
export interface PagQuote { quoteId: string; valuesAndFees?: PagValues; }
export interface PagValues { paymentInFiat: number; totalFeeFiat: number; totalFiat: number; paymentInCrypto: number; totalFeeCrypto: number; totalCrypto: number; }
export interface PagCreate { memo?: string; blockchain?: string; receiver?: string; amount?: string; instruction?: string; }
export interface PagPayment { id?: string | null; status: string | number; proofUrl?: string | null; invoiceUrl?: string; }

// ---- endpoints ----
export async function gatewayConfig(chain = "stellar"): Promise<{ chains: { key?: string; name: string; assets: PagAsset[] }[] }> {
  return req("/api/gatewayConfig", { query: { chain } });
}

export async function stellarUsdcAssetId(): Promise<number> {
  const cfg = await gatewayConfig("stellar");
  const chains = cfg?.chains ?? [];
  for (const c of chains) {
    if (String(c.key ?? c.name ?? "").toLowerCase().includes("stellar")) {
      const usdc = (c.assets ?? []).find((a) => a.symbol === "USDC" && a.status);
      if (usdc) return usdc.id;
    }
  }
  throw new Error("USDC on Stellar not available at pagfinance");
}

export async function validateCode(code: string): Promise<PagTransfer> {
  return req("/api/validate-code", { method: "POST", body: { code, method: "input" } });
}

export interface QuoteInput {
  invoiceCode: string;
  invoiceType?: string;
  invoiceTransferType?: string;
  assetId: number;
  amount: number;
  fiatCurrency?: string;
  sender?: string;
  userEmail?: string;
  userCpf?: string;
  externalId: string;
}
export async function quote(input: QuoteInput): Promise<PagQuote> {
  return req("/api/payment/quote", { method: "POST", body: { fiatCurrency: "BRL", ...input } });
}

export async function createPayment(input: { quoteId: string; sender: string }): Promise<PagCreate> {
  return req("/api/payment/create", { method: "POST", body: input });
}

export async function submitPayment(input: { quoteId?: string; txHash: string; sender?: string }): Promise<PagPayment> {
  return req("/api/payment/submit", { method: "POST", body: { blockchain: "stellar", ...input } });
}

export async function receipt(params: { type: string; tx: string; chain?: string }): Promise<unknown> {
  return req(`/api/receipt/${encodeURIComponent(params.type)}`, { query: { tx: params.tx, chain: params.chain ?? "stellar" } });
}

// Stable per invoice session, per the SDK contract.
export function externalId(): string {
  return `pag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
