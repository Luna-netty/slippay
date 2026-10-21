// AntiAbuseAgent — enforcement core ("the teeth"). The panopticon.
//
// Observes cross-agent activity and can HALT any agent. Two deterministic gates
// for money events (velocity, conservation) and a non-interference gate for
// inter-agent messages (no high-label data to a lower sink — kills covert
// collusion / stego escalation). HALT is mechanical: a halted agent is
// recompiled to the EMPTY toolset (Axl bind), losing its entire action space —
// it is disarmed, not asked to stand down.
//
// AntiAbuse is the most dangerous agent (root over the others), so it itself
// holds NO money capability. Treat it like root: hard ACL, immutable audit,
// external kill-switch (see antiabuse.ssl).
//
// Note on scope: the inter-agent label check here is the money-path-local guard.
// The canonical, full non-interference checker (lattice + least-fixpoint over the
// declared flow graph) is agents/ifc/ (Python, 16/16). In production AntiAbuse
// delegates whole-graph checks to it; this module keeps the per-event gate.

import { compileToolset } from "../axl/bind.mjs";

// Confidentiality/integrity lattice (PUBLIC = bottom). High data must not reach a
// sink whose clearance is lower.
const LABEL = { PUBLIC: 0, LOW: 1, HIGH: 2 };

export function evaluate(event, state) {
  if (event.kind === "message") {
    const src = LABEL[event.srcLabel] ?? 0;
    const clearance = LABEL[event.sinkClearance] ?? 0;
    if (src > clearance) return { action: "HALT", reason: "noninterference" };
    return { action: "ALLOW", reason: "ok" };
  }
  // money event: velocity then conservation.
  const win = state.windowEvents || [];
  if (win.length >= state.maxVelocity) return { action: "HALT", reason: "velocity" };
  const outflow = win.reduce((s, e) => s + (e.amount || 0), 0) + (event.amount || 0);
  if (outflow > state.inflow + state.buffer) return { action: "HALT", reason: "conservation" };
  return { action: "ALLOW", reason: "ok" };
}

// HALT enforcement. Returns the disarmed agent's toolset: empty. The model behind
// a halted agent receives zero tool schemas, so it has no action to take —
// enforcement is the absence of capability, not a request to stop.
export function disarm(registry) {
  return compileToolset([], registry);
}
