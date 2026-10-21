#!/usr/bin/env node
// Policy-checkout spike HTTP server.
//
// Single POST endpoint `/api/policy-checkout/spike` that deploys a fresh
// slippay-smart-wallet instance on Stellar testnet — passing the wallet's
// __constructor args (placeholder passkey material + admin + absolute
// per-charge ceiling) ATOMICALLY at deploy time (SECURITY_AUDIT C2/C3, no
// un-inited front-run window) — and calls install_policy() with the
// merchant/amount/interval supplied in the request body. Returns JSON
// with the new contract id + tx hashes + stellar.expert URLs.
//
// This is the trusted setup oracle described in DEPLOYED.md. It holds the
// slippay-deployer testnet key via stellar-cli's keyring and shells out
// to stellar contract invoke for each step. Latency is ~25-45s per
// request — acceptable for a spike demo, NOT production.
//
// Run from the repo root:
//   node scripts/policy-checkout-spike-server.mjs
//   # listens on http://localhost:8787
//
// In production, Vite's dev server proxies /api/* to this port; nginx
// would do the same. The frontend hits the same path regardless.

import { createServer } from "node:http";
import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
// Resolve @stellar/stellar-sdk from the apps/web workspace install — the
// scripts/ dir has no node_modules of its own.
import {
  Keypair, Horizon, TransactionBuilder, Networks, BASE_FEE,
  Contract, Address, nativeToScVal, xdr, rpc as SorobanRpc,
  authorizeEntry, Operation,
} from "../apps/web/node_modules/@stellar/stellar-sdk/lib/index.js";

const execFile = promisify(_execFile);
const PORT = Number(process.env.PORT ?? 8787);
const NETWORK = process.env.NETWORK ?? "testnet";
const DEPLOYER_KEY = process.env.DEPLOYER_KEY ?? "slippay-deployer";

