# Slippay consumer redesign — DARK YEEZY

Date: 2026-06-13
Status: design (pre-implementation)
Owner: Manuel (operator) · author: Claude Code
Scope decided via brainstorming: **landing + consumer flows**, **visual redesign keeping positioning**, aesthetic = **DARK YEEZY**, copy source = **home.tsx (early-access honest)**.

---

## 1. Goal

Rebuild the consumer-facing surface of app.slippay.cc in a single, distinctive DARK YEEZY design system, without touching working business logic. The redesign:

- replaces the current warm-bone editorial palette with a dark "vault" register rendered through the Yeezy editorial language (monumental type, numbered sections, extreme negative space);
- migrates the live route `/` from the `LandingV2.tsx` inline copy to the more honest `src/copy/home.tsx` positioning (DOLLAR INBOX, early-access);
- restyles the consumer flow pages to the same system so the product feels like one object end to end.

Non-goal: rewriting payment/auth/quote logic, contracts, or the dashboard/admin/investor surfaces.

---

## 2. Aesthetic direction (the committed bold choice)

DARK YEEZY = Yeezy Season's darker register (military/black/bone), not the light bone editorial the site uses today. Brutalist structure, refined execution. The thesis "your dollars, nobody freezes them" becomes the visual identity (a vault), without becoming technical — a non-crypto person still understands it.

### Design tokens

| Token | Value | Use |
|---|---|---|
| `ink` (ground) | `#0E0D0B` | page background — the vault |
| `ink-raised` | `#16140F` | raised panels / cards |
| `bone` (text) | `#F1EEE7` | primary text on dark |
| `bone-dim` | `rgba(241,238,231,0.60)` | secondary text |
| `bone-faint` | `rgba(241,238,231,0.40)` | labels, captions, hairlines |
| `accent` (punctum) | `#FDDA24` | the ONLY accent — CTAs, keyword marker, logo dot, section dot |
| `hairline` | `rgba(241,238,231,0.12)` | section dividers, card borders |

Brand-separation guardrail: accent stays Slippay yellow `#FDDA24`. **Never** introduce Bluewave KLEIN blue. No shared assets, copy, or case-study coupling with Bluewave.

### Type

- Display/body: **DM Sans** (already self-hosted). Monumental headings, uppercase where the current site is uppercase, `clamp()` fluid scale, tight tracking `-0.04em`, leading `~0.9`.
- Labels/eyebrows/numbers: **Space Mono**, uppercase, wide tracking `0.2–0.34em`, in `bone-faint`.
- Wordmark: keep the self-hosted **Rounded** font for `slippay·`, on dark.

### Layout & motion

- Numbered editorial section indices kept (`001 ·`, `002 ·` …) — rendered in mono/bone-faint with the yellow dot.
- Extreme negative space; thin `hairline` dividers between sections; max content widths preserved (`~820–1100px`).
- Motion layer from `index.css` is reused as-is (mask-rise reveals, lift hovers, scroll-reveal, marquee, square slider thumb). It already degrades under `prefers-reduced-motion`. Colors in keyframes that reference light values (e.g. scroll-progress `#A16207`) are re-tokenized for dark.
- Hero keeps a single proof object on the right (the `LivePaymentCard`), restyled dark. The cofrinho/piggy SVG animation set stays available but is NOT the hero lead in this direction (vault > toy); it may appear later as a smaller motif. Decision recorded so we do not delete the cofrinho CSS.

---

## 3. Positioning / copy

Source of truth becomes `src/copy/home.tsx` (PT primary, EN mirror). Its HARD-HONESTY constraints are load-bearing and MUST survive the redesign verbatim in spirit:

- the receive→hold→spend-via-Pix loop is **early access**, not live; Pix enters via a licensed partner "em definição" — never presented as a working "spend in reais today" feature;
- self-custody ("the money is yours, never ours") is true and may be stated plainly;
- agent spend-limit proof is **testnet + self-audited** — mark "mainnet + outside audit pending", never "proven in production";
- **strictly domestic** — hold/receive/spend domestically; NEVER claim cross-border send / remittance (Res 561, effective 2026-10-01);
- no jargon in the lead (say "dollars", "no password to memorize"; USDC/Stellar/Soroban only in the builder footnote).

The mainnet on-chain proof artifacts already referenced (contract, USDC tx, biometric payment) remain, framed exactly as `home.tsx` frames them ("verification transactions", not user traction).

Reconciliation: the current `LandingV2.tsx` inline copy (cofrinho, "paga sozinho", 5×0 scoreboard, ~1.9% as delivered) is retired from the live route. The cofrinho "em palavras simples" plain-language section is valuable and validated; it is **adapted** into the new copy as a plain-language block, but rewritten to obey the early-access honesty rules (no "pays on its own today" overclaim). Net: keep the clarity, drop the overclaim.

