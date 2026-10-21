import { Keypair, Horizon, TransactionBuilder, Networks, Operation, Asset, BASE_FEE } from "@stellar/stellar-sdk";

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const HORIZON = "https://horizon-testnet.stellar.org";

const kp = Keypair.random();
console.log("PUBLIC: ", kp.publicKey());
console.log("SECRET: ", kp.secret());

console.log("\n[1/3] friendbot fund...");
const fb = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
if (!fb.ok) { console.error("friendbot failed:", await fb.text()); process.exit(1); }
console.log("  funded");

const server = new Horizon.Server(HORIZON);
const account = await server.loadAccount(kp.publicKey());
console.log(`[2/3] account loaded · seq ${account.sequenceNumber()} · 10000 XLM testnet`);

const usdc = new Asset("USDC", USDC_ISSUER);
const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.changeTrust({ asset: usdc }))
  .setTimeout(60)
  .build();
tx.sign(kp);

console.log("[3/3] submit changeTrust USDC...");
const res = await server.submitTransaction(tx);
console.log("  hash:", res.hash);

const acc = await server.loadAccount(kp.publicKey());
const usdcBal = acc.balances.find(b => b.asset_code === "USDC");
console.log("\n=== DONE ===");
console.log("PLATFORM_ADDRESS:", kp.publicKey());
console.log("trustline USDC :", usdcBal ? "OK (limit " + usdcBal.limit + ")" : "MISSING");
