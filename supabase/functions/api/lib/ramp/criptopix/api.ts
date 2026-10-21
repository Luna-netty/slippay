/**
 * Cripto no Pix (CriptoPix) — Partner API low-level client.
 *
 * Server-side only. Authenticates every request with an HMAC-SHA256 signature
 * derived from the partner `clientSecret`, which must never reach the browser.
 *
 * This module is the raw transport for the three Partner API endpoints:
 *   - POST /api/partners/quote-dolar      (price a BRL<->USDT conversion)
 *   - POST /api/partners/generate-qr-code (on-ramp: create a Pix charge / brCode)
 *   - POST /api/partners/withdraw-order   (off-ramp: pay out via Pix or crypto)
 *
 * It is intentionally NOT the {@link Anchor} adapter — the adapter that maps
 * these shapes onto Slippay's provider-agnostic ramp interface wraps this
 * client (see ./client.ts). Keeping the transport separate makes the HMAC
 * signing unit-testable in isolation and mirrors the etherfuse/ split.
 *
 * Honest caveats baked in as of integration (verify at onboarding):
 *   - Amounts are denominated in USDT (`usdtAmount`), not USDC.
 *   - generate-qr-code takes no destination wallet address — the on-ramp likely
 *     credits a CriptoPix-side balance, with crypto delivery to an external
 *     wallet happening via a separate CRYPTO_WITHDRAW. Confirm whether a direct
 *     non-custodial settlement to a passed address is possible before relying on
 *     this for the (b) non-custodial flow.
 */

// ── Auth ────────────────────────────────────────────────────────────────────
// stringToSign = METHOD + PATH + TIMESTAMP + CLIENT_ID + BODY
// signature    = hex( HMAC_SHA256(stringToSign, clientSecret) )
// BODY is the exact JSON string sent (use "{}" for an empty body). The server
// allows a 5-minute clock-skew tolerance on TIMESTAMP (UNIX seconds).

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Compute the hex HMAC-SHA256 signature for a CriptoPix request. Exposed for
 * unit testing the signing against the documented worked example. */
export async function sign(
  clientSecret: string,
  method: string,
  path: string,
  timestamp: string,
  clientId: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const stringToSign = method + path + timestamp + clientId + body;
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(stringToSign));
  return toHex(sig);
}

// ── Wire shapes (from the Partner API docs) ─────────────────────────────────

export type QuoteType = "DEPOSIT" | "WITHDRAW";
export type WithdrawalType = "PIX_WITHDRAW" | "CRYPTO_WITHDRAW";
export type PixKeyType = "EMAIL" | "DOCUMENT" | "PHONE" | "RANDOM";

export type CnopTransactionType =
  | "PIX_PURCHASE"
  | "CRYPTO_PURCHASE"
  | "PIX_WITHDRAW"
  | "CRYPTO_WITHDRAW";

export type CnopTransactionStatus =
  | "CREATED"
  | "WAITING_PAYMENT"
  | "PAID"
  | "PROCESSING"
  | "RETRYING"
  | "COMPLETED"
  | "REFUNDED"
  | "ERROR";

/** Envelope every endpoint returns. `status: false` carries a string or a
 * field->messages validation map. */
export interface CnopEnvelope<T> {
  status: boolean;
  message: string | Record<string, string[]>;
  data?: T;
}

export interface QuoteDolarData {
  dolarPrice: number;
  dolarQuote: { quoteDeposit: number | null; quoteWithdraw: number | null };
}

export interface CnopOrderData {
  ids: {
    businessId: string;
    partnerTransactionId: string;
    internalTransactionId: string;
    /** Pix copy-paste payload ("BR Code") to render as a QR for the payer. */
    brCode: string;
    /** Persist this — it's the handle for status reconciliation. */
    gatewayId: string;
  };
  transactionPayload: {
    userId: string;
    userCpf: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    usdtAmount: number;
    reaisAmount: number;
  };
  transactionStatus: CnopTransactionStatus;
  typeError: string;
  errorMessage: string;
  transactionType: CnopTransactionType;
  createdAt: string;
}

export interface GenerateQrCodeBody {
  partnerTransactionId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  userId: string;
  userCpf: string;
  /** DD/MM/AAAA — used for payer verification. */
  birthDate: string;
}

export interface WithdrawOrderBody {
  partnerTransactionId: string;
  userId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  usdtAmount: number;
  withdrawalType: WithdrawalType;
  // Required for PIX_WITHDRAW:
  userCpf?: string;
  userPixKey?: string;
  pixKeyType?: PixKeyType;
  // Required for CRYPTO_WITHDRAW:
  userWalletAddress?: string;
}

// ── Client ──────────────────────────────────────────────────────────────────

export interface CnopConfig {
  clientId: string;
  clientSecret: string;
  /** API origin, e.g. https://api.criptonopix.app.br (no trailing slash). */
  baseUrl: string;
  /** Override the clock source (UNIX seconds). Injectable for tests. */
  now?: () => number;
}

/** Raised on a non-2xx response or a `status:false` envelope. Carries the HTTP
 * status and the raw message so the Anchor adapter can map it to AnchorError. */
export class CnopApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly payload: string | Record<string, string[]>,
  ) {
    super(typeof payload === "string" ? payload : JSON.stringify(payload));
    this.name = "CnopApiError";
  }
}

export class CnopApi {
  #cfg: CnopConfig;
  constructor(cfg: CnopConfig) {
    this.#cfg = cfg;
  }

  async #post<T>(path: string, body: object | null): Promise<T> {
    const bodyStr = body ? JSON.stringify(body) : "{}";
    const ts = String((this.#cfg.now?.() ?? Math.floor(Date.now() / 1000)));
    const signature = await sign(
      this.#cfg.clientSecret,
      "POST",
      path,
      ts,
      this.#cfg.clientId,
      bodyStr,
    );
    const res = await fetch(this.#cfg.baseUrl + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-client-id": this.#cfg.clientId,
        "x-timestamp": ts,
        "x-signature": signature,
      },
      body: bodyStr,
    });
    let parsed: CnopEnvelope<T>;
    try {
      parsed = await res.json();
    } catch {
      throw new CnopApiError(res.status, `non-json response (${res.status})`);
    }
    if (!res.ok || !parsed.status) {
      throw new CnopApiError(res.status, parsed.message ?? `error ${res.status}`);
    }
    return parsed.data as T;
  }

  /** Price a conversion. Pass an amount + type, or omit both for the raw rate. */
  quote(usdtAmount?: number, quoteType?: QuoteType): Promise<QuoteDolarData> {
    const body = usdtAmount !== undefined ? { usdtAmount, quoteType } : null;
    return this.#post<QuoteDolarData>("/api/partners/quote-dolar", body);
  }

  /** On-ramp: create a Pix charge. Returns the brCode (Pix copy-paste). */
  generateQrCode(body: GenerateQrCodeBody): Promise<CnopOrderData> {
    return this.#post<CnopOrderData>("/api/partners/generate-qr-code", body);
  }

  /** Off-ramp: pay the user out via Pix (PIX_WITHDRAW) or crypto (CRYPTO_WITHDRAW). */
  withdrawOrder(body: WithdrawOrderBody): Promise<CnopOrderData> {
    return this.#post<CnopOrderData>("/api/partners/withdraw-order", body);
  }
}
