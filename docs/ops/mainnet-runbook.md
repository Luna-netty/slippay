> **Historical reference.** The mainnet deploy described here has been executed:
> the subscription/transfer contracts are live on mainnet (`PUBLIC`). Kept as a
> reference for the deploy procedure. The remaining open step is a v0.3 redeploy
> (the attestation gate, proven on testnet, is not yet on mainnet). For the
> current deploy mechanism, see `docs/ops/deploy.md`.

# slippay mainnet runbook

- **status:** ready to execute
- **prerequisite:** all 6 audits closed at code level (`docs/security/audit-001..006.md`)
- **operator:** Manuel
- **estimated supervised time:** ~3-4h end-to-end, plus 24-72h optional soak on testnet pre-mainnet

## phase 0 · decisions before any command

Pick before phase 1 starts. Each blocks something downstream.

- [ ] **key custody option** (audit-005 S1+S2 · see `docs/security/key-custody.md`)
  - default recommendation: **A · Ledger Nano S Plus**, single signer, paper backup in different physical location
- [ ] **mainnet deployer Stellar address** (will be generated in phase 4)
- [ ] **platform-fee receiver address** — can equal deployer for v0.1, or separate (recommended for separation of duties)
- [ ] **paper backup location** — written down in a private ops file, NOT in this repo
- [ ] **mainnet USDC SAC contract id** — verify on `stellar.expert/explorer/public` before phase 4. Current Circle USDC on Stellar mainnet: confirm latest at `https://www.circle.com/blog/usdc-now-available-on-the-stellar-network` and cross-check with `https://stellar.expert/explorer/public/asset/USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`

## phase 1 · generate new secrets

These two env vars are required by the API process and MUST be set before
`pm2 reload`. Run on the operator's laptop (not the VPS):

```bash
# Audit-004 C2: HMAC secret for checkout_url ?t= tokens
openssl rand -base64 48 | tr -d '\n' | tee /tmp/CHECKOUT_TOKEN_SECRET.txt; echo

# Audit-004 C4: server-side pepper for api_key_hash
openssl rand -base64 48 | tr -d '\n' | tee /tmp/API_KEY_PEPPER.txt; echo
```

Copy each value into the password manager (Bitwarden/1Password) under the
slippay vault. Then upload to the VPS:

```bash
# Append to existing /opt/slippay-backend/.env (do NOT overwrite the file)
ssh manuel@165.22.10.194 'cat >> /opt/slippay-backend/.env' <<EOF
CHECKOUT_TOKEN_SECRET=$(cat /tmp/CHECKOUT_TOKEN_SECRET.txt)
API_KEY_PEPPER=$(cat /tmp/API_KEY_PEPPER.txt)
EOF

# Verify both keys landed (length sanity, do not echo full values)
ssh manuel@165.22.10.194 'awk -F= "/^CHECKOUT_TOKEN_SECRET|^API_KEY_PEPPER/{print \$1\": \"length(\$2)}" /opt/slippay-backend/.env'
# Expected: CHECKOUT_TOKEN_SECRET: 64  / API_KEY_PEPPER: 64
```

After this step, **wipe the tmp files**:

```bash
shred -u /tmp/CHECKOUT_TOKEN_SECRET.txt /tmp/API_KEY_PEPPER.txt
```

## phase 2 · apply DB migrations

Two new migrations from the audit cycle:

- `supabase/migrations/20260516140000_webhook_deliveries_idempotency.sql`
- `supabase/migrations/20260516150000_listener_leases.sql`

Apply them via Supabase CLI from the operator's laptop:

```bash
cd ~/projects/slippay
# Make sure CLI is linked to the production project (aaiiwhmthjtkcartzmku)
pnpm dlx supabase@latest link --project-ref aaiiwhmthjtkcartzmku
pnpm dlx supabase@latest db push
```

Verify both tables exist:

```bash
pnpm dlx supabase@latest db dump --schema public --data-only=false 2>&1 \
  | grep -E 'webhook_deliveries_terminal_unique|listener_leases'
# Expected: both names present
```

## phase 3 · rebuild + redeploy listener

The listener now depends on `undici` and `ipaddr.js` (audit-003 L1). The VPS is
NOT a git checkout — `/opt/slippay-backend` is a plain directory synced from the
laptop via rsync (there is no `deploy` user; deploys run as `manuel`). Build on
the laptop, rsync the tree up, then install + reload on the VPS:

