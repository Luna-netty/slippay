#!/usr/bin/env node
// Robust mainnet upload+deploy of the subscription v0.2 wasm, surfacing the REAL
// RPC error (the stellar CLI's "submission timeout" is opaque). Same proven
// pattern that landed the mainnet charge: simulate → assemble → sign → send →
// poll up to 120s. Two steps: uploadContractWasm, then createContract.
import * as S from "../apps/web/node_modules/@stellar/stellar-sdk/lib/index.js";
import { readFileSync } from "node:fs";
const { rpc, Keypair, Networks, TransactionBuilder, Operation, Address, hash, xdr, BASE_FEE } = S;

const RPC = process.env.RPC || "https://mainnet.sorobanrpc.com";
const server = new rpc.Server(RPC);
const kp = Keypair.fromSecret(process.env.DEPLOYER_SECRET);
const wasm = readFileSync(process.env.WASM);
const FEE = String(Number(BASE_FEE) * 10000);
// v0.4 __constructor(platform, fee_bps): platform fee recipient + bps (297 = 2.97%).
const PLATFORM = process.env.PLATFORM || "GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P";
const FEE_BPS = Number(process.env.FEE_BPS || "297");

async function submit(op, label) {
  const src = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(src, { fee: FEE, networkPassphrase: Networks.PUBLIC })
    .addOperation(op).setTimeout(120).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`[${label}] SIM: ${sim.error}`);
  const asm = rpc.assembleTransaction(tx, sim).build();
  asm.sign(kp);
  const sent = await server.sendTransaction(asm);
  console.log(`[${label}] send: ${sent.status} ${sent.hash} ${sent.errorResult ? JSON.stringify(sent.errorResult) : ""}`);
  if (sent.status === "ERROR") throw new Error(`[${label}] send ERROR`);
  let res = await server.getTransaction(sent.hash);
  for (let i = 0; i < 120 && res.status === "NOT_FOUND"; i++) { await new Promise(r => setTimeout(r, 1000)); res = await server.getTransaction(sent.hash); }
  console.log(`[${label}] final: ${res.status} ${sent.hash}`);
  if (res.status !== "SUCCESS") throw new Error(`[${label}] ${res.status}: ${JSON.stringify(res.resultXdr ?? res)}`);
  return { res, hash: sent.hash };
}

async function main() {
  console.log("deployer:", kp.publicKey(), "| wasm bytes:", wasm.length, "| rpc:", RPC);

  // 1. upload wasm
  const up = await submit(Operation.uploadContractWasm({ wasm }), "upload");
  const wasmHash = up.res.returnValue.bytes();
  const wasmHashHex = Buffer.from(wasmHash).toString("hex");
  console.log("WASM HASH:", wasmHashHex);

  // Upload-only mode: e.g. the smart-wallet wasm, where per-user instances are
  // created on demand by the relayer, not a single contract here.
  if (process.env.SKIP_CREATE === "1") {
    console.log("\n=== UPLOADED (MAINNET, no instance) ===");
    console.log("wasm hash:", wasmHashHex);
    return;
  }

  // 2. create contract instance from the uploaded wasm hash, running the v0.4
  // constructor (platform fee recipient + fee_bps) atomically at deploy.
  const salt = hash(Buffer.from(`slippay-sub-${process.env.SALT_TAG || "v4"}-${kp.publicKey()}`));
  // Domain commitment for attestation domain-separation (anti cross-contract /
  // cross-chain replay). Bound to the network passphrase + deploy tag; the
  // off-chain attester (scheduler / e2e) MUST sign with this exact 32 bytes.
  const PASSPHRASE = "Public Global Stellar Network ; September 2015";
  const DOMAIN = hash(Buffer.from(`slippay-domain-${process.env.SALT_TAG || "v4"}|${PASSPHRASE}`));
  const constructorArgs = [
    new Address(PLATFORM).toScVal(),
    xdr.ScVal.scvU32(FEE_BPS),
    xdr.ScVal.scvBytes(DOMAIN),
  ];
  console.log("constructor:", PLATFORM, "fee_bps", FEE_BPS, "domain", DOMAIN.toString("hex").slice(0, 16) + "…");
  const create = await submit(
    Operation.createCustomContract({ address: new Address(kp.publicKey()), wasmHash, salt, constructorArgs }),
    "create",
  );
  // contract id is the return of createContract (an address scval)
  let contractId;
  try { contractId = Address.fromScVal(create.res.returnValue).toString(); } catch { contractId = "(parse: check explorer)"; }
  console.log("\n=== DEPLOYED (MAINNET) ===");
  console.log("contract id:", contractId);
  console.log("explorer:", `https://stellar.expert/explorer/public/contract/${contractId}`);
}

main().catch(e => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
