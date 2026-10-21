# Landing V3 — infinity-dark + handhold-flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate the existing live dark landing (`LandingV3.tsx`) from flat to motion-led, stealing the dark base + grain + marquee + floating cards from infinitybase.com and the fluid silk accent from handhold.io.

**Architecture:** `LandingV3.tsx` is fully self-contained — all CSS lives in the `V3_CSS` template string injected via a `<style>` block, all JS effects are inline `useEffect` hooks. Every change here is either (a) an edit to the `V3_CSS` string, (b) a small JSX addition, or (c) one new `useEffect`. One new runtime dep: `lenis`. Nothing touches backend, contracts, app routes, or the light consumer/Gate pages.

**Tech Stack:** React + Vite + TypeScript, `motion` (Framer Motion v12, already installed), `lenis` (new), inline CSS, Playwright (system Chrome) for visual verification.

## Global Constraints

- Palette (verbatim): bg `#0a0e1a`, bg2 `#0d1322`, ink `#f3f5fb`, muted `#8a93ad`, cyan `#22d3ee`, cyan2 `#38bdf8`. Gold accent to surface: `rgba(253,218,36,*)`.
- All new CSS classes prefixed `v3-` and live inside the `V3_CSS` string in `LandingV3.tsx`. No new CSS files. No leak outside `.v3`.
- Every animated effect MUST have a `@media(prefers-reduced-motion:reduce)` kill switch and a `@media(max-width:768px)` lighter/static fallback where it risks mobile jank.
- No WebGL / three.js. No serif. No hero photo. No invented partners/claims in copy.
- Marquee content is factual only: `Stellar · USDC · Pix · CCTP · mainnet · on-chain proof · non-custodial · zero-knowledge`.
- Verification gate is VISUAL: Playwright screenshot (desktop 1440 + mobile 390) read by the implementer, plus `npm run lint` (tsc --noEmit) clean. There are no unit tests for visual CSS — do not fabricate them.

---

## Verification harness (shared by all tasks)

The screenshot script already exists at `/tmp/shot.mjs` (playwright-core + system Chrome). To verify against the local dev build:

```bash
# terminal A: start vite (background)
cd /home/galmanus/projects/slippay/apps/web && npm run dev
# note the port it prints (default 5173)

# terminal B: capture + read
node /tmp/shot.mjs "http://localhost:5173/" v3-wip
# then Read /tmp/shots/v3-wip-desktop-fold.png and v3-wip-mobile-fold.png
```

If `/` does not render LandingV3 locally, capture the explicit route the router maps it to (check `App.tsx`; the prototype historically lived at `/v3`). Confirm the live route before first capture.

---

### Task 1: Add Lenis smooth scroll

**Files:**
- Modify: `apps/web/package.json` (add `lenis` dep)
- Modify: `apps/web/src/pages/LandingV3.tsx` (add one `useEffect`, after the existing IntersectionObserver effect ~line 87)

**Interfaces:**
- Consumes: nothing.
- Produces: smooth scroll active on the landing only; torn down on unmount (no RAF leak into app routes).

- [ ] **Step 1: Install Lenis**

```bash
cd /home/galmanus/projects/slippay/apps/web && npm install lenis
```
Expected: `lenis` appears in `package.json` dependencies, no peer warnings that block.

- [ ] **Step 2: Add the smooth-scroll effect**

In `LandingV3.tsx`, immediately after the closing `}, []);` of the existing IntersectionObserver `useEffect` (line ~87), add:

```tsx
  // smooth scroll (landing-scoped, torn down on unmount; respects reduced-motion + mobile)
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let cancelled = false;
    let lenis: { raf: (t: number) => void; destroy: () => void } | null = null;
    import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      lenis = new Lenis({ duration: 1.1, smoothWheel: true });
      const loop = (time: number) => { lenis?.raf(time); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    });
    return () => { cancelled = true; cancelAnimationFrame(raf); lenis?.destroy(); };
  }, []);
```

