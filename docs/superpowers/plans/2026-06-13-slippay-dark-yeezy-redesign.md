# Slippay DARK YEEZY consumer redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Slippay consumer surface (landing + pay/cobrar/checkout/comprovante/account/buy) in one DARK YEEZY design system, migrating the live `/` route to the honest `home.tsx` copy, without touching payment/auth logic.

**Architecture:** A new `src/theme/dark.ts` module owns all dark tokens + shared chrome (button, section, index, marker). `LandingV2.tsx` is rewritten to consume `src/copy/home.tsx` through that theme. The six flow pages get a mechanical light→dark token swap (no logic edits). `index.css` light-valued hardcodes get re-tokenized for dark.

**Tech Stack:** React 18 + react-router-dom, Vite, TypeScript (`tsc -b && vite build`), Tailwind (utility classes inline), Vitest. Self-hosted DM Sans + Space Mono + Rounded fonts.

**Spec:** `docs/superpowers/specs/2026-06-13-slippay-dark-yeezy-redesign-design.md`

---

## Pre-flight (do once, before Task 1)

- [ ] **P1: Isolate the workspace.** This repo is at `/home/galmanus/projects/slippay`. Create a feature branch or git worktree so the redesign is isolated from the uncommitted working-copy changes already present (`git status` shows modified `App.tsx`, `LandingV2.tsx`, `home.tsx`, `index.css`, etc.).

```bash
cd /home/galmanus/projects/slippay
git stash list   # note anything stashed
git status -s    # review existing uncommitted changes — do NOT discard; they may be in-flight work
git checkout -b feat/dark-yeezy-redesign
```
If the existing uncommitted changes are unrelated/unwanted, confirm with operator before stashing. Do not `git checkout .` or discard without consent (memory: destructive-ops-per-item-consent).

- [ ] **P2: Verify the build is green BEFORE any change (baseline).**

```bash
cd /home/galmanus/projects/slippay/apps/web && npm run build
```
Expected: exits 0, `dist/` produced. If it fails on `main` already, fix or report before proceeding — you must distinguish pre-existing breakage from your own.

- [ ] **P3: Verify local↔prod parity.** Memory warns the laptop repo may diverge from prod. Confirm what is actually live before rebuilding on a stale base.

```bash
curl -s -o /dev/null -w 'live %{http_code}\n' https://app.slippay.cc/
curl -s https://app.slippay.cc/ | grep -o 'index-[A-Za-z0-9_]*\.js' | head -1   # live bundle hash
```
Record the live bundle hash. If the live site clearly differs from this repo's `LandingV2.tsx` (e.g. already shows home.tsx copy), STOP and reconcile with operator before building.

---

## Task 1: Dark theme module

**Files:**
- Create: `apps/web/src/theme/dark.ts`
- Test: `apps/web/src/theme/dark.test.ts`

- [ ] **Step 1: Write the failing test** — assert the tokens exist and are the agreed values (catches accidental KLEIN/bone-light regressions).

```ts
// apps/web/src/theme/dark.test.ts
import { describe, it, expect } from "vitest";
import { TOKENS } from "./dark.ts";

describe("dark theme tokens", () => {
  it("uses the vault ink ground and bone text", () => {
    expect(TOKENS.ink).toBe("#0E0D0B");
    expect(TOKENS.bone).toBe("#F1EEE7");
  });
  it("accent is Slippay yellow, never Bluewave KLEIN", () => {
    expect(TOKENS.accent).toBe("#FDDA24");
    // KLEIN blue must never appear
    expect(Object.values(TOKENS).join(" ")).not.toMatch(/#002FA7|klein/i);
  });
});
```

- [ ] **Step 2: Run test, verify it FAILS**

Run: `cd apps/web && npx vitest run src/theme/dark.test.ts`
Expected: FAIL — cannot find module `./dark.ts`.

- [ ] **Step 3: Implement the theme module**

