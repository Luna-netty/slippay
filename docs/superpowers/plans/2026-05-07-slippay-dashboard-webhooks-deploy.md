# SlipPay Dashboard + Webhooks + Deploy Implementation Plan (Plan C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out v0 to a deployable testnet product. Ships webhook delivery (HMAC + retries + dead state), merchant dashboard (signup/login/orders/settings), cron-driven order expiry, CI for tests + deploys (Vercel + Fly.io + Supabase migrations), and security hardening (CSP, SSRF guard on webhook URLs, deploy fingerprint). Mainnet flip remains explicit and gated by VASP partnership — out of scope.

**Architecture:** webhook worker is a second tasklet inside the existing `apps/listener` container. Dashboard is the existing `apps/web` SPA gaining `/signup`, `/login`, `/dashboard`. Cron runs as a Supabase scheduled function (pg_cron). CI is GH Actions; deploys are Vercel (web), Supabase CLI (api + migrations), Fly.io (listener).

**Tech Stack:** Same as Plan A+B + Playwright 1.x, GH Actions, Vercel CLI, Fly.io flyctl, pg_cron extension, `crypto.subtle` HMAC.

**Reference spec:** `docs/superpowers/specs/2026-05-07-slippay-design.md` (`72a98b0`).
**Plans this depends on:** v0.0.1-foundation (Plan A) + v0.0.2-checkout-listener (Plan B) shipped.

---

## Falsifiable prediction (60% conf)

Full Plan C ships in **≤4 weeks** with operator + Claude. Hard parts: getting GH Actions secrets right (Vercel token, Fly token, Supabase access token) and setting up first real production deploy. Above 4 weeks = bottleneck is human ops setup, not engineering.

---

## File structure (created across this plan)

```
slippay/
├── apps/
│   ├── listener/src/
│   │   ├── webhook.ts                       # delivery worker logic
│   │   ├── crypto.ts                        # HMAC helpers
│   │   └── ssrf.ts                          # URL safety check
│   └── web/src/
│       ├── pages/
│       │   ├── Login.tsx
│       │   ├── Signup.tsx
│       │   ├── Dashboard.tsx                # layout + nav
│       │   ├── DashboardOrders.tsx          # list view
│       │   └── DashboardSettings.tsx        # api key, webhook url, stellar address
│       └── lib/
│           ├── auth.tsx                     # supabase auth context + hook
│           └── apiAuth.ts                   # fetch wrapper using JWT cookie
├── supabase/migrations/
│   ├── 20260507120000_pg_cron_expire.sql    # nightly UPDATE expired orders
│   └── 20260507120100_webhook_indexes.sql   # supporting indexes if missing
├── apps/listener/test/
│   ├── webhook.test.ts                      # HMAC + retry schedule
│   └── ssrf.test.ts
├── apps/web/test/
│   └── auth.test.ts                         # auth context unit tests
├── e2e/                                     # NEW playwright project
│   ├── package.json
│   ├── playwright.config.ts
│   └── tests/
│       └── checkout.spec.ts                 # browser-driven smoke
├── .github/workflows/
│   ├── test.yml                              # PR test gate
│   ├── deploy-preview.yml                    # vercel preview
│   ├── deploy-prod.yml                       # vercel prod + supabase + fly
│   └── e2e.yml                               # nightly e2e against staging
├── apps/listener/fly.toml                    # Fly.io deployment config
└── docs/superpowers/plans/
    └── 2026-05-07-slippay-dashboard-webhooks-deploy.md   # this
```

---

## Task 1 · Webhook crypto (HMAC) + SSRF guard (pure utilities)

**Files:** `apps/listener/src/crypto.ts`, `ssrf.ts`, `test/{crypto,ssrf}.test.ts`

- [ ] **Step 1: Failing tests for crypto.ts**

`apps/listener/test/crypto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { signWebhook, verifyWebhook } from "../src/crypto.js";

describe("signWebhook", () => {
  it("returns t=<unix>,v1=<hmac> format", async () => {
    const sig = await signWebhook("secret", "{\"a\":1}", 1700000000);
    expect(sig).toMatch(/^t=1700000000,v1=[a-f0-9]{64}$/);
  });
});

describe("verifyWebhook", () => {
  it("accepts a fresh signature within tolerance window", async () => {
    const now = Math.floor(Date.now()/1000);
    const sig = await signWebhook("secret", "body", now);
    expect(await verifyWebhook("secret", "body", sig, now)).toBe(true);
  });

  it("rejects expired signature", async () => {
    const old = Math.floor(Date.now()/1000) - 600;
    const sig = await signWebhook("secret", "body", old);
    expect(await verifyWebhook("secret", "body", sig, Math.floor(Date.now()/1000))).toBe(false);
  });

  it("rejects forged signature", async () => {
    const sig = "t=1,v1=" + "0".repeat(64);
    expect(await verifyWebhook("secret", "body", sig, 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement crypto.ts**

```ts
const TOLERANCE_S = 300;

