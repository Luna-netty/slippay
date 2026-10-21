// One-time per-shop setup: registers the orders/create webhook pointing at the
// connector. Run after creating the custom app in the Shopify admin.
//
//   SHOPIFY_SHOP=loja.myshopify.com SHOPIFY_ACCESS_TOKEN=shpat_... \
//     node scripts/setup-shop.mjs [connector-base-url]
//
// Default connector base: https://api.slippay.cc/shopify

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const BASE = process.argv[2] ?? "https://api.slippay.cc/shopify";
const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2024-10";

if (!SHOP || !TOKEN) {
  console.error("usage: SHOPIFY_SHOP=loja.myshopify.com SHOPIFY_ACCESS_TOKEN=shpat_... node scripts/setup-shop.mjs");
  process.exit(1);
}

const admin = async (path, method = "GET", body) => {
  const r = await fetch(`https://${SHOP}/admin/api/${API_VERSION}${path}`, {
    method,
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

const address = `${BASE}/orders-create`;
const { data: existing } = await admin("/webhooks.json");
const dup = (existing.webhooks ?? []).find(w => w.topic === "orders/create" && w.address === address);
if (dup) {
  console.log(`webhook already registered (id ${dup.id}) → ${address}`);
} else {
  const { status, data } = await admin("/webhooks.json", "POST", {
    webhook: { topic: "orders/create", address, format: "json" },
  });
  if (status >= 400) { console.error(`FAILED ${status}:`, JSON.stringify(data)); process.exit(1); }
  console.log(`registered orders/create webhook (id ${data.webhook?.id}) → ${address}`);
}
console.log("\nlembrete: o segredo que assina esses webhooks é o 'API secret key' do custom app");
console.log("(admin → Settings → Apps → Develop apps → seu app → API credentials).");
console.log("coloque em SHOPIFY_WEBHOOK_SECRET no .env.shopify do servidor.");
