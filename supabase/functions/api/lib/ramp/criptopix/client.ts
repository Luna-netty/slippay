/**
 * Cripto no Pix (CriptoPix) — {@link Anchor} adapter.
 *
 * Wraps the low-level {@link CnopApi} (./api.ts) and maps its charge-model
 * Partner API onto Slippay's provider-agnostic ramp interface, so the routes in
 * routes/offramp.ts work unchanged.
 *
 * Impedance notes (CriptoPix is a charge/withdraw provider, not a hosted-KYC
 * customer provider like Etherfuse/BlindPay) — the seams, made explicit:
 *
 *   - No customer/KYC API. KYC happens inline (CPF + birthDate) at charge time
 *     and is CriptoPix's responsibility. So `createCustomer` synthesizes a local
 *     customer handle, `getKycStatus` reports `not_started`, and `getKycUrl`/
 *     `getFiatAccounts` are no-ops. `capabilities.kycUrl = false` lets the
 *     frontend skip KYC UI.
 *   - On-ramp needs CPF + birthDate; off-ramp needs the user's Pix key. The
 *     Anchor flow carries these via `input.identity` (CPF/birthDate) and
 *     `input.fiatAccountId` (interpreted as the Pix key for this provider, since
 *     there is no account-registration step). Missing identity → fail-closed.
 *   - No GET-by-id endpoint: transaction status arrives via webhook. The read
 *     methods therefore throw STATUS_VIA_WEBHOOK until a webhook->store hop is
 *     wired (routes/offramp.ts GET /order/:id depends on this).
 *   - Amounts are USDT, not USDC (confirm whether USDC is available before
 *     leaning on the dollar-account positioning).
 *   - The on-ramp (generate-qr-code) takes no destination wallet — Slippay never
 *     custodies funds (CriptoPix, the licensed party, does until a withdraw),
 *     so Slippay stays non-custodial; confirm whether direct-to-wallet
 *     settlement is possible to remove the two-step UX.
 */

import {
  type Anchor,
  type AnchorCapabilities,
  AnchorError,
  type CreateCustomerInput,
  type CreateOffRampInput,
  type CreateOnRampInput,
  type Customer,
  type GetCustomerInput,
  type GetQuoteInput,
  type KycStatus,
  type OffRampTransaction,
  type OnRampTransaction,
  type Quote,
  type RampTxRecord,
  type SavedFiatAccount,
  type TokenInfo,
  type TransactionStatus,
} from "../types.ts";
import {
  CnopApi,
  CnopApiError,
  type CnopOrderData,
  type CnopTransactionStatus,
  type PixKeyType,
} from "./api.ts";

export interface CriptoPixConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  /** Crypto symbol this deployment trades. "USDT" today; "USDC" once confirmed. */
  asset?: string;
  /** Quote validity window (seconds) for the synthetic quote id. Default 60. */
  quoteTtlSeconds?: number;
  /** Status lookup against the webhook-backed store. Injected by the factory so
   *  the read methods resolve real status (CriptoPix has no GET-by-id endpoint).
   *  When absent, reads fail-closed with STATUS_VIA_WEBHOOK. */
  lookup?: (id: string) => Promise<RampTxRecord | null>;
}

const CRYPTO_SYMBOLS = new Set(["USDT", "USDC", "USDB"]);

/** Map CriptoPix transaction status -> shared lifecycle status. */
function mapStatus(s: CnopTransactionStatus): TransactionStatus {
  switch (s) {
    case "CREATED":
    case "WAITING_PAYMENT":
      return "pending";
    case "PAID":
    case "PROCESSING":
    case "RETRYING":
      return "processing";
    case "COMPLETED":
      return "completed";
    case "REFUNDED":
      return "refunded";
    case "ERROR":
      return "failed";
  }
}

