import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { _resetRampProvider, applyMargin, getRampMarginBps, getRampProvider, isRampEnabled } from "../lib/ramp/index.ts";
import { EtherfuseClient } from "../lib/ramp/etherfuse/index.ts";
import { CnopApi, CnopApiError, CriptoPixClient } from "../lib/ramp/criptopix/index.ts";
import { FourPClient, FourPError } from "../lib/fourp/client.ts";
import { AnchorError } from "../lib/ramp/types.ts";
import { req } from "./_helpers.ts";

// ---- factory: dormant unless explicitly enabled + keyed --------------------

Deno.test("ramp provider is null when ETHERFUSE_ENABLED is unset", () => {
  Deno.env.delete("ETHERFUSE_ENABLED");
  Deno.env.delete("ETHERFUSE_API_KEY");
  _resetRampProvider();
  assertEquals(getRampProvider(), null);
  assertEquals(isRampEnabled(), false);
});

Deno.test("ramp provider is null when enabled but no API key", () => {
  Deno.env.set("ETHERFUSE_ENABLED", "1");
  Deno.env.delete("ETHERFUSE_API_KEY");
  _resetRampProvider();
  assertEquals(getRampProvider(), null);
});

Deno.test("ramp provider activates with ETHERFUSE_ENABLED=1 + key", () => {
  Deno.env.set("ETHERFUSE_ENABLED", "1");
  Deno.env.set("ETHERFUSE_API_KEY", "test-key");
  _resetRampProvider();
  const p = getRampProvider();
  assertEquals(p?.name, "etherfuse");
  assertEquals(p?.supportedCurrencies.includes("BRL"), true);
  assertEquals(p?.supportedRails.includes("pix"), true);
  Deno.env.delete("ETHERFUSE_ENABLED");
  Deno.env.delete("ETHERFUSE_API_KEY");
  _resetRampProvider();
});

// ---- margin: Slippay's spread embedded in every quote ----------------------

Deno.test("ramp margin defaults to 190 bps (1.9%)", () => {
  Deno.env.delete("SLIPPAY_RAMP_MARGIN_BPS");
  assertEquals(getRampMarginBps(), 190);
});

Deno.test("ramp margin is env-overridable, capped at 1000 bps", () => {
  Deno.env.set("SLIPPAY_RAMP_MARGIN_BPS", "250");
  assertEquals(getRampMarginBps(), 250);
  Deno.env.set("SLIPPAY_RAMP_MARGIN_BPS", "9999"); // over cap -> default
  assertEquals(getRampMarginBps(), 190);
  Deno.env.delete("SLIPPAY_RAMP_MARGIN_BPS");
});

Deno.test("applyMargin embeds the spread, both directions", () => {
  Deno.env.delete("SLIPPAY_RAMP_MARGIN_BPS"); // 1.9%
  // off-ramp: 534.6 BRL out -> 1.9% margin
  const off = applyMargin({ toAmount: "534.6", toCurrency: "BRL" });
  assertEquals(off.grossToAmount, "534.6");
  assertEquals(off.platformFeeBps, 190);
  assertEquals(off.platformFee, "10.1574");
  assertEquals(off.toAmount, "524.4426");
  // on-ramp: 100 USDC out -> same spread applies
  const on = applyMargin({ toAmount: "100", toCurrency: "USDC" });
  assertEquals(on.toAmount, "98.1");
  assertEquals(on.platformFee, "1.9");
});

// ---- client: USDC -> BRL off-ramp quote, mapped from the Etherfuse API ------

Deno.test("EtherfuseClient.getQuote resolves USDC and maps an off-ramp quote", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/ramp/assets")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            assets: [{
              symbol: "USDC",
              identifier:
                "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
              name: "USD Coin",
              currency: "usd",
              balance: null,
              image: null,
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    if (url.includes("/ramp/quote")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            quoteId: "q1",
            customerId: "c1",
            blockchain: "stellar",
            quoteAssets: {
              type: "offramp",
              sourceAsset:
                "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
              targetAsset: "BRL",
            },
            sourceAmount: "100",
            destinationAmount: "540",
            exchangeRate: "5.40",
            feeBps: "100",
            feeAmount: "5.4",
            destinationAmountAfterFee: "534.6",
            createdAt: "2026-06-07T00:00:00Z",
            updatedAt: "2026-06-07T00:00:00Z",
            expiresAt: "2026-06-07T00:10:00Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as typeof fetch;

  try {
    const client = new EtherfuseClient({
      apiKey: "k",
      baseUrl: "https://api.sand.etherfuse.com",
      defaultBlockchain: "stellar",
    });
    const q = await client.getQuote({
      fromCurrency: "USDC",
      toCurrency: "BRL",
      fromAmount: "100",
      stellarAddress: "GABC",
    });
    assertEquals(q.id, "q1");
    assertEquals(q.toCurrency, "BRL");
    assertEquals(q.fromAmount, "100");
    assertEquals(q.toAmount, "534.6"); // destinationAmountAfterFee wins
    assertEquals(q.fee, "5.4");
  } finally {
    globalThis.fetch = orig;
  }
});

// ---- provider clients: error & malformed response handling (#353) -----------

