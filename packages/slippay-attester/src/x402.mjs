// AIA over x402 (Stellar) — the integrity layer for the rail the network ships.
//
// x402 is now first-party on Stellar (per-request HTTP payment via a signed Soroban
// auth-entry, SEP-41/USDC, Coinbase + OpenZeppelin facilitators on testnet+mainnet).
// It settles ONE question: "is this payment authorized?" AIA adds the second none of
// the facilitators ask — "is the AGENT requesting it compromised?" — as a portable
// ed25519 verdict bound to the SAME x402 payment intent. A facilitator requires a
// fresh AIA signature before honoring the 402; no integrity sig, no settlement.
//
// We do NOT reimplement x402. We sit above it: the agent commits a surface, the
// oracle attests an x402 payment only while the agent stays inside it, and the
// verdict rides the existing AIA generic binding (action_hash ‖ not_after ‖ nonce).

import { actionHash, attestAction, verifyAction } from "./oracle.mjs";

// The economically-binding subset of an x402 v2 PaymentRequirements — the fields
// that define WHERE money goes and HOW MUCH. The integrity verdict is bound to
// exactly this: tamper any of them and the recomputed action_hash no longer matches.
export function x402Descriptor(req) {
  if (!req || !req.payTo || req.maxAmountRequired == null)
    throw new Error("x402 requirements need at least { payTo, maxAmountRequired, asset, network }");
  return {
    asset: String(req.asset ?? ""),                  // SEP-41 token contract (USDC default)
    maxAmountRequired: String(req.maxAmountRequired), // stroops / token base units
    network: String(req.network ?? "stellar"),        // "stellar" | "stellar-testnet"
    payTo: String(req.payTo),                          // settlement recipient (G… or C…)
    resource: String(req.resource ?? ""),              // the paid endpoint/URL
    scheme: String(req.scheme ?? "exact"),             // x402 scheme
  };
}

/** The action_hash an x402 facilitator recomputes from its own PaymentRequirements. */
export function x402ActionHash(req) { return actionHash(x402Descriptor(req)); }

/**
 * Attest an agent's x402 payment. Maps the x402 intent onto the integrity surface
 * (payTo → recipient, maxAmountRequired → amount) so surface + velocity detection
 * runs, then signs the AIA generic binding over the x402 action_hash. Fail-closed:
 * returns { ok:false, reason } if the agent has drifted outside its committed surface.
 */
export async function attestX402({ agent_id, requirements, tools_used }, attesterPrivKey, opts = {}) {
  const descriptor = x402Descriptor(requirements);
  return attestAction(
    { agent_id, descriptor, recipient: descriptor.payTo, amount: descriptor.maxAmountRequired, tools_used },
    attesterPrivKey,
    opts,
  );
}

/**
 * What an x402 facilitator runs before honoring the 402: recompute the action_hash
 * from the PaymentRequirements it already holds, then verify the AIA signature.
 * Binding holds — a verdict signed for one payTo/amount can't authorize another.
 */
export async function verifyX402({ requirements, not_after, nonce, signature, pubkey, now }) {
  return verifyAction({ action_hash: x402ActionHash(requirements), not_after, nonce, signature, pubkey, now });
}
