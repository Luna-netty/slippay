#!/usr/bin/env node
// One-time mainnet USDC setup for the biometric demo "pay in dollars":
//  1. USDC trustline on the relayer sponsor (so it can hold/send USDC)
//  2. swap a little XLM -> USDC into the sponsor via the Stellar DEX
//  3. USDC trustline on the demo recipient (so it can receive USDC)
// Classic ops via Horizon. Secrets come from env (never printed).
import * as S from "../apps/web/node_modules/@stellar/stellar-sdk/lib/index.js";
const { Horizon, Keypair, Networks, TransactionBuilder, Operation, Asset, BASE_FEE } = S;

const USDC = new Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
const horizon = new Horizon.Server("https://horizon.stellar.org");
const FEE = String(Number(BASE_FEE) * 100);

const relayer = Keypair.fromSecret(process.env.RELAYER_SECRET);
const deployer = Keypair.fromSecret(process.env.DEPLOYER_SECRET);
const SWAP_XLM = process.env.SWAP_XLM || "6";       // XLM to spend
const MIN_USDC = process.env.MIN_USDC || "0.8";      // min USDC to receive

async function send(kp, ops, label) {
  const acct = await horizon.loadAccount(kp.publicKey());
  const b = new TransactionBuilder(acct, { fee: FEE, networkPassphrase: Networks.PUBLIC });
  for (const op of ops) b.addOperation(op);
  const tx = b.setTimeout(120).build();
  tx.sign(kp);
  try {
    const r = await horizon.submitTransaction(tx);
    console.log(`[${label}] OK ${r.hash}`);
    return r;
  } catch (e) {
    const rc = e?.response?.data?.extras?.result_codes;
    console.log(`[${label}] ERR`, JSON.stringify(rc ?? e?.message ?? e));
    throw e;
  }
}

function hasUsdc(acct) {
  return acct.balances.some((x) => x.asset_code === "USDC" && x.asset_issuer === USDC.issuer);
}

async function main() {
  console.log("relayer:", relayer.publicKey(), "| deployer(recipient):", deployer.publicKey());

  // 1. relayer trustline
  const rAcct = await horizon.loadAccount(relayer.publicKey());
  if (!hasUsdc(rAcct)) await send(relayer, [Operation.changeTrust({ asset: USDC })], "relayer trustline");
  else console.log("[relayer trustline] already present");

  // 2. swap XLM -> USDC into the relayer (path payment to self)
  await send(relayer, [Operation.pathPaymentStrictSend({
    sendAsset: Asset.native(), sendAmount: SWAP_XLM,
    destination: relayer.publicKey(), destAsset: USDC, destMin: MIN_USDC, path: [],
  })], "swap XLM->USDC");

  // 3. recipient (deployer) trustline
  const dAcct = await horizon.loadAccount(deployer.publicKey());
  if (!hasUsdc(dAcct)) await send(deployer, [Operation.changeTrust({ asset: USDC })], "recipient trustline");
  else console.log("[recipient trustline] already present");

  // report balances
  const rb = (await horizon.loadAccount(relayer.publicKey())).balances;
  const usdc = rb.find((x) => x.asset_code === "USDC");
  const xlm = rb.find((x) => x.asset_type === "native");
  console.log(`\nrelayer now: ${xlm?.balance} XLM · ${usdc?.balance ?? 0} USDC`);
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
