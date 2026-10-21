# GTM — agent-integrity offer (re-cut for the 14-day test)

Re-cut of `root@167.172.27.73:/root/slippay-strategy/run1/brief.md`'s surviving bet
(`agent-spend-cap`, 30% confidence) after this session's build. Two changes from the
brief, both load-bearing:

1. **Lead with integrity, not the cap.** A capped SEP-41 allowance is copyable in an
   afternoon — it loses to the brief's own kill criterion ("I'll code the cap myself").
   The reason to pay is the thing nobody else ships: a rail that **refuses to pay a
   compromised agent**. Cap is table-stakes; integrity is the wedge.
2. **Frame as x402-interop, not Stellar-only.** The brief's letal objection is
   Stellar-vs-EVM (volume is on x402/Base/Kite/Coinbase). Answer, built this session:
   AIA verifies **over x402** (`@slippay/attester/x402`, 6/6 tests). x402 is first-party
   on Stellar AND the EVM standard (Coinbase + OpenZeppelin facilitators). So the pitch is
   "integrity on the chain you already use," not "come to Stellar."

## Honesty boundary (do not oversell)

Live today, sellable now:
- **Non-custodial capped wallet on Stellar mainnet** (`autocharge` via SEP-41 allowance — no per-period signature).
- **AIA integrity oracle** — enforces the agent's committed **surface + velocity**, fail-closed (`@slippay/attester`).
- **x402 binding** — `attestX402` / `verifyX402`, verdict bound to the payment intent (tested).
- **MCP** — `@slippay/mcp` (free; distribution).

Roadmap (say "roadmap", don't claim live): deep adversarial detectors (prompt-injection,
tool-output poisoning, drift). The on-chain *gate* (`autocharge_attested`) is testnet v0.3.
→ Sell "surface + velocity, enforced, fail-closed, verifiable on-chain, over x402." Not
"we detect every jailbreak."

## The offer

**SlipPay — the integrity layer for agent payments. $99/mo per agent fleet.**
Your agent commits a surface (allowed recipients, tools, spend cap, rate). SlipPay signs
each payment only while it stays inside — and refuses, fail-closed, when it drifts.
Portable verdict your x402 facilitator verifies before settling. Non-custodial. Live on
mainnet.

## ICP — where to find them (from the brief's archetypes)

- **MCP server authors** (npm `@modelcontextprotocol`, GitHub MCP topic) — they already ship agent tools.
- **x402 facilitator devs** — Coinbase x402 + OpenZeppelin x402 repos/Discord; they own the settlement hook.
- **Agent-payment waitlists** — Skyfire, Kite, Catena adjacent.
- **Framework communities** — CrewAI, LangGraph, AutoGen Discords (#deployment / #production).
- **YC W25 / S25 agent-infra** founders building autonomous spenders.
- **x402 / agent-payments hashtags on X** — reply to "my agent can pay now" posts.

Target: ~50 qualified contacts → 10 conversations → **3 paid ($99 charged, not a verbal yes)**.

## The pitch (verbatim — cold DM / email, ~130 words)

> **your agent can spend. what checks it isn't compromised?**
>
> You're shipping agents that hold payment mandates. Every rail — x402, Stripe — settles
> one question: *is the payment authorized?* None check the one that matters when an agent
> gets jailbroken or prompt-injected: *is the agent still itself?*
>
> SlipPay is the integrity layer. Your agent commits a surface up front — allowed
> recipients, tools, a spend cap, a rate. We sign each payment only while it stays inside,
> and refuse fail-closed when it drifts. The verdict is a portable ed25519 signature your
> x402 facilitator verifies before settling — on the chain you already use. Non-custodial;
> the capped wallet is live on mainnet.
>
> $99/mo per fleet. Worth 15 min — or I drop the x402 verify snippet and you try it today?

## Objection handling

- **"It has to be EVM / x402."** It *is* x402 — the AIA verdict verifies inside your x402
  facilitator before settlement. No chain switch. (Send the `verifyX402` snippet.)
- **"I'll just code the cap myself."** The cap, sure — that's an afternoon. The value isn't
  the cap; it's the fail-closed *integrity* verdict (surface + velocity now, deeper
  detection on the roadmap) and a portable attestation an auditor/insurer reads. You don't
  want to build *that* in-house.
- **"Why not custodial / why on-chain?"** Non-custodial — funds never touch us; the verdict
  is math your facilitator checks. Every charge is a public, verifiable transaction.

## Kill criterion (14 days)

If the dominant objection across 10 conversations is **"I'll code the cap myself"** OR
**"must be EVM-native, x402-interop isn't enough"**, the offer is dead — kill it, don't
iterate. If ≥3 teams pay $99, the prior flips to real: build the next detector.

## The ask, every time

Not "does this sound useful?" → **"can I set you up today — $99, I'll send the invoice"**.
A charged $99 is signal; a verbal yes is noise.
