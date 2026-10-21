> **Historical / inaccurate.** Superseded by `docs/ops/deploy.md`. The Vercel +
> GitHub Actions flow described below was never the real deploy mechanism. The
> system runs on a single VPS under PM2 + nginx, with the web app built locally
> and rsynced to the server. Do not follow this document for deploys.

# Deploy secrets · operator setup

This document is the **one-time setup checklist** to take SlipPay from local
dev to a public testnet URL. Run it once, then `git push origin main` triggers
the full deploy via `.github/workflows/deploy-staging.yml`.

## Tally

| Surface | Provider | Cost (testnet/staging) | Setup time |
|---|---|---|---|
| Frontend (`apps/web`) | Vercel | $0 (Hobby) | ~10 min |
| API (`supabase/functions/api`) | Supabase | $0 (free tier) | ~10 min (project init) |
| Database | Supabase Postgres | $0 | shared with API |
| Listener (`apps/listener`) | Fly.io | ~$2/mo (shared-cpu-1x 256mb) | ~10 min |
| **Total monthly** | | **~$2** | **~30 min** |

---

## 1. GitHub repo

```sh
gh auth login                      # if not already
gh repo create slippay --private --source=. --push
```

After this, every push to `main` triggers `test.yml` then `deploy-staging.yml`.

## 2. Supabase staging project

Create one project on https://supabase.com (region: `sa-east-1` São Paulo).
Note the **Project Ref** (the `xxxxxxxx` slug in `https://xxxxxxxx.supabase.co`).

In Project Settings:
- **Database password** — generate one, save it.
- **Access Token** — Account → Settings → Access Tokens → "GitHub Actions deploy". Save the token.

GitHub repo → Settings → Secrets and variables → Actions → add:

| secret | value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | the personal access token |
| `SUPABASE_STAGING_PROJECT_REF` | the project ref (e.g. `abcdefghijklmnop`) |
| `SUPABASE_STAGING_DB_PASSWORD` | the DB password |

The first deploy will:
- Apply all `supabase/migrations/*.sql` to the project DB
- Deploy `supabase/functions/api` as the Edge Function

## 3. Vercel project

```sh
npm i -g vercel
cd apps/web
vercel link        # creates Vercel project; choose "import existing"
vercel env pull    # confirms config
```

Get the IDs from `apps/web/.vercel/project.json` (created by `vercel link`).
Then in Vercel dashboard → Settings → Environment Variables, set:

| key | value | environment |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<staging-ref>.supabase.co` | Production |
| `VITE_SUPABASE_ANON_KEY` | (from Supabase Project Settings → API) | Production |
| `VITE_API_BASE` | `https://<staging-ref>.supabase.co/functions/v1/api` | Production |
| `VITE_STELLAR_NETWORK` | `TESTNET` | Production |
| `VITE_PLATFORM_ADDRESS` | (Stellar testnet keypair pub key — see §5) | Production |

GitHub Actions secrets:

| secret | value |
|---|---|
| `VERCEL_TOKEN` | https://vercel.com/account/tokens → create one |
| `VERCEL_ORG_ID` | from `apps/web/.vercel/project.json` |
| `VERCEL_PROJECT_ID` | same file |

## 4. Fly.io listener app

```sh
brew install flyctl       # or curl -L https://fly.io/install.sh | sh
flyctl auth login

cd apps/listener
flyctl launch --name slippay-listener-staging --region gru --no-deploy --copy-config
# answers: do NOT add Postgres, do NOT add Redis, do NOT deploy yet

flyctl secrets set \
  SUPABASE_URL="https://<staging-ref>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="(from Supabase API settings)" \
  STELLAR_NETWORK="TESTNET" \
  --app slippay-listener-staging
```

GitHub Actions secret:

| secret | value |
|---|---|
| `FLY_API_TOKEN` | `flyctl auth token` (paste output) |

## 5. Platform Stellar testnet keypair

