// Agent Connect — client logic for granting an AI agent a bounded, revocable
// on-chain spending session on the user's smart wallet.
//
// Maps to contracts/smart-wallet/src/lib.rs:468
//   install_agent_session(session_pubkey: BytesN<32>, token, per_tx_cap,
//     window_seconds, window_cap, expires_at, allow_recipients, ssl_hash)
//
// Custody model (per AGENT_CONNECT_SPEC.md): (A) the agent holds its own ed25519
// session key — safe because the contract bounds the blast radius. The human
// never holds the session key; the agent never sees the passkey.
//
// On-chain submit: install_agent_session requires ADMIN auth. In the v0.1 spike
// the admin is a server-held G-account (see contracts/smart-wallet/DEPLOYED.md +
// scripts/policy-checkout-spike-server.mjs). So `installAgentSession` POSTs the
// params to a backend endpoint that admin-signs and submits. v0.2 migrates admin
// to the passkey so the human signs the install directly with Face ID.

import { Keypair } from "@stellar/stellar-sdk";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "https://api.slippay.cc/api";

export interface AgentSessionKey {
  /** ed25519 public key, hex (32 bytes) — goes on-chain as session_pubkey. */
  pubkeyHex: string;
  /** Stellar G-address form of the same ed25519 key (display/transport). */
  address: string;
  /** ed25519 secret (S...). The AGENT holds this; never the human. */
  secret: string;
}

/** Generate a fresh ed25519 session key for an agent. The agent keeps `secret`
 *  (ideally in a KMS); only `pubkeyHex` is installed on-chain. */
export function generateSessionKey(): AgentSessionKey {
  const kp = Keypair.random();
  return {
    pubkeyHex: Buffer.from(kp.rawPublicKey()).toString("hex"),
    address: kp.publicKey(),
    secret: kp.secret(),
  };
}

/** Accept an agent's public key provided out-of-band (paste/scan). Accepts a
 *  G-address or a 32-byte hex pubkey; returns canonical hex. */
export function normalizeSessionPubkey(input: string): string {
  const s = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
  if (s.startsWith("G")) return Buffer.from(Keypair.fromPublicKey(s).rawPublicKey()).toString("hex");
  throw new Error("invalid session key (expected G-address or 64-hex)");
}

// ---- handshake (§3 of the spec) ----

export interface ConnectRequest {
  v: 1;
  session_pubkey: string;        // hex or G-address
  requested: {
    token: string;               // "USDC"
    per_tx_cap: string;          // human units, e.g. "5"
    window_seconds: number;      // e.g. 86400
    window_cap: string;          // e.g. "50"
    expires_at: number;          // unix seconds
    allow_recipients: string[];  // [] = any within budget
    policy_uri?: string;         // §4 — declared agent policy
  };
  agent: { name: string; domain?: string };
  callback?: string;             // app posts the grant result here
}

/** Parse a `?req=<b64>` connect request from an agent. The human reviews + can
 *  only TIGHTEN it; the request is a proposal, never an auto-grant. */
export function parseConnectRequest(b64: string): ConnectRequest {
  const json = JSON.parse(decodeURIComponent(escape(atob(b64))));
  if (json?.v !== 1 || !json?.session_pubkey || !json?.requested) {
    throw new Error("malformed connect request");
  }
  return json as ConnectRequest;
}

export function buildConnectRequest(req: ConnectRequest): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(req))));
}

// ---- §4 policy binding ----

/** Canonical-ish stringify (sorted keys) + sha256 → ssl_hash (32-byte hex).
 *  Binds the session to an exact policy document. Anyone can re-fetch the doc
 *  and verify the hash matches what's stored on-chain. */
export async function computeSslHash(policy: unknown): Promise<string> {
  const canonical = JSON.stringify(sortKeys(policy));
  const buf = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Buffer.from(new Uint8Array(digest)).toString("hex");
}
const ZERO_SSL = "00".repeat(32);
export { ZERO_SSL };

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v as Record<string, unknown>).sort().reduce((a, k) => {
      a[k] = sortKeys((v as Record<string, unknown>)[k]); return a;
    }, {} as Record<string, unknown>);
  }
  return v;
}

// ---- install (on-chain, via admin endpoint — see header) ----

export interface InstallParams {
  walletId: string;            // the user's smart-wallet contract id
  sessionPubkeyHex: string;    // normalized 64-hex
  tokenAddress: string;        // USDC SAC address
  perTxCap: string;            // stroops (i128) — caller converts from human units
  windowSeconds: number;
  windowCap: string;           // stroops
  expiresAt: number;           // unix seconds
  allowRecipients: string[];   // G/C addresses; [] = any within budget
  sslHash: string;             // 64-hex (ZERO_SSL if no policy)
}

export interface InstallResult { txHash: string; walletId: string; expiresAt: number; }

/** Submit install_agent_session. Today this hits the admin-signing endpoint
 *  (v0.1 spike admin pattern). When the contract admin is migrated to the
 *  passkey (v0.2), swap this for a client-side passkey-signed invoke. */
export async function installAgentSession(p: InstallParams): Promise<InstallResult> {
  const res = await fetch(`${API_BASE}/v1/agent-session/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(p),
  });
  const text = await res.text();
  let j: unknown = null; try { j = text ? JSON.parse(text) : null; } catch { j = text; }
  if (!res.ok) {
    const o = (j ?? {}) as Record<string, unknown>;
    throw new Error((o.error as string) || (o.message as string) || `install_failed_${res.status}`);
  }
  return j as InstallResult;
}

/** USDC has 7 decimals on Stellar. Convert human units ("5", "5.50") → stroops. */
export function toStroops(human: string): string {
  const [int, frac = ""] = human.trim().split(".");
  const fracPadded = (frac + "0000000").slice(0, 7);
  return (BigInt(int || "0") * 10_000_000n + BigInt(fracPadded || "0")).toString();
}
