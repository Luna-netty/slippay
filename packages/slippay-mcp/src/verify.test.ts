import { describe, it, expect } from "vitest";
import { reverifyCert, specSha256Hex, emitInductive, emitBase } from "./verify.ts";

// The genuine m2 example: AgentWallet, sliding_window(ceiling=2) bound 2.
const SPEC =
  "agent AgentWallet {\n  bind      -> [read_balance, propose_payment]\n  invariant -> sliding_window(ceiling = 2) bound 2\n}\n";
const SPEC_SHA = "0415df303eb4abf45bc224df6b2d147d1a53933130fccd9889054aff8e35e3be";
const CERT = JSON.stringify({
  kind: "axl-proof-certificate",
  axl_version: "0.1.0",
  spec_sha256: SPEC_SHA,
  agent: "AgentWallet",
  invariant: { family: "sliding_window", ceiling: 2, bound: 2 },
  verdict: "ISSUED",
  tight: true,
  onchain: { ssl_hash: SPEC_SHA, window_cap_multiplier: 2 },
});

describe("specSha256Hex", () => {
  it("hashes the m2 spec to the digest baked into the certificate", () => {
    expect(specSha256Hex(SPEC)).toBe(SPEC_SHA);
  });
});

describe("reverifyCert", () => {
  it("verifies the genuine m2 certificate", () => {
    const r = reverifyCert(CERT, SPEC);
    expect(r.verified).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("regenerates four obligations: base, inductive, attainable, minimal-predecessor", () => {
    const r = reverifyCert(CERT, SPEC);
    expect(r.obligations.map((o) => o.expect)).toEqual(["unsat", "unsat", "sat", "sat"]);
  });

  it("goes RED when the spec is tampered (binding breaks)", () => {
    const r = reverifyCert(CERT, SPEC + "\n");
    expect(r.verified).toBe(false);
    const binding = r.checks.find((c) => c.label.includes("binding"));
    expect(binding?.ok).toBe(false);
  });

  it("goes RED when the certificate's claimed bound is forged", () => {
    const obj = JSON.parse(CERT);
    obj.invariant.bound = 1; // but onchain.window_cap_multiplier stays 2
    const r = reverifyCert(JSON.stringify(obj), SPEC);
    expect(r.verified).toBe(false); // onchain multiplier (2) no longer == bound (1)
  });

  it("rejects non-JSON gracefully", () => {
    const r = reverifyCert("not json", SPEC);
    expect(r.verified).toBe(false);
  });
});

describe("SMT obligation shape", () => {
  it("inductive step asserts the negated post-invariant and ends in check-sat", () => {
    const smt = emitInductive(2, 2);
    expect(smt).toContain("(assert (not (and");
    expect(smt.trimEnd().endsWith("(check-sat)")).toBe(true);
  });
  it("base case asserts the negated invariant at the origin", () => {
    const smt = emitBase(2);
    expect(smt).toContain("(not (and (>= 0 0)");
  });
});