```ts
// apps/web/src/theme/dark.ts
// DARK YEEZY design system — single source of dark tokens + shared chrome.
// Brand-separation guardrail: accent is Slippay yellow. NEVER Bluewave KLEIN.
export const TOKENS = {
  ink: "#0E0D0B",        // page ground — the vault
  inkRaised: "#16140F",  // raised panels / cards
  bone: "#F1EEE7",       // primary text
  boneDim: "rgba(241,238,231,0.60)",
  boneFaint: "rgba(241,238,231,0.40)",
  accent: "#FDDA24",     // the ONLY accent
  hairline: "rgba(241,238,231,0.12)",
} as const;

// Shared className strings (Tailwind arbitrary values bound to tokens).
export const cx = {
  page: "min-h-screen bg-[#0E0D0B] text-[#F1EEE7] overflow-x-hidden",
  sec: "border-t border-[#F1EEE7]/12",
  inner: "max-w-[900px] mx-auto px-6 md:px-12 py-24 md:py-36 text-center",
  // primary CTA — yellow pill on dark
  btn: "lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#FDDA24] text-[#0a0a0a] font-medium",
  // secondary link — bone underline
  link: "text-[12px] uppercase tracking-[0.18em] border-b border-[#F1EEE7]/25 hover:border-[#F1EEE7] pb-1 text-[#F1EEE7]/70",
  // mono label
  label: "font-mono text-[10px] uppercase tracking-[0.3em] text-[#F1EEE7]/40",
} as const;

// Yellow keyword marker (used on emphasized inline words).
export const mark = {
  color: "#0a0a0a",
  background: "#FDDA24",
  padding: "0 0.06em",
  boxDecorationBreak: "clone",
  WebkitBoxDecorationBreak: "clone",
} as const;
```

- [ ] **Step 4: Run test, verify it PASSES**

Run: `cd apps/web && npx vitest run src/theme/dark.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/theme/dark.ts apps/web/src/theme/dark.test.ts
git commit -m "feat(theme): dark yeezy token module + guardrail test"
```

---

## Task 2: Shared dark Index component

The numbered editorial section index (`001 ·`) is used on every section. Extract it into the theme as a component so the landing and flows share one implementation.

**Files:**
- Modify: `apps/web/src/theme/dark.ts` (append component)
- Test: `apps/web/src/theme/dark.test.ts` (append render assertion)

- [ ] **Step 1: Add failing test**

