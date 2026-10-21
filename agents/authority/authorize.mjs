// AuthorityAgent — enforcement core ("the teeth").
//
// This module is the security boundary that holds EVEN IF the agent invoking it
// is fully compromised (successful indirect prompt injection, jailbreak, tool
// poisoning). It decides authorization from facts outside the agent's control:
//
//   1. cryptographic authenticity — the intent is signed by the merchant's
//      registered key (a DID/key check, NOT a string-match on a "from" field).
//   2. consent binding — the charge terms hash to the buyer's ORIGINAL consent
//      digest, captured at mandate creation. A later renewal that drifts the
//      amount/recipient/token is rejected even when validly signed by the
//      merchant (the "slow-drift" attack: definition mutates between cycles).
//   3. anti-replay — a nonce may authorize at most once.
//
// Data/control separation: this function accepts only TYPED scalar fields. Any
// free-text merchant metadata (notes, descriptions) is structurally excluded
// from the signed payload and from every decision branch — it cannot become an
// instruction. That is the design-level defense against IPI via merchant
// metadata (cf. Whispers of Wealth, arXiv:2601.22569), not a token blocklist.

import { createHash } from "node:crypto";
import pkg from "../../apps/web/node_modules/@stellar/stellar-sdk/lib/index.js";
const { Keypair } = pkg;

const sha256hex = (s) => createHash("sha256").update(s).digest("hex");

// Canonical, fixed-order serialization of the buyer-consented terms. Anything
// the buyer agreed to lives here; anything that drifts away from it is denied.
function consentString(t) {
  return [
    t.amount,
    t.token,
    t.recipient,
    String(t.periodSeconds),
    String(t.maxPeriods),
    t.buyer,
    t.merchantKey,
  ].join("|");
}

// Digest stored on the mandate at consent time. Recomputed from each intent to
// detect drift. Tamper-evident: any changed term changes the digest.
export function consentDigest(mandate) {
  return sha256hex(consentString(mandate));
}

// Canonical signed payload for an intent. Note: NO free-text fields. The
// merchant signs exactly these scalars, so smuggled prose is never authenticated
// and never reaches a control path.
function intentMessage(intent) {
  return [
    intent.mandateId,
    intent.amount,
    intent.recipient,
    intent.token,
    String(intent.periodIndex),
    intent.nonce,
  ].join("|");
}

// Merchant-side helper: sign an intent with the merchant keypair.
export function signIntent(keypair, intent) {
  return keypair.sign(Buffer.from(intentMessage(intent), "utf8")).toString("base64");
}

// The gate. Returns { ok, reason }. Order is deliberate: authenticity first
// (who), then consent scope (what), then replay (when).
export function authorizeIntent(intent, mandate, seenNonces) {
  // 1. authenticity — signed by the merchant's registered key.
  let authentic = false;
  try {
    const kp = Keypair.fromPublicKey(mandate.merchantKey);
    authentic = kp.verify(
      Buffer.from(intentMessage(intent), "utf8"),
      Buffer.from(intent.signature ?? "", "base64"),
    );
  } catch {
    authentic = false;
  }
  if (!authentic) return { ok: false, reason: "bad_signature" };

  // 2. consent binding — terms must hash to the buyer's original consent.
  const fromIntent = consentDigest({
    amount: intent.amount,
    token: intent.token,
    recipient: intent.recipient,
    periodSeconds: mandate.periodSeconds,
    maxPeriods: mandate.maxPeriods,
    buyer: mandate.buyer,
    merchantKey: mandate.merchantKey,
  });
  if (fromIntent !== mandate.consentDigest) return { ok: false, reason: "term_drift" };

  // 3. anti-replay — nonce used at most once.
  if (seenNonces.has(intent.nonce)) return { ok: false, reason: "replay" };

  return { ok: true, reason: "ok" };
}
