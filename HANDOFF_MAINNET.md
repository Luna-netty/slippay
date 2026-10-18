# SlipPay — mainnet handoff & deploy plan (2026-06-06)

Pick-up doc for the next session. Honest state + exact next steps. Nothing here is
hype: revenue is **$0**, no external users yet. The machine is built and proven on
mainnet; the one thing between "ready" and "earning" is **funding a real user's
wallet** (TASK 1 below).

---

## 0. How to deploy (frontend)
Frontend lives in this repo (`apps/web`), built locally and **rsync'd** to prod
(NOT Vercel/CI). One command:

```bash
bash scripts/deploy-web.sh        # typecheck + build + rsync + verify + route smoke
```

- Prod web root: `manuel@165.22.10.194:/opt/slippay-backend/apps/web/dist/`
- Site: https://app.slippay.cc  (serves index.html no-store → rendered = current deploy)
- Branch: `sync/docs-and-state-2026-06-05` (commit + push there).

Prod backend (api/relayer/scheduler) is a **separate Deno app on the same box**
(`/opt/slippay-backend`), run by **pm2**: `slippay-api`, `slippay-relayer`,
`slippay-scheduler`, `slippay-listener`, `slippay-attester`. Edit via `ssh manuel@165.22.10.194`.

---

## 1. Live facts (verify before quoting)
- Mainnet gate contract: `CCT3KJXRUO3HJJ2GLTW2MISSQVUEKOPUG3B4YQH75TCGKAOC4P6FIKUF`
- Relayer (PUBLIC): `https://api.slippay.cc/api/v1/relayer/info` → sponsor
  `GBI4NVNPTTXAQ7BTR6PSZYFRYFDFBGYR7DNGIQJF3SSSVEF7PRXMIEBU`, cap 5000000 stroops (0.5 USDC).
- Platform / team USDC recipient: `GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P`
- Proven tx (attested): `ede13fb6230334af91b2af1cfab92f86f8f44e8a7755acb57d92891d68a3e957`
- On-ramp: Transak (Pix→USDC→stellar), key `VITE_TRANSAK_API_KEY` in `apps/web/.env.production`.

## Revenue streams (state)
1. **Rail fee** (~0.3%, `fee_bps` in the subscription contract) — fires only when money moves. Live in contract.
2. **Attestation/compliance** (monetize the gate, merchant-side) — not metered yet (TASK 3).
3. **FX spread** (~1%, the 10x lever) — **built**: `apps/web/src/lib/quote.ts` (live USD/BRL × spread) + `/buy` page + `recordConversionIntent`. **Captures $0 until TASK 1 + a licensed FX anchor/rev-share** (today Transak keeps its margin).

---

## TASK 1 — UNBLOCK FUNDING: on-ramp → C-address  ★ the unlock
**Problem (root cause of the `/pay` failure):** a freshly relayer-deployed wallet is
a **contract (C…) address with 0 USDC**. On-ramps (Transak) typically settle to a
classic **G…** account, not a contract. So the wallet never gets funded → `/pay`
reverts at simulation ("this wallet has no USDC yet"). Until this is fixed, **no
revenue stream can fire** (spread/card/agent all need funded wallets).

**Fix (relayer, prod Deno):** add a forward path.
1. Deposit lands on a relayer-controlled **G-address** with a USDC trustline (the
   `walletAddress` passed to Transak = this G-address, not the C-wallet).
2. A watcher (or the existing `slippay-listener`) detects the incoming USDC payment.
3. Relayer **forwards** the USDC from the G-address to the user's **C-wallet** via a
   Stellar Asset Contract `transfer` (or classic payment if the C-wallet has a
   classic balance entry — note: Soroban SAC lets contract addresses hold USDC
   WITHOUT a classic trustline, so transfer to the C-address works).

Sketch (adapt to actual relayer.ts on prod):
```ts
// POST /api/v1/relayer/onramp/forward  { gAddress, walletId, amount }  (or event-driven)
// 1. confirm USDC received on gAddress (Horizon payments)
// 2. build SAC transfer(gAddress -> walletId, amount) signed by the G-address key
// 3. submit; return tx hash
```
Also: map the Transak deep-link `walletAddress` to the relayer G-address + a memo/ref
that ties the deposit to the user's `walletId` (so the forward knows the destination).

**Verify (final step needs a real Pix — operator does this):**
- Create an account at `/account` (one tap).
- `/buy` → small amount (e.g. R$ 50) → Pix → confirm USDC lands in the **C-wallet**
  (check balance on stellar.expert for the C-address).
- Then `/pay` a tiny amount → should now succeed (was the bug).

**Frontend is already ready:** `/buy` quotes + `buildOnrampUrl` deep-links; once the
relayer forwards to the C-wallet, the loop closes with no frontend change.

---

## TASK 2 — spread margin ledger (measure revenue per conversion)
Frontend already POSTs each conversion intent. Add the backend sink:
```ts
// POST /api/v1/onramp/intent  { brlIn, midRate, quotedRate, spreadBps, usdcOut, marginUsd, walletId, ts }
// append to a JSONL or a Supabase `conversions` table; sum marginUsd = FX revenue.
```
(Best-effort on the client — if absent it no-ops. Adding it starts measuring margin.)

Config: set `VITE_FX_SPREAD_BPS` in `apps/web/.env.production` to tune the spread
(default 100 = 1.00%). Rebuild + redeploy after changing.

---

## TASK 3 — merchant/agent-side metering (monetize the proof)
The contract already takes `fee_bps` to the platform on each charge. Build the meter:
per-merchant ledger of attested charges + fees accrued + a usage/invoice view in
`/dashboard`. (Measures zero until there's real agent volume — but it's the
foundation for the agent-economy revenue lane.)

---

## NOT now (need partners/licenses, not code)
- **Card + interchange** (biggest ARPU multiplier — Cash App ~$81/active, 70% interchange): needs BIN/issuer + license.
- **Yield on float** (Circle model, $2.6B/yr reserve income): needs custody decision + yield venue + license; conflicts with non-custodial (offer opt-in "Earn" tier).

---

## Regulatory guardrail
BCB Res 561 (May 2026) bans stablecoin in **cross-border** settlement → the legal
lane is **domestic** (hold dollars + agent payments). Keep copy USDC-explicit and
domestic; avoid remittance/cross-border framing in product claims.

---

## Frontend state (all deployed, theme done)
- Design system: warm bone `#f1eee7`, ink text, gray accent `#6f6862`, yellow
  `#FDDA24` as details + ALL CTAs yellow, yellow logo dot, USDC keyword marker.
  Applied system-wide (landing + gate/security/cockpit/manifesto/account/pay/cobrar/
  comprovante/dashboard + investors).
- Landing hero: headline `Dólar digital` / `Digital dollars` (bilingual, plain),
  sub "Pix in. USDC out…" with USDC marked, credibility row + "built on real rails
  in Brazil" microcopy. Bilingual PT/EN toggle persisted in `localStorage["slippay.lang"]`.
- New: `/buy` (FX quote converter), `/investors` (honest, pre-revenue traction).

## Security hygiene
- Rotate the Exa API key that was pasted in chat (`313b48b4-…`) at the Exa dashboard.
- Transak **API secret** stays server-only (`/opt/slippay-backend/.env.transak`), never in the repo.
