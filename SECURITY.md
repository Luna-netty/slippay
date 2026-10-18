# Security Policy & Incident Response Runbook

SlipPay is non-custodial dollar settlement for people, autonomous agents, and companies. Because the system coordinates on-chain settlement, merchant API keys, webhook delivery, and client-side transaction signing, security is treated as an architectural invariant, not an afterthought.

---

## 1. Reporting a Vulnerability

We welcome responsible security research. If you discover a vulnerability or potential security flaw, **please do not open a public issue or discuss it in public channels.**

### Private Reporting Channels
- **Email:** `security@slippay.xyz`
- **GitHub Security Advisory (Preferred):** Open a private report at [github.com/slippay-labs/slippay/security/advisories/new](https://github.com/slippay-labs/slippay/security/advisories/new)
- **Urgent Escalation:** Contact core maintainers on Telegram via [@Obaara293](https://t.me/Obaara293) or in the [SlipPay Labs community](https://t.me/slippay_labs) requesting a secure private channel.

### Expected Response Times (SLAs)
| Stage | Target SLA | Description |
|---|---|---|
| **Initial Acknowledgment** | $\le$ 24 hours | We confirm receipt of your report and assign a primary responder. |
| **Triage & Assessment** | $\le$ 48 hours | We validate the vulnerability, determine severity (CVSS), and reproduce the behavior. |
| **Mitigation / Patch** | 3–14 days | Fix implemented, verified against the threat model, and deployed. |
| **Public Disclosure** | 90 days | Coordinated disclosure window, unless agreed earlier by both parties. |

We ask that you give us reasonable time to investigate and mitigate an issue before publicly disclosing any details.

---

## 2. Scope Boundaries

### In-Scope
- **Smart Contracts & On-Chain Settlement:**
  - `contracts/checkout`, `contracts/subscription`, Soroban WASM artifacts, SEP-41 token allowances, SAC fee splits.
- **Client-Side Signing Gates & WYSIWYS:**
  - `apps/web/src/lib/txguard.ts`, `authorizeTx.ts`, `baseAuthorize.ts` (enforcing "What You See Is What You Sign", XDR decoding, receiver/amount assertion).
- **Edge API & Authentication:**
  - `supabase/functions/api/` (merchant API key authentication, peppered HMAC-SHA256, checkout tokens, rate limiters, SQL injection, RLS).
- **Event Listener & Delivery:**
  - `apps/listener/` (SSRF protections in `ssrf.ts`, webhook HMAC signing `t=...,v1=...`, replay cache, Horizon transaction ingestion).
- **Proof-Carrying Mandates & ZK Verification:**
  - AXL spending policy provers, ZK Groth16 mandate verification.

### Out-of-Scope
- Attacks requiring physical access to an operator's machine or hardware wallet (e.g. Ledger).
- Phishing, vishing, or social engineering targeting maintainers or users.
- Denial-of-Service attacks against public rate-limited endpoints with no systemic impact.
- Vulnerabilities in third-party dependencies that cannot be exercised or exploited through SlipPay's code paths.
- Missing security headers on auxiliary static pages that do not handle authenticated sessions.

---

## 3. Incident Response Runbook

When a critical security issue or credential compromise occurs, responders must follow this sequential protocol:

### Phase 1: Triage & Containment
1. Identify the compromised boundary (e.g., signing gate, edge API, webhook delivery, build tooling).
2. If an active exploit is detected on edge infrastructure, temporarily place the affected endpoint behind maintenance mode or throttle traffic at the reverse proxy.

### Phase 2: Credential & Secret Rotation Checklist
If secrets are exposed, suspect, or touched during an incident, rotate them in this order:

- [ ] **Supabase Service Role Key & Database Credentials:**
  - Rotate `SUPABASE_SERVICE_ROLE_KEY` and database password in Supabase project settings.
  - Redeploy edge functions and listener instances with the updated keys.
- [ ] **API Key Pepper (`API_KEY_PEPPER`):**
  - Used for hashing merchant API keys.
  - *Caution:* Rotating the pepper invalidates stored hashes; coordinate merchant key rotation or execute a phased dual-hash migration.
- [ ] **Checkout Token Secret (`CHECKOUT_TOKEN_SECRET`):**
  - Rotate in edge function secrets. Active checkout sessions expire within their bounded lifetime.
- [ ] **Webhook Signing Secret (`WEBHOOK_SIGNING_SECRET`):**
  - Rotate in listener configuration; update merchant webhook verification endpoints.
- [ ] **Relayer Fee-Payer Keys (`RELAYER_SECRET_KEY`):**
  - Drain residual gas funds to cold storage and generate a fresh relayer keypair for fee sponsorship.
- [ ] **CI/CD & Hosting Tokens:**
  - Rotate `VERCEL_TOKEN`, deploy hooks, and GitHub Actions repository secrets.

---

### Phase 3: Fix Verification & Build-Configuration Audit

> **Crucial Rule:** A security fix is never verified by "the git diff shows a change". A malicious or corrupted build file can disguise payloads within formatting or large diffs. Fixes to build configuration **must assert content, SHA-256 hash, and byte size**.

Before merging and deploying any security fix or configuration change, execute the following verification steps:

#### 1. Assert Byte Size and Content of Build Configs
Ensure build configuration files stay strictly within known, human-readable byte budgets:
```bash
# Verify byte sizes on Unix / macOS
wc -c apps/web/postcss.config.cjs
wc -c apps/web/vite.config.ts
wc -c eslint.config.js
```
*Verification standard:* If any configuration file shows an anomalous byte count (e.g. $> 2,000$ bytes for a standard PostCSS/Vite config), fail the review immediately.

#### 2. Verify Cryptographic File Hashes
Compare file SHA-256 digests against known clean baselines:
```bash
shasum -a 256 apps/web/postcss.config.cjs
shasum -a 256 pnpm-lock.yaml
```

#### 3. Strict Lockfile & Dependency Integrity Check
Verify that `pnpm-lock.yaml` is clean and has not been silently mutated:
```bash
# Verify clean install matches frozen lockfile
pnpm install --frozen-lockfile

# Assert lockfile was not rewritten during install
git diff --exit-code pnpm-lock.yaml
```

#### 4. Run the Full Offline Verification Suite
```bash
# Lint checks
pnpm -r lint

# Unit & integration tests
pnpm -r test

# Verify edge function tests
cd supabase/functions/api && deno test --allow-all test/
```

---

### Phase 4: Release & Disclosure
1. Tag release commit with GPG signature.
2. Deploy to staging, verify live health metrics, and deploy to production.
3. Publish a GitHub Security Advisory detailing the vulnerability, remediation, credit to the reporter, and any necessary merchant actions.
