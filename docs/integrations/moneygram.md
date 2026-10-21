# MoneyGram Access integration · Slippay — PLAN (not shipped)

- **status:** plan only · no code written · 2026-06-01
- **author:** Manuel Galmanus (plan drafted with Claude Code)
- **decision pending:** MoneyGram partnership + Res BCB 561 legal call (see §6)
- **grounding:** `apps/web/src/lib/anchor.ts` (existing SEP-10+SEP-24 client, 191 LOC),
  `agents/settlement/settle.mjs` (recipient guard / teeth),
  `apps/listener/src/reconciler.ts` (Horizon match)

---

## 0. one-line thesis

The Slippay backbone **already speaks MoneyGram's protocol**. MoneyGram Access is
not a proprietary API — it is a Stellar **anchor** that implements SEP-10 (auth) +
SEP-24 (interactive deposit/withdraw). `anchor.ts` already implements the client
side of both SEP-10 and SEP-24 deposit against `testanchor.stellar.org`. So the
integration is **a config swap + the withdraw (off-ramp) flow we don't have yet +
the custodial-auth variant**, not a greenfield build.

Concrete reuse estimate: SEP-10 (`sep10Authenticate`, anchor.ts:99-120) ports
**unchanged**. SEP-24 deposit (`sep24DepositInteractive`, anchor.ts:128-146) ports
with a URL swap. New code is the withdraw mirror + custodial memo + status polling
for `pending_user_transfer_start`. Rough order: **~150-250 LOC**, same shape as the
x402 integration that shipped under 200 LOC (docs/integrations/x402.md).

---

## 1. what MoneyGram Access actually is (verified 2026-06-01)

- A Stellar anchor. Integration spec is **public**: `stellar/moneygram-access-wallet-mvp`
  (reference wallet) + the Stellar "MoneyGram Access integration guide". License: open,
  buildable on testnet today.
- Rail it provides: **cash ↔ USDC** at physical MoneyGram locations. Cash-in ~30
  countries, cash-out ~170 countries (MoneyGram Ramps, 2025).
- Auth model: custodial wallets authenticate with a **registered Stellar public key +
  a unique user-ID memo** (positive int, ≤64 bits). Non-custodial wallets use the
  user's own key + the domain SIGNING_KEY from the stellar.toml.

### what it is NOT (the part that kills the naive pitch)
- **Not** a USDC↔PIX bridge. MoneyGram's Pix presence (via BS2) is their consumer
  remittance app — a different product from the Stellar crypto ramp. Do not assume
  the ramp talks PIX. It does not.
- So MoneyGram **complements** the Etherfuse PIX↔Stellar rail; it does not replace or
  overlap it. PIX = domestic, instant, digital. MoneyGram = physical, international, cash.

---

## 2. where it plugs into Slippay

```
  buyer/agent          Slippay (anchor client)        MoneyGram anchor        Stellar
      │                        │                            │                    │
      │  cash on-ramp          │  SEP-10 auth (reuse)       │                    │
      │ ─────────────────────► │ ─────────────────────────►│  KYC webview       │
      │                        │  SEP-24 deposit (reuse)    │                    │
      │                        │ ◄───── USDC to wallet ─────┼───────────────────►│
      │                        │                            │                    │
      │  off-ramp (NEW)        │  SEP-24 withdraw (NEW)     │                    │
      │ ─────────────────────► │ ─────────────────────────►│ cash pickup ref    │
      │                        │  send USDC w/ memo ────────┼───────────────────►│
```

Two distinct integration points, different value:

**(A) On-ramp (deposit) — buyer funds an agent wallet with cash.**
Reuses `sep24DepositInteractive` almost verbatim. Value to Slippay: a buyer with no
crypto and no PIX (e.g. unbanked, or cross-border payer) can fund the agent wallet.
Marginal — most Slippay buyers already have PIX.

**(B) Off-ramp (withdraw) — merchant cashes out USDC settlement to physical cash.**
This is the **new** code (`anchor.ts` is deposit-only today, confirmed: only
`sep24DepositInteractive` exists, no withdraw). Value: a merchant in any of ~170
cash-out countries can pull settled USDC as cash without a bank. This is the
genuinely additive capability — it widens the merchant TAM beyond bank/PIX holders.

---

## 3. concrete change set (when GO)

