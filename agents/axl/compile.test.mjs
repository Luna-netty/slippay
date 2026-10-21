// Axl compiler — compiles ONE declarative agent block into a complete inference
// contract with three MECHANICAL guarantees:
//
//   bind      -> the exact `tools=[...]` array (action space). A bound-out tool
//                has no schema; the model cannot emit it.
//   constrain -> the output schema the engine enforces on the response.
//   prove     -> DECIDABLE predicates compiled to deterministic code (real
//                arithmetic / set membership), NOT an LLM judge. An output that
//                violates a predicate is rejected mechanically.
//
// This is the unification nobody ships as one syntax: structured output,
// capability scoping and verifier predicates compiled from a single agent block.
//
// Run: node --test agents/axl/compile.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { parseAgent, compileAgent, compilePredicate, enforce } from "./compile.mjs";

const TOOLS = {
  read_balance:       { name: "read_balance", description: "", input_schema: {} },
  propose_settlement: { name: "propose_settlement", description: "", input_schema: {} },
  transfer_funds:     { name: "transfer_funds", description: "", input_schema: {} },
};
const SCHEMAS = {
  SettlementDecision: { type: "object", properties: { amount: { type: "number" }, recipient: { type: "string" } } },
};

const SRC = `agent Settlement {
  bind -> [read_balance, propose_settlement]
  constrain -> SettlementDecision
  prove -> decision.amount <= account.balance
  prove -> decision.recipient in account.allowlist
}`;

test("parses an agent block into bind/constrain/prove parts", () => {
  const spec = parseAgent(SRC);
  assert.equal(spec.name, "Settlement");
  assert.deepEqual(spec.capabilities, ["read_balance", "propose_settlement"]);
  assert.equal(spec.schema, "SettlementDecision");
  assert.deepEqual(spec.predicates, [
    "decision.amount <= account.balance",
    "decision.recipient in account.allowlist",
  ]);
});

test("compiles bind into a toolset with the forbidden tool mechanically absent", () => {
  const c = compileAgent(parseAgent(SRC), { tools: TOOLS, schemas: SCHEMAS });
  const names = c.tools.map((t) => t.name);
  assert.deepEqual(names.sort(), ["propose_settlement", "read_balance"]);
  assert.equal(c.tools.find((t) => t.name === "transfer_funds"), undefined);
});

test("compiles constrain into the resolved output schema", () => {
  const c = compileAgent(parseAgent(SRC), { tools: TOOLS, schemas: SCHEMAS });
  assert.equal(c.outputSchema, SCHEMAS.SettlementDecision);
});

test("prove compiles to REAL code, not an LLM judge — arithmetic is evaluated", () => {
  const within = compilePredicate("decision.amount <= account.balance");
  assert.equal(within.eval({ decision: { amount: 10 }, account: { balance: 50 } }), true);
  assert.equal(within.eval({ decision: { amount: 99 }, account: { balance: 50 } }), false);
});

test("prove supports set membership for allowlist checks", () => {
  const member = compilePredicate("decision.recipient in account.allowlist");
  assert.equal(member.eval({ decision: { recipient: "GA" }, account: { allowlist: ["GA", "GB"] } }), true);
  assert.equal(member.eval({ decision: { recipient: "GEVIL" }, account: { allowlist: ["GA", "GB"] } }), false);
});

test("enforce rejects an output that violates any predicate, naming the violation", () => {
  const c = compileAgent(parseAgent(SRC), { tools: TOOLS, schemas: SCHEMAS });
  const ctx = {
    decision: { amount: 999, recipient: "GEVIL" },
    account: { balance: 50, allowlist: ["GA"] },
  };
  const r = enforce(c, ctx);
  assert.equal(r.ok, false);
  assert.deepEqual(r.violations, [
    "decision.amount <= account.balance",
    "decision.recipient in account.allowlist",
  ]);
});

test("enforce passes a conformant output", () => {
  const c = compileAgent(parseAgent(SRC), { tools: TOOLS, schemas: SCHEMAS });
  const ctx = {
    decision: { amount: 29, recipient: "GA" },
    account: { balance: 50, allowlist: ["GA", "GB"] },
  };
  assert.equal(enforce(c, ctx).ok, true);
});

test("binding an unknown tool fails closed", () => {
  const bad = `agent X { bind -> [read_balance, wire_to_cayman] }`;
  assert.throws(() => compileAgent(parseAgent(bad), { tools: TOOLS, schemas: SCHEMAS }), /unknown capability: wire_to_cayman/);
});

test("constrain referencing an unknown schema fails closed", () => {
  const bad = `agent X { bind -> [read_balance] constrain -> NopeSchema }`;
  assert.throws(() => compileAgent(parseAgent(bad), { tools: TOOLS, schemas: SCHEMAS }), /unknown schema: NopeSchema/);
});
