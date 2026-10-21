#!/usr/bin/env node
// SlipPay MCP — the agent-facing product. Install it and an agent gets the whole
// SlipPay rail as verbs: pay, set up a recurring subscription, turn on autonomous
// debit with one approval, charge autonomously, gate that charge behind a proof of
// integrity, and re-verify any spending bound offline. Non-custodial and
// backend-free by construction: the agent's key signs locally and the tx goes
// straight to a Soroban RPC. The trust model IS the product — every spend is an
// on-chain object a counterparty can re-check, and slippay_charge_attested refuses
// to settle for an agent that can't present a fresh integrity attestation.
//
// Env: SLIPPAY_SIGNER_SECRET (agent wallet S…, required to sign) · SLIPPAY_CONTRACT
// (subscription contract C…) · SLIPPAY_NETWORK (testnet|public, default testnet) ·
// SLIPPAY_RPC_URL / SLIPPAY_USDC_ISSUER (optional overrides).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { reverifyCert } from "./verify.ts";
import * as chain from "./chain.ts";

const server = new McpServer({ name: "slippay", version: "0.2.0" });

// The membrane principle (Wave, 2026-06-03): an agent's surface must be minimal
// and capability-HONEST, not additive. More tools = more injection paths. The
// AGENT (default) gets only: prove a bound (verify), check status, and spend
// THROUGH THE GATE (charge_attested) — a compromised agent physically can't get a
// fresh attestation, so it can't spend. It gets NO raw pay (ungated escape hatch)
// and NO privileged setup. The PRINCIPAL role adds the trust-establishing verbs
// (subscribe / approve / arm_gate) + raw pay. Set SLIPPAY_ROLE=principal to enable.
const PRINCIPAL = (process.env.SLIPPAY_ROLE ?? "agent").toLowerCase() === "principal";

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}
function fail(e: unknown) {
  return { content: [{ type: "text" as const, text: `error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
}
const run = async (fn: () => Promise<unknown>) => { try { return text(await fn()); } catch (e) { return fail(e); } };

// ── slippay_verify — the moat. Offline, no key, no network. ──
server.registerTool(
  "slippay_verify",
  {
    title: "Re-verify a SlipPay proof-carrying certificate (offline)",
    description:
      "Re-verify, locally and offline, that a spending bound is real. Pass the proof certificate (JSON) " +
      "and the agent spec it covers. Returns the spec↔certificate SHA-256 binding (tamper-evidence), " +
      "structural coherence, and the exact SMT-LIB obligations the compiler discharged. Use before " +
      "trusting a counterparty agent's claimed limit. Nothing is sent anywhere.",
    inputSchema: {
      certificate: z.string().describe("The axl proof-certificate JSON."),
      spec: z.string().describe("The agent .axl spec the certificate claims to cover."),
    },
  },
  async ({ certificate, spec }) => {
    const r = reverifyCert(certificate, spec);
    return text({
      verified: r.verified,
      summary: r.verified ? "VERIFIED — bound to this exact spec, certificate coherent." : "FAILED — see checks (red binding = tampered).",
      checks: r.checks,
      obligations: r.obligations.map((o) => ({ name: o.name, expect: o.expect, smt: o.smt })),
    });
  },
);

// ── slippay_whoami — the agent wallet address (no signing). ──
server.registerTool(
  "slippay_whoami",
  { title: "Show the agent's SlipPay wallet address", description: "Return the Stellar public key derived from SLIPPAY_SIGNER_SECRET, the network, and the configured contract. No transaction.", inputSchema: {} },
  async () => run(async () => ({
    address: chain.whoami(),
    network: chain.IS_PUBLIC ? "public (mainnet)" : "testnet",
    rpc: chain.RPC_URL,
    contract: process.env.SLIPPAY_CONTRACT ?? "(SLIPPAY_CONTRACT unset)",
  })),
);

// ── slippay_pay — PRINCIPAL ONLY: a raw (ungated) on-chain payment. ──
if (PRINCIPAL) server.registerTool(
  "slippay_pay",
  {
    title: "Pay an asset on-chain from the agent wallet",
    description: "Send a SEP-41/SAC asset payment (default USDC) from the agent's wallet to a recipient, settled on Stellar in ~5s. Signed locally, submitted to the RPC. Returns the tx hash + explorer link.",
    inputSchema: {
      recipient: z.string().describe("Recipient Stellar address (G…)."),
      amount: z.string().describe("Decimal amount, e.g. \"0.50\"."),
      asset: z.string().default("USDC").describe("Asset code. Default USDC."),
    },
  },
  async ({ recipient, amount, asset }) => run(() => chain.pay(recipient, amount, asset)),
);

// ── slippay_subscribe — PRINCIPAL ONLY: create an on-chain recurring subscription. ──
if (PRINCIPAL) server.registerTool(
  "slippay_subscribe",
  {
    title: "Create a recurring subscription on-chain",
    description: "Create a SlipPay subscription where the agent is the payer: amount, period (seconds, ≥86400), optional max_periods/expiry. Returns the subscription_id (32-byte hex) used by approve/autocharge.",
    inputSchema: {
      merchant: z.string().describe("Merchant Stellar address (G…) that receives the charges."),
      amount: z.string().describe("USDC per cycle, decimal, e.g. \"9.00\"."),
      period_seconds: z.number().int().min(86400).describe("Cycle length in seconds (contract minimum 86400 = 1 day)."),
      max_periods: z.number().int().min(0).default(0).describe("0 = unlimited until cancel/expiry."),
      expires_at: z.number().int().min(0).default(0).describe("Unix time to expire, 0 = none."),
    },
  },
  async (a) => run(() => chain.subscribe(a.merchant, a.amount, a.period_seconds, a.max_periods, a.expires_at)),
);

// ── slippay_approve — PRINCIPAL ONLY: the one signature that turns on autonomous debit. ──
if (PRINCIPAL) server.registerTool(
  "slippay_approve",
  {
    title: "Authorize autonomous recurring debit (one signature)",
    description: "Approve the SlipPay subscription contract as a SEP-41 spender up to a capped, expiring allowance. After this, charges run autonomously within the cap — no signing per cycle. The allowance is a hard on-chain ceiling that expires.",
    inputSchema: {
      amount: z.string().describe("Total allowance cap in USDC (e.g. \"108.00\" for 12 × 9)."),
      expiration_ledger: z.number().int().describe("Ledger sequence the allowance expires at (use a current ledger + buffer)."),
    },
  },
  async (a) => run(() => chain.approve(a.amount, a.expiration_ledger)),
);

// ── slippay_autocharge — PRINCIPAL/RELAYER ONLY: allowance-gated charge (no integrity attestation). ──
if (PRINCIPAL) server.registerTool(
  "slippay_autocharge",
  {
    title: "Trigger an autonomous recurring charge",
    description: "Execute the next charge on a subscription using the standing allowance — no buyer signature. The contract enforces period/max/expiry; the allowance enforces the cap. Submittable by any relayer.",
    inputSchema: { subscription_id: z.string().describe("The 32-byte hex subscription id from slippay_subscribe.") },
  },
  async ({ subscription_id }) => run(() => chain.autocharge(subscription_id)),
);

// ── slippay_charge_attested — the 10x verb: charge ONLY with a proof of integrity. ──
server.registerTool(
  "slippay_charge_attested",
  {
    title: "Charge only if the agent presents a valid integrity attestation",
    description:
      "The differentiated rail: an autonomous charge that settles ONLY when a fresh, single-use integrity " +
      "attestation is presented — an ed25519 signature, from the attester bound via slippay_arm_gate, over " +
      "(subscription_id, charges_done, not_after), verified on-chain. Missing/expired/forged/replayed → the " +
      "contract refuses (fail-closed). This is the question no other rail asks: not 'is the payment authorized?' " +
      "but 'is the agent requesting it uncompromised?'. The attestation comes from your integrity attester/oracle.",
    inputSchema: {
      subscription_id: z.string().describe("32-byte hex subscription id."),
      not_after: z.number().int().describe("Unix time the attestation expires (must be ≥ now)."),
      signature: z.string().describe("128-hex (64-byte) ed25519 signature from the bound attester over id‖charges_done‖not_after."),
    },
  },
  async (a) => run(() => chain.autochargeAttested(a.subscription_id, a.not_after, a.signature)),
);

// ── slippay_arm_gate — PRINCIPAL ONLY: bind an integrity attester (agent must NOT self-attest). ──
if (PRINCIPAL) server.registerTool(
  "slippay_arm_gate",
  {
    title: "Arm the integrity gate on a subscription",
    description: "Bind an ed25519 attester public key to the subscription. Once armed, slippay_charge_attested is the path that settles, and only with that attester's fresh signature. Set by the subscription's merchant.",
    inputSchema: {
      subscription_id: z.string().describe("32-byte hex subscription id."),
      attester_pubkey: z.string().describe("64-hex (32-byte) ed25519 public key of the integrity attester."),
    },
  },
  async (a) => run(() => chain.armGate(a.subscription_id, a.attester_pubkey)),
);

// ── slippay_status — read a payment's settlement from the chain (no backend). ──
server.registerTool(
  "slippay_status",
  {
    title: "Check a payment's on-chain settlement",
    description: "Look up a transaction hash on Horizon and return whether it settled, the ledger, and the explorer link. Reads the chain directly — no SlipPay backend.",
    inputSchema: { hash: z.string().describe("Stellar transaction hash.") },
  },
  async ({ hash }) => run(() => chain.txStatus(hash)),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`slippay-mcp 0.2.0 ready · role=${PRINCIPAL ? "principal" : "agent (membrane)"} · net=${chain.IS_PUBLIC ? "public" : "testnet"} · signer=${process.env.SLIPPAY_SIGNER_SECRET ? "set" : "unset"} · contract=${process.env.SLIPPAY_CONTRACT ? "set" : "unset"}\n`);
}
main().catch((e) => { process.stderr.write(`slippay-mcp fatal: ${(e as Error).stack ?? e}\n`); process.exit(1); });