export async function signWebhook(secret: string, body: string, t: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const data = enc.encode(`${t}.${body}`);
  const buf = await crypto.subtle.sign("HMAC", key, data);
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
  return `t=${t},v1=${hex}`;
}

export async function verifyWebhook(secret: string, body: string, header: string, nowSec: number): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!isFinite(t) || Math.abs(nowSec - t) > TOLERANCE_S) return false;
  const expected = await signWebhook(secret, body, t);
  // constant-time compare
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 3: Failing tests for ssrf.ts**

```ts
// test/ssrf.test.ts
import { describe, it, expect } from "vitest";
import { isSafeWebhookUrl } from "../src/ssrf.js";

describe("isSafeWebhookUrl", () => {
  it("accepts https URLs to public hosts", () => {
    expect(isSafeWebhookUrl("https://example.com/wh", "mainnet")).toBe(true);
  });

  it("rejects http on mainnet", () => {
    expect(isSafeWebhookUrl("http://example.com/wh", "mainnet")).toBe(false);
  });

  it("allows http on testnet (dev convenience)", () => {
    expect(isSafeWebhookUrl("http://example.com/wh", "testnet")).toBe(true);
  });

  it("rejects RFC1918 destinations on mainnet", () => {
    for (const url of ["http://10.0.0.1/wh", "https://192.168.1.1/wh", "https://172.16.0.5/wh"]) {
      expect(isSafeWebhookUrl(url, "mainnet")).toBe(false);
    }
  });

  it("rejects localhost on mainnet", () => {
    expect(isSafeWebhookUrl("https://localhost/wh", "mainnet")).toBe(false);
    expect(isSafeWebhookUrl("https://127.0.0.1/wh", "mainnet")).toBe(false);
    expect(isSafeWebhookUrl("https://[::1]/wh", "mainnet")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isSafeWebhookUrl("not a url", "mainnet")).toBe(false);
    expect(isSafeWebhookUrl("ftp://example.com", "mainnet")).toBe(false);
  });
});
```

- [ ] **Step 4: Implement ssrf.ts**

```ts
const RFC1918 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

export function isSafeWebhookUrl(url: string, network: "testnet" | "mainnet"): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (network === "mainnet" && parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  if (network === "mainnet") {
    if (LOCAL_HOSTS.has(host)) return false;
    if (RFC1918.some(re => re.test(host))) return false;
  }
  return true;
}
```

- [ ] **Step 5: Run tests pass + commit**

```sh
git commit -m "$(cat <<'EOF'
feat(listener): hmac webhook signing + ssrf guard for webhook urls

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 · Webhook delivery worker

**Files:** `apps/listener/src/webhook.ts`, `test/webhook.test.ts`, modify `apps/listener/src/main.ts` to start it

- [ ] **Step 1: Failing tests covering retry schedule + delivery + dead transition**

```ts
// test/webhook.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextBackoff, deliverOnce } from "../src/webhook.js";

describe("nextBackoff", () => {
  it("returns escalating delays per attempt", () => {
    expect(nextBackoff(0)).toBe(60);          // 1m
    expect(nextBackoff(1)).toBe(300);         // 5m
    expect(nextBackoff(2)).toBe(1800);        // 30m
    expect(nextBackoff(3)).toBe(7200);        // 2h
    expect(nextBackoff(4)).toBe(43200);       // 12h
    expect(nextBackoff(5)).toBe(86400);       // 24h
    expect(nextBackoff(6)).toBe(null);        // dead
  });
});

describe("deliverOnce", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("returns sent on 2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));
    const r = await deliverOnce({
      url: "https://example.com/wh",
      secret: "s",
      deliveryId: "d-1",
      payload: { type: "order.paid", data: { id: "o-1" } },
    });
    expect(r.status).toBe("sent");
    expect(r.code).toBe(200);
  });

  it("returns failed on 5xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 503 })));
    const r = await deliverOnce({ url: "https://example.com/wh", secret: "s", deliveryId: "d-2", payload: {} });
    expect(r.status).toBe("failed");
  });

  it("returns failed on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("dns")));
    const r = await deliverOnce({ url: "https://example.com/wh", secret: "s", deliveryId: "d-3", payload: {} });
    expect(r.status).toBe("failed");
  });
});
```

- [ ] **Step 2: Implement webhook.ts**

```ts
import { signWebhook } from "./crypto.js";
import { log } from "./log.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSafeWebhookUrl } from "./ssrf.js";

