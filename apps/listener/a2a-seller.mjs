#!/usr/bin/env node
// A2A seller (agent A) — minimal x402 endpoint for the testnet proof.
//
// Speaks the same 402 protocol the production x402 route serves (accepts[0] +
// payload{amount,assetCode,assetIssuer,memo}) so the autonomous buyer (a2a-buyer.mjs)
// works against it unchanged. NOT the production seller (that is supabase x402.ts on
// mainnet) — this is a self-contained agent A to prove the A2A loop end-to-end on
// testnet: charge -> confirm payment on Horizon by memo -> release the datum.
//
// Run: A2A_SELLER_SECRET=S... A2A_USDC_ISSUER=G... A2A_AMOUNT=0.01 \
//      A2A_NETWORK=testnet PORT=8788 node apps/listener/a2a-seller.mjs

import { Horizon, Keypair } from "@stellar/stellar-sdk";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const NET = process.env.A2A_NETWORK ?? "testnet";
const HORIZON = NET === "public" ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org";
const PORT = Number(process.env.PORT ?? "8788");
const AMOUNT = process.env.A2A_AMOUNT ?? "0.01";
const ASSET_CODE = "USDC";
const ISSUER = process.env.A2A_USDC_ISSUER;
const seller = Keypair.fromSecret(process.env.A2A_SELLER_SECRET);
const RESOURCE = "/datum";
const CONTENT = process.env.A2A_CONTENT ?? `{"datum":"the-price-of-eth-was-2412","served_at":"runtime","by":"agent-A"}`;

if (!ISSUER) { console.error("missing A2A_USDC_ISSUER"); process.exit(1); }

const horizon = new Horizon.Server(HORIZON);
// One memo per unsettled session (regenerated after a delivery).
let memoHex = randomBytes(32).toString("hex");
let delivered = false;

// Has a payment of >= AMOUNT USDC(ISSUER) to the seller with our memo landed?
async function paymentConfirmed() {
  try {
    const page = await horizon.payments().forAccount(seller.publicKey()).order("desc").limit(30).call();
    for (const op of page.records) {
      if (op.type !== "payment") continue;
      if (op.asset_type === "native") continue;
      if (op.asset_code !== ASSET_CODE || op.asset_issuer !== ISSUER) continue;
      if (op.to !== seller.publicKey()) continue;
      if (Number(op.amount) + 1e-9 < Number(AMOUNT)) continue;
      const tx = await op.transaction();
      if (tx.memo_type === "hash" && tx.memo && Buffer.from(tx.memo, "base64").toString("hex") === memoHex) {
        return tx.hash;
      }
    }
  } catch (e) { console.error("horizon check failed:", e?.message ?? e); }
  return null;
}

function require402(res) {
  const body = {
    x402Version: 1,
    accepts: [{
      scheme: "exact",
      network: NET === "public" ? "stellar" : "stellar-testnet",
      resource: RESOURCE,
      payTo: seller.publicKey(),
      maxAmountRequired: AMOUNT,
      payload: { amount: AMOUNT, assetCode: ASSET_CODE, assetIssuer: ISSUER, memo: memoHex },
    }],
  };
  res.writeHead(402, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  if (!req.url.startsWith(RESOURCE)) { res.writeHead(404); res.end("not found"); return; }
  if (delivered) { res.writeHead(200, { "content-type": "application/json" }); res.end(CONTENT); return; }
  const txHash = await paymentConfirmed();
  if (txHash) {
    delivered = true;
    console.log(`✓ payment confirmed (tx ${txHash}) — releasing datum`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(CONTENT);
    return;
  }
  require402(res);
});

server.listen(PORT, () => {
  console.log(`A2A seller (agent A) on :${PORT}${RESOURCE}`);
  console.log(`  payTo: ${seller.publicKey()}`);
  console.log(`  charging: ${AMOUNT} ${ASSET_CODE} · memo ${memoHex.slice(0, 12)}… · ${NET}`);
});
