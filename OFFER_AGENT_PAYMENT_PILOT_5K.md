# SlipPay — Agent-Payment + Integrity Pilot · $4,997 (fixed)

**For:** a web3 protocol, agent platform, or merchant that wants autonomous agents
to pay — and wants proof the paying agent isn't compromised.
**Delivery:** 5 business days. Fixed price, fixed scope. No retainer.

---

## What you get (concrete, all live today)

1. **Your agent/merchant, live on the SlipPay rail (Stellar mainnet).**
   Recurring + autonomous charges through the deployed Soroban contract
   (`CAQZECYT…`), settled in ~5s, sub-cent fees, non-custodial (funds move
   payer → you, we never hold them).

2. **The integrity gate, armed.** Your charges settle only when a fresh,
   single-use attestation is presented — the on-chain answer to the question no
   other rail asks: *is the agent requesting this payment compromised?* x402 /
   Stripe MPP verify authorization; this verifies the counterparty.

3. **An adversarial audit of your agent + the gate, with a report.** We run real
   on-chain attacks (forged/replayed/expired attestation, period bypass) against
   your setup and hand you a re-runnable report against a public contract address.
   You don't trust us — you re-check the math.

4. **The `@slippay/mcp` integration** (live on npm): your agent installs one MCP
   server and gets the gated-spend + offline proof-verification as tools.

## Price

- **$4,997**, fixed. 50% to start, 50% on delivery.
- Settles in USDC (or invoice/bank, your choice).
- Scope is exactly the four items above for ONE agent/merchant. Additional agents
  or custom detection logic = separate scope.

## Why now

Agent-to-agent payments are arriving before the safety layer for them exists.
Every rail can move the money; none can refuse to move it for a hijacked agent.
This pilot puts that refusal on-chain for your agent in a week — and gives you a
public artifact (the audit report + the live contract) you can show your own
users, auditors, or investors.

## Honest scope boundary

This pilot uses a **signed-surface attestation** (your agent's tool/contract
surface is committed; deviation = refusal). The fully-automated integrity oracle
(continuous compromise detection) is on the roadmap, not in this $5k scope — what
ships here is the on-chain gate + the audit, both real and verifiable today.

— Manuel Galmanus · Bluewave / SlipPay · manuel@bluewaveai.online
