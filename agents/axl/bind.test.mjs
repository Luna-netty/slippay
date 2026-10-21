// Axl `bind` primitive — capability filtering at the tool-list level.
//
// The guarantee under test is MECHANICAL, not advisory: an agent bound to a
// capability set receives, as its `tools=[...]` array for the model call, ONLY
// the tool schemas for those capabilities. A capability it is not bound to has
// NO schema in the action space — so the model cannot emit a valid tool_use for
// it, regardless of any prompt injection. This is the difference between
// "the policy says don't" (advisory) and "the action does not exist" (mechanical).
//
// Run: node --test agents/axl/bind.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { parseBind, compileToolset } from "./bind.mjs";

// A registry of every tool the platform can expose (Anthropic tool-def shape).
const REGISTRY = {
  read_balance:    { name: "read_balance",    description: "read an account balance", input_schema: { type: "object" } },
  propose_payment: { name: "propose_payment", description: "propose a payment for approval", input_schema: { type: "object" } },
  transfer_funds:  { name: "transfer_funds",  description: "MOVE money irreversibly", input_schema: { type: "object" } },
  rotate_recipient:{ name: "rotate_recipient",description: "change a payout address", input_schema: { type: "object" } },
};

test("parses an Axl bind declaration into a capability set", () => {
  const caps = parseBind("bind Settlement -> [read_balance, propose_payment]");
  assert.deepEqual(caps, { agent: "Settlement", capabilities: ["read_balance", "propose_payment"] });
});

test("emitted toolset contains exactly the bound capabilities", () => {
  const tools = compileToolset(["read_balance", "propose_payment"], REGISTRY);
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["propose_payment", "read_balance"]);
});

test("a capability NOT bound is mechanically absent from the action space", () => {
  const tools = compileToolset(["read_balance", "propose_payment"], REGISTRY);
  const names = tools.map((t) => t.name);
  // transfer_funds exists in the registry but Settlement is not bound to it.
  assert.ok(!names.includes("transfer_funds"), "transfer_funds must not be in the model's tool array");
  assert.ok(!names.includes("rotate_recipient"), "rotate_recipient must not be in the model's tool array");
});

test("binding an unknown capability fails closed (config error, not silent drop)", () => {
  assert.throws(
    () => compileToolset(["read_balance", "wire_to_cayman"], REGISTRY),
    /unknown capability: wire_to_cayman/,
  );
});

test("an empty binding yields an empty toolset — zero action space, safe default", () => {
  const tools = compileToolset([], REGISTRY);
  assert.equal(tools.length, 0);
});

test("end-to-end: a Settlement agent bound away from transfer_funds cannot be given it by injection", () => {
  // Whatever a compromised upstream tries, the toolset is compiled from the
  // binding + registry only — never from agent-controlled input.
  const { capabilities } = parseBind("bind Settlement -> [read_balance, propose_payment]");
  const tools = compileToolset(capabilities, REGISTRY);
  // The model literally has no transfer_funds schema to call.
  assert.equal(tools.find((t) => t.name === "transfer_funds"), undefined);
});