Dynamic `import("lenis")` keeps it out of the initial bundle and dodges any SSR/eval issues.

- [ ] **Step 3: Lint**

Run: `cd /home/galmanus/projects/slippay/apps/web && npm run lint`
Expected: no TS errors.

- [ ] **Step 4: Visual verify**

Start dev server, capture, and Read the screenshot. Confirm: page scrolls (static screenshot unaffected, but no console errors; scroll feel verified by the absence of layout shift). Confirm `/gate` still uses native scroll (no leak) by navigating there in the same session.

- [ ] **Step 5: Commit**

```bash
cd /home/galmanus/projects/slippay && git add apps/web/package.json apps/web/package-lock.json apps/web/src/pages/LandingV3.tsx && git commit -m "feat(landing): Lenis smooth scroll on V3, reduced-motion guarded"
```

---

### Task 2: Hero fluid ribbon (handhold accent, cyan→gold mesh)

**Files:**
- Modify: `apps/web/src/pages/LandingV3.tsx` — add one `<div>` in the `v3-bg` block (~line 100) and CSS in `V3_CSS`.

**Interfaces:**
- Consumes: nothing.
- Produces: `.v3-ribbon` element behind the hero; surfaces the gold accent for the first time.

- [ ] **Step 1: Add the ribbon element**

In the `v3-bg` block, add `<div className="v3-ribbon" aria-hidden />` as the FIRST child (before `v3-glow-a`), so it sits furthest back:

```tsx
      <div className="v3-bg" aria-hidden>
        <div className="v3-ribbon" />
        <div className="v3-glow v3-glow-a" />
        <div className="v3-glow v3-glow-b" />
        <div className="v3-grid" />
        <div className="v3-grain" />
      </div>
```

- [ ] **Step 2: Add the ribbon CSS**

Append to `V3_CSS` (before the closing backtick):

```css
/* handhold-accent fluid silk ribbon — cyan->gold mesh, no WebGL */
.v3-ribbon{position:absolute;top:-15%;left:0;right:0;height:72vh;z-index:0;pointer-events:none;
  background:
    radial-gradient(38% 60% at 18% 38%, rgba(34,211,238,.30), transparent 62%),
    radial-gradient(44% 56% at 72% 28%, rgba(253,218,36,.15), transparent 62%),
    radial-gradient(34% 50% at 52% 68%, rgba(56,189,248,.24), transparent 62%);
  filter:blur(44px);will-change:transform;
  animation:v3ribbon 24s ease-in-out infinite;}
@keyframes v3ribbon{
  0%,100%{transform:translate3d(0,0,0) scale(1);}
  33%{transform:translate3d(-4%,2%,0) scale(1.08);}
  66%{transform:translate3d(4%,-2%,0) scale(1.04);}}
@media(max-width:768px){.v3-ribbon{animation:none;height:48vh;filter:blur(34px);}}
@media(prefers-reduced-motion:reduce){.v3-ribbon{animation:none;}}
```

- [ ] **Step 3: Lint** — `npm run lint`, expect clean.

- [ ] **Step 4: Visual verify**

Capture desktop + mobile fold. Read both. Confirm: a soft cyan→gold luminous flow is visible behind the H1; gold is present (not just cyan); mobile shows the static version (no animation artifacts), no banding/harsh edges. If it reads muddy against the existing glow blobs, reduce `v3-glow` opacity from `.5` to `.4` in the same file.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/LandingV3.tsx && git commit -m "feat(landing): fluid cyan-gold silk ribbon hero accent (handhold-stolen)"
```

---

### Task 3: Grain + vignette depth (infinity base)

**Files:**
- Modify: `apps/web/src/pages/LandingV3.tsx` — bump `.v3-grain`, add `.v3-vignette` element + CSS.

**Interfaces:**
- Consumes: nothing.
- Produces: `.v3-vignette` element; heavier grain.

- [ ] **Step 1: Add the vignette element**

In `v3-bg`, add `<div className="v3-vignette" />` as the LAST child (after `v3-grain`):

```tsx
        <div className="v3-grain" />
        <div className="v3-vignette" />
      </div>
