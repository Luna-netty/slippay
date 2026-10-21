#!/usr/bin/env node
// Agent-wallet enforcement e2e on Stellar MAINNET.
//
// Same money-shot as the testnet version: a delegated agent signs with its own
// ed25519 session key (WalletAuth::Agent), moves funds WITHIN its on-chain
// budget, and the contract REJECTS a transfer ABOVE the per-tx cap — enforced in
// __check_auth, no human in the loop. Tiny amounts; recipient defaults to the
// deployer (an account that exists, so the native SAC transfer can land).
//
// Requires a wallet instance already deployed on mainnet (see slippay-agent-mainnet.sh).
// Run via the orchestrator, or:
//   WALLET=<id> DEPLOYER_SECRET=<S...> NODE_PATH=apps/web/node_modules \
//     node scripts/e2e-agent-wallet-mainnet.mjs
import * as S from "../apps/web/node_modules/@stellar/stellar-sdk/lib/index.js";
import { execSync } from "node:child_process";

const { rpc, xdr, Keypair, Networks, TransactionBuilder, Operation, Address, Asset, Contract, nativeToScVal, hash, BASE_FEE } = S;

const RPC = process.env.RPC || "https://soroban-rpc.mainnet.stellar.gateway.fm";
const PASSPHRASE = process.env.PASSPHRASE || Networks.PUBLIC;
const CLI_NET = process.env.CLI_NETWORK || "mainnet-rpc";
const SOURCE = process.env.SOURCE || "slippay-mainnet-deployer";
const WALLET = process.env.WALLET; // required — mainnet wallet instance
const DEPLOYER_SECRET = process.env.DEPLOYER_SECRET;
// Tiny mainnet amounts (7-decimal stroops). 1 XLM = 10_000_000.
const PER_TX = process.env.PER_TX || "3000000";       // 0.3 XLM per-tx cap
const WINDOW_CAP = process.env.WINDOW_CAP || "5000000"; // 0.5 XLM window cap
const FUND = process.env.FUND || "5000000";            // 0.5 XLM funded into wallet
const WITHIN = process.env.WITHIN || "1000000";        // 0.1 XLM — within cap, succeeds
const OVER = process.env.OVER || "4000000";            // 0.4 XLM — over per-tx cap, rejected
const SSL_HASH = process.env.SSL_HASH || "ab".repeat(32);
const EXPLORER = "https://stellar.expert/explorer/public/tx/";
const server = new rpc.Server(RPC, { allowHttp: false });

const log = (...a) => console.log(...a);
const sh = (cmd) => { log("· " + cmd.replace(DEPLOYER_SECRET ?? "x", "***")); return execSync(cmd, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim(); };

const NATIVE_SAC = Asset.native().contractId(PASSPHRASE);

function scAddr(id) { return new Address(id).toScVal(); }
function i128(n) { return nativeToScVal(BigInt(n), { type: "i128" }); }

function transferInvocation(from, to, amount) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(NATIVE_SAC).toScAddress(),
        functionName: "transfer",
        args: [scAddr(from), scAddr(to), i128(amount)],
      })
    ),
    subInvocations: [],
  });
}

function signAgentAuth(agent, invocation, nonce, sigExpLedger) {
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(PASSPHRASE)),
      nonce: xdr.Int64.fromString(String(nonce)),
      signatureExpirationLedger: sigExpLedger,
      invocation,
    })
  );
  const payload = hash(preimage.toXDR());
  const sig = agent.sign(payload);
  const walletAuth = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Agent"),
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("session_pubkey"), val: xdr.ScVal.scvBytes(agent.rawPublicKey()) }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("signature"), val: xdr.ScVal.scvBytes(sig) }),
    ]),
  ]);
  const creds = new xdr.SorobanAddressCredentials({
    address: new Address(WALLET).toScAddress(),
    nonce: xdr.Int64.fromString(String(nonce)),
    signatureExpirationLedger: sigExpLedger,
    signature: walletAuth,
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(creds),
    rootInvocation: invocation,
  });
}

