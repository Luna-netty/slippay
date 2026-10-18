// AIA-over-x402 smoke test. Proves: an in-surface x402 payment gets a signed
// integrity verdict that verifies against the SAME requirements; tampering the
// requirements breaks verification (binding); an out-of-surface payTo or an
// over-cap amount is REFUSED (fail-closed) — exactly what a facilitator needs
// before honoring a 402.
//
// Run isolated:  SLIPPAY_ATTESTER_DATA=/tmp/x402-surfaces.json node src/x402.test.mjs
import { sha256 } from "@noble/hashes/sha256";
import { commitSurface, publicKeyHex } from "./oracle.mjs";
import { attestX402, verifyX402, x402ActionHash } from "./x402.mjs";

const priv = sha256(new TextEncoder().encode("slippay-x402-test-seed")); // 32 bytes
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };

const PAYTO = "GCYEAQWXDR3MXHU364KIFOLSL2FIZL5RYXEKO3QVQ3WTQCWY64BXBRNR"; // allowed merchant
const OTHER = "GAFK7XFZEVILVERSOMEOTHERADDRESSNOTALLOWEDXXXXXXXXXXXXXXXX"; // not allowed
const USDC = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA"; // USDC SAC (mainnet)

const reqs = (over) => ({
  scheme: "exact",
  network: "stellar",
  asset: USDC,
  payTo: PAYTO,
  maxAmountRequired: over ? "5000000" : "500000", // cap is 1_000_000
  resource: "https://api.example.com/v1/inference",
});

const main = async () => {
  const pub = await publicKeyHex(priv);
  console.log("attester pubkey:", pub, "\n");

  commitSurface({
    agent_id: "x402-agent",
    allowed_recipients: [PAYTO],
    allowed_tools: ["pay"],
    max_amount: "1000000", // 1.0 token cap
  });

  // deterministic action_hash from the binding subset (order-independent input)
  const h1 = x402ActionHash(reqs(false));
  const h2 = x402ActionHash({ payTo: PAYTO, maxAmountRequired: "500000", asset: USDC, network: "stellar", resource: "https://api.example.com/v1/inference", scheme: "exact" });
  ok(h1 === h2 && h1.length === 64, "x402 action_hash is canonical (key-order independent, 32 bytes)");

  // CLEAN: in-surface x402 payment → signed verdict
  const clean = await attestX402({ agent_id: "x402-agent", requirements: reqs(false), tools_used: ["pay"] }, priv);
  ok(clean.ok && clean.signature?.length === 128 && clean.action_hash === h1,
     "in-surface x402 payment → signed AIA verdict bound to the x402 action_hash");

  // facilitator verifies against the SAME requirements
  const v = await verifyX402({ requirements: reqs(false), not_after: clean.not_after, nonce: clean.nonce, signature: clean.signature, pubkey: pub });
  ok(v.valid, "facilitator verifies the verdict against the original PaymentRequirements");

  // BINDING: tamper the requirements (different payTo) → verification fails
  const tampered = await verifyX402({ requirements: { ...reqs(false), payTo: OTHER }, not_after: clean.not_after, nonce: clean.nonce, signature: clean.signature, pubkey: pub });
  ok(!tampered.valid, "tampered payTo → verification FAILS (verdict is bound to the payment)");

  // OUT-OF-SURFACE recipient → refused, no signature
  const badPayTo = await attestX402({ agent_id: "x402-agent", requirements: { ...reqs(false), payTo: OTHER }, tools_used: ["pay"] }, priv);
  ok(!badPayTo.ok && /outside the committed surface/.test(badPayTo.reason ?? ""),
     "x402 payment to an uncommitted recipient → REFUSED (fail-closed)");

  // OVER-CAP amount → refused
  const overCap = await attestX402({ agent_id: "x402-agent", requirements: reqs(true), tools_used: ["pay"] }, priv);
  ok(!overCap.ok && /exceeds the committed cap/.test(overCap.reason ?? ""),
     "x402 payment over the committed cap → REFUSED (fail-closed)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
main();
