# Web locale strategy (PT/EN) and the canonical route set

The web surface is bilingual: **Portuguese (`pt`) is primary**, English (`en`)
is the secondary mirror. This page is the locale contract — which locales are
supported, how the choice is detected and persisted, which routes are
canonical, and which duplicate or legacy routes are kept and why. Read it
before adding a third language or an a11y pass.

Source: `apps/web/src/lib/lang.ts`, `apps/web/src/copy/home.tsx`,
`apps/web/src/App.tsx`, `apps/web/src/lib/darkTheme.ts`.
Tests: `apps/web/src/lib/lang.test.ts`, `apps/web/src/lib/darkTheme.test.ts`.

## Supported locales

| Locale | `Lang` value | Role |
|---|---|---|
| Portuguese (Brazil) | `"pt"` | Primary and the default. The audience — Brazilians who earn in dollars — reads Portuguese. |
| English | `"en"` | Secondary mirror for the global investor/builder audience. |

- The only legal values are `pt` and `en` (`Lang = "pt" | "en"` in
  `apps/web/src/lib/lang.ts`). There are no region variants in the value
  (`pt-BR` appears only as the `<html lang>` attribute).
- The locale is global UI-copy state, **not** part of the URL: no route carries
  a `/pt/…` or `/en/…` prefix.
- Bilingual copy lives in `apps/web/src/copy/home.tsx` as
  `homeCopy: Record<Lang, HomeStrings>` — both registers share the same shape,
  markup-bearing strings are JSX nodes so emphasis survives translation. PT
  voice rules (`você`, never creole `tu`) are documented at the top of that
  file.
