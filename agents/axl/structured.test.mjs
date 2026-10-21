// Axl compiler -> real Anthropic request config. Closes the `constrain` gap:
// the compiled contract emits `output_config.format` (json_schema, constrained
// decoding) + strict tool definitions — the actual API fields, not a resolved
// schema object. On the Anthropic API this is grammar-level constrained
// decoding: the model cannot emit tokens off the schema.
//
// Ref: platform.claude.com/docs/en/build-with-claude/structured-outputs
// Run: node --test agents/axl/structured.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { parseAgent, compileAgent, toRequestConfig } from "./compile.mjs";

const TOOLS = {
  read_balance:       { name: "read_balance", description: "", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  propose_settlement: { name: "propose_settlement", description: "", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  transfer_funds:     { name: "transfer_funds", description: "", input_schema: { type: "object", properties: {}, additionalProperties: false } },
};
const STRICT_SCHEMA = {
  type: "object",
  properties: { amount: { type: "number" }, recipient: { type: "string" } },
  required: ["amount", "recipient"],
  additionalProperties: false,
};
const SCHEMAS = { SettlementDecision: STRICT_SCHEMA };

const SRC = `agent Settlement {
  bind -> [read_balance, propose_settlement]
  constrain -> SettlementDecision
}`;

test("emits output_config.format with json_schema constrained decoding", () => {
  const c = compileAgent(parseAgent(SRC), { tools: TOOLS, schemas: SCHEMAS });
  const req = toRequestConfig(c);
  assert.equal(req.output_config.format.type, "json_schema");
  assert.equal(req.output_config.format.schema, STRICT_SCHEMA);
});

test("emits strict tool definitions and keeps the bound-out tool absent", () => {
  const c = compileAgent(parseAgent(SRC), { tools: TOOLS, schemas: SCHEMAS });
  const req = toRequestConfig(c);
  assert.ok(req.tools.every((t) => t.strict === true), "every tool must be strict");
  assert.equal(req.tools.find((t) => t.name === "transfer_funds"), undefined);
});

test("a constrain schema without additionalProperties:false fails closed", () => {
  const loose = { type: "object", properties: { x: { type: "string" } } }; // no additionalProperties:false
  const c = compileAgent(parseAgent(SRC), { tools: TOOLS, schemas: { SettlementDecision: loose } });
  assert.throws(() => toRequestConfig(c), /strict schema requires additionalProperties:\s*false/);
});

test("no constrain block => no output_config (tools still strict)", () => {
  const c = compileAgent(parseAgent(`agent S { bind -> [read_balance] }`), { tools: TOOLS, schemas: SCHEMAS });
  const req = toRequestConfig(c);
  assert.equal(req.output_config, undefined);
  assert.ok(req.tools.every((t) => t.strict === true));
});