/** Best-effort Pix key type detection (CriptoPix needs it explicitly). */
function detectPixKeyType(key: string): PixKeyType {
  if (key.includes("@")) return "EMAIL";
  const digits = key.replace(/\D/g, "");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    return "RANDOM";
  }
  if (digits.length === 11 && key.replace(/\s/g, "") === digits) return "DOCUMENT"; // CPF
  if (digits.length === 14) return "DOCUMENT"; // CNPJ
  if (digits.length >= 12 && digits.length <= 13) return "PHONE"; // +55 DDD number
  return "RANDOM";
}

/** Translate a low-level CnopApiError into a route-friendly AnchorError. */
function wrap(e: unknown): AnchorError {
  if (e instanceof CnopApiError) {
    const msg = typeof e.payload === "string"
      ? e.payload
      : JSON.stringify(e.payload);
    return new AnchorError(msg, "CRIPTOPIX_API_ERROR", e.statusCode || 502);
  }
  if (e instanceof AnchorError) return e;
  return new AnchorError(String((e as Error)?.message ?? e), "UNKNOWN_ERROR", 502);
}

export class CriptoPixClient implements Anchor {
  readonly name = "criptopix";
  readonly displayName = "Cripto no Pix";
  readonly capabilities: AnchorCapabilities = {
    emailLookup: false,
    kycUrl: false,
    sep24: false,
    sep6: false,
    requiresTos: false,
    requiresOffRampSigning: false,
    requiresBankBeforeQuote: false,
    requiresBlockchainWalletRegistration: false,
    deferredOffRampSigning: false,
    requiresAnchorPayoutSubmission: true,
    fiatAccountRegistration: "inline",
  };
  readonly supportedCurrencies = ["BRL"] as const;
  readonly supportedRails = ["pix"] as const;
  readonly supportedTokens: readonly TokenInfo[];

  #api: CnopApi;
  #asset: string;
  #ttl: number;
  #lookup?: (id: string) => Promise<RampTxRecord | null>;

