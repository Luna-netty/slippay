// Frontend client for the 4P Finance on-ramp (backend route /api/v1/4p).
// The backend holds the x-api-key; this client only sends the buyer's request
// with their Supabase JWT (the 4P endpoints sit behind requireApiKeyOrJwt).
//
// 4P settles USDC on EVM/Solana (NOT Stellar), so the buyer supplies the wallet
// address that receives the crypto.

import { authFetch } from "./apiAuth.ts";

export class Ramp4pError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) {
    super(message);
    this.name = "Ramp4pError";
  }
}

async function handle<T>(res: Response): Promise<T> {
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-json */ }
  if (!res.ok) {
    const j = json as { error?: string; message?: string } | null;
    if (res.status === 503) throw new Ramp4pError("disabled", "Pagamento em Pix ainda não está ligado.", 503);
    if (res.status === 401) throw new Ramp4pError("auth", "Entre na sua conta para continuar.", 401);
    throw new Ramp4pError(j?.error ?? "error", j?.message ?? `Erro ${res.status}`, res.status);
  }
  return json as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch { throw new Ramp4pError("network", "Sem conexão com o servidor."); }
  return handle<T>(res);
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try { res = await authFetch(path); } catch { throw new Ramp4pError("network", "Sem conexão."); }
  return handle<T>(res);
}

export interface Ramp4pStatus {
  enabled: boolean;
  chain?: string;
  asset?: string;
}

export async function status4p(): Promise<Ramp4pStatus> {
  try { return await get<Ramp4pStatus>("/v1/4p/status"); }
  catch { return { enabled: false }; }
}

/** Quote breakdown for `brl`: net crypto out (after Slippay margin), the gross
 *  4P amount, the margin in bps, and the exact dollar rate (gross). All so the UI
 *  can show the user the exact rate and the fee applied, transparently. */
export interface Quote4p {
  cryptoOut: number | null;   // net USDC the user receives (margin applied)
  grossOut: number | null;    // USDC at the raw 4P rate, before Slippay margin
  marginBps: number | null;   // Slippay fee in basis points (e.g. 280 = 2.8%)
  asset: string | null;
  dollarRate: number | null;  // effective rate: R$ per 1 USD (brl / cryptoOut), matching user's actual settlement
}

export async function quote4p(brl: number): Promise<Quote4p> {
  const { quote, gross, marginBps } = await post<{
    quote: { quote?: Record<string, { price: number }> };
    gross?: Record<string, number>;
    marginBps?: number;
  }>("/v1/4p/quote", { amountBrl: brl });
  const map = quote?.quote ?? {};
  const asset = Object.keys(map)[0] ?? null;
  const net = asset ? map[asset]?.price ?? null : null;
  const grossOut = asset && gross ? gross[asset] ?? null : null;
  const dollarRate = net && net > 0 ? brl / net : null;
  return { cryptoOut: net, grossOut, marginBps: marginBps ?? null, asset, dollarRate };
}

export type Ramp4pStatusValue =
  | "pending" | "paid" | "processing" | "completed" | "confirmed" | "failed" | string;

export interface Ramp4pOrder {
  id: string;
  txid?: string;
  pixCopiaECola?: string;
  status?: Ramp4pStatusValue;
}

/** Create a Pix on-ramp; USDC settles to `receiverWallet` (EVM/Solana). */
export async function createOnramp4p(input: {
  amountBrl: number;
  receiverWallet: string;
  email: string;
  cpf: string;
}): Promise<Ramp4pOrder> {
  const { order } = await post<{ order: Ramp4pOrder }>("/v1/4p/onramp", {
    amountBrl: input.amountBrl,
    receiverWallet: input.receiverWallet,
    email: input.email,
    cpf: input.cpf,
  });
  return order;
}

/** Poll an on-ramp's status (from the webhook-backed store). The store returns a
 * RampTxRecord whose `transactionStatus` carries 4P's status (e.g. "paid"). */
export async function getOnramp4p(id: string): Promise<{ transactionStatus?: string }> {
  const { order } = await get<{ order: { transactionStatus?: string } }>(
    `/v1/4p/onramp/${encodeURIComponent(id)}`,
  );
  return order;
}

// ---------------------------------------------------------------------------
// Off-ramp (USD -> R$)
// ---------------------------------------------------------------------------

/** Quote for selling USDC and receiving BRL via Pix. */
export interface Offramp4pQuote {
  brlOut: number | null;
  receiver: string | null;
  asset: string | null;
}

/** Returns approximate BRL to be received for `usdc` USDC.
 *  If the endpoint returns 503/404 (not live yet), returns null fields gracefully. */
export async function quoteOfframp4p(usdc: number): Promise<Offramp4pQuote> {
  try {
    const data = await post<{ brlOut?: number; receiver?: string; asset?: string }>(
      "/v1/4p/offramp/quote",
      { amountUsdc: usdc },
    );
    return {
      brlOut: data.brlOut ?? null,
      receiver: data.receiver ?? null,
      asset: data.asset ?? null,
    };
  } catch (e) {
    if (e instanceof Ramp4pError && (e.status === 503 || e.status === 404)) {
      return { brlOut: null, receiver: null, asset: null };
    }
    throw e;
  }
}

/** Create a USDC off-ramp order; BRL is delivered via Pix to `pixKey`.
 *  4P requires `person_document` (CPF 11 / CNPJ 14 digits) + email on every sell.
 *  Returns the on-chain receiver address + amount to transfer, and an order id for polling. */
export async function createOfframp4p(input: {
  usdc: number;
  pixKey: string;
  sender: string;
  email: string;
  doc: string; // digits only — 11 (CPF) or 14 (CNPJ)
}): Promise<{ id: string; receiver: string; amount: string }> {
  const data = await post<{ id: string; receiver: string; amount: string }>(
    "/v1/4p/offramp",
    {
      amountUsdc: input.usdc,
      pixKey: input.pixKey,
      senderWallet: input.sender,
      email: input.email,
      ...(input.doc.length === 14 ? { cnpj: input.doc } : { cpf: input.doc }),
    },
  );
  return data;
}

/** Poll an off-ramp order's status. */
export async function getOfframp4p(id: string): Promise<{ transactionStatus?: string }> {
  const data = await get<{ transactionStatus?: string }>(
    `/v1/4p/offramp/${encodeURIComponent(id)}`,
  );
  return data;
}
