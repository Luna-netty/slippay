# Landing V3 — "infinity dark + handhold flow"

**Date:** 2026-06-21
**Branch context:** work happens on `feat/solana-adapter` (current) or a fresh branch off it; reversible, frontend-only.
**Scope owner:** Manuel
**Status:** approved direction, ready for implementation plan

## Intent

Elevate the existing live dark landing (`LandingV3.tsx`, already deployed at app.slippay.cc) from "solid but flat" to a premium, motion-led page by stealing **structure + effects** (not assets, not copy) from two reference sites:

- **infinitybase.com** (Webflow web3 studio, Floripa) → dark base, grain/noise, scroll-reveal, infinite marquee, asymmetric floating cards, studio-grade weight.
- **handhold.io** (light editorial SaaS) → one stolen element only: the **fluid silk gradient ribbon** as a hero accent.

Decision (operator, 2026-06-21): **dark infinity as base, handhold fluidity as accent.** Not a reversal of the dark V3 direction — it builds on top of it. Light/editorial/serif of handhold is explicitly rejected.

## Non-goals (YAGNI / explicit cuts)

- No serif display type (conflicts with current sans).
- No mountain/hero photo.
- No WebGL / three.js (`three` not installed; dead weight on a mobile-first product that receives USDC on phones).
- No pixel-clone of either site (copy, fonts, the handhold ribbon asset are theirs).
- No change to backend, contracts, app routes, or the cofrinho/consumer pages. Landing only.

## Anchor (what already exists — build on, don't rebuild)

- `apps/web/src/pages/LandingV3.tsx` (251 lines) — hero, sections, proof, close. Already has:
  - `v3-grain` overlay div (currently flat)
  - `IntersectionObserver` scroll-reveal via `v3-reveal` class
- `apps/web/src/lib/darkTheme.ts` — palette + utility class strings (`D` object).
- `apps/web/src/index.css` — latent gold thread: cursor glow `rgba(253,218,36,0.07)` + scroll-progress bar `#A16207`. Reuse for the handhold gold accent.
- `motion` (Framer Motion v12.40) already installed.

### Palette (locked)
- bg `#0a0e1a`, bg2 `#0d1322`
- text `#f3f5fb`
- accent cyan `#22d3ee` → `#38bdf8`
- gold accent (latent, to surface): `#fdda24` / `#A16207`

### Dependencies to add
- `lenis` (~3kb) — smooth scroll. Only new runtime dep.

## The five effects (each mapped to a concrete location)

1. **Hero fluid ribbon (handhold accent).** Animated **CSS mesh-gradient** silk ribbon, cyan→gold, flowing slowly behind the hero `<h1>`. No WebGL. Targets 60fps. Surfaces the latent gold. *Mobile: render a static gradient (no animation) to avoid jank.*

2. **Grain + depth (infinity base).** Upgrade `v3-grain` from flat to real granular texture: SVG `feTurbulence` noise + `mix-blend-mode: overlay`, plus an edge **vignette**. Gives studio weight without a photo.

3. **Smooth scroll.** Add **Lenis**, wired once at landing mount, cleaned up on unmount. Converts the existing reveal from "appears" to "glides".

4. **Proof marquee (infinity).** Infinite horizontal CSS-keyframe ticker. Content: `Stellar · USDC · Pix · CCTP · mainnet · on-chain proof` (factual, no invented partners). Pauses on `prefers-reduced-motion`.

5. **Floating cards (infinity).** The 3 hero feature cards get asymmetric reveal (staggered heights/delays via Framer Motion) + the cyan hover glow `D.card` already defines.

## Error handling / robustness

- `prefers-reduced-motion: reduce` → kill ribbon animation, marquee, smooth scroll; fall back to static + native scroll.
- Mobile (`<768px`) → static ribbon, lighter grain, Lenis still ok but verify no scroll-hijack feel on touch.
- Lenis must be torn down on unmount (no leaked RAF loop bleeding into app routes).
- All new CSS scoped under `v3-*` / a new effects module — must not leak into the light Gate/consumer pages.

## Verification (how we confirm it works)

Playwright screenshot harness already built at `/tmp/shot.mjs` + `/tmp/scrollcap.mjs` (system Chrome via playwright-core). After build:
- capture desktop 1440 + mobile 390, fold + full, scroll-revealed.
- Claude reads the PNGs and confirms: ribbon visible, grain present, cards staggered, marquee running, no layout break.
- Compare against this spec before any deploy.
- `npm run lint` (tsc --noEmit) clean.

## Deploy (out of scope for first pass, noted)

Per `reference_slippay_deploy`: build on laptop + rsync to `/opt/slippay-backend/apps/web/dist` on `manuel@165.22.10.194`. Verify bundle marker before/after. Not part of this implementation unless operator says ship.

## Failure modes acknowledged

1. **Mobile jank** — grain + Lenis + ribbon + reveal stacked = dropped frames on the exact device Slippay is used on. Mitigation: static ribbon + lighter grain on mobile. Must be screenshot-verified on the 390 viewport, not assumed.
2. **Effect soup** — five effects can read as busy/try-hard, the opposite of infinity's restraint. Mitigation: the ribbon is the ONLY strong-color motion; everything else is monochrome. If it reads busy in the screenshot review, cut marquee first.
3. **Style leak** — new CSS bleeding into the light consumer/Gate pages. Mitigation: strict `v3-*` scoping, verified by also screenshotting `/gate` after the change.
