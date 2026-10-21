# SlipPay Agent Wallet — the governance layer x402 leaves open

*Positioning brief · Stellar 37 Graus, 2026-06-08 · audience: Stellar ecosystem + Foundation*

## The gap (concrete, not narrative)

The agent-payment stack on Stellar has a rail and a facilitator, but no policy layer:

- **x402** (Coinbase + Stellar) — the rail. HTTP 402 pay-per-call settlement in USDC. Open, commoditized, production-ready via the OpenZeppelin Relayer.
- **OpenZeppelin x402 Plugin / Smart Account** — facilitation and programmable accounts.
- **Stripe Issuing for Agents** (announced 2026-04-29) — issues virtual cards per agent but **requires a human to approve each purchase**. Their own words on spending limits without human approval: *"we're planning."*

What none of them ship: **on-chain, user-enforced spending policy for an autonomous agent** — a limit the platform itself cannot override, that lets the agent act *between* human approvals.

## What SlipPay built (verifiable on testnet today)

A Soroban smart wallet (custom account, CAP-46-11) where:

1. A human authorizes an agent **once** (passkey / WebAuthn, secp256r1).
2. That authorization installs a **delegated session** for an ed25519 agent key, scoped by:
   - `per_tx_cap` — hard cap per transfer
   - `window_cap` over `window_seconds` — aggregate budget (e.g. 50 USDC / 24h)
   - `allow_recipients` — pay only approved counterparties (the agent-to-agent guarantee)
   - `expires_at` + one-tap `revoke` — bounded, killable
3. The agent then transfers **autonomously** — no human signature per transaction — and `__check_auth` enforces every constraint on-chain. An out-of-scope spend is **rejected by the contract**, not by a dashboard.

**The wedge:** *Stripe handles agents that need a human to approve every purchase. SlipPay handles agents that act between human approvals, with cryptographic guarantees about what they can and cannot do.*

## Proof (live, public)

| artifact | reference |
|---|---|
| smart-wallet contract (testnet) | `CB65SDIIMRVZJBAEWVKNAAYHKUP5WWR2JCHNOTGWYAGHWPTJS7CRBSKN` |
| `install_agent_session` tx | `39ef780ddea70511b8e93d03ff0dda7499f7a719b26c0a20e5ba28d3d90b8a4d` |
| session, read on-chain | per_tx 10 USDC · window 50 USDC / 24h · allowlist · revocable |
| enforcement logic | 29/29 unit tests (per-tx, windowed budget, allowlist, revoke, expiry) |

stellar.expert: https://stellar.expert/explorer/testnet/contract/CB65SDIIMRVZJBAEWVKNAAYHKUP5WWR2JCHNOTGWYAGHWPTJS7CRBSKN

## Honest status (what is and isn't done)

- **Done + verifiable:** the delegated-session primitive is live on testnet; enforcement (caps, window, allowlist, revoke, expiry) is covered by 29 unit tests; wasm builds; `__check_auth` is wired for both passkey (secp256r1) and agent (ed25519) credentials via a typed `WalletAuth`.
- **In progress:** end-to-end testnet run with a real agent-signed transfer (the public "contract rejects the overspend" transaction); security re-audit of the new delegation surface (the prior audit closed 8 critical + 14 high on the pre-delegation contract).
- **Gated:** mainnet deploy — behind the e2e run, the re-audit, and a migration decision.

## The category claim, and its honest limit

This is the empty quadrant: the rail and the facilitator exist; the **on-chain governance/attestation layer for agent spending does not**. SlipPay's position is *first-mover + reference implementation*, not "only one capable."

- **Watch:** OpenZeppelin Smart Account is the nearest party that could commoditize on-chain policy. The window is the advantage; the standard is the moat.
- **No forcing function yet:** nobody is *required* to use agent-spend governance today. The durable value depends on a forcing function emerging — an AML/attestation requirement, an insurer, or a marketplace badge — and on SlipPay being the rail that carries it.

## The ask at 37 Graus

One of: a **design partner** running agents in production, or a **Stellar Foundation** signal (Infrastructure Grant / endorsement) recognizing this as the missing governance primitive for x402 agent payments on Stellar.
