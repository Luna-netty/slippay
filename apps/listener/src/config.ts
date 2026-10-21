function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
const rawNetwork = (process.env.STELLAR_NETWORK ?? "TESTNET").toUpperCase() as "TESTNET" | "PUBLIC";

export const config = {
  supabaseUrl: need("SUPABASE_URL"),
  supabaseServiceRoleKey: need("SUPABASE_SERVICE_ROLE_KEY"),
  network: rawNetwork,
  // The merchants.network column stores "testnet"|"mainnet" (lowercase). The
  // listener must only watch merchants on the SAME network it streams, or it
  // tries to stream a testnet address against mainnet Horizon (or vice-versa)
  // and the stream errors forever. Map the Stellar-facing shape to that column.
  merchantNetwork: rawNetwork === "TESTNET" ? "testnet" : "mainnet",
  // Fail-closed gating flag: anything not explicitly TESTNET is treated as
  // mainnet. `network` keeps its Stellar-facing "TESTNET"|"PUBLIC" shape (used
  // by horizon/manager); this flag is the one the SSRF guard keys off of so a
  // PUBLIC network can never silently disable the webhook blocklist (audit-003).
  isMainnet: rawNetwork !== "TESTNET",
  // Dev-only escape hatch. When "1", permits http/localhost/RFC1918 webhook
  // targets so local mock servers work in tests. NEVER set in production.
  allowLocalWebhooks: (process.env.ALLOW_LOCAL_WEBHOOKS ?? "") === "1",
  merchantPollMs: Number(process.env.MERCHANT_POLL_MS ?? "30000"),
};
