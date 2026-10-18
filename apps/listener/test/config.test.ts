import { describe, it, expect, vi, afterEach } from "vitest";

// config.ts reads process.env at module-evaluation time, so each case clears the
// relevant keys, sets the ones under test, resets the module registry, and
// re-imports. afterEach restores the original env so nothing leaks between cases.
const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STELLAR_NETWORK",
  "ALLOW_LOCAL_WEBHOOKS",
  "MERCHANT_POLL_MS",
  "STELLAR_USDC_ISSUER_OVERRIDE",
] as const;

const ORIGINAL: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIGINAL[k] = process.env[k];

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

async function loadConfig(env: Record<string, string> = {}) {
  clearEnv();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  const mod = await import("../src/config.js");
  return mod.config;
}

const REQUIRED = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-key" };

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
  vi.resetModules();
});

describe("config · required env", () => {
  it("throws when SUPABASE_URL is missing", async () => {
    await expect(loadConfig({ SUPABASE_SERVICE_ROLE_KEY: "k" })).rejects.toThrow("missing env SUPABASE_URL");
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    await expect(loadConfig({ SUPABASE_URL: "https://proj.supabase.co" })).rejects.toThrow("missing env SUPABASE_SERVICE_ROLE_KEY");
  });
});

describe("config · network gating", () => {
  it("defaults to TESTNET and maps it to the lowercase merchant column", async () => {
    const c = await loadConfig(REQUIRED);
    expect(c.network).toBe("TESTNET");
    expect(c.merchantNetwork).toBe("testnet");
    expect(c.isMainnet).toBe(false);
  });

  it("PUBLIC selects mainnet and flips the fail-closed SSRF flag", async () => {
    const c = await loadConfig({ ...REQUIRED, STELLAR_NETWORK: "PUBLIC" });
    expect(c.network).toBe("PUBLIC");
    expect(c.merchantNetwork).toBe("mainnet");
    expect(c.isMainnet).toBe(true);
  });

  it("uppercases a lowercase network value", async () => {
    const c = await loadConfig({ ...REQUIRED, STELLAR_NETWORK: "public" });
    expect(c.network).toBe("PUBLIC");
    expect(c.isMainnet).toBe(true);
  });

  it("treats an unknown value as mainnet (fails closed, never silently TESTNET)", async () => {
    const c = await loadConfig({ ...REQUIRED, STELLAR_NETWORK: "devnet" });
    expect(c.merchantNetwork).toBe("mainnet");
    expect(c.isMainnet).toBe(true);
  });

  it("does not trust an issuer override to downgrade a PUBLIC network", async () => {
    // config.ts exposes no override field; the SSRF flag the guards key off of is
    // derived solely from the network, so an override can never relax it.
    const c = await loadConfig({ ...REQUIRED, STELLAR_NETWORK: "PUBLIC", STELLAR_USDC_ISSUER_OVERRIDE: "GCUSTOM" + "X".repeat(49) });
    expect(c.isMainnet).toBe(true);
    expect((c as Record<string, unknown>).usdcIssuerOverride).toBeUndefined();
    expect((c as Record<string, unknown>).isMainnet).toBe(true);
  });
});

describe("config · webhook escape hatch and poll interval", () => {
  it("only ALLOW_LOCAL_WEBHOOKS=1 enables local webhooks", async () => {
    expect((await loadConfig(REQUIRED)).allowLocalWebhooks).toBe(false);
    expect((await loadConfig({ ...REQUIRED, ALLOW_LOCAL_WEBHOOKS: "0" })).allowLocalWebhooks).toBe(false);
    expect((await loadConfig({ ...REQUIRED, ALLOW_LOCAL_WEBHOOKS: "true" })).allowLocalWebhooks).toBe(false);
    expect((await loadConfig({ ...REQUIRED, ALLOW_LOCAL_WEBHOOKS: "1" })).allowLocalWebhooks).toBe(true);
  });

  it("defaults MERCHANT_POLL_MS to 30s and honours an override", async () => {
    expect((await loadConfig(REQUIRED)).merchantPollMs).toBe(30_000);
    expect((await loadConfig({ ...REQUIRED, MERCHANT_POLL_MS: "5000" })).merchantPollMs).toBe(5_000);
  });
});
