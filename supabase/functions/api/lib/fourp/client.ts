/**
 * 4P Finance (4p.finance) — Partner API client. Server-side only.
 *
 * 4P is a BR PSP for Pix<->crypto: on-ramp sends stablecoin DIRECTLY to a wallet
 * you pass (non-custodial for the buyer), off-ramp converts crypto->Pix. Auth is
 * a single `x-api-key` header that must never reach the browser.
 *
 * Endpoints (base https://api.4p.finance):
 *   POST /v1/transaction/price_conversion   — BRL<->crypto quote
 *   PUT  /v1/pix/transaction                — on-ramp (returns Pix copy-paste)
 *   PUT  /v1/cryptopix/transaction          — off-ramp (returns wallet to send to)
 *   GET  /v1/notification/:token            — pull a webhook's real status
 *
 * Webhook is two-step: 4P POSTs only a notification *token* to your URL; you then
 * GET /v1/notification/:token to read the status. See routes/fourp.ts.
 *
 * NOTE: 4P has no Stellar. Networks: Ethereum, Bitcoin, Solana, Tron, Arbitrum,
 * Base, Polygon, BSC, Avalanche, Optimism. Default chain/asset are set at API-key
 * activation; pass custom_data to override per transaction.
 */

export interface FourPConfig {
  apiKey: string;
  /** API origin (no trailing slash). Default https://api.4p.finance */
  baseUrl?: string;
  /** Default settlement chain (e.g. "Base", "Solana", "Arbitrum"). */
  chain?: string;
  /** Default asset (e.g. "USDC", "USDT"). */
  asset?: string;
}

/** Envelope every 4P endpoint returns. 4P answers HTTP 200 even on auth/
 * validation failures and puts the REAL status in `http_code`; errors carry
 * `details.message`, successes carry the payload under `info.data` (older) or
 * `details.data`. Parse all of these so the real cause surfaces. */
interface FourPEnvelope<T> {
  http_code: number;
  success: boolean;
  info?: { result?: string; message?: string; data?: T };
  details?: { result?: string; message?: string; data?: T };
  data?: T;
  message?: string;
}

export interface QuoteData {
  amount: string;
  symbol: string;
  quote: Record<string, { price: number; last_updated: string }>;
}

export interface OnrampData {
  txid: string;
  pixCopiaECola: string;
  status: string;
  location?: string;
  chave?: string;
  valor?: { original: number };
  calendario?: { criacao: string; expiracao: number };
}

export interface OfframpData {
  txid: string;
  amount_crypto: number;
  asset: string;
  chain: string;
  amount_brl: number;
  /** Wallet the user must send crypto to. */
  receiver_wallet: string;
  expires: number;
}

export interface NotificationData {
  id: string;
  txid: string;
  status: string; // e.g. "paid"
  amount: string;
  description?: string;
  payer_info?: string;
  custom_id?: string;
  payment_date_time?: string;
  confirmed_at?: string;
  created_at?: string;
}

export class FourPError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "FourPError";
  }
}

export class FourPClient {
  #key: string;
  #base: string;
  readonly chain: string;
  readonly asset: string;

  constructor(cfg: FourPConfig) {
    this.#key = cfg.apiKey;
    this.#base = (cfg.baseUrl ?? "https://api.4p.finance").replace(/\/+$/, "");
    this.chain = cfg.chain ?? "Base";
    this.asset = cfg.asset ?? "USDC";
  }

  async #req<T>(method: "GET" | "POST" | "PUT", path: string, body?: object): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.#base + path, {
        method,
        headers: {
          "x-api-key": this.#key,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      throw new FourPError(502, `4P network error: ${String((e as Error).message ?? e)}`);
    }
    let parsed: FourPEnvelope<T>;
    try {
      parsed = await res.json();
    } catch {
      throw new FourPError(res.status, `4P non-json response (${res.status})`);
    }
    // 4P returns HTTP 200 even on failure; the real status is in `http_code`.
    const effectiveStatus = parsed.http_code ?? res.status;
    const failed = !res.ok || parsed.success === false || effectiveStatus >= 400;
    if (failed) {
      const msg = parsed.details?.message ?? parsed.info?.message ?? parsed.message ??
        `4P error ${effectiveStatus}`;
      throw new FourPError(effectiveStatus || 502, msg);
    }
    return (parsed.info?.data ?? parsed.details?.data ?? parsed.data) as T;
  }

  /** BRL -> crypto quote. Returns the unit price of `convert` per BRL block. */
  quote(amountBrl: string, convert?: string): Promise<QuoteData> {
    return this.#req<QuoteData>("POST", "/v1/transaction/price_conversion", {
      amount: amountBrl,
      currency_from_symbol: "BRL",
      convert: convert ?? this.asset,
    });
  }

  /** Off-ramp quote: how many BRL for `amountUsdc` of the configured asset. */
  quoteOfframp(amountUsdc: string): Promise<QuoteData> {
    return this.#req<QuoteData>("POST", "/v1/transaction/price_conversion", {
      amount: amountUsdc,
      currency_from_symbol: this.asset,
      convert: "BRL",
    });
  }

  /** On-ramp: create a Pix charge that settles crypto to `receiverWallet`. */
  createOnramp(input: {
    cpf?: string;
    cnpj?: string;
    email: string;
    amountBrl: number;
    receiverWallet: string;
    customId: string;
    description: string;
    notificationUrl: string;
    expires?: number;
    chain?: string;
    asset?: string;
  }): Promise<OnrampData> {
    const doc = input.cnpj ? { cnpj: input.cnpj } : { cpf: input.cpf };
    return this.#req<OnrampData>("PUT", "/v1/pix/transaction", {
      ...doc,
      email: input.email,
      amount: input.amountBrl,
      expires: input.expires ?? 3600,
      custom_id: input.customId,
      description: input.description,
      notification_url: input.notificationUrl,
      custom_data: {
        chain: input.chain ?? this.chain,
        asset: input.asset ?? this.asset,
        receiver_wallet: input.receiverWallet,
      },
    });
  }

  /** Off-ramp: create a sell; user sends crypto to the returned receiver_wallet. */
  createOfframp(input: {
    personDocument: string;
    email: string;
    amountCrypto: number;
    senderWallet: string;
    destinationPixKey: string;
    customId: string;
    notificationUrl: string;
    chain?: string;
    asset?: string;
  }): Promise<OfframpData> {
    return this.#req<OfframpData>("PUT", "/v1/cryptopix/transaction", {
      person_document: input.personDocument,
      email: input.email,
      amount_crypto: input.amountCrypto,
      custom_id: input.customId,
      custom_data: { chain: input.chain ?? this.chain, asset: input.asset ?? this.asset },
      sender_wallet: input.senderWallet,
      destination_pix_key: input.destinationPixKey,
      notification_url: input.notificationUrl,
    });
  }

  /** Pull a webhook notification's real status by its token. */
  getNotification(token: string): Promise<NotificationData> {
    return this.#req<NotificationData>("GET", `/v1/notification/${encodeURIComponent(token)}`);
  }
}
