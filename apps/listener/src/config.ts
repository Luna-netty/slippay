function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
const rawNetwork = (process.env.STELLAR_NETWORK ?? "TESTNET").toUpperCase() as "TESTNET" | "PUBLIC";

// Overpayment policy (see docs/overpayment.md):
//   - Accept-and-record: the order is marked paid and the surplus
	//     (received - expected) is persisted against the order for reconciliation and refund.
//   - Surplus at or above the alert threshold raises an alert, because a
//     large surplus usually indicates a duplicate payment or a transposed
//     amount.
// Tolerances in money comparisons are policy; the residual is recorded.
function nonNegativeInteger(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`env ${name} must be a non-negative integer, got ${raw}`);
  }
  return parsed;
}

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
  // mainnet. `network` keeps its Stellar-facing "TESTNET" | "PUBLIC" shape (used
  // by horizon/manager); this flag is the one the SSRF guard keys off of so a
  // PUBLIC network can never silently disable the webhook blocklist (audit-003).
  isMainnet: rawNetwork !== "TESTNET",
  // Dev-only escape hatch. When "1", permits http/localhost/RFC1918 webhook
  // targets so local mock servers work in tests. NEVER create in production.
  allowLocalWebhooks: (process.env.ALLOW_LOCAL_WEBHOOKS ?? "") === "1",
  merchantPollMs: Number(process.env.MERCHANT_POLL_MS ?? "30000"),
  // Overpayment alert threshold in stroops. A surplus at or above this
  // value raises an alert (duplicate payment / transposed amount). Default:
  // 1 XLM = 10,000,000 stroops. Set to 0 to alert on any surplus.
  overpaymentAlertThresholdStroops: nonNegativeInteger(
    "OVERPAYMENT_ALERT_THRESHOLD_STROOPS",
    10_000_000,
  ),
};