Deno.test("EtherfuseClient maps non-2xx and malformed error payloads to AnchorError", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response("upstream gateway timeout", { status: 504 }))) as typeof fetch;

  try {
    const client = new EtherfuseClient({
      apiKey: "k",
      baseUrl: "https://api.sand.etherfuse.com",
    });
    const err = await assertRejects(
      () => client.getAssets("stellar", "brl", "GABC"),
      AnchorError,
    );
    assertEquals(err.statusCode, 504);
    assertEquals(err.code, "UNKNOWN_ERROR");
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("CnopApi and CriptoPixClient handle non-JSON and status:false responses", async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("<html>502 Bad Gateway</html>", { status: 502 }))) as typeof fetch;

    const api = new CnopApi({
      clientId: "cid",
      clientSecret: "csec",
      baseUrl: "https://api.criptonopix.app.br",
    });
    const rawErr = await assertRejects(() => api.quote(10, "DEPOSIT"), CnopApiError);
    assertEquals(rawErr.statusCode, 502);

    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: false, message: "invalid signature" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )) as typeof fetch;

    const adapter = new CriptoPixClient({
      clientId: "cid",
      clientSecret: "csec",
      baseUrl: "https://api.criptonopix.app.br",
    });
    const wrapped = await assertRejects(
      () => adapter.getQuote({ fromCurrency: "BRL", toCurrency: "USDT", toAmount: "20" }),
      AnchorError,
    );
    assertEquals(wrapped.code, "CRIPTOPIX_API_ERROR");
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("FourPClient surfaces network errors, non-JSON responses, and envelope http_code errors", async () => {
  const orig = globalThis.fetch;
  const client = new FourPClient({ apiKey: "test-4p-key", baseUrl: "https://api.4p.finance" });

  try {
    globalThis.fetch = (() => Promise.reject(new TypeError("network timeout"))) as typeof fetch;
    const netErr = await assertRejects(() => client.quote("100"), FourPError);
    assertEquals(netErr.statusCode, 502);

    globalThis.fetch = (() =>
      Promise.resolve(new Response("not-json", { status: 503 }))) as typeof fetch;
    const parseErr = await assertRejects(() => client.quote("100"), FourPError);
    assertEquals(parseErr.statusCode, 503);

    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            http_code: 401,
            success: false,
            details: { message: "Invalid API key" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )) as typeof fetch;
    const envErr = await assertRejects(() => client.quote("100"), FourPError);
    assertEquals(envErr.statusCode, 401);
    assertEquals(envErr.message, "Invalid API key");
  } finally {
    globalThis.fetch = orig;
  }
});

// ---- 4P routes: dormant when FOURP_API_KEY is unset (#353) ------------------

Deno.test("4P routes stay dormant (enabled: false / 503 ramp_disabled) when FOURP_API_KEY is unset", async () => {
  Deno.env.delete("FOURP_API_KEY");

  const statusRes = await req("/v1/4p/status");
  assertEquals(statusRes.status, 200);
  assertEquals(await statusRes.json(), { enabled: false });

  const webhookRes = await req("/v1/4p/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "tok_1" }),
  });
  assertEquals(webhookRes.status, 503);
  assertEquals((await webhookRes.json()).error, "ramp_disabled");

  const quoteRes = await req("/v1/4p/quote", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.slippay.cc" },
    body: JSON.stringify({ amountBrl: 100 }),
  });
  assertEquals(quoteRes.status, 503);
  assertEquals((await quoteRes.json()).error, "ramp_disabled");

  const offrampRes = await req("/v1/4p/offramp", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.slippay.cc" },
    body: JSON.stringify({
      amountUsdc: 25,
      pixKey: "user@example.com",
      senderWallet: "0x1111111111111111111111111111111111111111",
      email: "user@example.com",
      cpf: "12345678901",
    }),
  });
  assertEquals(offrampRes.status, 503);
  assertEquals((await offrampRes.json()).error, "ramp_disabled");
});

// ---- 4P off-ramp: fail-closed receiver pinning (#353) -----------------------

Deno.test("POST /v1/4p/offramp rejects mismatched receiver_wallet when FOURP_OFFRAMP_RECEIVER is pinned", async () => {
  const orig = globalThis.fetch;
  Deno.env.set("FOURP_API_KEY", "test-4p-key");
  Deno.env.set("FOURP_OFFRAMP_RECEIVER", "0xPinnedReceiver00000000000000000000000001");

  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/v1/cryptopix/transaction")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            http_code: 200,
            success: true,
            info: {
              data: {
                txid: "tx_off_1",
                amount_crypto: 25,
                asset: "USDC",
                chain: "Base",
                amount_brl: 135,
                receiver_wallet: "0xAttackerWallet00000000000000000000000099",
                expires: 3600,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;

  try {
    const res = await req("/v1/4p/offramp", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.slippay.cc" },
      body: JSON.stringify({
        amountUsdc: 25,
        pixKey: "user@example.com",
        senderWallet: "0x1111111111111111111111111111111111111111",
        email: "user@example.com",
        cpf: "12345678901",
      }),
    });
    assertEquals(res.status, 502);
    const body = await res.json();
    assertEquals(body.error, "receiver_mismatch");
  } finally {
    globalThis.fetch = orig;
    Deno.env.delete("FOURP_API_KEY");
    Deno.env.delete("FOURP_OFFRAMP_RECEIVER");
  }
});