// Load wasm hash + template from the deployed env file.
const DEPLOY_ENV_PATH = new URL(
  "../contracts/smart-wallet/.testnet-deploy.env",
  import.meta.url,
);
function loadEnv() {
  const txt = readFileSync(DEPLOY_ENV_PATH, "utf8");
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
const ENV = loadEnv();
const WASM_HASH = ENV.SLIPPAY_SMART_WALLET_WASM_HASH_TESTNET;
if (!WASM_HASH) {
  console.error("missing SLIPPAY_SMART_WALLET_WASM_HASH_TESTNET");
  process.exit(1);
}

// Placeholder passkey material. v0.2 replaces with real WebAuthn credentials.
const PLACEHOLDER_PUBKEY =
  "04" + "01".repeat(32) + "02".repeat(32);
const PLACEHOLDER_CRED_ID = "03".repeat(32);

// SECURITY_AUDIT C3 · immutable absolute per-charge ceiling, passed to the
// __constructor and never settable again. Caps the largest single per-charge
// drain even with a fully compromised admin. For the demo this is sized well
// above the demo amounts but far below the funded balance. Override with
// MAX_ABSOLUTE_PER_CHARGE (stroops, 7 decimals). Default 100.0 XLM/USDC.
const MAX_ABSOLUTE_PER_CHARGE = process.env.MAX_ABSOLUTE_PER_CHARGE ?? "1000000000";

// v0.1 admin = the trusted setup oracle, i.e. this server's signing
// key. The wallet's `install_policy` and `revoke_policy` require this
// address's `require_auth`. v0.2 migrates admin to the wallet's own
// contract address so the user's passkey gates these mutations.
async function getAdminAddress() {
  const { stdout } = await execFile("stellar", ["keys", "address", DEPLOYER_KEY]);
  return stdout.toString().trim();
}

// Demo merchant + token. The TOKEN constant is the native XLM SAC; for v0.1
// we don't actually move USDC, we just install a policy that names this
// token. v0.2 wires USDC SAC.
const DEMO_MERCHANT = "GAE5HOWKZVVL5AOZQVJOZFY2ZB7Z2YK6PV4UKWOWB3KQWQCHY2PBVJMM";
const DEMO_TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

async function stellar(args, opts = {}) {
  const t0 = Date.now();
  const { stdout, stderr } = await execFile("stellar", args, {
    maxBuffer: 8 * 1024 * 1024,
    ...opts,
  });
  const dt = Date.now() - t0;
  return { stdout: stdout.toString(), stderr: stderr.toString(), dt };
}

// Parse a stellar.expert tx URL out of stellar-cli stdout. The CLI prints
// `🔗 https://stellar.expert/explorer/testnet/tx/<hash>` on every submit.
function parseTxHash(stdout) {
  const m = stdout.match(/explorer\/testnet\/tx\/([0-9a-f]{64})/);
  return m ? m[1] : null;
}

async function fundWallet(wallet) {
  // Transfer 10 XLM from the deployer G-account to the wallet contract via
  // the native asset SAC. The wallet now holds XLM (in SAC form) and can be
  // the `from` of subsequent SAC.transfer calls that go through __check_auth.
  return stellar([
    "contract", "invoke",
    "--network", NETWORK,
    "--source", DEPLOYER_KEY,
    "--id", DEMO_TOKEN,
    "--",
    "transfer",
    "--from", await getAdminAddress(),
    "--to", wallet,
    "--amount", "100000000", // 10.0 XLM (7 decimals)
  ]);
}

async function deployAndInstall({
  amount_per_charge,
  max_per_charge,
  interval_seconds,
  expires_at,
}) {
  // Step 1: deploy fresh instance from wasm hash, passing the __constructor
  // args ATOMICALLY (SECURITY_AUDIT C2). `stellar contract deploy -- <ctor
  // args>` invokes the contract's __constructor in the SAME transaction as the
  // create, so there is NO un-inited window between deploy and init for an
  // observer to front-run with their own passkey + admin. This replaces the old
  // two-step deploy-then-init flow that C2 flagged.
  const adminAddr = await getAdminAddress();
  const deploy = await stellar([
    "contract", "deploy",
    "--network", NETWORK,
    "--source", DEPLOYER_KEY,
    "--wasm-hash", WASM_HASH,
    "--",
    "--passkey_pubkey", PLACEHOLDER_PUBKEY,
    "--passkey_cred_id", PLACEHOLDER_CRED_ID,
    "--admin", adminAddr,
    // SECURITY_AUDIT C3 · immutable absolute per-charge ceiling.
    "--max_absolute_per_charge", String(MAX_ABSOLUTE_PER_CHARGE),
  ]);
  // stellar-cli prints the contract id on the last line of stdout.
  const wallet = deploy.stdout.trim().split(/\r?\n/).pop().trim();
  if (!wallet.startsWith("C") || wallet.length !== 56) {
    throw new Error(`deploy: unexpected contract id '${wallet}'`);
  }
  // Deploy now carries init; the tx hash for the atomic deploy+construct is the
  // deploy tx. Surface it as init_tx for response-shape compatibility.
  const initTx = parseTxHash(deploy.stdout + deploy.stderr);

  // Step 2: install_policy.
  const install = await stellar([
    "contract", "invoke",
    "--network", NETWORK,
    "--source", DEPLOYER_KEY,
    "--id", wallet,
    "--",
    "install_policy",
    "--merchant", DEMO_MERCHANT,
    "--token", DEMO_TOKEN,
    "--amount_per_charge", String(amount_per_charge),
    "--max_per_charge", String(max_per_charge),
    "--interval_seconds", String(interval_seconds),
    "--expires_at", String(expires_at),
  ]);
  const policyTx = parseTxHash(install.stdout + install.stderr);

  // Step 3: fund the wallet with XLM (via native SAC) so it can be the
  // `from` of a subsequent merchant pull demo.
  const fund = await fundWallet(wallet);
  const fundTx = parseTxHash(fund.stdout + fund.stderr);

  return {
    wallet_contract_id: wallet,
    init_tx: initTx,
    policy_tx: policyTx,
    fund_tx: fundTx,
    wallet_url: `https://stellar.expert/explorer/testnet/contract/${wallet}`,
    init_tx_url: initTx
      ? `https://stellar.expert/explorer/testnet/tx/${initTx}`
      : null,
    policy_tx_url: policyTx
      ? `https://stellar.expert/explorer/testnet/tx/${policyTx}`
      : null,
    fund_tx_url: fundTx
      ? `https://stellar.expert/explorer/testnet/tx/${fundTx}`
      : null,
    network: NETWORK,
    timing_ms: {
      // deploy now includes the atomic __constructor (init folded in, C2).
      deploy: deploy.dt,
      install: install.dt,
      fund: fund.dt,
    },
  };
}

// -------- Charge demo via @stellar/stellar-sdk --------
// stellar-cli refuses to construct a SorobanAuthorizationEntry for a
// custom-account wallet (it expects a signing key by address). We sidestep
// by building the transaction manually with the SDK and injecting an
// Address-credentialed auth entry whose `signature` field is the v0.1
// placeholder (64 bytes of 0x01). The wallet's `__check_auth` accepts any
// non-zero signature in v0.1; this is the same trusted-setup gating used
// for install_policy.

const RPC_URL = "https://soroban-testnet.stellar.org";
const NET_PASS = Networks.TESTNET;
const sorobanServer = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

async function loadDeployerKeypair() {
  // Stellar-cli stores keys under ~/.config/stellar/identity/<name>.toml
  // with `seed_phrase = "..."` for HD wallets. The deploy script created
  // slippay-deployer via friendbot at index 0 with a fresh seed phrase
  // (per `stellar keys generate`). We need the raw secret to sign txs
  // server-side. Pulling via `stellar keys show --secret`:
  const { stdout } = await execFile("stellar", ["keys", "secret", DEPLOYER_KEY]);
  return Keypair.fromSecret(stdout.toString().trim());
}

async function chargeViaSdk({ wallet, amount, to }) {
  const t0 = Date.now();
  const deployer = await loadDeployerKeypair();
  const recipient = to ?? DEMO_MERCHANT;

  // Build the contract invocation: tokenContract.transfer(from=wallet, to=recipient, amount)
  const tokenContract = new Contract(DEMO_TOKEN);
  const transferOp = tokenContract.call(
    "transfer",
    new Address(wallet).toScVal(),
    new Address(recipient).toScVal(),
    nativeToScVal(BigInt(amount), { type: "i128" }),
  );

  // Build base transaction with the deployer as source (pays fees).
  const source = await sorobanServer.getAccount(deployer.publicKey());
  let tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NET_PASS })
    .addOperation(transferOp)
    .setTimeout(60)
    .build();

  // Simulate to discover required auth entries.
  const sim = await sorobanServer.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    return {
      status: "rejected",
      error: `simulation: ${sim.error}`,
      amount,
      timing_ms: Date.now() - t0,
    };
  }
  if (!sim.result?.auth || sim.result.auth.length === 0) {
    return {
      status: "rejected",
      error: "no auth entries returned by simulation",
      amount,
      timing_ms: Date.now() - t0,
    };
  }

  // Manually inject a placeholder signature into every Address-credentialed
  // entry. The SDK's `authorizeEntry` helper tries to base32-decode the
  // credential address as an ed25519 G-account on its way through, which
  // breaks for our contract C-address — hence the manual construction.
  const validUntilLedger = (await sorobanServer.getLatestLedger()).sequence + 100;
  const PLACEHOLDER_SIG_BYTES = Buffer.from(new Uint8Array(64).fill(1));
  const newAuthEntries = [];
  for (const entry of sim.result.auth) {
    const creds = entry.credentials();
    if (creds.switch().name !== "sorobanCredentialsAddress") {
      newAuthEntries.push(entry);
      continue;
    }
    // Build a fresh SorobanAddressCredentials with our placeholder sig.
    const addrCreds = creds.address();
    const newAddrCreds = new xdr.SorobanAddressCredentials({
      address: addrCreds.address(),
      nonce: xdr.Int64.fromString(String(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))),
      signatureExpirationLedger: validUntilLedger,
      // signature is an SCVal — for v0.1 wallet __check_auth, just pass
      // the raw 64-byte placeholder as ScVal::Bytes. The contract's
      // signature: BytesN<64> argument maps directly to this.
      signature: xdr.ScVal.scvBytes(PLACEHOLDER_SIG_BYTES),
    });
    newAuthEntries.push(new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(newAddrCreds),
      rootInvocation: entry.rootInvocation(),
    }));
  }

  // Build a fresh tx carrying our patched auth entries, then simulate
  // again so resource fees reflect the placeholder signature size (the
  // first sim used empty placeholder credentials, undercounting bytes).
  const hostFnSc = transferOp.body().invokeHostFunctionOp().hostFunction();
  const txWithAuth = new TransactionBuilder(
    await sorobanServer.getAccount(deployer.publicKey()),
    { fee: BASE_FEE, networkPassphrase: NET_PASS },
  )
    .addOperation(Operation.invokeHostFunction({ func: hostFnSc, auth: newAuthEntries }))
    .setTimeout(60)
    .build();

  const sim2 = await sorobanServer.simulateTransaction(txWithAuth);
  if (SorobanRpc.Api.isSimulationError(sim2)) {
    return {
      status: "rejected",
      error: `re-simulation: ${sim2.error}`,
      amount,
      timing_ms: Date.now() - t0,
    };
  }
  const assembled = SorobanRpc.assembleTransaction(txWithAuth, sim2);
  const finalTx = assembled.build();
  finalTx.sign(deployer);

  const sent = await sorobanServer.sendTransaction(finalTx);
  if (sent.status !== "PENDING") {
    return {
      status: "rejected",
      error: `send: status=${sent.status} hash=${sent.hash} errorResult=${sent.errorResult?.toXDR("base64") ?? ""}`,
      amount,
      timing_ms: Date.now() - t0,
    };
  }

  // Poll for terminal status.
  let r = await sorobanServer.getTransaction(sent.hash);
  while (r.status === "NOT_FOUND") {
    await new Promise(rs => setTimeout(rs, 1500));
    r = await sorobanServer.getTransaction(sent.hash);
  }
  if (r.status !== "SUCCESS") {
    return {
      status: "rejected",
      tx: sent.hash,
      tx_url: `https://stellar.expert/explorer/testnet/tx/${sent.hash}`,
      error: `tx ${r.status}: ${r.resultXdr?.toXDR("base64") ?? ""}`,
      amount,
      timing_ms: Date.now() - t0,
    };
  }
  return {
    status: "ok",
    tx: sent.hash,
    tx_url: `https://stellar.expert/explorer/testnet/tx/${sent.hash}`,
    amount,
    timing_ms: Date.now() - t0,
  };
}

