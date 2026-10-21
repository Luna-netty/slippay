import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  quote,
  createPayment,
  submitPayment,
  validateCode,
  gatewayConfig,
  setPagToken,
  externalId,
  type QuoteInput,
} from "./pagfinance.ts";

const BASE = import.meta.env.VITE_PAGFINANCE_BASE ?? "https://app.pag.finance";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
}

const QUOTE_INPUT: QuoteInput = {
  invoiceCode: "INV-1",
  invoiceType: "PIX",
  assetId: 7,
  amount: 123.45,
  fiatCurrency: "BRL",
  userEmail: "merchant@example.com",
  externalId: "pag_ext_1",
};

describe("quote", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the UI input to the exact request body (deep equality)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { quoteId: "q1" } }));

    const result = await quote(QUOTE_INPUT);

    const [url, init] = lastCall(fetchMock);
    expect(url).toBe(`${BASE}/api/payment/quote`);
    expect(init.method).toBe("POST");
    // Exact body: a renamed/added/removed field must fail this assertion.
    expect(JSON.parse(String(init.body))).toEqual({ fiatCurrency: "BRL", ...QUOTE_INPUT });
    expect(result).toEqual({ quoteId: "q1" });
  });

  it("defaults the fiat currency to BRL when the caller omits it", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { quoteId: "q2" } }));

    const { fiatCurrency: _omitted, ...rest } = QUOTE_INPUT;
    await quote(rest);

    const [, init] = lastCall(fetchMock);
    expect(JSON.parse(String(init.body)).fiatCurrency).toBe("BRL");
  });

  it("sends the pagfinance client headers", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { quoteId: "q3" } }));

    await quote(QUOTE_INPUT);

    const [, init] = lastCall(fetchMock);
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-client-id"]).toBeDefined();
    expect(headers.blockchain).toBe("stellar");
  });
});

describe("createPayment / submitPayment / validateCode", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createPayment posts exactly { quoteId, sender }", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { memo: "m" } }));

    await createPayment({ quoteId: "q1", sender: "GABC" });

    const [url, init] = lastCall(fetchMock);
    expect(url).toBe(`${BASE}/api/payment/create`);
    expect(JSON.parse(String(init.body))).toEqual({ quoteId: "q1", sender: "GABC" });
  });

  it("submitPayment adds blockchain=stellar to the body", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { status: "PENDING" } }));

    await submitPayment({ quoteId: "q1", txHash: "deadbeef", sender: "GABC" });

    const [url, init] = lastCall(fetchMock);
    expect(url).toBe(`${BASE}/api/payment/submit`);
    expect(JSON.parse(String(init.body))).toEqual({ blockchain: "stellar", quoteId: "q1", txHash: "deadbeef", sender: "GABC" });
  });

  it("validateCode posts the code with method=input", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { amount: 10, currency: "BRL", type: "PIX" } }));

    const out = await validateCode("CODE-9");

    const [url, init] = lastCall(fetchMock);
    expect(url).toBe(`${BASE}/api/validate-code`);
    expect(JSON.parse(String(init.body))).toEqual({ code: "CODE-9", method: "input" });
    expect(out.amount).toBe(10);
  });

  it("gatewayConfig returns the raw (envelope-less) object", async () => {
    const fetchMock = vi.mocked(fetch);
    const cfg = { chains: [{ name: "Stellar", assets: [] }] };
    fetchMock.mockResolvedValue(jsonResponse(cfg));

    const out = await gatewayConfig("stellar");

    const [url] = lastCall(fetchMock);
    expect(url).toBe(`${BASE}/api/gatewayConfig?chain=stellar`);
    expect(out).toEqual(cfg);
  });
});

describe("error and disabled-route handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps a 4xx success:false envelope to a thrown Error with the server message", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: { message: "código inválido" } }, 400));

    await expect(quote(QUOTE_INPUT)).rejects.toThrow("código inválido");
  });

  it("maps a top-level error envelope to a thrown Error", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ success: false, message: "sem saldo" }, 422));

    await expect(quote(QUOTE_INPUT)).rejects.toThrow("sem saldo");
  });

  it("maps a 401 to an explicit auth-needed error", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));

    await expect(quote(QUOTE_INPUT)).rejects.toThrow(/auth needed \(401\)/);
  });

  it("maps a 503 disabled route to a stable http-coded error", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));

    await expect(quote(QUOTE_INPUT)).rejects.toThrow("pagfinance_http_503");
  });

  it("maps a 404 disabled route to a stable http-coded error", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));

    await expect(quote(QUOTE_INPUT)).rejects.toThrow("pagfinance_http_404");
  });

  it("attaches the stored bearer token to every request", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    setPagToken("tok-xyz");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { quoteId: "q" } }));

    await quote(QUOTE_INPUT);

    const [, init] = lastCall(fetchMock);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-xyz");
  });
});

describe("externalId", () => {
  it("returns a stable-looking per-session pag_ id", () => {
    const id = externalId();
    expect(id).toMatch(/^pag_\d+_[a-z0-9]+$/);
    expect(externalId()).not.toBe(id);
  });
});