const SCHEDULE = [60, 300, 1800, 7200, 43200, 86400];

export function nextBackoff(attempt: number): number | null {
  return SCHEDULE[attempt] ?? null;
}

export interface DeliverArgs {
  url: string;
  secret: string;
  deliveryId: string;
  payload: unknown;
}

export interface DeliverResult {
  status: "sent" | "failed";
  code?: number;
  body?: string;
}

export async function deliverOnce(args: DeliverArgs): Promise<DeliverResult> {
  const body = JSON.stringify(args.payload);
  const t = Math.floor(Date.now() / 1000);
  const sig = await signWebhook(args.secret, body, t);
  try {
    const r = await fetch(args.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slippay-signature": sig,
        "x-slippay-delivery-id": args.deliveryId,
      },
      body,
    });
    const text = await r.text().catch(() => "");
    return { status: r.ok ? "sent" : "failed", code: r.status, body: text.slice(0, 500) };
  } catch (e) {
    return { status: "failed", body: String(e) };
  }
}

export function startWebhookWorker(db: SupabaseClient, network: "testnet"|"mainnet") {
  let stopped = false;

  async function tick() {
    while (!stopped) {
      const { data: rows } = await db.from("webhook_deliveries")
        .select("id, order_id, payload, attempt_n, status, orders ( merchants ( webhook_url, webhook_secret, network ) )")
        .in("status", ["queued", "failed"])
        .lte("next_attempt_at", new Date().toISOString())
        .order("next_attempt_at", { ascending: true })
        .limit(50);

      if (!rows || rows.length === 0) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      for (const row of rows) {
        const merchant = (row as any).orders?.merchants as { webhook_url?: string; webhook_secret?: string; network?: string };
        if (!merchant?.webhook_url) {
          await db.from("webhook_deliveries").update({ status: "dead", response_body: "no_webhook_url" }).eq("id", row.id);
          continue;
        }
        if (!isSafeWebhookUrl(merchant.webhook_url, network)) {
          await db.from("webhook_deliveries").update({ status: "dead", response_body: "unsafe_url" }).eq("id", row.id);
          continue;
        }

        const result = await deliverOnce({
          url: merchant.webhook_url,
          secret: merchant.webhook_secret!,
          deliveryId: row.id as string,
          payload: row.payload,
        });

        const newAttempt = (row.attempt_n as number) + 1;
        if (result.status === "sent") {
          await db.from("webhook_deliveries").update({
            status: "sent",
            response_code: result.code,
            response_body: result.body,
            attempt_n: newAttempt,
            last_attempt_at: new Date().toISOString(),
          }).eq("id", row.id);
          log("info", "webhook_sent", { id: row.id, code: result.code });
        } else {
          const backoff = nextBackoff(newAttempt - 1);
          await db.from("webhook_deliveries").update({
            status: backoff === null ? "dead" : "failed",
            response_code: result.code,
            response_body: result.body,
            attempt_n: newAttempt,
            last_attempt_at: new Date().toISOString(),
            next_attempt_at: backoff === null
              ? new Date().toISOString()
              : new Date(Date.now() + backoff * 1000).toISOString(),
          }).eq("id", row.id);
          log("warn", "webhook_failed", { id: row.id, attempt: newAttempt, backoff });
        }
      }
    }
  }

  tick();
  return () => { stopped = true; };
}
```

- [ ] **Step 3: Modify main.ts to start worker**

```ts
import { startWebhookWorker } from "./webhook.js";

// after startManager:
const stopWebhook = startWebhookWorker(db, config.network.toLowerCase() as "testnet"|"mainnet");
// in SIGTERM:
stopWebhook();
```

- [ ] **Step 4: Tests pass + commit**

---

## Task 3 · Migration: pg_cron expiry job

- [ ] **Step 1: Create migration**

`supabase/migrations/20260507120000_pg_cron_expire.sql`:

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'slippay-expire-orders',
  '*/5 * * * *',  -- every 5 minutes
  $$
    update orders
    set status = 'expired'
    where status = 'pending'
      and expires_at < now();

    insert into webhook_deliveries (order_id, type, payload, next_attempt_at)
    select o.id, 'order.expired',
      jsonb_build_object(
        'type', 'order.expired',
        'data', jsonb_build_object(
          'id', o.id,
          'external_ref', o.external_ref,
          'brl_amount', o.brl_amount,
          'memo', o.memo,
          'expires_at', o.expires_at
        )
      ),
      now()
    from orders o
    where o.status = 'expired'
      and not exists (select 1 from webhook_deliveries w where w.order_id = o.id and w.type = 'order.expired');
  $$
);
```

