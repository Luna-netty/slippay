# Agent surface

This is the builder-facing side of SlipPay: how an autonomous agent pays through
the rail, what it is allowed to do, and what its principal (the human or service
that owns it) controls. The design separates an agent's verbs from its
principal's verbs so a compromised agent cannot escalate its own authority.

Source: `packages/slippay-mcp`, `contracts/subscription`,
`apps/web/src/pages/Sub.tsx`, `apps/web/src/lib/soroban.ts`.

## The membrane: agent verbs vs principal verbs

`@slippay/mcp` exposes the rail to an agent as MCP tools, behind a role membrane
set by `SLIPPAY_ROLE` (default `agent`). The split is deliberate.

**Agent tools** (the verbs an agent gets):

- `slippay_verify` — offline re-verification of a proof-carrying certificate (the
  read-only check; see [../guides/verify-a-cert.md](../guides/verify-a-cert.md)).
- `slippay_whoami` — identity of the configured signer.
- `slippay_charge_attested` — an autonomous charge that settles only with a fresh,
  single-use ed25519 attestation.
- `slippay_status` — a settlement read from Horizon.

**Principal-only tools** (trust setup, hidden from agents):

- `slippay_pay` — raw SAC / SEP-41 transfer.
- `slippay_subscribe` — create a subscription.
- `slippay_approve` — the one allowance that arms autonomous debit.
- `slippay_autocharge` — allowance-gated charge with no attestation.
- `slippay_arm_gate` — `set_attester`.

The point of the membrane: an agent has no raw `pay`, no setup verbs, and cannot
mint its own attestation. A compromised agent cannot grant itself spending
authority. It can only act inside the surface its principal already armed.

The package is non-custodial and backend-free. The agent holds its own key
(`SLIPPAY_SIGNER_SECRET`) and builds, signs, and submits Soroban / Stellar
transactions straight to an RPC. No SlipPay backend sits in the payment path.

## The `/sub` on-chain recurring flow

`/sub/:id` is the buyer-facing surface for the on-chain recurring rail. It shows
both the recurring path and a single on-chain charge.

### Step 1: approve the allowance once

The buyer connects a wallet and signs **one** approval: a SEP-41
`approve(owner, spender = subscription contract, cap, expiration_ledger)` on the
USDC token (`approveAllowance` in `lib/soroban.ts`). The page sets a capped
amount and an expiration of roughly nine months of ledgers.

### Step 2: autocharge each period

After that one approval, the autocharge path pulls each period with no further
buyer signature. The mainnet autocharge contract (v0.2, `CAQZECYT…`) calls
`transfer_from(spender = contract, buyer -> merchant)` against the standing
allowance. Any relayer can submit the call; the relayer is a fee-payer only and
never custodies funds.

There are two independent ceilings:

- **Contract-side** — status, period, `max_periods`, `expires_at` in the
  subscription contract.
- **SAC-side** — the allowance cap and the allowance expiration ledger. When the
  allowance is exhausted or expired, `transfer_from` fails and the buyer must
  re-approve. This is a hard on-chain ceiling.

The off-chain half is a scheduler (`scripts/autocharge-scheduler.mjs`) that finds
due subscriptions and fires `autocharge(id)` signed by a relayer. It defaults to
a dry run and requires explicit flags to charge.

### The per-period-signature alternative

`/sub` also supports a charge where the buyer signs **every** period. That path
uses the v0.1 contract (`CBJMQ6ZY…`), whose `charge(id)` binds the buyer
signature to `(id, token, merchant, amount)` and then runs the nested SEP-41
`transfer(buyer -> merchant)`. `signAndSubmitContractCharge` signs the unsigned
charge XDR (built by the API) and submits it via the Soroban RPC.

### Demo vs production

`/sub` is a real rail on a demo surface. The single-charge path needs
`VITE_DEMO_MERCHANT_KEY` in the browser build, because the
`onchain-charge` endpoint that builds the unsigned charge is merchant-authed and
the key cannot safely live in a customer's browser. Productionizing this needs a
public, checkout-token-gated variant of that endpoint. Until then, treat the
single-charge path as a demo. The allowance approval and the autocharge mechanism
themselves are the real recurring rail.

## The attestation gate (status seam)

The v0.3 attestation gate adds `autocharge_attested(id, not_after, signature)`
plus `set_attester`, with an on-chain `ed25519_verify`. The signed message is 44
bytes: `id(32) || charges_done(u32 BE) || not_after(u64 BE)`. The `id` binding
blocks cross-subscription replay, the `charges_done` binding makes each
attestation single-use, and `not_after` is freshness. A failed verify reverts
(fail-closed).

Honest seam: the attestation gate is proven on **testnet only**. Mainnet
currently runs v0.2, which is allowance-gated with **no** attestation gate. Do not
describe the mainnet rail as attested.

## How an agent integrates with `@slippay/mcp`

1. Install: the agent runs `npx -y @slippay/mcp` as an MCP server.
2. Configure the environment: `SLIPPAY_SIGNER_SECRET` (the agent's own key),
   `SLIPPAY_CONTRACT`, `SLIPPAY_NETWORK` (`testnet` or `public`), and optional RPC
   / USDC issuer overrides. Leave `SLIPPAY_ROLE` at `agent`.
3. The principal, out of band, runs the principal-only verbs once: create a
   subscription, approve the allowance, and (on testnet) arm the gate.
4. The agent then operates within that armed surface: `slippay_charge_attested`
   to settle, `slippay_status` to read settlement, `slippay_verify` to re-check a
   certificate.

For the full tool list and environment, see the package README:
[../../packages/slippay-mcp/README.md](../../packages/slippay-mcp/README.md).

## Cross-links

- Contract details: `contracts/subscription/DEPLOYED.md`,
  `contracts/smart-wallet/DEPLOYED.md`.
- Package: [../../packages/slippay-mcp/README.md](../../packages/slippay-mcp/README.md).
- Certificate re-verification: [../guides/verify-a-cert.md](../guides/verify-a-cert.md).
- AXL spending bound as a theorem: [../axl.md](../axl.md).
- Biometric human pay: [../guides/biometric-pay.md](../guides/biometric-pay.md).

## Status and honest limitations

- The attestation gate (v0.3) is testnet-only. Mainnet runs v0.2 (allowance, no
  gate).
- The subscription contracts and the smart-wallet have no third-party audit; only
  a self-run adversarial harness.
- `@slippay/mcp` is non-custodial and backend-free, but the agent must protect its
  own signer key. The membrane limits a compromised agent's reach; it does not
  recover a leaked key.
- No paying customers and no volume claims.