---

## 4. Page-by-page

### In scope (restyle to DARK YEEZY)

1. **`/` landing** — rebuilt. New `LandingV2.tsx` consumes `homeCopy` from `src/copy/home.tsx` instead of its inline `COPY`. Section order driven by `home.tsx`'s structured shape: hero → plain-words → the pain → loss calculator → how-you-use-it (3 steps) → how-it's-different (3 reasons) → built-for-what's-next (x402, honest borrowed authority) → honest-status → CTA (single waitlist ask) → footer. Bridge link to `/builders` (agents narrative) kept low and zero-tech.
2. **`/pay` (PayDemo)** — restyle the pay/scan surface dark; logic untouched. Honesty: testnet labeling preserved where present.
3. **`/cobrar` (Cobrar)** — receive-via-QR surface, dark restyle.
4. **`/checkout/:order_id` (Checkout)** — dark restyle.
5. **`/comprovante/:txhash` (Comprovante)** — receipt, dark restyle.
6. **`/account` (Account)** — consumer entry/login surface, dark restyle.
7. **`/buy` + `/comprar` (Buy)** — dark restyle.

Shared chrome (header, nav, footer, lang toggle, CTA button, section index) is extracted/standardized so all pages share one dark system rather than each re-declaring tokens inline.

### Explicitly out of scope (untouched this pass)

`/dashboard/*`, `/investors`, `/manifesto`, `/security`, `/docs`, `/gate`, `/cockpit`, `/agents`, `/builders`, demos (`/x402-demo`, `/anchor-demo`, `/withdraw-demo`, `/demo`, `/preview`, `/bio`), `/loja`, `/store`, `/conformidade`. These keep their current styling; a later pass can extend the system.

---

## 5. Architecture / units

- `src/theme/dark.ts` (new) — exports the token constants + shared className strings (`btn`, `sec`, `inner`, `mark`, `Index` component) so pages don't re-declare them. Single source for the dark system.
- `src/copy/home.tsx` — unchanged shape; becomes the landing's data source. (If a plain-words block is added, it extends `HomeStrings` for both langs symmetrically.)
- `LandingV2.tsx` — rewritten to render `home.tsx` copy through the dark theme. Inline `COPY` removed.
- Flow pages — import tokens from `src/theme/dark.ts`; swap light classes for dark; no logic edits.
- `index.css` — re-tokenize the few hardcoded light color values for dark; keep all keyframes.

Each unit answers: what it does (theme = tokens; copy = strings; page = layout), how it's used (import), what it depends on (theme depends on nothing; pages depend on theme + copy).

---

## 6. Honesty / regulatory guardrails (non-negotiable)

Carried verbatim from `home.tsx` §HARD HONESTY. Any new or adapted copy is checked against:
1. no "use it today" for the Pix loop — early access only;
2. no remittance / cross-border send claim anywhere;
3. agent proof marked testnet + outside-audit-pending;
4. self-custody stated as the load-bearing true claim;
5. no jargon in the lead.

Slippay is non-custodial and NOT a VASP — copy must not imply custody or FX origination.

---

## 7. Deploy

Per existing mechanism (memory `reference_slippay_deploy`): build on laptop, rsync `apps/web/dist` to `manuel@165.22.10.194:/opt/slippay-backend/apps/web/dist`. SSH authorized, keys present. Not Vercel. Verify live via `curl -s -o /dev/null -w '%{http_code}'` and a no-store hash check before declaring done. Reconcile local-vs-prod parity before building, since the laptop repo has uncommitted changes and history may diverge from prod.

---

## 8. Testing / verification

- `npm run build` (vite) green, no TS errors.
- Visual: every in-scope page renders dark with yellow punctum; no leftover bone-light backgrounds; no KLEIN blue anywhere.
- Honesty lint (manual): grep the rendered copy for forbidden claims (remittance/cross-border, "pays on its own today", "proven in production", non-early-access Pix).
- Accessibility: contrast of bone-on-ink ≥ WCAG AA for body; `prefers-reduced-motion` still kills motion.
- No regression in flow logic: pay/cobrar/checkout/comprovante still function (manual click-through on the dev server).

---

## 9. Out of scope / YAGNI

- No dashboard/admin restyle this pass.
- No new copy positioning invented — only migrate to home.tsx + adapt the plain-words block.
- No new payment/auth/contract logic.
- No Bluewave coupling, no KLEIN, no case-study cross-reference.

---

## 10. Resolved decisions

Hero lead motif: **proof card** (LivePaymentCard), restyled dark. Decided by operator 2026-06-13. The cofrinho/piggy SVG set is kept in `index.css` as a possible smaller motif but is not the hero lead.