```

- [ ] **Step 2: Bump grain + add vignette CSS**

Replace the existing `.v3-grain{...}` rule (line ~189) with:

```css
.v3-grain{position:absolute;inset:0;opacity:.08;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}
.v3-vignette{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 240px 50px rgba(0,0,0,.55);}
@media(max-width:768px){.v3-grain{opacity:.05;}}
```

- [ ] **Step 3: Lint** — expect clean.

- [ ] **Step 4: Visual verify**

Capture + read desktop + mobile. Confirm: visible film grain (studio texture, not noise wall), darkened edges focusing the center, no muddiness over text. If text legibility drops, lower vignette spread from `50px` to `30px`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/LandingV3.tsx && git commit -m "feat(landing): real grain + vignette depth (infinity-stolen)"
```

---

### Task 4: Proof marquee (infinity)

**Files:**
- Modify: `apps/web/src/pages/LandingV3.tsx` — add marquee JSX after the hero `</section>` (~line 135), add CSS.

**Interfaces:**
- Consumes: nothing.
- Produces: an infinite ticker strip between hero and features.

- [ ] **Step 1: Add the marquee JSX**

Immediately after the hero `</section>` (line ~135) and before the features section, insert:

```tsx
      {/* proof marquee */}
      <div className="v3-marquee" aria-hidden>
        <div className="v3-marquee-track">
          {[0, 1].map((row) => (
            <div key={row} className="v3-marquee-row">
              {["Stellar", "USDC", "Pix", "CCTP", "mainnet", "on-chain proof", "non-custodial", "zero-knowledge"].map((w) => (
                <span key={w} className="v3-marquee-item">{w}<i className="v3-marquee-sep">·</i></span>
              ))}
            </div>
          ))}
        </div>
      </div>
```

Two identical rows make the `-50%` loop seamless.

- [ ] **Step 2: Add the marquee CSS**

Append to `V3_CSS`:

```css
/* infinity-stolen proof ticker */
.v3-marquee{position:relative;z-index:1;border-top:1px solid var(--line);border-bottom:1px solid var(--line);overflow:hidden;padding:16px 0;
  mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);}
.v3-marquee-track{display:flex;width:max-content;animation:v3marq 34s linear infinite;}
.v3-marquee-row{display:flex;align-items:center;}
.v3-marquee-item{display:inline-flex;align-items:center;gap:22px;font-family:"Space Mono",monospace;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);padding-right:22px;white-space:nowrap;}
.v3-marquee-sep{color:var(--cyan);font-style:normal;}
@keyframes v3marq{to{transform:translateX(-50%);}}
@media(prefers-reduced-motion:reduce){.v3-marquee-track{animation:none;}}
```

- [ ] **Step 3: Lint** — expect clean.

- [ ] **Step 4: Visual verify**

Capture + read. Confirm: a single-line ticker between hero and features, edges faded via mask, words legible, cyan separators. Mobile: confirm it doesn't overflow-break the layout (it should clip cleanly).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/LandingV3.tsx && git commit -m "feat(landing): infinite proof marquee (infinity-stolen)"
```

---

### Task 5: Floating cards asymmetric (infinity)

**Files:**
- Modify: `apps/web/src/pages/LandingV3.tsx` — add CSS only (the stagger delay already exists via inline `transitionDelay`).

**Interfaces:**
- Consumes: existing `.v3-cards` / `.v3-card` (line ~228-234).
- Produces: asymmetric vertical offset on desktop; hover transform preserved (offset via `margin-top`, NOT `transform`, to avoid clobbering the existing `:hover{transform:translateY(-4px)}`).

- [ ] **Step 1: Add the asymmetric-offset CSS**

Append to `V3_CSS`:

```css
/* infinity-stolen asymmetric float — margin (not transform) to preserve hover lift */
@media(min-width:861px){
  .v3-cards{align-items:start;}
  .v3-cards .v3-card:nth-child(2){margin-top:38px;}
  .v3-cards .v3-card:nth-child(3){margin-top:16px;}
}
```

- [ ] **Step 2: Lint** — expect clean.

- [ ] **Step 3: Visual verify**

Capture + read desktop (cards should sit at three different heights, magazine-spread feel) and mobile (single column, offsets collapse — confirm no weird gaps). Hover one card mentally-verified preserved (transform still lifts; margin is independent).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/LandingV3.tsx && git commit -m "feat(landing): asymmetric floating feature cards (infinity-stolen)"
```

