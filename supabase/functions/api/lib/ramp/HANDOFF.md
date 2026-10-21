# Off-ramp (USDC → BRL/Pix) — handoff

Status: **built, deployed, dormant.** Live route `GET /api/v1/offramp/status`
returns `{"enabled":false}` until you plug the key. Everything below is wired.

## To go live, you only add the key

Edit `/opt/slippay-backend/.env` and add:

```
ETHERFUSE_ENABLED=1
ETHERFUSE_API_KEY=<key from devnet.etherfuse.com or the Etherfuse Telegram>
# sandbox is the default; for production also set:
# ETHERFUSE_BASE_URL=https://api.etherfuse.com
```

Then:

```
cd /opt/slippay-backend && pm2 reload ecosystem.config.cjs --only slippay-api && pm2 save
```

Verify: `curl -s https://api.slippay.cc/api/v1/offramp/status` should now show
`"enabled":true` with provider `etherfuse`.

## What's wired

- `lib/ramp/types.ts` — provider-agnostic `Anchor` interface + DTOs (so we can
  swap Etherfuse → Copperx later without touching routes).
- `lib/ramp/etherfuse/` — the Etherfuse client (ported from the pix-demo,
  Deno-adapted). Implements `Anchor`.
- `lib/ramp/index.ts` — env-driven factory. Dormant unless ENABLED + key.
- `routes/offramp.ts` — mounted at `/api/v1/offramp`:
  - `GET  /status`              public; {enabled, provider, currencies, rails}
  - `POST /quote`              USDC→BRL (or BRL→USDC) quote
  - `POST /customer`           create Etherfuse customer (wallet-keyed)
  - `GET  /kyc-url`            hosted KYC iframe URL
  - `GET  /customer/:id/kyc`   KYC status
  - `GET  /customer/:id/fiat-accounts`
  - `POST /order`              create off-ramp order (returns unsigned tx —
                               user's passkey wallet signs + submits)
  - `GET  /order/:id`          order status (poll to settlement)
  - `GET  /assets`             diagnostic: confirms USDC:GA5ZSEJY... on Stellar
- `test/ramp.test.ts` — factory on/off + USDC→BRL quote mapping (4 tests green).

## Confirmed facts

- Etherfuse `/ramp/assets` returns USDC directly on Stellar
  (`USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`, Circle's
  mainnet issuer). **No TESOURO swap needed** — off-ramp is USDC → BRL direct.
- Off-ramp is deferred-signed (capabilities.deferredOffRampSigning) and KYC is
  hosted (iframe).

## Still to confirm with Etherfuse (Telegram)

1. Is the **BRL/Pix corridor with USDC as source** live in **production**
   (not just sandbox)? Docs show USD/EUR/MXN fiat examples; BRL is newer.
2. Get the **production** API key when that corridor is GA.

## Remaining frontend work (separate from this backend)

The web app needs the cash-out UI: read `/offramp/status`, run the
customer→KYC→quote→order flow, and sign the returned tx via the existing
passkey/relayer path. Not built yet.