```ts
// append to dark.test.ts
import { renderToStaticMarkup } from "react-dom/server";
import { Index } from "./dark.tsx";

it("Index renders number + label with the yellow dot", () => {
  const html = renderToStaticMarkup(<Index n="001" label="why" />);
  expect(html).toContain("001");
  expect(html).toContain("why");
});
```
Note: rename `dark.ts` → `dark.tsx` since it now holds JSX (update the import in `dark.test.ts` Task-1 block from `./dark.ts` to `./dark.tsx`). Keep the test file as `.tsx`.

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/theme/dark.test.tsx` → FAIL (no `Index` export).

- [ ] **Step 3: Implement** — append to `dark.tsx`:

```tsx
import type { ReactNode } from "react";
export function Index({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-baseline justify-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#F1EEE7]/40">
      <span className="text-[#F1EEE7]/70">{n}</span>
      <span className="h-px w-8 bg-current opacity-40" />
      <span>{label}</span>
      <span className="w-2 h-2 bg-[#FDDA24] self-center" />
    </div>
  );
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(theme): shared dark Index section header"`

---

## Task 3: Rewrite the landing to consume home.tsx through the dark theme

**Files:**
- Modify: `apps/web/src/pages/LandingV2.tsx` (full rewrite of the render; remove inline `COPY`)
- Read for reference: `apps/web/src/copy/home.tsx` (the `homeCopy: Record<Lang, HomeStrings>` data source)

This is the core task. Render each `HomeStrings` field in section order, on dark tokens. No new copy invented — only consume `home.tsx`.

- [ ] **Step 1: Swap the data source.** Replace the entire inline `const COPY = {...}` and `type Lang` with:

```tsx
import { homeCopy } from "../copy/home.tsx";
import { useLang } from "../lib/lang.ts"; // if a lang hook exists; else keep the local useState lang pattern from the old file
import { TOKENS, cx, mark, Index } from "../theme/dark.tsx";
// const t = homeCopy[lang];
```
If `../lib/lang.ts` exports no hook, keep the existing `useState<Lang>` + `localStorage("slippay.lang")` pattern from the current `LandingV2.tsx` (lines 153–158) — it works; just point `t` at `homeCopy[lang]`.

- [ ] **Step 2: Rebuild the page body** section-by-section, mapping `HomeStrings` fields to dark sections. Order (from spec §4.1): hero → plain-words → pain (`gap`) → loss calculator (`calc`, use existing `SavingsSimulator` component if wired, else render the `calc` strings) → how-you-use-it (`howto`) → how-it's-different (`proof`) → built-for-what's-next (`standard`) → honest status (`status`) → CTA (`cta`) → footer (`footer`). Use:
  - page wrapper: `<div className={cx.page}>`
  - each section: `<section className={cx.sec}><div data-reveal className="max-w-[900px] mx-auto px-6 md:px-12 py-24 md:py-36">…</div></section>`
  - section header: `<Index n="001" label={t.proof.label.replace(/^┃\s*/, "")} />` (strip the leading `┃` glyph the copy uses)
  - headings: `<h2 className="mt-10 font-bold tracking-[-0.04em] leading-[0.92] text-[clamp(2rem,6vw,3.75rem)]" style={{fontFamily:"'DM Sans',sans-serif"}}>{t.section.h2}</h2>`
  - hero right column: keep `<LivePaymentCard />` (the proof card — operator decision 2026-06-13), wrapped with `<div className={cx.label}>{t.hero.badge}</div>` above it.
  - CTA button: `<Link to="/account" className={cx.btn}>{t.cta.button}</Link>`
  - keep the PT/EN `LangToggle`, the sticky header, and the mobile menu from the current file, recolored to dark (bg `#0E0D0B`/85, borders `#F1EEE7`/8).
  - the builder bridge: render `t.bridge.line` + a `<Link to="/builders" className={cx.link}>{t.bridge.button}</Link>` low on the page (zero-tech, per spec).

- [ ] **Step 3: Honesty guard — render-time.** Do NOT add any string not present in `home.tsx`. The honest framing (early-access, domestic-only, testnet) lives in the copy; rendering it verbatim preserves it. Keep the mainnet proof links (`status.mainnetContract/Tx/Bio`) pointing at the existing stellar.expert URLs.

- [ ] **Step 4: Build green.**

Run: `cd apps/web && npm run build`
Expected: exits 0, no TS errors. Fix any type mismatch between `HomeStrings` fields and your JSX (e.g. `ReactNode` vs `string`).

- [ ] **Step 5: Visual check on dev server.**

Run: `cd apps/web && npm run dev` then open the printed localhost URL. Verify: dark ground, bone text, yellow CTAs only, numbered sections, hero proof card, PT/EN toggle works, no bone-light leftover background, no KLEIN blue.

- [ ] **Step 6: Commit** — `git commit -am "feat(landing): dark yeezy rebuild on honest home.tsx copy"`

---

## Task 4–9: Flow page dark restyle (one task each, identical procedure)

Each flow page gets the SAME mechanical restyle. No logic edits — only className/color swaps. Procedure per page:

**Token swap table (apply to every flow page):**

| Find (light) | Replace (dark) |
|---|---|
| `bg-[#f1eee7]` / `bg-[#f1eee7]/xx` | `bg-[#0E0D0B]` / `bg-[#0E0D0B]/xx` |
| `text-[#0a0a0a]` (primary text) | `text-[#F1EEE7]` |
| `text-[#0a0a0a]/NN` (dim text) | `text-[#F1EEE7]/NN` |
| `border-[#0a0a0a]/NN` | `border-[#F1EEE7]/NN` |
| raised card `bg-white`/`bg-[#fff]` | `bg-[#16140F]` |
| accent `#FDDA24` | unchanged (keep yellow) |
| `GRAY = "#6f6862"` | `"#F1EEE7"` at 40% → replace usages with `text-[#F1EEE7]/40` |

For each page, prefer importing `TOKENS`/`cx` from `../theme/dark.tsx` for buttons and labels rather than re-declaring inline.

- [ ] **Task 4: `/pay` — `apps/web/src/pages/PayDemo.tsx`** (337 lines)
  - Apply the token swap table. Preserve any testnet labeling/disclaimer strings verbatim (honesty).
  - Build green: `npm run build`. Dev-server click-through: the scan/pay UI still renders and the QR/scan flow still works (no logic change).
  - Commit: `git commit -am "style(pay): dark yeezy restyle"`

- [ ] **Task 5: `/cobrar` — `apps/web/src/pages/Cobrar.tsx`** (97 lines)
  - Token swap table. Build green. Verify the receive/QR generation still renders.
  - Commit: `git commit -am "style(cobrar): dark yeezy restyle"`

- [ ] **Task 6: `/checkout/:order_id` — `apps/web/src/pages/Checkout.tsx`** (214 lines)
  - Token swap table. Build green. Verify checkout renders with a sample order id on the dev server.
  - Commit: `git commit -am "style(checkout): dark yeezy restyle"`

- [ ] **Task 7: `/comprovante/:txhash` — `apps/web/src/pages/Comprovante.tsx`** (429 lines)
  - Token swap table. This is the largest flow page — work top-down, re-run build after each screenful of edits. Verify the receipt + on-chain links still render.
  - Commit: `git commit -am "style(comprovante): dark yeezy restyle"`

- [ ] **Task 8: `/account` — `apps/web/src/pages/Account.tsx`** (163 lines)
  - Token swap table. Build green. Verify the account/login entry renders; biometric/passkey CTA still wired.
  - Commit: `git commit -am "style(account): dark yeezy restyle"`

- [ ] **Task 9: `/buy` + `/comprar` — `apps/web/src/pages/Buy.tsx`** (148 lines)
  - Token swap table. Build green. Verify the buy flow renders.
  - Commit: `git commit -am "style(buy): dark yeezy restyle"`

---

## Task 10: Re-tokenize index.css light hardcodes

**Files:**
- Modify: `apps/web/src/index.css`

- [ ] **Step 1:** Find light-valued hardcodes that assume a bone background and fix them for dark:
  - `.scroll-progress { background: #A16207; }` → keep or switch to `#FDDA24` (yellow reads on dark). Use `#FDDA24`.
  - `.slip-range` track/thumb use `#0a0a0a` (ink) — on dark these vanish. Change thumb `background: #0a0a0a` → `#F1EEE7`; track `rgba(10,10,10,0.18)` → `rgba(241,238,231,0.18)`.
  - Leave all keyframes (coin-drop, pig-*, gold-*, mask-up, etc.) intact — they are transform/opacity based and palette-agnostic.

- [ ] **Step 2: Build green** — `npm run build`.

- [ ] **Step 3: Visual check** — scroll progress bar + any range slider (SavingsSimulator) are visible on dark.

- [ ] **Step 4: Commit** — `git commit -am "style(css): re-tokenize light hardcodes for dark"`

---

## Task 11: Honesty lint test (codify the non-negotiables)

**Files:**
- Create: `apps/web/src/copy/honesty.test.ts`

- [ ] **Step 1: Write the test** — fails if forbidden claims reappear in `home.tsx`.

```ts
// apps/web/src/copy/honesty.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./home.tsx", import.meta.url), "utf8");

describe("home.tsx honesty guardrails", () => {
  it("makes no cross-border / remittance claim", () => {
    expect(src).not.toMatch(/remessa|remittance|cross-border|envia(r)? pra fora|send abroad/i);
    // (the copy may say "no sending abroad" / "sem remessa pra fora" as a NEGATION —
    //  allowlist those exact negations if this trips; the point is no positive claim)
  });
  it("does not present the Pix loop as live today", () => {
    expect(src).not.toMatch(/use hoje|use it today|pague suas contas sozinho hoje/i);
  });
  it("keeps early-access framing present", () => {
    expect(src).toMatch(/early access|acesso antecipado/i);
  });
});
```
Note: if the negation-allowlist trips test 1 (the copy legitimately says "sem remessa pra fora" / "no sending abroad"), refine the regex to target positive claims only (e.g. require a verb like "enviamos/we send" without "não/no"). Adjust to GREEN against the current honest copy — the test encodes intent, the current copy must pass.

- [ ] **Step 2: Run** — `npx vitest run src/copy/honesty.test.ts`. Tune regexes until the current honest copy PASSES and an injected bad string would FAIL (sanity-check by temporarily adding "use hoje" and seeing red, then remove).

- [ ] **Step 3: Commit** — `git commit -am "test(copy): honesty guardrail lint"`

---

## Task 12: Full build + deploy dry-run

- [ ] **Step 1: Full green gate**

```bash
cd apps/web && npm run lint && npm run test && npm run build
```
Expected: tsc clean, vitest all pass, vite build exits 0.

- [ ] **Step 2: Local preview smoke** — `npm run preview`, click every in-scope route (`/`, `/pay`, `/cobrar`, `/checkout/test`, `/comprovante/test`, `/account`, `/buy`). All dark, all functional.

- [ ] **Step 3: Deploy (ONLY after operator says go).** Per `reference_slippay_deploy`:

```bash
# build already done above; rsync dist to prod
rsync -avz --delete apps/web/dist/ manuel@165.22.10.194:/opt/slippay-backend/apps/web/dist/
```
Then verify live (no-store, real hash change):

```bash
curl -s -o /dev/null -w 'live %{http_code}\n' https://app.slippay.cc/
curl -s -H 'Cache-Control: no-store' https://app.slippay.cc/ | grep -o 'index-[A-Za-z0-9_]*\.js' | head -1
```
Confirm the bundle hash changed vs P3 baseline. Do NOT claim deployed until the hash differs and HTTP 200 (memory: dont-blame-cache, verification-before-completion).

- [ ] **Step 4: Final commit / PR** — only if operator asks; this repo's default is commit-on-request.

---

## Self-Review (author checklist — completed)

**Spec coverage:**
- Aesthetic tokens → Task 1. Shared chrome → Task 2. Landing rebuild + copy migration → Task 3. Flow restyle (6 pages) → Tasks 4–9. index.css dark → Task 10. Honesty guardrails → Task 11 (codified) + Task 3 step 3 (render-time). Deploy → Task 12. Brand separation (no KLEIN) → Task 1 test. ✓ all spec sections mapped.

**Placeholder scan:** No "TBD/TODO". Flow tasks use a concrete token-swap table rather than fake per-line JSX (honest: exact JSX for 1388 lines of flow pages would be fabricated; the table is mechanically applicable). Landing task gives field-by-field mapping to real `HomeStrings` keys.

**Type consistency:** `TOKENS`, `cx`, `mark`, `Index` names are consistent across Tasks 1–9. `dark.ts` becomes `dark.tsx` in Task 2 (flagged) — all imports reference `../theme/dark.tsx` thereafter.

**Known risk:** local↔prod divergence (P3) — if live already differs from this repo, reconcile before Task 3. Lang hook assumption (Task 3 step 1) has a fallback to the existing useState pattern.