- Pages that render both registers read the locale through `useLang()`
  (`Home.tsx`, `Agents.tsx`, `Comprovante.tsx`) or through the legacy inline
  mechanism described under [Persistence](#persistence).

## Detection (`detectLang`)

`detectLang()` resolves in this order:

1. **No `window`** (SSR, tests) → `"pt"`.
2. **Stored value** under the key `slippay_lang` — used only when it is exactly
   `"pt"` or `"en"` → that value wins over the browser.
3. **Browser**: `navigator.language` starting with `en` (case-insensitive) →
   `"en"`, otherwise → `"pt"`.

Rules that follow from the code and are pinned by tests:

- An unsupported or corrupted stored value (`"fr"`, `""`, `"PT"`, anything
  else) is **ignored**; detection falls through to the browser rule. Nothing
  non-canonical is ever persisted back.
- The default is PT even for a non-PT, non-EN browser (`fr-FR`, `es-ES`, …):
  only an explicitly English browser flips to EN.
- If storage access throws (private mode, storage disabled), detection falls
  back to the browser rule instead of failing the page.

## Persistence

- **Canonical key: `slippay_lang`.** It is written only by `persistLang()`,
  which `useLang()`'s setter calls. Writes of unsupported values are dropped;
  storage failures are ignored (private mode must not crash the page).
- `useLang()` also mirrors the choice onto `document.documentElement.lang`
  (`"pt-BR"` for `pt`, `"en"` for `en`).
- **Legacy key: `slippay.lang`.** Seven pages predate the helper and inline
  the same read/write logic with the same validation: `LandingV2`, `LandingV3`,
  `Gate`, `Empresas`, `Receber`, `Manifesto`, `Security`. Within that family
  the choice is shared (they all read and write `slippay.lang`), and the
  landing's language toggle is what those pages mean by "shares the landing's
  language choice".
- **Known gap, documented on purpose:** the two keys are independent — a
  toggle on a `useLang()` page persists only under `slippay_lang`, and a
  toggle on a legacy page only under `slippay.lang`, so the stores can
  disagree. New code must use `useLang()` / `persistLang()`. Unifying the
  seven legacy pages onto the helper (with a one-time read fallback to
  `slippay.lang`) is follow-up work; the split is documented here rather than
  migrated in the same change that pins the contract.

## Theme: `lib/darkTheme.ts` has no persistence

`apps/web/src/lib/darkTheme.ts` is a **static token module**: the `DARK`
palette and the `dk` Tailwind class fragments shared by the dark pages. There
is no theme toggle, no `prefers-color-scheme` listener, and no
localStorage read or write — the theme is chosen per page at author time.
`darkTheme.test.ts` pins the token values, keeps `dk` consistent with `DARK`,
and asserts that importing the module touches no storage.

## Canonical routes

Rule of thumb reflected by the router (`apps/web/src/App.tsx`): public
marketing surfaces use the PT name as canonical (`/receber`, `/cobrar`,
`/empresas`, `/seguranca`, `/conformidade`, `/loja`); account and utility
surfaces are language-neutral or EN (`/login`, `/dashboard`, `/docs`,
`/account`, `/builders`, `/investors`). Both `Investidores` and `Investors`
are **not** both canonical: `/investors` (page `Investors.tsx`, EN) is the one
canonical investor route.

| Canonical route | Page | Register |
|---|---|---|
| `/` | `LandingV2` | PT-primary bilingual landing |
| `/receber` | `Receber` | PT funnel (no EN alias exists) |
| `/cobrar` | `Cobrar` | PT-named, merchant QR surface |
| `/comprovante/:txhash` | `Comprovante` | public verifier, bilingual |
| `/empresas` | `Empresas` | PT (EN alias `/b2b` below) |
| `/conformidade` | `Conformidade` | PT (EN alias `/compliance` below) |
| `/seguranca` | `Security` | PT path, bilingual page (EN alias `/security` below) |
| `/manifesto` | `Manifesto` | bilingual |
| `/gate` | `Gate` | bilingual |
| `/investors` | `Investors` | EN investor narrative |
| `/loja` | `Store` | PT path, EN page (no EN alias) |
| `/builders` | `Builders` | EN, canonical in both registers |
| `/human` | `Home` | human home, bilingual |
| `/v1` | `AgentHome` | agent/builder home |
| `/v3` | `LandingV3` | versioned landing experiment |
| `/verify`, `/agents`, `/login`, `/signup`, `/account`, `/dashboard/*`, `/docs`, `/s/:subId` | utility | language-neutral |
| `/pay`, `/checkout/:order_id`, `/sub/:id` | transaction flows | language-neutral |
| `/demo`, `/preview`, `/bio`, `/zk`, `/x402-demo`, `/anchor-demo`, `/withdraw-demo` | internal demos | — |
| `/pix-pay`, `/comex`, `/cofre` | feature-flagged (`VITE_PAGFINANCE_ENABLED`, `VITE_COMEX_ENABLED`, `VITE_DEFINDEX_ENABLED`) | — |

## Duplicate and legacy routes kept, and why

Every alias renders the same page as its canonical route — no two URLs serve
different content — so removing any of them only risks breaking inbound links.
They are kept, not accidental:

| Alias | Serves | Why it remains |
|---|---|---|
| `/v2`, `/cofrinho-landing` | `LandingV2` (`/`) | Old experiment/bookmark URLs for the current landing. |
| `/b2b` | `Empresas` (`/empresas`) | EN alias for the PT-canonical B2B page. |
| `/compliance` | `Conformidade` (`/conformidade`) | EN alias for the PT-canonical compliance page. |
| `/security` | `Security` (`/seguranca`) | EN alias; the page header itself documents `/security`. |
| `/investidores`, `/pitch` | `Investors` (`/investors`) | PT alias + old pitch URL. The investor audience is EN, so the EN page is canonical; the PT path stays for inbound links. |
| `/buy`, `/comprar`, `/pix`, `/cash` | `Cash` | Four historical names for one buy-cash page; `/buy` and `/cash` are still linked internally (`Account.tsx`, `PayDemo.tsx`), so all four stay. |

### `Investidores.tsx` — unrouted legacy page

`apps/web/src/pages/Investidores.tsx` (the older PT-only investor narrative)
is **not imported by the router**: `/investidores` renders `Investors.tsx`.
The file is kept as history/reference and must not be re-wired without also
deciding the canonical investor route above. It is dead code by design, which
is why `/investidores` and `Investors` are aliases, not duplicates.

## Adding a third locale

The contract above is what a third language has to touch: the `Lang` union and
`isLang()`/`persistLang()` validation in `lang.ts`, every
`Record<Lang, …>` copy map (starting with `homeCopy`), the `detectLang()`
fallback table, the `<html lang>` mapping, and this route table — plus
deciding whether the seven legacy `slippay.lang` pages migrate first (they
should).

## Tests

```
pnpm --filter @slippay/web test   # vitest — lang.test.ts, darkTheme.test.ts, …
pnpm --filter @slippay/web lint   # tsc --noEmit
```

- `apps/web/src/lib/lang.test.ts` — detection order, persistence round-trip,
  unsupported stored values, storage failures.
- `apps/web/src/lib/darkTheme.test.ts` — default token values, `dk`/`DARK`
  consistency, no storage access.