- [ ] **Step 2: Apply via `supabase db reset`**

- [ ] **Step 3: Smoke**

```sh
psql ... -c "select * from cron.job;"
```

Expected: one row with the slippay-expire-orders schedule.

- [ ] **Step 4: Commit**

---

## Task 4 · Web: auth context + login + signup pages

**Files:**
- Create: `apps/web/src/lib/auth.tsx`, `apps/web/src/lib/apiAuth.ts`, `apps/web/src/pages/Login.tsx`, `apps/web/src/pages/Signup.tsx`, `apps/web/test/auth.test.ts`
- Modify: `apps/web/package.json` (add `@supabase/supabase-js`), `apps/web/src/App.tsx`

- [ ] **Step 1: Add dep**

```sh
pnpm --filter @slippay/web add @supabase/supabase-js
```

- [ ] **Step 2: Implement auth context**

`apps/web/src/lib/auth.tsx`:

```tsx
import { createClient, type Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

interface AuthCtx { session: Session | null; loading: boolean; }
const Ctx = createContext<AuthCtx>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return <Ctx.Provider value={{ session, loading }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
```

- [ ] **Step 3: apiAuth.ts (fetch wrapper that injects JWT)**

```ts
import { supabase } from "./auth.tsx";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:54321/functions/v1/api";

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
  });
}
```

- [ ] **Step 4: Login + Signup pages**

Both call `supabase.auth.signInWithPassword(...)` / `signUp(...)`. Magic-link option deferred for v0.

`apps/web/src/pages/Login.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/auth.tsx";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  return (
    <main className="max-w-sm mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-6">login</h1>
      <form onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setErr(error.message); else nav("/dashboard");
      }} className="space-y-3">
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="email" required className="w-full bg-zinc-900 rounded px-3 py-2" />
        <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="password" required className="w-full bg-zinc-900 rounded px-3 py-2" />
        <button className="w-full bg-emerald-500 text-black py-2 rounded font-semibold">log in</button>
        {err && <div className="text-red-400 text-sm">{err}</div>}
      </form>
      <a href="/signup" className="text-sm text-zinc-400 mt-4 block">no account? sign up</a>
    </main>
  );
}
```

`apps/web/src/pages/Signup.tsx` — similar, calls `supabase.auth.signUp({ email, password })`, on success redirects to `/dashboard`.

- [ ] **Step 5: Wrap App with AuthProvider, add routes**

`apps/web/src/main.tsx`:

```tsx
// inside the render:
<BrowserRouter>
  <AuthProvider>
    <App />
  </AuthProvider>
</BrowserRouter>
```

`App.tsx`:

```tsx
<Route path="/login" element={<Login />} />
<Route path="/signup" element={<Signup />} />
<Route path="/dashboard" element={<Dashboard />} />
```

- [ ] **Step 6: tests + commit**

---

## Task 5 · Web: Dashboard layout + orders list

**Files:**
- Create: `apps/web/src/pages/Dashboard.tsx` (layout + nav + protected route guard), `DashboardOrders.tsx`

- [ ] Implementation similar to other pages — fetch `/v1/orders` via `authFetch`, render table with id/external_ref/amount/status/created_at, polling every 10s.

- [ ] Protected route: in Dashboard component, if `useAuth().session` is null AND not `loading`, redirect to `/login`.

- [ ] commit.

---

## Task 6 · Web: Dashboard settings (api key reveal/rotate, webhook url, stellar address)

**Files:**
- Create: `apps/web/src/pages/DashboardSettings.tsx`

- [ ] Fields: display_name (read-only), email (read-only), stellar_address (editable), webhook_url (editable), api_key_prefix (read-only). Buttons: rotate API key (POST /me/rotate-key, modal showing key once, copy button), test webhook (POST /test-webhook).
- [ ] PATCH /v1/merchants/me on save.
- [ ] tests + commit.

---

## Task 7 · CI: PR test gate (.github/workflows/test.yml)

**File:** `.github/workflows/test.yml`

```yaml
name: test
on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: denoland/setup-deno@v2
        with: { deno-version: v2.x }
      - uses: supabase/setup-cli@v1
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r test
      - run: supabase start
      - run: cd supabase/functions/api && deno test --allow-all --no-check --env-file=../../../.env.local.ci test/
```