```bash
# 1. From the laptop: build, then rsync the repo to the VPS (excludes vcs/dev/secrets).
#    --checksum makes rsync compare content hashes, not just mtimes, so a rebuilt
#    file with an unchanged timestamp is still transferred.
cd ~/projects/slippay
pnpm -r run build
rsync -az --checksum \
  --exclude node_modules/ --exclude .git/ --exclude '.env*' \
  ./ manuel@165.22.10.194:/opt/slippay-backend/

# 2. On the VPS: install with frozen lockfile + rebuild in place.
ssh manuel@165.22.10.194 'cd /opt/slippay-backend && pnpm install --frozen-lockfile && pnpm -r run build'

# 3. Verify the deployed listener entrypoint matches what was built locally (checksum gate).
#    The listener is tsc-compiled (not bundled); pm2 runs dist/main.js.
sha256sum apps/listener/dist/main.js
ssh manuel@165.22.10.194 'sha256sum /opt/slippay-backend/apps/listener/dist/main.js'
# Expected: identical hashes. If they differ, the rsync did not land — re-run step 1.

# 4. Reload PM2 (zero-downtime; keeps PM2-managed env vars).
ssh manuel@165.22.10.194 'pm2 reload ecosystem.config.cjs --update-env'

# 5. Tail logs for 30s to confirm clean start (no SSRF blowups, no env errors).
ssh manuel@165.22.10.194 'pm2 logs --lines 50 --nostream'
```

**failure modes named:**
- if `API_KEY_PEPPER` is empty, the api process throws "API_KEY_PEPPER not set" on the first authenticated request, returns 500. Fix: re-run phase 1.
- if `CHECKOUT_TOKEN_SECRET` is empty, every order creation throws with "CHECKOUT_TOKEN_SECRET not set or < 32 chars". Fix: re-run phase 1.
- if the listener leases table is missing, `acquireLease` errors and watchAccount is never started. Fix: re-run phase 2.

## phase 4 · contract redeploy on TESTNET with real wallet e2e

audit-002 F5 is the hardest gate: tests use `mock_all_auths_allowing_non_root_auth`
which bypasses the exact auth-chain property that matters on mainnet. Before
mainnet money is in play, we need at least one charge executed against the new
wasm using a real wallet signature.

```bash
# 1. Build the updated wasm
cd ~/projects/slippay/contracts/subscription
cargo build --release --target wasm32v1-none --locked

# 2. Deploy to testnet with the existing slippay-deployer identity
./deploy-testnet.sh
# This writes .testnet-deploy.env with the new CONTRACT_ID and WASM_HASH.

# 3. Generate a fresh buyer/merchant pair OR reuse demo-buyer / demo-merchant
stellar keys ls | grep slippay-demo
stellar keys address slippay-demo-buyer

# 4. Run the demo, but instead of using the testutil mock_all_auths, sign
#    the charge tx WITH the buyer's actual secret. demo-testnet.mjs already
#    does this for the SAC transfer leg — verify the env you ran it in:
node demo-testnet.mjs --verbose
# Expected output: contract id, create() tx hash, charge() tx hash, both
# successful. The charge tx must show the buyer Stellar address signing
# explicitly (no host-auth bypass).

# 5. Capture both tx hashes; paste into DEPLOYED.md.

# 6. Verify on stellar.expert that the charge actually moved tokens from
#    buyer to merchant and that an event "subscription_charged" was emitted
#    with the v0.2 fields.
```

**falsifiable 24h:** if the e2e charge fails with `MissingValue` or auth-related panic,
the v0.1 buyer-signs-each-charge story does NOT work end to end. The contract code
is fine, the operational shape is wrong — pause and revisit `charge()` auth wiring
before mainnet.

## phase 5 · soak on testnet (recommended 24-72h)

Leave the new build running on testnet against the new contract for at least
24h. Watch:

- `pm2 logs --nostream` — no `lease_heartbeat_failed`, no `webhook_*_failed`, no SSRF rejections you didn't expect
- `webhook_deliveries` table — every delivery either `sent` (200) or `failed` retrying on backoff; nothing `dead` from `unsafe_url`
- a synthetic order from the WC plugin v0.2 staging install (`is_available()` returns true on a BRL store with sk_test_... key + secret ≥ 32 chars)

This soak surfaces any drift between the audit-fix unit tests and real-world
Horizon stream + Supabase RLS + WC webhook behavior.

## phase 6 · mainnet deploy

Only after phase 4-5 are green.