| file | change | reuse |
|---|---|---|
| `apps/web/src/lib/anchor.ts` | parametrize `ANCHOR_HOME`/asset (testanchor → MoneyGram prod/sandbox) | SEP-10 unchanged |
| `apps/web/src/lib/anchor.ts` | add `sep24WithdrawInteractive` (mirror of deposit) | same fetch/poll shape |
| `apps/web/src/lib/anchor.ts` | add custodial SEP-10 variant (account = Slippay key, `memo` = user id) | extends existing |
| new page / dashboard action | merchant "cash out via MoneyGram" | mirrors `AnchorDemo.tsx` |
| `agents/settlement/settle.mjs` | **no change** — withdraw is buyer→anchor, the teeth already pin recipient | guard intact |
| config / secrets | `FUNDS_SECRET_KEY`, `AUTH_SECRET_KEY` (allowlisted by MoneyGram) | — |

The recipient-redirection guard (`settle.mjs:30-33`, `consentedRecipient` pin) is
**orthogonal** to this and stays exactly as-is. MoneyGram withdraw moves money FROM
the user TO the anchor; the redirection threat (funds landing on a rotated merchant
address) does not apply on that leg.

---

## 4. disanalogies / what does NOT map cleanly

- **KYC ownership flips.** On the PIX/Etherfuse rail Slippay controls the UX. On
  MoneyGram, KYC happens in **MoneyGram's webview** (SEP-24 interactive popup) — you
  hand the user off. The "zero-tech, Jobs/iPhone" Slippay UX goal
  (`project_slippay_democratization`) breaks at the MoneyGram KYC handoff. Disanalogy
  with the passkey flow: passkey is one tap; MoneyGram KYC is a full identity
  interrupt you do not control.
- **Custodial memo = you hold the key.** The custodial auth model means Slippay's
  registered Stellar account authenticates on behalf of users via memo. That makes
  Slippay a custodian for that leg — a regulatory and key-management posture change,
  not just a code change.

---

## 5. failure modes (named)

1. **Dead code.** Building the off-ramp before a merchant asks for physical cash-out =
   ~200 LOC + a new compliance surface with zero demand. The current first-R$ blocker
   (memory `project_slippay_monetization`) is merchant setting a Stellar address — NOT
   absence of a cash ramp. MoneyGram does not move that blocker.
2. **Custody creep.** The custodial variant quietly turns Slippay into a custodian.
   That is a different legal entity posture than the non-custodial "we never hold
   funds" story.
3. **Partnership gate stalls the demo.** Even testnet/sandbox requires MoneyGram to
   allowlist your `FUNDS_SECRET_KEY`/`AUTH_SECRET_KEY` public keys. No self-serve.
   Timeline is MoneyGram's, not yours — cannot be sprinted.

---

## 6. gates (cannot be solved in code)

1. **MoneyGram partnership.** Must contact MoneyGram, share the two public keys for
   allowlisting, before even the sandbox works. Non-self-serve.
2. **Res BCB 561 (your own memory `project_slippay_repositioning_561`).** Res 561 +
   519/520/521 classify cross-border stablecoin movement as câmbio. MoneyGram's value
   is precisely **cross-border** cash. Integrating the cross-border off-ramp may
   reopen the exact regulatory wall the domestic repositioning closed. **This needs the
   advogado before any live wiring** — it is the critical-path gate, above the code.

---

## 7. falsifiable acceptance (testnet, no partnership needed)

Pointing `anchor.ts` at the **stellar testanchor** (already wired) proves the protocol
end-to-end without MoneyGram. Falsifiable checks before claiming "MoneyGram-ready":

- [ ] `sep24WithdrawInteractive` returns `{ url, id }` against testanchor and the
      withdraw popup completes (mirrors the working deposit at AnchorDemo).
- [ ] custodial SEP-10 (account = fixed key, memo = user id) yields a valid JWT.
- [ ] withdraw status polls to `completed` and the USDC debit appears on Horizon.

If those three pass on testanchor, the MoneyGram swap is a config + allowlist step,
not a code risk. **Falsifiable:** if porting to MoneyGram sandbox requires anything
beyond URL/asset/key config + the withdraw flow above, this "thin integration" thesis
is wrong. Confidence the thesis holds: ~70% — MoneyGram follows standard SEP-24, but I
have not run their sandbox, so unverified on their specific quirks.
