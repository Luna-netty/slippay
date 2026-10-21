// Re-verification of an axl proof-carrying certificate — the SlipPay MCP's
// hero capability (the one kaimo-style config-guards structurally cannot offer).
// Node port of apps/web/src/lib/axlVerify.ts; the SMT-LIB emitter reproduces
// axl-compiler/src/smt.rs byte-for-byte (verified against `axlc prove --emit-smt`).

import { createHash } from "node:crypto";

export function specSha256Hex(specText: string): string {
  return createHash("sha256").update(specText, "utf8").digest("hex");
}

const PREAMBLE = `(declare-const W_cap Int)
(declare-const per_tx Int)
(declare-const W Int)
(declare-const elapsed Int)
(declare-const a Int)
(declare-const p Int)
(declare-const c Int)
(assert (> W_cap 0))
(assert (> per_tx 0))
(assert (<= per_tx W_cap))
(assert (<= W_cap (* 100 per_tx)))
(assert (>= W 60))
`;

function transitionDefs(m: number): string {
  return `(define-fun p1 () Int (ite (>= elapsed W) (ite (< elapsed (* 2 W)) c 0) p))
(define-fun c1 () Int (ite (>= elapsed W) 0 c))
(define-fun eie () Int (ite (>= elapsed W) 0 elapsed))
(define-fun remaining () Int (- W eie))
(define-fun weighted_prev () Int (div (* p1 remaining) W))
(define-fun c2 () Int (+ c1 a))
(define-fun accept () Bool (and
  (<= (+ weighted_prev c1 a) W_cap)
  (<= (+ p1 c1 a) (* ${m} W_cap))))
`;
}

function invariantExpr(p: string, c: string, k: number): string {
  return `(and (>= ${p} 0) (>= ${c} 0) (<= ${p} W_cap) (<= ${c} W_cap) (<= (+ ${p} ${c}) (* ${k} W_cap)))`;
}

export function emitInductive(m: number, k: number): string {
  return `; inductive step: ceiling M=${m}, claimed bound K=${k}. UNSAT to break => sound.
${PREAMBLE}(assert ${invariantExpr("p", "c", k)})
(assert (>= elapsed 0))
(assert (> a 0))
(assert (<= a per_tx))
${transitionDefs(m)}(assert accept)
(assert (not ${invariantExpr("p1", "c2", k)}))
(check-sat)
`;
}

export function emitBase(k: number): string {
  return `; base case: invariant_K(0,0) must hold. assert its negation; expect unsat.
(declare-const W_cap Int)
(assert (> W_cap 0))
(assert (not ${invariantExpr("0", "0", k)}))
(check-sat)
`;
}

export function emitAttainable(m: number, k: number): string {
  return `; attainability: can an accepted charge reach p1+c2 == K*cap? SAT => tight.
${PREAMBLE}(assert ${invariantExpr("p", "c", k)})
(assert (>= elapsed 0))
(assert (> a 0))
(assert (<= a per_tx))
${transitionDefs(m)}(assert accept)
(assert (= (+ p1 c2) (* ${k} W_cap)))
(check-sat)
`;
}

export interface Check { label: string; ok: boolean; detail: string }
export interface Obligation { name: string; expect: "unsat" | "sat"; smt: string }
export interface ReverifyResult { checks: Check[]; obligations: Obligation[]; verified: boolean }

interface Cert {
  kind?: string;
  spec_sha256?: string;
  invariant?: { family?: string; ceiling?: number | string; bound?: number };
  verdict?: string;
  onchain?: { ssl_hash?: string; window_cap_multiplier?: number } | null;
}

// Re-verify a certificate against the spec it covers. Pure + local: hash binding
// + structural coherence + regeneration of the exact SMT-LIB obligations.
export function reverifyCert(certJson: string, specText: string): ReverifyResult {
  const checks: Check[] = [];
  let cert: Cert;
  try { cert = JSON.parse(certJson); } catch {
    return { checks: [{ label: "certificate parses", ok: false, detail: "invalid JSON" }], obligations: [], verified: false };
  }
  checks.push({ label: "kind", ok: cert.kind === "axl-proof-certificate", detail: cert.kind ?? "(missing)" });

  const h = specSha256Hex(specText);
  const hashOk = !!cert.spec_sha256 && h === cert.spec_sha256;
  checks.push({ label: "spec↔certificate SHA-256 binding", ok: hashOk, detail: hashOk ? `matches ${h.slice(0, 16)}…` : `spec=${h.slice(0, 16)}… cert=${(cert.spec_sha256 ?? "—").slice(0, 16)}…` });

  const bound = cert.invariant?.bound;
  const ceiling = cert.invariant?.ceiling;
  checks.push({ label: "verdict ISSUED", ok: cert.verdict === "ISSUED", detail: cert.verdict ?? "(missing)" });
  if (cert.onchain) {
    checks.push({ label: "onchain.ssl_hash == spec hash", ok: cert.onchain.ssl_hash === cert.spec_sha256, detail: cert.onchain.ssl_hash === cert.spec_sha256 ? "ok" : "mismatch" });
    checks.push({ label: "onchain multiplier == proved bound", ok: cert.onchain.window_cap_multiplier === bound, detail: `K=${bound} mult=${cert.onchain.window_cap_multiplier}` });
  }

  const obligations: Obligation[] = [];
  if (cert.invariant?.family === "sliding_window" && typeof bound === "number" && typeof ceiling === "number") {
    obligations.push({ name: "base case", expect: "unsat", smt: emitBase(bound) });
    obligations.push({ name: "inductive step (sound)", expect: "unsat", smt: emitInductive(ceiling, bound) });
    obligations.push({ name: "attainability (tight)", expect: "sat", smt: emitAttainable(ceiling, bound) });
    if (bound > 1) obligations.push({ name: `predecessor K=${bound - 1} not sound (minimal)`, expect: "sat", smt: emitInductive(ceiling, bound - 1) });
  }

  return { checks, obligations, verified: checks.every((c) => c.ok) };
}