```bash
# 1. On a clean machine (or in the operator's air-gapped environment):
#    generate the mainnet deployer per the chosen custody option.
#    For option A (Ledger):
stellar keys generate --hd-path "m/44'/148'/0'" slippay-mainnet-deployer
# (or `stellar keys add` if importing from Ledger directly)

# 2. Fund the deployer account.
#    Buy ~30 XLM on MercadoBitcoin/Foxbit, withdraw to:
stellar keys address slippay-mainnet-deployer

# 3. Wait for the deposit to confirm on stellar.expert mainnet, then:
cd ~/projects/slippay/contracts/subscription
NETWORK=mainnet DEPLOYER_NAME=slippay-mainnet-deployer ./deploy-testnet.sh
# (the script is misnamed historically; NETWORK env switches it)

# 4. Capture CONTRACT_ID_MAINNET + WASM_HASH_MAINNET.
#    Set `SLIPPAY_SUBSCRIPTION_WASM_HASH_MAINNET` in GitHub Actions vars so
#    future signed-tag deploys assert against it (audit-005 S5).

# 5. Update merchant rows on Supabase to set network='mainnet' on the
#    intended merchants only. Manual review per merchant — KYC pass + agreed
#    pricing must be in place.
echo "UPDATE merchants SET network='mainnet' WHERE id IN (...);" | \
  pnpm dlx supabase@latest db query

# 6. Flip the listener config:
ssh manuel@165.22.10.194 'sed -i "s/^STELLAR_NETWORK=.*/STELLAR_NETWORK=mainnet/" /opt/slippay-backend/.env && pm2 reload ecosystem.config.cjs --update-env'

# 7. Run a real $1 USDC test order against the WC v0.2 plugin staging install
#    pointing at mainnet. Verify webhook fires with signed delivery, order
#    transitions to processing, USDC lands in the merchant wallet.
```

**hard rollback if anything goes wrong:**

```bash
# Flip listener back to testnet
ssh manuel@165.22.10.194 'sed -i "s/^STELLAR_NETWORK=.*/STELLAR_NETWORK=testnet/" /opt/slippay-backend/.env && pm2 reload ecosystem.config.cjs --update-env'

# Pause every mainnet merchant subscription (off-chain, kills autopay attempts)
echo "UPDATE merchants SET active=false WHERE network='mainnet';" | \
  pnpm dlx supabase@latest db query
```

The contract itself has no admin/pause function — rollback at the listener +
merchant-row level is the only available switch. Document this caveat
explicitly when onboarding the first mainnet merchant.

## phase 7 · plugin v0.2 release

audit-006 W3/W6/W8 ship in plugin v0.2.0. Distribution:

```bash
cd ~/projects/slippay
# 1. Zip the plugin folder
( cd plugins && zip -r ~/woocommerce-slippay-0.2.0.zip woocommerce-slippay -x '*/tests/*' '*/.git/*' )

# 2. Publish a signed release on GitHub
gh release create v0.2.0-wc-plugin \
  ~/woocommerce-slippay-0.2.0.zip \
  --title "WooCommerce SlipPay v0.2.0 — security update (CVSS 9.1)" \
  --notes-file plugins/woocommerce-slippay/CHANGELOG-v0.2.md \
  --target main

# 3. Publish SHA256SUMS alongside (audit-005 S6)
sha256sum ~/woocommerce-slippay-0.2.0.zip | tee SHA256SUMS
gh release upload v0.2.0-wc-plugin SHA256SUMS

# 4. Email every known v0.1 merchant. Body in plugins/woocommerce-slippay/SECURITY-NOTICE-v0.2.md
#    (to be written before sending).
```

## post-mainnet · ongoing operational hygiene

- `pm2 logs --nostream | grep -E 'unsafe_url|lease_acquired|webhook_insert_dedup'` daily for the first 14 days
- weekly: review `webhook_deliveries WHERE status='dead'` rows — any with `response_body LIKE 'unsafe_url%'` are merchants who tried to point at private IPs (warn them)
- monthly: rotate `CHECKOUT_TOKEN_SECRET` (invalidates outstanding checkout URLs, customers re-fetch on the SPA reload)
- quarterly: revisit audit-002 F2 (no upgrade path) and decide if v0.2 contract redeploy + migration is needed

## checklist — quick view

- [ ] phase 0 · decisions captured
- [ ] phase 1 · 2 secrets generated, deployed, tmp wiped
- [ ] phase 2 · 2 migrations applied, schema verified
- [ ] phase 3 · listener rebuilt, PM2 reloaded, logs clean
- [ ] phase 4 · contract redeployed on testnet, **real wallet e2e charge succeeded**, tx hashes in DEPLOYED.md
- [ ] phase 5 · 24-72h soak, no unexpected `unsafe_url` or `lease_heartbeat_failed`
- [ ] phase 6 · mainnet contract deployed, WASM_HASH_MAINNET registered, 1 real $1 order verified
- [ ] phase 7 · plugin v0.2 released with signed artifact + SHA256SUMS, merchant comms sent

## what this runbook does NOT cover

- pre-launch marketing copy (`docs/business/{revenue-model,positioning}.md` pending — `Sprint 3 #2,#3`)
- SCF submission (`docs/grants/scf-application-draft.md` pending — `Sprint 3 #4`)
- 5 wallets reais (Sprint 4 #6) — operational outreach, not a code task
- pitch deck (`Sprint 4 #7`)