---

### Task 6: Integration pass — full-page review + leak check + reduced-motion

**Files:** none (review only; fixes folded back into prior tasks' files if needed).

- [ ] **Step 1: Full-page capture, both viewports**

```bash
node /tmp/shot.mjs "http://localhost:5173/<v3-route>" v3-final
```
Read `v3-final-desktop-full.png`, `v3-final-mobile-full.png`, both folds. Use the scroll-reveal capture (`/tmp/scrollcap.mjs` adapted to the local URL) so reveal sections aren't blank.

- [ ] **Step 2: Effect-soup check (spec failure mode 2)**

Judge against the spec: is the ribbon the ONLY strong-color motion and everything else monochrome? If it reads busy/try-hard, cut the marquee first (revert Task 4), re-capture.

- [ ] **Step 3: Style-leak check (spec failure mode 3)**

Capture `/gate` (the light consumer page). Confirm grain/ribbon/marquee did NOT bleed in (all scoped under `.v3`). If anything leaked, tighten the selector.

- [ ] **Step 4: Reduced-motion check**

Re-capture with reduced motion forced (Playwright context `reducedMotion: 'reduce'`). Confirm: ribbon static, marquee static, reveals shown, page fully legible.

- [ ] **Step 5: Mobile jank sanity (spec failure mode 1)**

On the 390 viewport confirm: ribbon static, grain lighter, no horizontal scroll from the marquee. This is the device Slippay is actually used on.

- [ ] **Step 6: Final lint + commit the plan completion**

```bash
cd /home/galmanus/projects/slippay/apps/web && npm run lint
cd /home/galmanus/projects/slippay && git add -A docs/superpowers && git commit -m "docs(landing): mark V3 infinity-handhold plan complete"
```

- [ ] **Step 7: Hand back to operator**

Do NOT deploy. Per `reference_slippay_deploy`, deploy is build-on-laptop + rsync to prod and is operator-gated. Present the final screenshots and ask whether to ship.

---

## Self-Review

**Spec coverage:**
- Effect 1 ribbon → Task 2 ✓
- Effect 2 grain+depth → Task 3 ✓
- Effect 3 smooth scroll → Task 1 ✓
- Effect 4 marquee → Task 4 ✓
- Effect 5 floating cards → Task 5 ✓
- Mobile fallbacks → in each task's CSS + Task 6 step 5 ✓
- reduced-motion → each task + Task 6 step 4 ✓
- Style-leak guard → Task 6 step 3 ✓
- Effect-soup mitigation → Task 6 step 2 ✓
- No-deploy / operator gate → Task 6 step 7 ✓

**Placeholder scan:** No TBD/TODO. Every code step has literal CSS/TSX. Verification steps name the exact file to Read.

**Type consistency:** Lenis typed inline as `{ raf; destroy }` (Task 1) — matches usage. Class names (`v3-ribbon`, `v3-vignette`, `v3-marquee*`) consistent between JSX and CSS tasks.

**Known adaptation:** No unit tests — this is visual CSS; the gate is screenshot-read + lint, stated in Global Constraints. Honest, not a gap.