async function agentTransfer(agent, deployer, to, amount, label) {
  const { sequence } = await server.getLatestLedger();
  const sigExp = sequence + 200;
  const nonce = Math.floor(Math.random() * 1e15);
  const invocation = transferInvocation(WALLET, to, amount);
  const authEntry = signAgentAuth(agent, invocation, nonce, sigExp);

  const op = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(NATIVE_SAC).toScAddress(),
        functionName: "transfer",
        args: [scAddr(WALLET), scAddr(to), i128(amount)],
      })
    ),
    auth: [authEntry],
  });

  const src = await server.getAccount(deployer.publicKey());
  const tx = new TransactionBuilder(src, { fee: String(Number(BASE_FEE) * 100), networkPassphrase: PASSPHRASE })
    .addOperation(op).setTimeout(60).build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    log(`\n[${label}] amount=${amount} → REJECTED at auth: ${sim.error}\n`);
    return { rejected: true, error: sim.error };
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();
  assembled.sign(deployer);
  const sent = await server.sendTransaction(assembled);
  let res = await server.getTransaction(sent.hash);
  for (let i = 0; i < 30 && res.status === "NOT_FOUND"; i++) { await new Promise(r => setTimeout(r, 1000)); res = await server.getTransaction(sent.hash); }
  log(`\n[${label}] amount=${amount} → ${res.status} · tx ${sent.hash}`);
  log(`  ${EXPLORER}${sent.hash}\n`);
  return { rejected: false, status: res.status, hash: sent.hash };
}

async function sessionExists(agent, feeAcct) {
  try {
    const c = new Contract(WALLET);
    const op = c.call("get_agent_session", nativeToScVal(agent.rawPublicKey(), { type: "bytes" }));
    const src = await server.getAccount(feeAcct.publicKey());
    const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(op).setTimeout(30).build();
    const sim = await server.simulateTransaction(tx);
    return !rpc.Api.isSimulationError(sim);
  } catch { return false; }
}

async function main() {
  if (!WALLET) { console.error("WALLET required (mainnet wallet instance id)"); process.exit(1); }
  if (!DEPLOYER_SECRET) { console.error("DEPLOYER_SECRET required"); process.exit(1); }
  const deployer = Keypair.fromSecret(DEPLOYER_SECRET);
  const agent = Keypair.random();
  const agentPubHex = agent.rawPublicKey().toString("hex");
  // Recipient MUST be (a) an existing/funded account — the native SAC won't
  // create a new account with a sub-1-XLM transfer — and (b) NOT the wallet
  // admin (the contract rejects allowing the controller as a recipient,
  // Error #15 RecipientNotAllowed). The orchestrator funds a dedicated
  // recipient and passes it here.
  const recipient = process.env.RECIPIENT;
  if (!recipient) { console.error("RECIPIENT required (a funded, non-admin account)"); process.exit(1); }
  log("MAINNET · native SAC:", NATIVE_SAC);
  log("wallet:", WALLET);
  log("agent ed25519 pubkey:", agentPubHex);
  log("recipient:", recipient);

  let ready = false;
  for (let attempt = 1; attempt <= 6 && !ready; attempt++) {
    log(`\n=== setup attempt ${attempt} · install agent session · fund wallet ===`);
    sh(`stellar contract invoke --network ${CLI_NET} --source ${SOURCE} --id ${WALLET} -- install_agent_session --session_pubkey ${agentPubHex} --token ${NATIVE_SAC} --per_tx_cap ${PER_TX} --window_seconds 86400 --window_cap ${WINDOW_CAP} --expires_at 0 --allow_recipients '["${recipient}"]' --ssl_hash ${SSL_HASH} >/dev/null 2>&1 || true`);
    sh(`stellar contract invoke --network ${CLI_NET} --source ${SOURCE} --id ${NATIVE_SAC} -- transfer --from ${deployer.publicKey()} --to ${WALLET} --amount ${FUND} >/dev/null 2>&1 || true`);
    await new Promise((r) => setTimeout(r, 4000));
    ready = await sessionExists(agent, deployer);
    log(`  session on-chain: ${ready ? "YES" : "not yet, retrying…"}`);
  }
  if (!ready) { console.error("setup failed — agent session never landed on-chain"); process.exit(1); }

  const ok = await agentTransfer(agent, deployer, recipient, WITHIN, "WITHIN cap");
  const over = await agentTransfer(agent, deployer, recipient, OVER, "OVER cap");

  log("=== RESULT (MAINNET) ===");
  log("within-cap transfer:", ok.rejected ? "REJECTED (unexpected)" : `${ok.status} ${ok.hash ?? ""}`);
  log("  hash:", ok.hash ?? "(none)");
  log("over-cap transfer:  ", over.rejected ? `REJECTED ✓ (${over.error})` : `${over.status} (unexpected — should reject)`);
  log("\n↑ the WITHIN hash is your real agent→recipient bounded payment on mainnet.");
}

main().catch(e => { console.error(e); process.exit(1); });
