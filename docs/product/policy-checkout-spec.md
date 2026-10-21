# Policy Checkout · product spec v1

**Date:** 2026-05-28 · **Author:** Manuel + Claudin · **Status:** locked for Rio 08/06 demo

The single thing this product does, in one sentence:

> A subscription checkout where the **user's smart wallet enforces the merchant's recurring-charge limit on-chain**, activated by **one biometric tap** with zero visible blockchain surface.

This is what Stripe cannot replicate. Everything else is dressing.

---

## 1 · What the user sees

Single URL per subscription: `app.slippay.cc/s/<sub_id>`. Opens to one screen:

- Merchant logo + name
- One line: *"Assinar {plan_name} — {amount}/{interval}"*
- One button: *"Confirmar com biometria"*
- One small lock icon, tappable, that opens a panel listing the four guarantees (section 3)

After the biometric tap: same screen flips to *"Assinatura ativa"* with the policy summary and a *"Cancelar assinatura"* button. Nothing else.

**No** login form, email field, password, wallet selector, network selector, chain name, gas estimate, fee approval modal, ToS checkbox, seed phrase. None of these exist anywhere in the flow.

---

## 2 · What the merchant configures

Merchant dashboard (out of demo scope for Rio, but the data model exists):

- `plan_name`, `amount`, `interval` (e.g., 30 days), `currency` (USDC for v1)
- `max_per_charge` (hard cap, defaults to `amount * 1.2`)
- `merchant_stellar_address` (where funds settle)
- `policy_expiry` (defaults to 12 months)

These four fields generate the deeplink `/s/<sub_id>`.

---

## 3 · What lives on-chain (the load-bearing part)

When the user taps biometric, the user's smart wallet (Soroban contract, deployed lazy on first tap, owned solely by the user's passkey) is updated with a **spending policy** authorizing the merchant. The policy is a struct in contract storage:

```
Policy {
  merchant: Address,        // exact contract that may pull funds
  asset: USDC,
  amount_per_charge: u64,   // expected charge amount
  max_per_charge: u64,      // hard cap, contract reverts above this
  interval_seconds: u64,    // minimum gap between charges
  expires_at: u64,          // unix timestamp; after this, pulls revert
  revoked: bool,            // user can set true at any time, 1 tap
}
```

Each pull by the merchant runs through `__check_auth` which validates: caller == policy.merchant, amount <= max_per_charge, time since last charge >= interval_seconds, !revoked, now < expires_at. **Slippay's backend cannot bypass any of these.** Only the user (via passkey signature) can revoke or modify.

**The four guarantees displayed to the user, derived from the on-chain policy:**

1. *"Only {merchant_name} can charge you. No one else."* — from `policy.merchant`
2. *"Maximum {max_per_charge} per cycle. Above this, the payment is rejected on-chain."* — from `max_per_charge`
3. *"Settles in seconds. No 7-day clearing window."* — from Stellar finality (3-5s)
4. *"Revoke with one tap. Slippay cannot stop you."* — from on-chain `revoked` flag

---

## 4 · The Stripe-impossible property, named explicitly

Stripe could write all four guarantees in their dashboard. They could not enforce them, because:

- Stripe's "spending limit" lives in Stripe's database. Stripe controls it; users do not.
- Stripe's clearing window is mandated by chargeback law (Reg E in US, PSD2 in EU). They cannot offer instant final settlement without becoming an unlicensed money transmitter.
- Stripe must be the obligatory intermediary; the merchant cannot receive direct.

**The killer line:** *"Stripe cannot ship this without ceasing to be Stripe."*

---

## 5 · Demo acceptance criteria for Rio 08/06

The demo passes if and only if, on a fresh phone with no Slippay history:

- **Time from button tap to "Assinatura ativa": ≤ 8 seconds** (p50 target ≤ 6s).
- **Taps from URL open to active: exactly 1** (the biometric).
- **Characters typed by user: 0.**
- The four-guarantee panel, when opened, shows live data fetched from the on-chain policy (not hardcoded).
- The "Cancelar assinatura" button, when tapped, sets `revoked = true` on-chain within 5s and the screen reflects it.

The mentor's phone runs the demo. Manuel narrates the four guarantees while pointing at the lock icon. The mentor opens the panel and sees the on-chain data. That's the demo.

---

## 6 · Out of scope for v1 / Rio demo (explicitly deferred)

- Merchant dashboard (the sub_id is created via a script; merchant UX comes later)
- Recurring charge engine (the first charge happens at activation; subsequent charges via cron worker — implementable post-Rio if the policy primitive works)
- Fiat on-ramp (user must already hold USDC on Stellar — Vibrant or anchor flow is referenced in pitch but not built)
- Cross-chain via CCIP (roadmap, slide only; anchored on Stellar+Chainlink announcement 31/10/2025)
- Lost-device recovery (passkey OS sync handles 90% of cases; explicit recovery flow is post-Rio)
- Email receipts (post-Rio)

---

## 7 · Most likely failure mode

The smart wallet + passkey stack (OpenZeppelin smart-account-kit, pre-1.0) hits a bug or limitation that surfaces only on mainnet, not testnet. Mitigation: complete the spike on testnet by 2026-05-31 (D+3), then run a mainnet rehearsal by 2026-06-04 (D+7). Three days of margin before Rio.

If mainnet rehearsal fails: fallback is to demo on testnet with a verbal disclaimer ("running on testnet to avoid mainnet fees during demo iteration"). Honest, defensible, not ideal.

---

## 8 · Falsifiable predictions

- **Spike (smart wallet deploy + passkey signing end-to-end on testnet):** fechável em ≤ 4h de trabalho focado. Se passar de 8h, o stack OZ pre-1.0 ainda é custoso demais e a estratégia muda.
- **Mainnet rehearsal (D+7):** demo flow funciona em ≤ 8s no celular do Manuel. Se passar de 12s consistentemente, é regressão e disparamos investigação antes do Rio.
- **Rio demo (D+11):** mentor entende a diferença Stripe-impossível em ≤ 60s de explicação + visual da policy on-chain. Se precisar de mais que isso, a comunicação visual está fraca, não o produto.

---

End of spec. Anything not in this document is not in v1.
