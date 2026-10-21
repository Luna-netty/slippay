// Smoke test for the integrity oracle. Proves: clean action → signed attestation
// that verifies; every surface deviation → refused (fail-closed); message is the
// exact 44-byte shape the Soroban gate consumes (cross-chain parity).
import { sha256 } from "@noble/hashes/sha256";
import {
  commitSurface, attest, verifyAttestation, attestationMessage, publicKeyHex,
  attestAction, verifyAction,
} from "./oracle.mjs";

const priv = sha256(new TextEncoder().encode("slippay-attester-demo-seed")); // 32 bytes
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };

const A = "GCYEAQWXDR3MXHU364KIFOLSL2FIZL5RYXEKO3QVQ3WTQCWY64BXBRNR"; // allowed merchant
const B = "GAFK7XFZEVILVERSOMEOTHERADDRESSNOTALLOWEDXXXXXXXXXXXXXXXX"; // not allowed
const SUB = "b2".repeat(32); // 32-byte hex subscription id

const main = async () => {
  const pub = await publicKeyHex(priv);
  console.log("attester pubkey:", pub, "\n");

  const commitment = commitSurface({
    agent_id: "agent-7",
    allowed_recipients: [A],
    allowed_tools: ["charge", "quote"],
    max_amount: "1000000", // 0.1 token cap
  });
  ok(commitment.length === 64, "surface committed (sha-256 commitment returned)");

  // message parity with the contract
  ok(attestationMessage(SUB, 0, 9999999999).length === 44,
     "attestation message is 44 bytes (id‖charges_done‖not_after) — Soroban parity");

  // CLEAN: in-surface charge → signed
  const clean = await attest(
    { agent_id: "agent-7", subscription_id: SUB, charges_done: 0, recipient: A, amount: "500000", tools_used: ["charge"] },
    priv,
  );
  ok(clean.ok && clean.signature && clean.signature.length === 128, "CLEAN action → signed attestation (64-byte sig)");

  const v = await verifyAttestation({ subscription_id: SUB, charges_done: 0, not_after: clean.not_after, signature: clean.signature, pubkey: pub });
  ok(v.valid === true, "clean attestation verifies off-chain (chain-agnostic) ✓");

  // DEVIATIONS → refused, fail-closed
  const devR = await attest({ agent_id: "agent-7", subscription_id: SUB, charges_done: 0, recipient: B, amount: "500000", tools_used: ["charge"] }, priv);
  ok(!devR.ok && devR.compromised, `recipient deviation REFUSED — ${devR.reason}`);

  const devAmt = await attest({ agent_id: "agent-7", subscription_id: SUB, charges_done: 0, recipient: A, amount: "5000000", tools_used: ["charge"] }, priv);
  ok(!devAmt.ok, `over-cap REFUSED — ${devAmt.reason}`);

  const devTool = await attest({ agent_id: "agent-7", subscription_id: SUB, charges_done: 0, recipient: A, amount: "500000", tools_used: ["exfiltrate"] }, priv);
  ok(!devTool.ok, `off-surface tool REFUSED — ${devTool.reason}`);

  const devNoReg = await attest({ agent_id: "unknown", subscription_id: SUB, charges_done: 0, recipient: A, amount: "1" }, priv);
  ok(!devNoReg.ok, `unregistered agent REFUSED — ${devNoReg.reason}`);

  // tampered / expired → invalid
  const tampered = await verifyAttestation({ subscription_id: SUB, charges_done: 1, not_after: clean.not_after, signature: clean.signature, pubkey: pub });
  ok(tampered.valid === false, "replay on a different charge_index → invalid (single-use binding)");
  const expired = await verifyAttestation({ subscription_id: SUB, charges_done: 0, not_after: 1, signature: clean.signature, pubkey: pub });
  ok(expired.valid === false, "expired attestation → invalid");

  // --- AIA generic binding (rail-agnostic: Base/x402, Solana/pay.sh, anywhere) ---
  commitSurface({ agent_id: "agent-x", allowed_recipients: ["0xBaseRecipient"], max_amount: "1000000" });
  const ga = await attestAction({ agent_id: "agent-x", recipient: "0xBaseRecipient", amount: "500000",
    descriptor: { rail: "base-x402", recipient: "0xBaseRecipient", amount: "500000", resource: "GET /v1/search" } }, priv);
  ok(ga.ok && ga.signature && ga.action_hash && ga.nonce !== undefined, "GENERIC attest (any-rail) → signed: action_hash + nonce + sig");
  const gv = await verifyAction({ action_hash: ga.action_hash, not_after: ga.not_after, nonce: ga.nonce, signature: ga.signature, pubkey: pub });
  ok(gv.valid === true, "generic attestation verifies off-chain — Base/Solana/anywhere ✓ (rail-agnostic standard)");
  const gt = await verifyAction({ action_hash: "00".repeat(32), not_after: ga.not_after, nonce: ga.nonce, signature: ga.signature, pubkey: pub });
  ok(gt.valid === false, "tampered action_hash → invalid");
  const grefuse = await attestAction({ agent_id: "agent-x", recipient: "0xEVIL", amount: "500000" }, priv);
  ok(!grefuse.ok, `generic out-of-surface REFUSED — ${grefuse.reason}`);

  // --- velocity: detection BEYOND static surface (the Bluewave-depth direction) ---
  commitSurface({ agent_id: "speedy", allowed_recipients: [A], max_amount: "9", max_per_window: 2, window_seconds: 3600 });
  const s1 = await attest({ agent_id: "speedy", subscription_id: SUB, charges_done: 0, recipient: A, amount: "1" }, priv);
  const s2 = await attest({ agent_id: "speedy", subscription_id: SUB, charges_done: 1, recipient: A, amount: "1" }, priv);
  const s3 = await attest({ agent_id: "speedy", subscription_id: SUB, charges_done: 2, recipient: A, amount: "1" }, priv);
  ok(s1.ok && s2.ok && !s3.ok, `velocity: 3rd charge in window REFUSED — ${s3.reason}`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
};
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