// Rebuild an InvokeHostFunction op with a fresh auth list. The SDK does
// not expose a clean "with auth" mutator on Operation, so we reconstruct
// from xdr.
function xdrInvokeWithAuth(tx, newAuthEntries) {
  const env = tx.toEnvelope();
  const op = env.v1().tx().operations()[0];
  const body = op.body().invokeHostFunctionOp();
  const newOp = new xdr.Operation({
    sourceAccount: op.sourceAccount(),
    body: xdr.OperationBody.invokeHostFunction(
      new xdr.InvokeHostFunctionOp({
        hostFunction: body.hostFunction(),
        auth: newAuthEntries,
      }),
    ),
  });
  // Wrap as a regular Operation via fromXDRObject for the builder.
  return {
    // TransactionBuilder.addOperation accepts an xdr-shaped op via the
    // internal `_operations` push; the cleanest path is to use the
    // Operation.fromXDR class method to materialize a usable Op.
    toXDRObject: () => newOp,
    type: "invokeHostFunction",
  };
}

async function charge({ wallet, amount, to }) {
  // Wrap the SDK path with a timing guard. Falls back to surfacing the
  // error string if the auth-entry plumbing fails — the caller (and the
  // page) renders this as a "rejected" state.
  const t0 = Date.now();
  try {
    return await chargeViaSdk({ wallet, amount, to });
  } catch (e) {
    return {
      status: "rejected",
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      amount,
      timing_ms: Date.now() - t0,
    };
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid JSON body");
  }
}

