# audit-005 · secrets, supply chain, CI/CD

- **status:** opened · **NO-GO** as-is
- **date:** 2026-05-16
- **scope:** repo root + `.env*`, `scripts/*`, `contracts/subscription/deploy-testnet.sh`, `Cargo.{toml,lock}`, `package.json`, `pnpm-lock.yaml`, `ecosystem.config.cjs`, `supabase/config.toml`, `.github/workflows/*`, plugin distribution path, three Dockerfiles, `docs/deploy-secrets.md`
- **out of scope:** webhook HMAC (audit-001), contract internals (002), listener routes (003), Supabase API routes (004)

## findings

| # | sev | category | location | title |
|---|---|---|---|---|
| S1 | **critical** | key custody | `~/.config/stellar/identity/slippay-deployer.toml` | deployer seed phrase plaintext on operator laptop · `deploy-testnet.sh:23-26` writes same path |
| S2 | **critical** | key custody | `docs/deploy-secrets.md:101-112` | platform-fee key documented as "1Password/Bitwarden" (plaintext-at-rest), no HSM/multisig |
| S3 | high | deploy posture | `ecosystem.config.cjs:23` · `/opt/slippay-backend/.env` | `SUPABASE_SERVICE_ROLE_KEY` plaintext on VPS, readable by anyone with pm2/host |
| S4 | high | supply chain | `apps/listener/package.json:16` | `@stellar/stellar-sdk: "*"` floating-major; local `pnpm install` without `--frozen-lockfile` resolves arbitrary version |
| S5 | high | CI/CD | `.github/workflows/` | no `deploy-production.yml`; no signed tags enforced; no SBOM; no SLSA provenance |
| S6 | high | plugin distribution | `plugins/woocommerce-slippay/README.md:13-29` | no SHA-256, no signed releases, no `Update URI:`; merchant cloning gets whatever HEAD is |
| S7 | medium | .env.example fragmentation | repo root | no top-level `.env.example`; per-app files don't cover the superset `ecosystem.config.cjs` reads |
| S8 | medium | Dockerfile hardening | `apps/{listener,web}/Dockerfile` | `--ignore-scripts` already in use (positive); comment names operational not security rationale |
| S9 | medium | committed JWTs | `scripts/e2e-payment-testnet.mjs:20` · `scripts/e2e-subscriptions.mjs:17` | anon-key for Supabase ref `nhddnulzsaubewvzspkh` shipped in repo; project differs from `aaiiwhmthjtkcartzmku` — two-project confusion |
| S10 | low | gitignore | `.env.local.ci`, `.env.docker.example` | intentionally not ignored (CI / template); contents are demo JWTs |
| S11 | low | plugin compat | `woocommerce-slippay.php:13` | `WC tested up to: 9.0` will go stale |

## positive findings (keep, document)

- `apps/listener/Dockerfile:21` drops to `USER node`
- `contracts/subscription/.gitignore:1` correctly ignores `.testnet-deploy.env` (verified `git check-ignore -v`)
- all 193 Cargo deps from `registry+https://github.com/rust-lang/crates.io-index` (no git/vendored/patched)
- WC plugin has `ABSPATH` guard + HPOS declaration
- no `curl | bash` / `wget | sh` / `sudo` in any committed script
- CI uses `pnpm install --frozen-lockfile`

## secrets-in-history check (explicit)

```bash
git log --all -p 2>/dev/null | grep -E '(SUPABASE_SERVICE_ROLE_KEY|sk-ant-|S[A-Z2-7]{55}|BEGIN.*PRIVATE)'
# 24 hits → all demo JWTs (iss=supabase-demo), placeholders, or env-var references
git log --all --diff-filter=A --name-only --pretty=format: | grep -iE '\.env|secret|\.pem|identity|testnet-deploy'
# .env.docker.example, .env.local.ci, 3× .env.example, docs/deploy-secrets.md — NO real .env, NO .pem, NO identity
git grep -nE 'eyJ[A-Za-z0-9_-]{20,}'
# 5 hits — all already explained
grep -rE '\bS[A-Z2-7]{55}\b'
# zero matches (Stellar secret pattern)
```

**conclusion: no rotation required for git history.** seed-phrase exposure is on operator's local disk (S1), outside repo, in scope because `deploy-testnet.sh` writes there.

## mainnet conditions

**hard blockers (NO-GO without):**

1. **S1 + S2** — key custody decision documented and implemented. mainnet deployer key + platform-fee key cannot be plaintext-on-VPS or plaintext-in-password-manager. options: Ledger Stellar app (HD path), 2-of-3 Stellar multisig (1 Ledger + 1 server + 1 cold backup), or KMS-mounted-at-boot. document in `docs/deploy-secrets.md` before deploy.
2. **S4** — pin `@stellar/stellar-sdk` from `"*"` to `"^15.1.0"` in `apps/listener/package.json:16`. one-line fix.
3. **S5** — `.github/workflows/deploy-production.yml` triggered only on signed-tag-push; manual approval via `environments:`; includes `cargo build --locked` + WASM hash assertion against on-chain `WASM_HASH_MAINNET` constant.
4. **S6** — plugin distribution integrity story. either WordPress.org submission OR signed GitHub Releases with published SHA256SUMS + README verify command.

**operational hygiene (recommended pre-mainnet):**
5. S3 — move secrets to fetch-at-boot (Fly secrets pattern, or `systemd-creds` + age-encrypted file)
6. S7 — top-level `.env.example` mirroring `ecosystem.config.cjs` reads, with `# required`/`# optional`
7. S9 — confirm RLS enforced on `nhddnulzsaubewvzspkh` project; document which Supabase ref is which (staging vs prod)
8. S10/S11 — keep S10 as-is; bump S11 each release

## confidence caveats

- no mainnet runbook committed yet → key custody assessment is inference from staging path
- transitive npm vuln state not assessed (would need `pnpm audit --prod` against live registry)
- Cargo deps verified single-supply-chain but not version-by-version vulnerability scanned
