# Slippay agents — four units, mechanically bounded

Money agents, not chatbots. Every one is a **pair**: enforcement code (the teeth,
holds even if the agent's model is fully compromised) + an `.ssl` policy (the
auditable statement). If code and spec disagree, **the code wins**.

| agent | role | teeth | tests |
|---|---|---|---|
| **Billing** | proposes charge intents | `billing/bill.mjs` — eligibility (active, period-elapsed, not expired/maxed); consented amount+recipient only | 7 |
| **Authority** | the gate | `authority/authorize.mjs` — ed25519 signature + consent-digest (anti slow-drift) + replay | 5 |
| **Settlement** | reconciles payments | `settlement/settle.mjs` — memo + **consented-recipient** (closes redirection) + amount + replay | 8 |
| **AntiAbuse** | the panopticon | `antiabuse/antiabuse.mjs` — velocity + conservation + non-interference; **HALT = disarm to empty toolset** | 7 |

`node --test agents/**/**.test.mjs` → 46/46 (incl. the Axl primitives).

## The chain composes

```
Billing.proposeCharge ─intent→ Authority.authorizeIntent ─ok→ Settlement.verifySettlement ─ok→ mark paid
                                         ▲                                                      
                            AntiAbuse observes every edge; HALT disarms any agent
```

The emitted intent shape is shared end-to-end, so the four units snap together
without a shared mutable helper that could become a backdoor.

## Why this is mechanical, not advisory

For a money system an `.ssl` `@assertion` is **not** the security boundary — a
compromised agent will not honor its own assertions. The boundary is what the
agent cannot control:

1. **Axl `bind`** — each agent's `tools=[...]` array contains only its bound
   capabilities. Billing/Authority/Settlement/AntiAbuse all lack `transfer_funds`;
   the model cannot emit a tool that isn't in the request. (`agents/axl/`)
2. **`prove` as code** — Authority/Settlement/Billing decisions are deterministic
   checks (signatures, consent digests, periods), never an LLM judge.
3. **On-chain ceiling** — the audited Soroban wallet (cap + allowlist) bounds any
   authorized spend, and its budget invariant is **machine-checked** (`outflow ≤
   2·window_cap` over all action sequences — `agents/axl/proofs/`).
4. **HALT** — AntiAbuse recompiles a flagged agent to the empty toolset: zero
   action space, not a request to stop.

A fully IPI-compromised agent still cannot move money: it lacks the tool, its
proposal fails the deterministic gate, the on-chain cap bounds it, and AntiAbuse
can disarm it.

## Honest gaps

- The agents are tested in isolation; wiring the chain into the live charge path
  (`supabase/functions/api`) + the listener is the integration step, not done.
- AntiAbuse's per-event label check is money-path-local; the full non-interference
  checker over a declared flow graph is `agents/ifc/` (Python, 16/16) — production
  AntiAbuse delegates whole-graph checks to it (cross-language boundary).
- The `.ssl` files have no Slippay-side runtime yet; they are the auditable specs,
  the `.mjs` is what executes.