const server = createServer(async (req, res) => {
  // CORS for the Vite dev server on :5173.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" })
      .end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  try {
    const body = await readJsonBody(req);

    if (req.url === "/api/policy-checkout/spike") {
      // Defaults are small XLM amounts so the demo wallet (funded with 10
      // XLM) can survive multiple within-cap charges. Production switches
      // to test USDC SAC.
      const params = {
        amount_per_charge: body.amount_per_charge ?? 1_000_000,   // 0.1 XLM
        max_per_charge: body.max_per_charge ?? 2_000_000,         // 0.2 XLM cap
        interval_seconds: body.interval_seconds ?? 60,            // 60s for fast demo
        expires_at: body.expires_at ?? 0,
      };
      console.log(new Date().toISOString(), "spike_create", JSON.stringify(params));
      const result = await deployAndInstall(params);
      console.log(
        new Date().toISOString(),
        "spike_created",
        result.wallet_contract_id,
        `(${Object.values(result.timing_ms).reduce((a,b)=>a+b,0)}ms)`,
      );
      res.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(result));
      return;
    }

    if (req.url === "/api/policy-checkout/charge") {
      if (!body.wallet) throw new Error("missing wallet");
      const amount = body.amount ?? 1_000_000; // default within cap
      const to = body.to; // optional · for audit-verification of C1 fix
      console.log(new Date().toISOString(), "charge", body.wallet.slice(0,8), amount, to ? `to=${to.slice(0,8)}` : "");
      const result = await charge({ wallet: body.wallet, amount, to });
      console.log(new Date().toISOString(), "charge_result", result.status, `(${result.timing_ms}ms)`);
      res.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(result));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" })
      .end(JSON.stringify({ error: "not_found" }));
    return;
  } catch (err) {
    console.error(new Date().toISOString(), "spike_error", err.message);
    res.writeHead(500, { "content-type": "application/json" })
      .end(JSON.stringify({ error: "server_error", message: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`policy-checkout-spike-server :${PORT}`);
  console.log(`network=${NETWORK} deployer=${DEPLOYER_KEY} wasm_hash=${WASM_HASH.slice(0,16)}...`);
});