  constructor(cfg: CriptoPixConfig) {
    this.#api = new CnopApi({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      baseUrl: cfg.baseUrl.replace(/\/+$/, ""),
    });
    this.#asset = (cfg.asset ?? "USDT").toUpperCase();
    this.#ttl = cfg.quoteTtlSeconds ?? 60;
    this.#lookup = cfg.lookup;
    this.supportedTokens = [{
      symbol: this.#asset,
      name: this.#asset === "USDC" ? "USD Coin" : "Tether USD",
      description: `${this.#asset} on the CriptoPix BRL/Pix corridor`,
    }];
  }

  // ── Customer / KYC: synthesized (no customer API) ──────────────────────────

  createCustomer(input: CreateCustomerInput): Promise<Customer> {
    const id = input.taxId ?? input.publicKey ?? input.email ?? crypto.randomUUID();
    const now = new Date().toISOString();
    return Promise.resolve({
      id,
      email: input.email,
      kycStatus: "not_started",
      country: input.country ?? "BR",
      createdAt: now,
      updatedAt: now,
    });
  }

  getCustomer(_input: GetCustomerInput): Promise<Customer | null> {
    // No lookup API; the caller owns customer identity.
    return Promise.resolve(null);
  }

  getKycStatus(_customerId: string): Promise<KycStatus> {
    // CriptoPix verifies the payer inline per transaction (CPF + DOB).
    return Promise.resolve("not_started");
  }

  getFiatAccounts(_customerId: string): Promise<SavedFiatAccount[]> {
    return Promise.resolve([]);
  }

  // ── Quote ──────────────────────────────────────────────────────────────────

  async getQuote(input: GetQuoteInput): Promise<Quote> {
    const onramp = CRYPTO_SYMBOLS.has(input.toCurrency.toUpperCase());
    const quoteType = onramp ? "DEPOSIT" : "WITHDRAW";
    // CriptoPix prices by USDT amount. On-ramp: the dollar side is `toAmount`;
    // off-ramp: the dollar side is `fromAmount`.
    const usdtStr = onramp ? input.toAmount : input.fromAmount;
    const usdt = Number(usdtStr);
    if (!Number.isFinite(usdt) || usdt <= 0) {
      throw new AnchorError(
        "CriptoPix quotes require a positive dollar (USDT) amount",
        "INVALID_AMOUNT",
        400,
      );
    }
    try {
      const q = await this.#api.quote(usdt, quoteType);
      const brl = onramp ? q.dolarQuote.quoteDeposit : q.dolarQuote.quoteWithdraw;
      if (brl == null) {
        throw new AnchorError(
          `CriptoPix returned no ${quoteType} price`,
          "NO_QUOTE",
          502,
        );
      }
      const now = Date.now();
      return {
        id: `cnop-${quoteType.toLowerCase()}-${now}`,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        fromAmount: onramp ? String(brl) : String(usdt),
        toAmount: onramp ? String(usdt) : String(brl),
        exchangeRate: String(q.dolarPrice),
        fee: String(Math.max(0, Math.abs(brl - q.dolarPrice * usdt))),
        expiresAt: new Date(now + this.#ttl * 1000).toISOString(),
        createdAt: new Date(now).toISOString(),
      };
    } catch (e) {
      throw wrap(e);
    }
  }

  // ── On-ramp (BRL Pix -> USDT) ───────────────────────────────────────────────

  async createOnRamp(input: CreateOnRampInput): Promise<OnRampTransaction> {
    const cpf = input.identity?.taxId;
    const birthDate = input.identity?.birthDate;
    if (!cpf || !birthDate) {
      throw new AnchorError(
        "CriptoPix on-ramp requires identity.taxId (CPF) and identity.birthDate (DD/MM/AAAA)",
        "MISSING_IDENTITY",
        400,
      );
    }
    const usdt = Number(input.amount);
    if (!Number.isFinite(usdt) || usdt <= 0) {
      throw new AnchorError("Invalid on-ramp amount", "INVALID_AMOUNT", 400);
    }
    try {
      const order = await this.#api.generateQrCode({
        partnerTransactionId: input.quoteId,
        productName: "Slippay on-ramp",
        quantity: 1,
        unitPrice: usdt,
        userId: input.customerId,
        userCpf: cpf,
        birthDate,
      });
      return this.#toOnRamp(order, input);
    } catch (e) {
      throw wrap(e);
    }
  }

  // ── Off-ramp (USDT -> BRL Pix) ──────────────────────────────────────────────

  async createOffRamp(input: CreateOffRampInput): Promise<OffRampTransaction> {
    const cpf = input.identity?.taxId;
    // For this provider, fiatAccountId carries the user's Pix key (no registration step).
    const pixKey = input.fiatAccountId;
    if (!cpf || !pixKey) {
      throw new AnchorError(
        "CriptoPix off-ramp requires identity.taxId (CPF) and a Pix key in fiatAccountId",
        "MISSING_PAYOUT_DETAILS",
        400,
      );
    }
    const usdt = Number(input.amount);
    if (!Number.isFinite(usdt) || usdt <= 0) {
      throw new AnchorError("Invalid off-ramp amount", "INVALID_AMOUNT", 400);
    }
    try {
      const order = await this.#api.withdrawOrder({
        partnerTransactionId: input.quoteId,
        userId: input.customerId,
        productName: "Slippay off-ramp",
        quantity: 1,
        unitPrice: usdt,
        usdtAmount: usdt,
        withdrawalType: "PIX_WITHDRAW",
        userCpf: cpf,
        userPixKey: pixKey,
        pixKeyType: detectPixKeyType(pixKey),
      });
      return this.#toOffRamp(order, input);
    } catch (e) {
      throw wrap(e);
    }
  }

  // ── Status reads: resolved against the webhook-backed store ─────────────────

  async getOnRampTransaction(id: string): Promise<OnRampTransaction | null> {
    const rec = await this.#requireLookup(id);
    if (!rec) return null;
    return this.#recToOnRamp(rec);
  }

  async getOffRampTransaction(id: string): Promise<OffRampTransaction | null> {
    const rec = await this.#requireLookup(id);
    if (!rec) return null;
    return this.#recToOffRamp(rec);
  }

  async #requireLookup(id: string): Promise<RampTxRecord | null> {
    if (!this.#lookup) {
      throw new AnchorError(
        "CriptoPix status store not configured (no lookup injected)",
        "STATUS_VIA_WEBHOOK",
        501,
      );
    }
    return await this.#lookup(id);
  }

  // ── Mappers ─────────────────────────────────────────────────────────────────

  #toOnRamp(order: CnopOrderData, input: CreateOnRampInput): OnRampTransaction {
    const now = new Date().toISOString();
    const brl = String(order.transactionPayload.reaisAmount);
    return {
      id: order.ids.gatewayId,
      customerId: input.customerId,
      quoteId: input.quoteId,
      status: mapStatus(order.transactionStatus),
      fromAmount: brl,
      fromCurrency: "BRL",
      toAmount: String(order.transactionPayload.usdtAmount),
      toCurrency: this.#asset,
      stellarAddress: input.stellarAddress,
      paymentInstructions: {
        type: "pix",
        amount: brl,
        currency: "BRL",
        pixCode: order.ids.brCode,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  #toOffRamp(order: CnopOrderData, input: CreateOffRampInput): OffRampTransaction {
    const now = new Date().toISOString();
    return {
      id: order.ids.gatewayId,
      customerId: input.customerId,
      quoteId: input.quoteId,
      status: mapStatus(order.transactionStatus),
      fromAmount: String(order.transactionPayload.usdtAmount),
      fromCurrency: this.#asset,
      toAmount: String(order.transactionPayload.reaisAmount),
      toCurrency: "BRL",
      stellarAddress: input.stellarAddress,
      createdAt: now,
      updatedAt: now,
    };
  }

  // ── Stored-record mappers (webhook status -> Anchor shapes) ─────────────────

  #recStatus(rec: RampTxRecord): TransactionStatus {
    const s = rec.transactionStatus as CnopTransactionStatus | undefined;
    return s ? mapStatus(s) : "pending";
  }

  #recToOnRamp(rec: RampTxRecord): OnRampTransaction {
    const now = new Date().toISOString();
    const brl = rec.reaisAmount != null ? String(rec.reaisAmount) : "0";
    return {
      id: rec.gatewayId,
      customerId: rec.userId ?? "",
      quoteId: rec.partnerTransactionId ?? "",
      status: this.#recStatus(rec),
      fromAmount: brl,
      fromCurrency: "BRL",
      toAmount: rec.usdtAmount != null ? String(rec.usdtAmount) : "0",
      toCurrency: this.#asset,
      stellarAddress: "",
      stellarTxHash: rec.hashWeb3,
      paymentInstructions: rec.brCode
        ? { type: "pix", amount: brl, currency: "BRL", pixCode: rec.brCode }
        : undefined,
      createdAt: now,
      updatedAt: now,
    };
  }

  #recToOffRamp(rec: RampTxRecord): OffRampTransaction {
    const now = new Date().toISOString();
    return {
      id: rec.gatewayId,
      customerId: rec.userId ?? "",
      quoteId: rec.partnerTransactionId ?? "",
      status: this.#recStatus(rec),
      fromAmount: rec.usdtAmount != null ? String(rec.usdtAmount) : "0",
      fromCurrency: this.#asset,
      toAmount: rec.reaisAmount != null ? String(rec.reaisAmount) : "0",
      toCurrency: "BRL",
      stellarAddress: "",
      stellarTxHash: rec.hashWeb3,
      createdAt: now,
      updatedAt: now,
    };
  }
}