- [ ] Create `.env.local.ci` (committed) with the local supabase keys (those are public defaults of supabase CLI dev stack).
- [ ] Commit + open PR to validate workflow runs.

---

## Task 8 · CI: Vercel preview + production deploys

**File:** `.github/workflows/deploy-preview.yml`, `deploy-prod.yml`

Standard Vercel + Supabase + Fly steps. Secrets needed:

- VERCEL_TOKEN
- VERCEL_ORG_ID
- VERCEL_PROJECT_ID
- SUPABASE_ACCESS_TOKEN
- SUPABASE_PROJECT_REF (staging + prod)
- FLY_API_TOKEN

Document required secrets in `docs/deploy-secrets.md`.

- [ ] Workflows + secret docs commit.

---

## Task 9 · Listener Fly.io deploy config

**File:** `apps/listener/fly.toml`

```toml
app = "slippay-listener-staging"
primary_region = "gru"

[build]

[env]
  STELLAR_NETWORK = "TESTNET"
  MERCHANT_POLL_MS = "30000"

[processes]
  app = "node dist/main.js"

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
  cpus = 1
```

Set secrets via `fly secrets set` for SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

- [ ] Add `fly.toml` + commit.

---

## Task 10 · Playwright e2e against staging

**Files:** `e2e/package.json`, `playwright.config.ts`, `tests/checkout.spec.ts`

- [ ] Wire Playwright with a stubbed wallet (Freighter automated via the Stellar SDK + a custom test wallet — no real Freighter UI; substitute `stellar-wallets-kit` with a stub that returns the test signer in test mode via `VITE_TEST_MODE` flag).
- [ ] Run nightly via `e2e.yml` workflow.
- [ ] commit.

---

## Task 11 · Security hardening pass

- [ ] CSP header on web (Vercel `vercel.json` headers).
- [ ] SRI for any third-party scripts (verify currently zero).
- [ ] Deploy fingerprint pinning before mainnet flip (manual checklist in `docs/mainnet-readiness.md`).
- [ ] Rate limiting on api function (using Hono middleware backed by upstash redis or supabase table).
- [ ] commit.

---

## Task 12 · brl_amount consistency + Plan A debt cleanup

- [ ] Migrate `orders.brl_amount` and `usdc_amount` to text (or apply a global response transformer that always stringifies).
- [ ] Patch all api endpoints to return string for both.
- [ ] Update web `PublicOrder` type and tests.
- [ ] commit.

---

## Task 13 · Production readiness checklist

**File:** `docs/mainnet-readiness.md`

Checklist items:

- [ ] VASP partnership signed for off-ramp + KYC institucional
- [ ] Audit completed on apps/api + apps/web atomic tx builder + apps/listener matcher
- [ ] Mainnet platform Stellar address in cold-storage multisig
- [ ] CSP + SRI verified on prod build
- [ ] Rate limiting tuned and tested
- [ ] Webhook delivery tested with 3 real merchant endpoints
- [ ] Cron job verified expiring orders correctly
- [ ] Monitoring: alerts on listener_state staleness >60s, webhook dead rate >5%, edge function 5xx >1%
- [ ] Runbooks: listener crash, supabase outage, horizon outage
- [ ] Public docs: API reference, integration guide, webhook security guide

Document this for Marco; do NOT auto-flip to mainnet without all boxes checked.

---

## Self-review

**Spec coverage check:**

| Spec section | Task |
|---|---|
| §3.4 webhook delivery semantics | Tasks 1, 2 |
| §3.2 dashboard | Tasks 4, 5, 6 |
| §5 expired flow | Task 3 |
| §7 e2e Playwright | Task 10 |
| §8 deploy CI | Tasks 7, 8, 9 |
| §9 security | Task 11 |
| §10 mainnet gate | Task 13 |

**Gaps deliberately deferred:**
- VTEX/Nuvemshop/Shopify plugins — Plan D
- Embeddable JS SDK — Plan D
- Off-ramp BRL/PIX — gated by VASP partnership, separate effort
- Buyer KYC — gated by VASP partnership

---

## Execution handoff

Plan complete and saved. Two execution options:

1. **Subagent-Driven** (recommended for B-style velocity)
2. **Inline Execution** (slower, more checkpoints)

Plan A and B took ~4 hours of operator + Claude. Plan C is wider in surface area but lighter per task. Estimate: ~6-8 hours similar pace, blocked mostly by external secret setup (Vercel/Fly/Supabase tokens) which require human ops.
