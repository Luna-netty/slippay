// SlipPay integrity oracle — chain-agnostic core.
//
// The moat made real: x402 / Stripe / any rail settle on "is this payment
// authorized?". This answers the second question none of them ask — "is the
// AGENT requesting it compromised?" — and encodes the verdict as an ed25519
// signature that:
//   (a) the Soroban gate `autocharge_attested` verifies ON-CHAIN (Stellar), and
//   (b) any other chain / off-chain flow verifies via `verifyAttestation` here.
// Same signed message both ways → one integrity layer, every chain. That is how
// SlipPay earns from Base/EVM agent volume without porting the rail.
//
// v0 detection = TOOL-CALL-SURFACE DEVIATION (falsifiable, on-ledger-checkable):
// an agent commits its allowed recipients / tools / cap up front; a charge that
// stays inside the committed surface is "uncompromised" and gets signed; any
// deviation (new recipient, over cap, off-surface tool) is refused, fail-closed.
// Behavioral anomaly is deliberately out of v0 — too noisy to be a hard gate.

import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

// noble v2 needs sha512 wired for the (sync + async) ed25519 ops.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// ---- helpers ----
const enc = new TextEncoder();
export function hexToBytes(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2) throw new Error("odd hex length");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
const toHex = (b) => Buffer.from(b).toString("hex");
function concat(...arrs) {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

// The EXACT message the Soroban contract signs/verifies:
//   id (32 bytes) ‖ charges_done (u32 big-endian) ‖ not_after (u64 big-endian)
// Keeping byte-for-byte parity is what makes one attestation valid on-chain AND off.
export function attestationMessage(subscriptionIdHex, chargesDone, notAfter) {
  const id = hexToBytes(subscriptionIdHex);
  if (id.length !== 32) throw new Error("subscription_id must be 32 bytes (64 hex)");
  const cd = new Uint8Array(4); new DataView(cd.buffer).setUint32(0, chargesDone >>> 0, false);
  const na = new Uint8Array(8); new DataView(na.buffer).setBigUint64(0, BigInt(notAfter), false);
  return concat(id, cd, na);
}

// ---- surface registry (file-backed; survives restart) ----
const DATA = process.env.SLIPPAY_ATTESTER_DATA || `${process.env.HOME || "."}/.slippay/surfaces.json`;
const surfaces = new Map();
(function load() {
  try { if (existsSync(DATA)) for (const s of JSON.parse(readFileSync(DATA, "utf8"))) surfaces.set(s.agent_id, s); }
  catch (e) { console.error("attester: could not load surfaces:", e?.message ?? e); }
})();
function persist() {
  try { mkdirSync(dirname(DATA), { recursive: true }); writeFileSync(DATA, JSON.stringify([...surfaces.values()], null, 2)); }
  catch (e) { console.error("attester: could not persist surfaces:", e?.message ?? e); }
}

/** Commit an agent's allowed surface. Returns a SHA-256 commitment of it. */
export function commitSurface(s) {
  if (!s.agent_id) throw new Error("agent_id required");
  const surface = {
    agent_id: s.agent_id,
    allowed_recipients: s.allowed_recipients ?? [],
    allowed_tools: s.allowed_tools ?? null,        // null = tools not constrained
    max_amount: BigInt(s.max_amount ?? "0").toString(),
    max_per_window: s.max_per_window ?? 0,         // 0 = no velocity limit
    window_seconds: s.window_seconds ?? 3600,
  };
  surfaces.set(surface.agent_id, surface);
  persist();
  const canon = JSON.stringify({
    r: [...surface.allowed_recipients].sort(),
    t: surface.allowed_tools ? [...surface.allowed_tools].sort() : null,
    m: surface.max_amount,
    v: [surface.max_per_window, surface.window_seconds],
  });
  return toHex(sha256(enc.encode(canon)));
}

export function getSurface(agentId) { return surfaces.get(agentId) ?? null; }

/** Why the action deviates from the committed surface, or null if clean. */
export function surfaceDeviation(action, surface) {
  if (surface.allowed_recipients.length && !surface.allowed_recipients.includes(action.recipient))
    return `recipient ${String(action.recipient).slice(0, 10)}… is outside the committed surface`;
  if (surface.max_amount !== "0" && BigInt(action.amount ?? "0") > BigInt(surface.max_amount))
    return `amount ${action.amount} exceeds the committed cap ${surface.max_amount}`;
  if (surface.allowed_tools && Array.isArray(action.tools_used)) {
    const bad = action.tools_used.find((t) => !surface.allowed_tools.includes(t));
    if (bad) return `tool "${bad}" is outside the committed surface`;
  }
  return null;
}

// ---- detection layer (extensible; v0 = surface + velocity) ----
// Velocity is the first signal BEYOND static surface: a compromised/runaway agent
// betrays itself by rate. Deeper detectors (prompt-injection markers, tool-output
// poisoning, behavioral drift) plug in here — the Bluewave-security moat that a
// payments incumbent cannot cheaply replicate. Each detector returns a reason or null.
const recent = new Map(); // agent_id -> [unix seconds]
function velocityDeviation(action, surface, now) {
  const max = surface.max_per_window ?? 0;
  if (!max) return null;
  const win = surface.window_seconds ?? 3600;
  const hits = (recent.get(action.agent_id) ?? []).filter((t) => now - t < win);
  if (hits.length >= max) return `velocity: ${hits.length} charges in ${win}s exceeds committed ${max} — possible runaway/compromised agent`;
  return null;
}
function noteCharge(agentId, now) {
  const arr = (recent.get(agentId) ?? []).filter((t) => now - t < 86400);
  arr.push(now); recent.set(agentId, arr);
}

/** The full integrity check: surface + every detector. Returns {ok, reason}. */
export function runIntegrityCheck(action, now) {
  const surface = getSurface(action.agent_id);
  if (!surface) return { ok: false, reason: "agent has no committed surface — register it first" };
  const detectors = [surfaceDeviation(action, surface), velocityDeviation(action, surface, now)];
  const reason = detectors.find(Boolean);
  return reason ? { ok: false, reason, compromised: true } : { ok: true };
}

/**
 * The verb. Runs the integrity check; ONLY signs if the agent stays in-surface.
 * Returns { ok:true, not_after, signature } or { ok:false, reason } (fail-closed).
 */
export async function attest(action, attesterPrivKey, opts = {}) {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const chk = runIntegrityCheck(action, now);
  if (!chk.ok) return chk;
  const not_after = now + (opts.ttlSeconds ?? 300);
  const msg = attestationMessage(action.subscription_id, action.charges_done >>> 0, not_after);
  const sig = await ed.signAsync(msg, attesterPrivKey);
  noteCharge(action.agent_id, now);
  return { ok: true, not_after, signature: toHex(sig) };
}

/** Stellar-binding verification (the Soroban gate's message). */
export async function verifyAttestation({ subscription_id, charges_done, not_after, signature, pubkey, now }) {
  const t = now ?? Math.floor(Date.now() / 1000);
  if (t > Number(not_after)) return { valid: false, reason: "expired" };
  const msg = attestationMessage(subscription_id, charges_done >>> 0, Number(not_after));
  const ok = await ed.verifyAsync(hexToBytes(signature), msg, hexToBytes(pubkey));
  return { valid: ok, reason: ok ? null : "bad signature" };
}

// ---- AIA generic binding: rail-agnostic. ANY rail (Base/x402, Solana/pay.sh, …)
// builds the SAME canonical action descriptor, the oracle signs over its hash, and
// the rail verifies the sig. The integrity verdict travels across every chain. ----
export function actionHash(descriptor) {
  const canon = JSON.stringify(descriptor, Object.keys(descriptor).sort()); // canonical (sorted keys)
  return toHex(sha256(enc.encode(canon)));
}
function genericMessage(actionHashHex, notAfter, nonce) {
  const ah = hexToBytes(actionHashHex);
  if (ah.length !== 32) throw new Error("action_hash must be 32 bytes");
  const na = new Uint8Array(8); new DataView(na.buffer).setBigUint64(0, BigInt(notAfter), false);
  const nn = new Uint8Array(8); new DataView(nn.buffer).setBigUint64(0, BigInt(nonce), false);
  return concat(ah, na, nn); // 48 bytes: action_hash ‖ not_after ‖ nonce
}

/** Attest a generic (any-rail) action. `action` carries agent_id + the rail's payment descriptor. */
export async function attestAction(action, attesterPrivKey, opts = {}) {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const chk = runIntegrityCheck(action, now);
  if (!chk.ok) return chk;
  const not_after = now + (opts.ttlSeconds ?? 300);
  const ah = action.action_hash ?? actionHash(action.descriptor ?? action);
  const nonce = opts.nonce ?? Number(BigInt("0x" + Buffer.from(randomBytes(6)).toString("hex")));
  const sig = await ed.signAsync(genericMessage(ah, not_after, nonce), attesterPrivKey);
  noteCharge(action.agent_id, now);
  return { ok: true, action_hash: ah, not_after, nonce, signature: toHex(sig) };
}

/** Rail-agnostic verification — what a Base/Solana/off-chain flow calls. */
export async function verifyAction({ action_hash, not_after, nonce, signature, pubkey, now }) {
  const t = now ?? Math.floor(Date.now() / 1000);
  if (t > Number(not_after)) return { valid: false, reason: "expired" };
  const ok = await ed.verifyAsync(hexToBytes(signature), genericMessage(action_hash, Number(not_after), nonce), hexToBytes(pubkey));
  return { valid: ok, reason: ok ? null : "bad signature" };
}

export async function publicKeyHex(privKey) { return toHex(await ed.getPublicKeyAsync(privKey)); }
export { ed };