The atomic tx splits buyer payment into [merchant_share, platform_fee]. The platform leg
needs a Stellar testnet address that has a USDC trustline.

```sh
node -e "
const { Keypair } = require('@stellar/stellar-sdk');
const k = Keypair.random();
console.log('PUBLIC KEY:', k.publicKey());
console.log('SECRET:    ', k.secret());
"
```

Save the secret somewhere safe (1Password, Bitwarden — NOT git). Fund the address via Friendbot:

```sh
curl "https://friendbot.stellar.org/?addr=<PUBLIC_KEY>"
```

Add the USDC trustline (one-time, signed by the secret):

```sh
# Use the e2e helper or Stellar Lab to send a changeTrust op
# See: https://laboratory.stellar.org → Build Transaction → Operation: Change Trust
# Asset code: USDC
# Issuer: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5  (Circle testnet)
```

Set `VITE_PLATFORM_ADDRESS` in Vercel env (step 3) to the public key.

## 6. First deploy

```sh
git push origin main
```

CI runs:
1. `test.yml` — lint + workspace tests + edge function tests + builds. Must pass.
2. `deploy-staging.yml` — supabase (DB push + functions deploy) → vercel + fly in parallel.

Watch:
- Vercel: dashboard build log
- Supabase: project Functions → Logs
- Fly: `flyctl logs --app slippay-listener-staging`

## 7. First merchant smoke

Once the URL is live (e.g. `https://slippay-staging.vercel.app`):

```sh
# 1. Sign up via /signup
# 2. /dashboard onboards merchant, reveals API key
# 3. /dashboard/settings: set Stellar testnet address (with USDC trustline)
# 4. Create order:
curl -X POST "https://<staging-ref>.supabase.co/functions/v1/api/v1/orders" \
  -H "authorization: Bearer sk_live_..." \
  -H "content-type: application/json" \
  -d '{"brl_amount":"10.00"}' | jq

# 5. Open the returned checkout_url in browser with Freighter testnet wallet,
#    sign the atomic tx
# 6. Watch Fly listener logs for order_reconciled
# 7. Dashboard /orders flips to status=paid
```

## Failure modes by step

| Step fails because | Symptom | Fix |
|---|---|---|
| supabase db push hits old migrations | "migration X already applied" | first push: run `supabase migration repair --status applied` against the missing IDs OR drop the staging DB and start fresh |
| vercel SPA rewrites broken | /checkout/<id> returns 404 | confirm `apps/web/vercel.json` exists in the deploy artifact |
| fly listener crashloops | logs say "missing env SUPABASE_*" | re-run `flyctl secrets set ...` |
| webhook fires to merchant but signature doesn't validate | merchant rejects | confirm the merchant uses the same `webhook_secret` returned by POST /v1/merchants — it is per-merchant, not global |

---

## Reference: env var matrix

| Var | Where | Set by |
|---|---|---|
| `SUPABASE_URL` | listener (Fly) + functions (Supabase auto-injects) | flyctl secrets / Supabase auto |
| `SUPABASE_SERVICE_ROLE_KEY` | listener (Fly) + functions (auto-injected, do NOT override) | flyctl secrets / Supabase auto |
| `SUPABASE_ANON_KEY` | functions (auto-injected) | Supabase auto |
| `VITE_SUPABASE_URL` | web (Vercel) | Vercel env |
| `VITE_SUPABASE_ANON_KEY` | web (Vercel) | Vercel env |
| `VITE_API_BASE` | web (Vercel) | Vercel env |
| `VITE_STELLAR_NETWORK` | web (Vercel) | Vercel env |
| `VITE_PLATFORM_ADDRESS` | web (Vercel) | Vercel env |
| `STELLAR_NETWORK` | listener (Fly) | flyctl secrets / fly.toml [env] |
| `MERCHANT_POLL_MS` | listener (Fly, optional, default 30000) | fly.toml [env] |
