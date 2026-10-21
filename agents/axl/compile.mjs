// Axl compiler — one declarative agent block -> one inference contract.
//
//   agent Settlement {
//     bind      -> [read_balance, propose_settlement]   // action space
//     constrain -> SettlementDecision                   // output schema
//     prove     -> decision.amount <= account.balance   // decidable predicate (CODE)
//     prove     -> decision.recipient in account.allowlist
//   }
//
// The three stages produce MECHANICAL guarantees, not prose:
//   bind      -> compileToolset: the model's tools array; bound-out tools have
//                no schema and cannot be emitted.
//   constrain -> the engine-enforced output schema.
//   prove     -> deterministic predicates over the output+context. Decidable
//                predicates (arithmetic, membership, equality) are COMPILED TO
//                CODE — never delegated to an LLM judge. An LLM "verifying"
//                `amount <= balance` is strictly worse than computing it.
//
// Placement: this compiler runs in the orchestrator that builds the request and
// checks the response — outside the agent's reach. That is the guarantee.

import { compileToolset } from "./bind.mjs";

// ── parse ────────────────────────────────────────────────────────────────────
export function parseAgent(text) {
  const nameM = /agent\s+(\w+)\s*\{/.exec(text);
  if (!nameM) throw new Error(`malformed agent block`);
  const name = nameM[1];
  const body = text.slice(text.indexOf("{") + 1, text.lastIndexOf("}"));

  const bindM = /bind\s*->\s*\[([^\]]*)\]/.exec(body);
  const capabilities = bindM
    ? bindM[1].split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const schemaM = /constrain\s*->\s*(\w+)/.exec(body);
  const schema = schemaM ? schemaM[1] : null;

  const predicates = [];
  for (const line of body.split("\n")) {
    const pm = /prove\s*->\s*(.+)/.exec(line);
    if (pm) predicates.push(pm[1].trim().replace(/\}\s*$/, "").trim());
  }
  return { name, capabilities, schema, predicates };
}

// ── prove: decidable predicate -> deterministic code ─────────────────────────
const OPS = {
  "<=": (a, b) => a <= b,
  ">=": (a, b) => a >= b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  "<": (a, b) => a < b,
  ">": (a, b) => a > b,
  "in": (a, b) => Array.isArray(b) && b.includes(a),
};

function resolveOperand(token, ctx) {
  const t = token.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^["'].*["']$/.test(t)) return t.slice(1, -1);
  return t.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx);
}

export function compilePredicate(src) {
  const m = /^(.+?)\s+(<=|>=|==|!=|<|>|in)\s+(.+)$/.exec(src.trim());
  if (!m) throw new Error(`malformed predicate: ${src}`);
  const [, lhs, op, rhs] = m;
  const apply = OPS[op];
  return {
    source: src.trim(),
    eval: (ctx) => apply(resolveOperand(lhs, ctx), resolveOperand(rhs, ctx)),
  };
}

// ── compile + enforce ────────────────────────────────────────────────────────
export function compileAgent(spec, registries) {
  const { tools = {}, schemas = {} } = registries;
  const compiledTools = compileToolset(spec.capabilities, tools); // throws on unknown capability
  let outputSchema = null;
  if (spec.schema) {
    outputSchema = schemas[spec.schema];
    if (!outputSchema) throw new Error(`unknown schema: ${spec.schema}`);
  }
  return {
    agent: spec.name,
    tools: compiledTools,
    outputSchema,
    predicates: spec.predicates.map(compilePredicate),
  };
}

// Emit the real Anthropic request fragment from a compiled contract. `bind`
// becomes strict tool definitions; `constrain` becomes output_config.format
// (json_schema = constrained decoding, grammar-level — the model cannot emit
// tokens off the schema). Fail-closed: a constrain schema must declare
// additionalProperties:false, or the "guarantee" is not actually strict.
// Ref: platform.claude.com/docs/en/build-with-claude/structured-outputs
export function toRequestConfig(contract) {
  const tools = contract.tools.map((t) => ({ ...t, strict: true }));
  const req = { tools };
  if (contract.outputSchema) {
    if (contract.outputSchema.additionalProperties !== false) {
      throw new Error("strict schema requires additionalProperties: false");
    }
    req.output_config = { format: { type: "json_schema", schema: contract.outputSchema } };
  }
  return req;
}

// Runtime `prove` stage: run every predicate against a candidate output+context.
// Returns the predicates it violated (empty = conformant). An output that fails
// is rejected — settlement of an unverified decision does not happen.
export function enforce(contract, ctx) {
  const violations = contract.predicates.filter((p) => !p.eval(ctx)).map((p) => p.source);
  return { ok: violations.length === 0, violations };
}
