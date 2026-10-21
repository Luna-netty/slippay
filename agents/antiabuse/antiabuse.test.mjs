// AntiAbuseAgent enforcement — the panopticon. Observes cross-agent activity and
// can HALT any agent. Its teeth: deterministic anomaly gates (velocity,
// conservation) + non-interference on inter-agent messages, and a HALT that
// DISARMS the target mechanically (recompiles it to the empty toolset via Axl
// bind — zero action space, not "asked to stand down"). It holds NO money
// capability itself; being the most dangerous agent, that is the whole point.
//
// Run: node --test agents/antiabuse/antiabuse.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, disarm } from "./antiabuse.mjs";
import { parseBind, compileToolset } from "../axl/bind.mjs";

const state = (over = {}) => ({ windowEvents: [], inflow: 100, buffer: 20, maxVelocity: 5, ...over });

test("allows a normal spend within velocity and conservation", () => {
  const r = evaluate({ kind: "spend", agent: "Billing", amount: 10, ts: 100 }, state());
  assert.equal(r.action, "ALLOW", r.reason);
});

test("HALTs on a conservation breach (outflow exceeds inflow+buffer)", () => {
  const s = state({ windowEvents: [{ ts: 1, amount: 115 }] });
  const r = evaluate({ kind: "spend", agent: "Billing", amount: 10, ts: 100 }, s);
  assert.equal(r.action, "HALT");
  assert.equal(r.reason, "conservation");
});

test("HALTs on a velocity breach (too many actions in window)", () => {
  const s = state({ windowEvents: [1, 2, 3, 4, 5].map((t) => ({ ts: t, amount: 1 })) });
  const r = evaluate({ kind: "spend", agent: "Billing", amount: 1, ts: 6 }, s);
  assert.equal(r.action, "HALT");
  assert.equal(r.reason, "velocity");
});

test("HALTs an inter-agent message that leaks a high label to a low sink (stego/collusion)", () => {
  const r = evaluate({ kind: "message", from: "Settlement", to: "Billing", srcLabel: "HIGH", sinkClearance: "LOW" }, state());
  assert.equal(r.action, "HALT");
  assert.equal(r.reason, "noninterference");
});

test("allows an inter-agent message within clearance", () => {
  const r = evaluate({ kind: "message", from: "Billing", to: "Authority", srcLabel: "LOW", sinkClearance: "HIGH" }, state());
  assert.equal(r.action, "ALLOW", r.reason);
});

test("HALT disarms the target: zero tools, mechanically (Axl bind)", () => {
  const REGISTRY = {
    observe: { name: "observe", description: "", input_schema: {} },
    transfer_funds: { name: "transfer_funds", description: "", input_schema: {} },
  };
  const tools = disarm(REGISTRY);
  assert.equal(tools.length, 0, "a halted agent must have NO action space");
});

test("the panopticon itself holds no money capability", () => {
  const REGISTRY = {
    observe: { name: "observe", description: "", input_schema: {} },
    halt: { name: "halt", description: "", input_schema: {} },
    transfer_funds: { name: "transfer_funds", description: "", input_schema: {} },
  };
  const { capabilities } = parseBind("bind AntiAbuse -> [observe, halt]");
  const tools = compileToolset(capabilities, REGISTRY);
  assert.equal(tools.find((t) => t.name === "transfer_funds"), undefined);
});
