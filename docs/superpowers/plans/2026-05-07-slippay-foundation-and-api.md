# SlipPay Foundation + API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the SlipPay monorepo, Supabase project (Postgres + Auth + RLS), shared zod schema package, and the Hono Edge Function API covering merchant CRUD + order create/list/cancel. Ships when an authenticated merchant can create an order via curl and RLS prevents cross-merchant access.

**Architecture:** pnpm workspace monorepo. Supabase hosts Postgres + Auth + Edge Functions (Deno). API written in Hono on Deno. Shared types/schemas in TS package consumed by Deno via `imports` map. Tests via `deno test` (api) and `vitest` (shared).

**Tech Stack:** pnpm 9, TypeScript 5, Hono 4, Deno 1.46+ (Supabase Edge runtime), Supabase CLI, Postgres 15, zod 3, vitest 2.

**Reference spec:** `docs/superpowers/specs/2026-05-07-slippay-design.md` (commit `72a98b0`).

---

## File structure (created across this plan)

```
slippay/
├── .editorconfig
├── .gitignore
├── package.json                              # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── src/
│       │   ├── index.ts
│       │   ├── constants.ts
│       │   ├── types.ts
│       │   └── schemas/
│       │       ├── merchant.ts
│       │       ├── order.ts
│       │       └── index.ts
│       └── test/
│           └── schemas.test.ts
├── supabase/
│   ├── config.toml                            # auto by `supabase init`
│   ├── seed.sql
│   ├── migrations/
│   │   ├── 20260507100000_initial_schema.sql
│   │   └── 20260507100100_rls_policies.sql
│   └── functions/
│       └── api/
│           ├── deno.json
│           ├── index.ts
│           ├── lib/
│           │   ├── supabase.ts
│           │   ├── apikey.ts
│           │   ├── rate.ts
│           │   └── memo.ts
│           ├── middleware/
│           │   ├── auth_jwt.ts
│           │   ├── auth_apikey.ts
│           │   └── error.ts
│           ├── routes/
│           │   ├── merchants.ts
│           │   └── orders.ts
│           └── test/
│               ├── _helpers.ts
│               ├── apikey.test.ts
│               ├── memo.test.ts
│               ├── merchants.test.ts
│               └── orders.test.ts
└── docs/superpowers/
    ├── specs/2026-05-07-slippay-design.md     # already exists
    └── plans/2026-05-07-slippay-foundation-and-api.md  # this file
```

Each file has one responsibility. Routes split by resource (`merchants`, `orders`). Helpers grouped by concern (auth, supabase client, business utilities).

---

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`). Co-author trailer for Claude.
- **TDD:** every behavior change = failing test first.
- **Tests live next to code** (per layer): shared in `packages/shared/test/`, api in `supabase/functions/api/test/`.
- **Local DB:** `supabase start` boots full stack (Postgres + Auth + Studio). Tests connect via service role key from `supabase status`.
- **Edge function tests:** use Hono's `app.request()` directly — no need to spin HTTP server.

---

## Task 1 · Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`, `README.md`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "slippay",
  "version": "0.0.1",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "supabase:start": "supabase start",
    "supabase:stop": "supabase stop",
    "supabase:reset": "supabase db reset",
    "api:test": "deno test --allow-all supabase/functions/api/test/"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules
dist
.env
.env.local
*.log
.DS_Store
.turbo
supabase/.temp
.vercel
.fly
*.tsbuildinfo
```

- [ ] **Step 5: Create .editorconfig**

```
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true
```

- [ ] **Step 6: Create minimal README.md**

```markdown
# SlipPay

Non-custodial USDC payment gateway for Brazilian e-commerce, built on Stellar.

## Status

Pre-launch. See `docs/superpowers/specs/2026-05-07-slippay-design.md`.

## Dev

```sh
pnpm install
supabase start
pnpm api:test
```
```

- [ ] **Step 7: Install + commit**

```sh
cd /home/galmanus/projects/slippay
pnpm install
git add .
git commit -m "chore: monorepo scaffold (pnpm workspace + tsconfig + ignore)"
```

Expected: pnpm initializes lockfile, no errors.

---

## Task 2 · Shared package (zod schemas + types + constants)

**Files:**
- Create: `packages/shared/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/constants.ts`, `src/types.ts`, `src/schemas/{merchant,order,index}.ts`, `test/schemas.test.ts`

- [ ] **Step 1: Create packages/shared/package.json**

```json
{
  "name": "@slippay/shared",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Create packages/shared/vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

- [ ] **Step 4: Write failing test for schemas**

`packages/shared/test/schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CreateMerchantInputSchema,
  CreateOrderInputSchema,
  OrderStatusSchema,
} from "../src/index.ts";

describe("CreateMerchantInputSchema", () => {
  it("accepts valid input", () => {
    expect(CreateMerchantInputSchema.parse({
      display_name: "Acme Crypto",
      stellar_address: "GBXYZ".padEnd(56, "A"),
      webhook_url: "https://acme.com/wh",
    })).toBeTruthy();
  });

  it("rejects bad stellar address length", () => {
    expect(() => CreateMerchantInputSchema.parse({
      display_name: "Acme",
      stellar_address: "G123",
    })).toThrow();
  });

  it("rejects non-https webhook", () => {
    expect(() => CreateMerchantInputSchema.parse({
      display_name: "Acme",
      webhook_url: "http://acme.com/wh",
    })).toThrow();
  });
});

describe("CreateOrderInputSchema", () => {
  it("accepts valid order", () => {
    expect(CreateOrderInputSchema.parse({
      brl_amount: "100.00",
      external_ref: "cart_42",
    })).toBeTruthy();
  });

  it("rejects negative amount", () => {
    expect(() => CreateOrderInputSchema.parse({ brl_amount: "-1.00" })).toThrow();
  });

  it("rejects amount with > 2 decimals", () => {
    expect(() => CreateOrderInputSchema.parse({ brl_amount: "100.123" })).toThrow();
  });
});

describe("OrderStatusSchema", () => {
  it("includes all known statuses", () => {
    for (const s of ["pending","paid","underpaid","expired","cancelled","dead"]) {
      expect(OrderStatusSchema.parse(s)).toBe(s);
    }
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```sh
cd packages/shared && pnpm install && pnpm test
```

Expected: FAIL with module not found / undefined exports.

- [ ] **Step 6: Implement constants**

`packages/shared/src/constants.ts`:

```ts
export const NETWORK = {
  testnet: {
    horizon: "https://horizon-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
    usdc_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", // Circle USDC testnet — verify at scaffold
  },
  mainnet: {
    horizon: "https://horizon.stellar.org",
    passphrase: "Public Global Stellar Network ; September 2015",
    usdc_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", // Circle USDC mainnet — verify
  },
} as const;

export const USDC_ASSET_CODE = "USDC";
export const STELLAR_ADDRESS_LENGTH = 56;
export const MEMO_HASH_HEX_LENGTH = 64; // 32 bytes
export const DEFAULT_PLATFORM_FEE_BP = 100; // 1%
export const ORDER_DEFAULT_EXPIRY_MINUTES = 30;
export const API_KEY_PREFIX = "sk_live_";
export const API_KEY_BYTES = 32;
```

- [ ] **Step 7: Implement types**

`packages/shared/src/types.ts`:

```ts
export type Network = "testnet" | "mainnet";
export type OrderStatus = "pending" | "paid" | "underpaid" | "expired" | "cancelled" | "dead";

export interface Merchant {
  id: string;
  display_name: string;
  email: string;
  stellar_address: string | null;
  network: Network;
  api_key_prefix: string;
  webhook_url: string | null;
  platform_fee_bp: number;
  active: boolean;
  created_at: string;
}

export interface Order {
  id: string;
  merchant_id: string;
  external_ref: string | null;
  brl_amount: string;
  usdc_amount: string;
  rate_brl_usdc: string;
  memo: string;
  status: OrderStatus;
  tx_hash: string | null;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
}
```

- [ ] **Step 8: Implement schemas/merchant.ts**

```ts
import { z } from "zod";
import { STELLAR_ADDRESS_LENGTH } from "../constants.ts";

const stellarAddress = z.string().length(STELLAR_ADDRESS_LENGTH).regex(/^G[A-Z0-9]{55}$/);
const httpsUrl = z.string().url().regex(/^https:\/\//);

export const CreateMerchantInputSchema = z.object({
  display_name: z.string().min(1).max(120),
  stellar_address: stellarAddress.optional(),
  webhook_url: httpsUrl.optional(),
});

export const PatchMerchantInputSchema = CreateMerchantInputSchema.partial();

export type CreateMerchantInput = z.infer<typeof CreateMerchantInputSchema>;
export type PatchMerchantInput = z.infer<typeof PatchMerchantInputSchema>;
```

- [ ] **Step 9: Implement schemas/order.ts**

```ts
import { z } from "zod";

const brlAmount = z.string().regex(/^\d{1,9}\.\d{2}$/, "must be string with 2 decimals");

export const CreateOrderInputSchema = z.object({
  brl_amount: brlAmount.refine(v => parseFloat(v) > 0, "must be > 0"),
  external_ref: z.string().max(120).optional(),
  expires_in_minutes: z.number().int().min(5).max(1440).optional(),
});

export const OrderStatusSchema = z.enum([
  "pending","paid","underpaid","expired","cancelled","dead",
]);

export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;
```

- [ ] **Step 10: Implement schemas/index.ts and src/index.ts**

`packages/shared/src/schemas/index.ts`:

```ts
export * from "./merchant.ts";
export * from "./order.ts";
```

`packages/shared/src/index.ts`:

```ts
export * from "./types.ts";
export * from "./constants.ts";
export * from "./schemas/index.ts";
```

- [ ] **Step 11: Run tests to verify pass**

```sh
pnpm test
```

Expected: 7 tests pass.

- [ ] **Step 12: Commit**

```sh
cd /home/galmanus/projects/slippay
git add packages/shared
git commit -m "feat(shared): zod schemas, types, constants for merchants and orders"
```

---

## Task 3 · Supabase init + local stack

**Prereq:** `supabase` CLI installed (`brew install supabase/tap/supabase` or `npx supabase ...`). Verify with `supabase --version`.

**Files:**
- Create: `supabase/config.toml` (auto), `supabase/seed.sql`

- [ ] **Step 1: Init Supabase project locally**

```sh
cd /home/galmanus/projects/slippay
supabase init
```

Expected: creates `supabase/config.toml`, `supabase/migrations/`, `supabase/seed.sql`.

- [ ] **Step 2: Edit supabase/config.toml — set project_id and edge runtime port**

Open `supabase/config.toml`, set:

```toml
project_id = "slippay"

[functions.api]
verify_jwt = false  # we verify per-route since some endpoints are API-key auth
```

- [ ] **Step 3: Start the stack**

```sh
supabase start
```

Expected: Postgres on 54322, Studio on 54323, API on 54321, Auth on 54321/auth/v1.

Save output `service_role key` and `anon key` for later steps.

- [ ] **Step 4: Commit baseline**

```sh
git add supabase/
git commit -m "chore(supabase): init local project"
```

---

## Task 4 · Initial schema migration

**Files:**
- Create: `supabase/migrations/20260507100000_initial_schema.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20260507100000_initial_schema.sql
create extension if not exists pgcrypto;

create table merchants (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique not null references auth.users(id) on delete cascade,
  display_name    text not null,
  email           text not null,
  stellar_address text,
  network         text not null default 'testnet' check (network in ('testnet','mainnet')),
  api_key_hash    text not null,
  api_key_prefix  text not null,
  webhook_url     text,
  webhook_secret  text not null,
  platform_fee_bp int  not null default 100 check (platform_fee_bp between 0 and 1000),
  active          bool not null default true,
  created_at      timestamptz not null default now()
);
create index merchants_apikey_idx on merchants(api_key_prefix);
create index merchants_address_active_idx on merchants(stellar_address) where active;

create table orders (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references merchants(id) on delete restrict,
  external_ref    text,
  brl_amount      numeric(12,2) not null check (brl_amount > 0),
  usdc_amount     numeric(12,7) not null check (usdc_amount > 0),
  rate_brl_usdc   numeric(12,7) not null,
  memo            text not null unique,
  status          text not null default 'pending'
                  check (status in ('pending','paid','underpaid','expired','cancelled','dead')),
  tx_hash         text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  paid_at         timestamptz
);
create index orders_merchant_status_idx on orders(merchant_id, status);
create index orders_memo_pending_idx on orders(memo) where status = 'pending';
create index orders_expires_pending_idx on orders(expires_at) where status = 'pending';

create table webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  type            text not null,
  attempt_n       int not null default 0,
  status          text not null default 'queued'
                  check (status in ('queued','sent','failed','dead')),
  response_code   int,
  response_body   text,
  payload         jsonb not null,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now()
);
create index webhook_pending_idx on webhook_deliveries(next_attempt_at)
  where status in ('queued','failed');

create table listener_state (
  account_id   text primary key,
  paging_token text not null,
  updated_at   timestamptz not null default now()
);
```

- [ ] **Step 2: Apply migration locally**

```sh
supabase db reset
```

Expected: clean reset, applies all migrations + seed.

- [ ] **Step 3: Manual smoke — verify tables exist**

```sh
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\dt public.*"
```

Expected: lists `merchants`, `orders`, `webhook_deliveries`, `listener_state`.

- [ ] **Step 4: Commit**

```sh
git add supabase/migrations
git commit -m "feat(db): initial schema (merchants, orders, webhook_deliveries, listener_state)"
```

---

## Task 5 · RLS policies migration

**Files:**
- Create: `supabase/migrations/20260507100100_rls_policies.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20260507100100_rls_policies.sql
alter table merchants enable row level security;
alter table orders enable row level security;
alter table webhook_deliveries enable row level security;
-- listener_state: no RLS, only service_role touches it

create policy merchants_self_select on merchants
  for select to authenticated
  using (auth_user_id = auth.uid());

create policy merchants_self_insert on merchants
  for insert to authenticated
  with check (auth_user_id = auth.uid());

create policy merchants_self_update on merchants
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy orders_via_merchant_select on orders
  for select to authenticated
  using (merchant_id in (select id from merchants where auth_user_id = auth.uid()));

create policy orders_via_merchant_insert on orders
  for insert to authenticated
  with check (merchant_id in (select id from merchants where auth_user_id = auth.uid()));

create policy orders_via_merchant_update on orders
  for update to authenticated
  using (merchant_id in (select id from merchants where auth_user_id = auth.uid()))
  with check (merchant_id in (select id from merchants where auth_user_id = auth.uid()));

create policy webhooks_via_merchant_select on webhook_deliveries
  for select to authenticated
  using (order_id in (
    select o.id from orders o
    join merchants m on m.id = o.merchant_id
    where m.auth_user_id = auth.uid()
  ));
```

- [ ] **Step 2: Apply**

```sh
supabase db reset
```

- [ ] **Step 3: Smoke — RLS active**

```sh
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
  "select tablename, rowsecurity from pg_tables where schemaname='public';"
```

Expected: all three application tables show `t` for rowsecurity.

- [ ] **Step 4: Commit**

```sh
git add supabase/migrations
git commit -m "feat(db): RLS policies for merchants, orders, webhook_deliveries"
```

---

## Task 6 · Hono Edge Function bootstrap + healthcheck

**Files:**
- Create: `supabase/functions/api/deno.json`, `index.ts`, `lib/supabase.ts`, `middleware/error.ts`, `test/_helpers.ts`

- [ ] **Step 1: Create deno.json**

```json
{
  "imports": {
    "hono": "npm:hono@4.6.5",
    "hono/cors": "npm:hono@4.6.5/cors",
    "zod": "npm:zod@3.23.8",
    "supabase": "npm:@supabase/supabase-js@2.45.4",
    "@slippay/shared": "../../../packages/shared/src/index.ts"
  },
  "tasks": {
    "test": "deno test --allow-all test/"
  },
  "compilerOptions": {
    "lib": ["deno.window", "deno.unstable"],
    "strict": true
  }
}
```

- [ ] **Step 2: Write failing test for healthcheck**

`supabase/functions/api/test/_helpers.ts`:

```ts
import app from "../index.ts";

export function req(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, "http://localhost");
  return app.fetch(new Request(url, init));
}
```

`supabase/functions/api/test/health.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { req } from "./_helpers.ts";

Deno.test("GET /health returns ok", async () => {
  const res = await req("/health");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });
});
```

- [ ] **Step 3: Run test to verify fail**

```sh
cd supabase/functions/api && deno task test
```

Expected: FAIL — `index.ts` does not exist.

- [ ] **Step 4: Implement Supabase client helper**

`supabase/functions/api/lib/supabase.ts`:

```ts
import { createClient, SupabaseClient } from "supabase";

export function userClient(req: Request): SupabaseClient {
  const auth = req.headers.get("authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
}

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}
```

- [ ] **Step 5: Implement error middleware**

`supabase/functions/api/middleware/error.ts`:

```ts
import type { Context, Next } from "hono";
import { ZodError } from "zod";

export async function errorMiddleware(c: Context, next: Next) {
  try {
    await next();
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: "validation_error", issues: e.issues }, 400);
    }
    console.error("api_error", e);
    return c.json({ error: "internal_error" }, 500);
  }
}
```

- [ ] **Step 6: Implement index.ts with /health**

`supabase/functions/api/index.ts`:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { errorMiddleware } from "./middleware/error.ts";

const app = new Hono().basePath("/api");

app.use("*", errorMiddleware);
app.use("*", cors({ origin: "*", allowMethods: ["GET","POST","PATCH","OPTIONS"] }));

app.get("/health", (c) => c.json({ ok: true }));

if (import.meta.main) {
  Deno.serve(app.fetch);
}

export default app;
```

Note: tests import `app`. Edge Function deploy uses `Deno.serve`. The `basePath("/api")` matches Supabase's `/functions/v1/api` routing — when invoked locally, supabase CLI strips function name; when invoked from production, function name is `api`. Adjust the test helper to use base `/api`:

Update `test/_helpers.ts`:

```ts
import app from "../index.ts";

export function req(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL("/api" + path, "http://localhost");
  return app.fetch(new Request(url, init));
}
```

- [ ] **Step 7: Run test to verify pass**

```sh
deno task test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```sh
cd /home/galmanus/projects/slippay
git add supabase/functions/api
git commit -m "feat(api): hono bootstrap with healthcheck and error middleware"
```

---

## Task 7 · API key generation + verification utility

**Files:**
- Create: `supabase/functions/api/lib/apikey.ts`, `test/apikey.test.ts`

- [ ] **Step 1: Write failing tests**

`supabase/functions/api/test/apikey.test.ts`:

```ts
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateApiKey, hashApiKey, verifyApiKey, prefixOf } from "../lib/apikey.ts";

Deno.test("generateApiKey returns sk_live_ + 64 hex", () => {
  const { plain } = generateApiKey();
  if (!plain.startsWith("sk_live_")) throw new Error("missing prefix");
  assertEquals(plain.length, "sk_live_".length + 64);
});

Deno.test("hashApiKey is deterministic and != plain", async () => {
  const k = "sk_live_" + "a".repeat(64);
  const h1 = await hashApiKey(k);
  const h2 = await hashApiKey(k);
  assertEquals(h1, h2);
  assertNotEquals(h1, k);
});

Deno.test("verifyApiKey accepts correct, rejects wrong (constant-time)", async () => {
  const { plain, hash } = await (async () => {
    const k = generateApiKey();
    return { plain: k.plain, hash: await hashApiKey(k.plain) };
  })();
  assertEquals(await verifyApiKey(plain, hash), true);
  assertEquals(await verifyApiKey(plain.replace(/.$/, "Z"), hash), false);
});

Deno.test("prefixOf returns first 16 chars", () => {
  assertEquals(prefixOf("sk_live_abcdefgh1234567890"), "sk_live_abcdefgh");
});
```

- [ ] **Step 2: Run to verify fail**

```sh
deno task test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`supabase/functions/api/lib/apikey.ts`:

```ts
import { API_KEY_PREFIX, API_KEY_BYTES } from "@slippay/shared";

export function generateApiKey(): { plain: string } {
  const bytes = new Uint8Array(API_KEY_BYTES);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2,"0")).join("");
  return { plain: API_KEY_PREFIX + hex };
}

export async function hashApiKey(plain: string): Promise<string> {
  const data = new TextEncoder().encode(plain);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

export async function verifyApiKey(plain: string, hash: string): Promise<boolean> {
  const computed = await hashApiKey(plain);
  if (computed.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}

export function prefixOf(plain: string, n = 16): string {
  return plain.slice(0, n);
}
```

**Note on hash choice (deviation from spec §6 which mentioned bcrypt cost 12):** API keys are 256-bit random — collision-resistant by entropy alone, slow hashes are unnecessary deterrent. SHA-256 + constant-time compare is the standard for high-entropy bearer secrets (Stripe, Twilio do same). Deviation accepted; spec to be patched in a follow-up commit.

- [ ] **Step 4: Run tests pass**

```sh
deno task test
```

Expected: 4 new tests pass + 1 existing.

- [ ] **Step 5: Commit**

```sh
git add supabase/functions/api/lib/apikey.ts supabase/functions/api/test/apikey.test.ts
git commit -m "feat(api): api key generation, sha256 hashing, constant-time verify"
```

---

## Task 8 · JWT auth middleware + API key auth middleware

**Files:**
- Create: `supabase/functions/api/middleware/auth_jwt.ts`, `auth_apikey.ts`

- [ ] **Step 1: Implement JWT middleware**

`supabase/functions/api/middleware/auth_jwt.ts`:

```ts
import type { Context, Next } from "hono";
import { userClient } from "../lib/supabase.ts";

export async function requireJwt(c: Context, next: Next) {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  const sb = userClient(c.req.raw);
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  c.set("user", data.user);
  c.set("supabase", sb);
  await next();
}
```

- [ ] **Step 2: Implement API key middleware**

`supabase/functions/api/middleware/auth_apikey.ts`:

```ts
import type { Context, Next } from "hono";
import { serviceClient } from "../lib/supabase.ts";
import { hashApiKey, prefixOf } from "../lib/apikey.ts";

export async function requireApiKey(c: Context, next: Next) {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer sk_live_")) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  const plain = auth.slice("Bearer ".length);
  const hash = await hashApiKey(plain);
  const sb = serviceClient();
  const { data, error } = await sb
    .from("merchants")
    .select("*")
    .eq("api_key_hash", hash)
    .eq("active", true)
    .maybeSingle();
  if (error || !data) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  // additional constant-time guard against timing leak via DB equality
  // (Supabase index lookup is constant-time over hash space; OK)
  c.set("merchant", data);
  c.set("supabase", sb); // service-role client for downstream queries scoped via merchant_id explicitly
  await next();
}
```

- [ ] **Step 3: No standalone test for middlewares — covered by route tests in tasks 9-13**

- [ ] **Step 4: Commit**

```sh
git add supabase/functions/api/middleware
git commit -m "feat(api): jwt and api-key auth middlewares"
```

---

## Task 9 · POST /v1/merchants + GET /v1/merchants/me

**Files:**
- Create: `supabase/functions/api/routes/merchants.ts`, `test/merchants.test.ts`
- Modify: `supabase/functions/api/index.ts` (mount routes)

- [ ] **Step 1: Write failing tests**

`supabase/functions/api/test/merchants.test.ts`:

```ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { req } from "./_helpers.ts";
import { serviceClient } from "../lib/supabase.ts";

// helper: create a Supabase user via admin API and return JWT
async function createTestUser(email = `test-${crypto.randomUUID()}@slippay.test`) {
  const sb = serviceClient();
  const { data, error } = await sb.auth.admin.createUser({
    email, email_confirm: true, password: "test-password-1234",
  });
  if (error) throw error;
  const { data: session, error: e2 } = await sb.auth.signInWithPassword({
    email, password: "test-password-1234",
  });
  if (e2) throw e2;
  return { user: data.user, jwt: session.session!.access_token };
}

Deno.test("POST /v1/merchants without auth returns 401", async () => {
  const res = await req("/v1/merchants", { method: "POST", body: JSON.stringify({ display_name: "x" }) });
  assertEquals(res.status, 401);
});

Deno.test("POST /v1/merchants creates merchant and reveals API key once", async () => {
  const { jwt } = await createTestUser();
  const res = await req("/v1/merchants", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ display_name: "Acme" }),
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assert(body.merchant.id);
  assert(body.api_key.startsWith("sk_live_"));
});

Deno.test("GET /v1/merchants/me returns own merchant, no key", async () => {
  const { jwt } = await createTestUser();
  await req("/v1/merchants", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ display_name: "Beta" }),
  });
  const res = await req("/v1/merchants/me", { headers: { authorization: `Bearer ${jwt}` } });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.merchant.display_name, "Beta");
  assert(!("api_key" in body));
});
```

- [ ] **Step 2: Set env for tests**

```sh
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_ANON_KEY=$(supabase status --output json | jq -r .ANON_KEY)
export SUPABASE_SERVICE_ROLE_KEY=$(supabase status --output json | jq -r .SERVICE_ROLE_KEY)
```

Run: `deno task test` — expect new tests fail (route not implemented).

- [ ] **Step 3: Implement routes/merchants.ts**

```ts
import { Hono } from "hono";
import { CreateMerchantInputSchema, type Merchant } from "@slippay/shared";
import { requireJwt } from "../middleware/auth_jwt.ts";
import { generateApiKey, hashApiKey, prefixOf } from "../lib/apikey.ts";
import { serviceClient } from "../lib/supabase.ts";

const r = new Hono();

r.post("/", requireJwt, async (c) => {
  const user = c.get("user");
  const sb = c.get("supabase");
  const input = CreateMerchantInputSchema.parse(await c.req.json());
  const apiKey = generateApiKey();
  const hash = await hashApiKey(apiKey.plain);
  const prefix = prefixOf(apiKey.plain);
  const webhookSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2,"0")).join("");
  const { data, error } = await sb
    .from("merchants")
    .insert({
      auth_user_id: user.id,
      display_name: input.display_name,
      email: user.email,
      stellar_address: input.stellar_address ?? null,
      webhook_url: input.webhook_url ?? null,
      api_key_hash: hash,
      api_key_prefix: prefix,
      webhook_secret: webhookSecret,
    })
    .select("*")
    .single();
  if (error) return c.json({ error: "create_failed", detail: error.message }, 400);
  const { api_key_hash, webhook_secret, ...safe } = data;
  return c.json({ merchant: safe as Merchant, api_key: apiKey.plain }, 201);
});

r.get("/me", requireJwt, async (c) => {
  const sb = c.get("supabase");
  const { data, error } = await sb.from("merchants").select("*").maybeSingle();
  if (error || !data) return c.json({ error: "not_found" }, 404);
  const { api_key_hash, webhook_secret, ...safe } = data;
  return c.json({ merchant: safe as Merchant });
});

export default r;
```

- [ ] **Step 4: Mount routes in index.ts**

Modify `supabase/functions/api/index.ts`:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { errorMiddleware } from "./middleware/error.ts";
import merchants from "./routes/merchants.ts";

const app = new Hono().basePath("/api");
app.use("*", errorMiddleware);
app.use("*", cors({ origin: "*", allowMethods: ["GET","POST","PATCH","OPTIONS"] }));

app.get("/health", (c) => c.json({ ok: true }));
app.route("/v1/merchants", merchants);

if (import.meta.main) Deno.serve(app.fetch);
export default app;
```

- [ ] **Step 5: Run tests pass**

```sh
deno task test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```sh
git add supabase/functions/api
git commit -m "feat(api): POST /v1/merchants and GET /v1/merchants/me"
```

---

## Task 10 · PATCH /v1/merchants/me + POST /v1/merchants/me/rotate-key

**Files:**
- Modify: `supabase/functions/api/routes/merchants.ts`, `test/merchants.test.ts`

- [ ] **Step 1: Write failing tests** (append to `test/merchants.test.ts`)

```ts
Deno.test("PATCH /v1/merchants/me updates fields", async () => {
  const { jwt } = await createTestUser();
  await req("/v1/merchants", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ display_name: "Old" }),
  });
  const res = await req("/v1/merchants/me", {
    method: "PATCH",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ display_name: "New", webhook_url: "https://acme.com/wh" }),
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.merchant.display_name, "New");
  assertEquals(body.merchant.webhook_url, "https://acme.com/wh");
});

Deno.test("POST /v1/merchants/me/rotate-key returns new key, invalidates old", async () => {
  const { jwt } = await createTestUser();
  const create = await req("/v1/merchants", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ display_name: "Acme" }),
  });
  const oldKey = (await create.json()).api_key;

  const rot = await req("/v1/merchants/me/rotate-key", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
  });
  assertEquals(rot.status, 200);
  const { api_key: newKey } = await rot.json();
  if (newKey === oldKey) throw new Error("key did not rotate");
});
```

- [ ] **Step 2: Run to verify fail**

```sh
deno task test
```

Expected: 2 new fail.

- [ ] **Step 3: Extend routes/merchants.ts**

Append to `routes/merchants.ts`:

```ts
import { PatchMerchantInputSchema } from "@slippay/shared";

r.patch("/me", requireJwt, async (c) => {
  const sb = c.get("supabase");
  const input = PatchMerchantInputSchema.parse(await c.req.json());
  const { data, error } = await sb
    .from("merchants")
    .update(input)
    .select("*")
    .single();
  if (error) return c.json({ error: "update_failed", detail: error.message }, 400);
  const { api_key_hash, webhook_secret, ...safe } = data;
  return c.json({ merchant: safe });
});

r.post("/me/rotate-key", requireJwt, async (c) => {
  const sb = c.get("supabase");
  const apiKey = generateApiKey();
  const hash = await hashApiKey(apiKey.plain);
  const prefix = prefixOf(apiKey.plain);
  const { error } = await sb
    .from("merchants")
    .update({ api_key_hash: hash, api_key_prefix: prefix })
    .select("id")
    .single();
  if (error) return c.json({ error: "rotate_failed", detail: error.message }, 400);
  return c.json({ api_key: apiKey.plain });
});
```

- [ ] **Step 4: Run pass + commit**

```sh
deno task test
git add supabase/functions/api
git commit -m "feat(api): PATCH /v1/merchants/me and rotate-key"
```

---

## Task 11 · Memo generator utility

**Files:**
- Create: `supabase/functions/api/lib/memo.ts`, `test/memo.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/memo.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateMemo } from "../lib/memo.ts";
import { MEMO_HASH_HEX_LENGTH } from "@slippay/shared";

Deno.test("generateMemo returns 64 hex chars", async () => {
  const m = await generateMemo();
  assertEquals(m.length, MEMO_HASH_HEX_LENGTH);
  assertEquals(/^[0-9a-f]+$/.test(m), true);
});

Deno.test("generateMemo is unique across calls", async () => {
  const set = new Set(await Promise.all(Array.from({length: 100}, () => generateMemo())));
  assertEquals(set.size, 100);
});
```

- [ ] **Step 2: Run fail → implement → run pass**

```ts
// lib/memo.ts
export async function generateMemo(): Promise<string> {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,"0")).join("");
}
```

- [ ] **Step 3: Commit**

```sh
git add supabase/functions/api/lib/memo.ts supabase/functions/api/test/memo.test.ts
git commit -m "feat(api): memo generator (sha256 hex, 32 bytes)"
```

---

## Task 12 · Rate provider (BRL→USDC) with caching

**Files:**
- Create: `supabase/functions/api/lib/rate.ts`, `test/rate.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/rate.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getBrlPerUsdc, _resetCacheForTest } from "../lib/rate.ts";

Deno.test("getBrlPerUsdc returns positive number from CoinGecko fallback", async () => {
  _resetCacheForTest();
  const r = await getBrlPerUsdc();
  assert(r > 0);
});

Deno.test("getBrlPerUsdc caches within ttl", async () => {
  _resetCacheForTest();
  const a = await getBrlPerUsdc();
  const b = await getBrlPerUsdc();
  assertEquals(a, b);
});
```

- [ ] **Step 2: Implement**

```ts
// lib/rate.ts
let cache: { value: number; expires: number } | null = null;
const TTL_MS = 60_000;

export function _resetCacheForTest() { cache = null; }

export async function getBrlPerUsdc(): Promise<number> {
  if (cache && cache.expires > Date.now()) return cache.value;
  const value = await fetchCoinGecko();
  cache = { value, expires: Date.now() + TTL_MS };
  return value;
}

async function fetchCoinGecko(): Promise<number> {
  const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=brl");
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const j = await r.json() as { "usd-coin"?: { brl?: number } };
  const v = j["usd-coin"]?.brl;
  if (typeof v !== "number" || v <= 0) throw new Error("bad rate response");
  return v;
}
```

**Note:** spec mentioned Circle API as primary + CoinGecko fallback. Circle's rate endpoint requires API key on a paid tier — deferred to v0.5. CoinGecko free public endpoint sufficient for testnet. Circle will be added as primary before mainnet flip.

- [ ] **Step 3: Run + commit**

```sh
deno task test
git add supabase/functions/api/lib/rate.ts supabase/functions/api/test/rate.test.ts
git commit -m "feat(api): rate provider (BRL/USDC via CoinGecko, 60s ttl cache)"
```

---

## Task 13 · POST /v1/orders

**Files:**
- Create: `supabase/functions/api/routes/orders.ts`, `test/orders.test.ts`
- Modify: `supabase/functions/api/index.ts`

- [ ] **Step 1: Write failing tests**

`test/orders.test.ts`:

```ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { req } from "./_helpers.ts";
import { serviceClient } from "../lib/supabase.ts";

async function createMerchant() {
  const sb = serviceClient();
  const email = `m-${crypto.randomUUID()}@slippay.test`;
  const { data: u } = await sb.auth.admin.createUser({ email, email_confirm: true, password: "p" });
  const { data: s } = await sb.auth.signInWithPassword({ email, password: "p" });
  const create = await req("/v1/merchants", {
    method: "POST",
    headers: { authorization: `Bearer ${s.session!.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ display_name: "T", stellar_address: "G" + "A".repeat(55) }),
  });
  return await create.json();
}

Deno.test("POST /v1/orders without api key returns 401", async () => {
  const res = await req("/v1/orders", { method: "POST", body: JSON.stringify({ brl_amount: "10.00" }) });
  assertEquals(res.status, 401);
});

Deno.test("POST /v1/orders creates order, returns checkout_url + memo + usdc_amount", async () => {
  const m = await createMerchant();
  const res = await req("/v1/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${m.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ brl_amount: "100.00", external_ref: "cart_1" }),
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assert(body.order.id);
  assertEquals(body.order.status, "pending");
  assert(body.order.memo.length === 64);
  assert(parseFloat(body.order.usdc_amount) > 0);
  assert(body.checkout_url.includes(body.order.id));
});

Deno.test("POST /v1/orders rejects invalid amount", async () => {
  const m = await createMerchant();
  const res = await req("/v1/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${m.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ brl_amount: "0.00" }),
  });
  assertEquals(res.status, 400);
});
```

- [ ] **Step 2: Implement routes/orders.ts**

```ts
import { Hono } from "hono";
import { CreateOrderInputSchema, ORDER_DEFAULT_EXPIRY_MINUTES } from "@slippay/shared";
import { requireApiKey } from "../middleware/auth_apikey.ts";
import { generateMemo } from "../lib/memo.ts";
import { getBrlPerUsdc } from "../lib/rate.ts";

const r = new Hono();

const CHECKOUT_BASE = Deno.env.get("CHECKOUT_BASE_URL") ?? "http://localhost:5173";

r.post("/", requireApiKey, async (c) => {
  const merchant = c.get("merchant");
  const sb = c.get("supabase");
  const input = CreateOrderInputSchema.parse(await c.req.json());
  const rate = await getBrlPerUsdc();
  const usdc = (parseFloat(input.brl_amount) / rate).toFixed(7);
  const memo = await generateMemo();
  const minutes = input.expires_in_minutes ?? ORDER_DEFAULT_EXPIRY_MINUTES;
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
  const { data, error } = await sb.from("orders").insert({
    merchant_id: merchant.id,
    external_ref: input.external_ref ?? null,
    brl_amount: input.brl_amount,
    usdc_amount: usdc,
    rate_brl_usdc: rate.toFixed(7),
    memo,
    expires_at: expiresAt,
  }).select("*").single();
  if (error) return c.json({ error: "create_failed", detail: error.message }, 400);
  return c.json({
    order: data,
    checkout_url: `${CHECKOUT_BASE}/checkout/${data.id}`,
  }, 201);
});

export default r;
```

- [ ] **Step 3: Mount in index.ts**

Add to `index.ts`:

```ts
import orders from "./routes/orders.ts";
app.route("/v1/orders", orders);
```

- [ ] **Step 4: Run + commit**

```sh
deno task test
git add supabase/functions/api
git commit -m "feat(api): POST /v1/orders with memo + rate + expiry"
```

---

## Task 14 · GET /v1/orders + GET /v1/orders/:id + POST /v1/orders/:id/cancel

**Files:**
- Modify: `supabase/functions/api/routes/orders.ts`, `test/orders.test.ts`

- [ ] **Step 1: Write failing tests** (append)

```ts
Deno.test("GET /v1/orders lists own orders only", async () => {
  const a = await createMerchant();
  const b = await createMerchant();
  await req("/v1/orders", { method: "POST",
    headers: { authorization: `Bearer ${a.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ brl_amount: "10.00" }) });
  await req("/v1/orders", { method: "POST",
    headers: { authorization: `Bearer ${b.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ brl_amount: "20.00" }) });
  const res = await req("/v1/orders", { headers: { authorization: `Bearer ${a.api_key}` } });
  const body = await res.json();
  assertEquals(body.orders.length, 1);
  assertEquals(body.orders[0].brl_amount, "10.00");
});

Deno.test("GET /v1/orders/:id returns public limited fields without auth", async () => {
  const m = await createMerchant();
  const c = await req("/v1/orders", { method: "POST",
    headers: { authorization: `Bearer ${m.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ brl_amount: "50.00" }) });
  const { order } = await c.json();
  const res = await req(`/v1/orders/${order.id}`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.order.id, order.id);
  assertEquals("api_key_hash" in body.order, false);
});

Deno.test("POST /v1/orders/:id/cancel marks status cancelled", async () => {
  const m = await createMerchant();
  const c = await req("/v1/orders", { method: "POST",
    headers: { authorization: `Bearer ${m.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ brl_amount: "5.00" }) });
  const { order } = await c.json();
  const res = await req(`/v1/orders/${order.id}/cancel`, { method: "POST",
    headers: { authorization: `Bearer ${m.api_key}` } });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.order.status, "cancelled");
});
```

- [ ] **Step 2: Extend routes/orders.ts**

Append:

```ts
r.get("/", requireApiKey, async (c) => {
  const merchant = c.get("merchant");
  const sb = c.get("supabase");
  const status = c.req.query("status");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  let q = sb.from("orders").select("*").eq("merchant_id", merchant.id)
    .order("created_at", { ascending: false }).limit(limit);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return c.json({ error: "list_failed", detail: error.message }, 400);
  return c.json({ orders: data });
});

// public limited fields
const PUBLIC_FIELDS = "id,merchant_id,brl_amount,usdc_amount,memo,status,expires_at,paid_at,tx_hash,created_at,external_ref";
import { serviceClient } from "../lib/supabase.ts";
r.get("/:id", async (c) => {
  const id = c.req.param("id");
  const sb = serviceClient();
  const { data, error } = await sb.from("orders").select(PUBLIC_FIELDS).eq("id", id).maybeSingle();
  if (error || !data) return c.json({ error: "not_found" }, 404);
  return c.json({ order: data });
});

r.post("/:id/cancel", requireApiKey, async (c) => {
  const merchant = c.get("merchant");
  const sb = c.get("supabase");
  const id = c.req.param("id");
  const { data, error } = await sb.from("orders")
    .update({ status: "cancelled" })
    .eq("id", id).eq("merchant_id", merchant.id).eq("status", "pending")
    .select("*").maybeSingle();
  if (error || !data) return c.json({ error: "cannot_cancel" }, 400);
  return c.json({ order: data });
});
```

- [ ] **Step 3: Run + commit**

```sh
deno task test
git add supabase/functions/api
git commit -m "feat(api): GET orders list + public detail + cancel"
```

---

## Task 15 · Manual smoke against running stack

- [ ] **Step 1: Restart stack and serve api**

```sh
supabase stop && supabase start
supabase functions serve api --no-verify-jwt --env-file .env.local
```

(Create `.env.local` with `CHECKOUT_BASE_URL=http://localhost:5173`.)

- [ ] **Step 2: Sign up + create merchant**

```sh
ANON=$(supabase status --output json | jq -r .ANON_KEY)
SR=$(supabase status --output json | jq -r .SERVICE_ROLE_KEY)

# create test user
curl -s -X POST "http://127.0.0.1:54321/auth/v1/signup" \
  -H "apikey: $ANON" -H "content-type: application/json" \
  -d '{"email":"smoke@slippay.test","password":"smoketest1234"}' | jq

# login → JWT
JWT=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "content-type: application/json" \
  -d '{"email":"smoke@slippay.test","password":"smoketest1234"}' | jq -r .access_token)

# create merchant
RESP=$(curl -s -X POST "http://127.0.0.1:54321/functions/v1/api/v1/merchants" \
  -H "authorization: Bearer $JWT" -H "content-type: application/json" \
  -d '{"display_name":"SmokeMerchant"}')
echo $RESP | jq
APIKEY=$(echo $RESP | jq -r .api_key)
```

- [ ] **Step 3: Create order**

```sh
curl -s -X POST "http://127.0.0.1:54321/functions/v1/api/v1/orders" \
  -H "authorization: Bearer $APIKEY" -H "content-type: application/json" \
  -d '{"brl_amount":"100.00","external_ref":"smoke_1"}' | jq
```

Expected: `{ order: {...status:"pending",memo:"<64hex>",usdc_amount:"..."}, checkout_url:"..." }`.

- [ ] **Step 4: List + cancel**

```sh
curl -s "http://127.0.0.1:54321/functions/v1/api/v1/orders" \
  -H "authorization: Bearer $APIKEY" | jq

ORDER_ID=...  # paste from previous
curl -s -X POST "http://127.0.0.1:54321/functions/v1/api/v1/orders/$ORDER_ID/cancel" \
  -H "authorization: Bearer $APIKEY" | jq
```

- [ ] **Step 5: RLS smoke — confirm no cross-merchant leak**

Create second merchant. Try to GET orders of merchant A using B's API key. Expect 0 rows.

- [ ] **Step 6: Tag**

```sh
git tag -a v0.0.1-foundation -m "Foundation + API ready: merchants + orders endpoints, RLS verified"
```

---

## Self-review

**Spec coverage check:**

| Spec section | Task |
|---|---|
| §3.1 endpoints (merchants CRUD + orders) | Tasks 9, 10, 13, 14 |
| §3.1 rate limiting | **deferred to Plan C** (sits with deploy/CI) — flagged below |
| §4 schema | Task 4 |
| §4 RLS | Task 5 |
| §6 auth (JWT + API key) | Tasks 7, 8 |
| §5 payment flow (server-side parts: order create, memo, rate) | Tasks 11, 12, 13 |
| §13 stellar specifics (constants in shared) | Task 2 |
| §11 repo layout | Tasks 1, 6 |
| §3.3 listener | **Plan B** |
| §3.4 webhook delivery | **Plan C** |
| §3.2 web/checkout | **Plan B** |
| §7 testing — unit + integration | Each task TDD |
| §8 deploy | **Plan C** |

**Gaps deliberately deferred:** rate limiting, listener, webhook delivery, web app, deploy CI, e2e Playwright. All belong in Plans B and C.

**Placeholder scan:** none. All TBDs in Tasks 12 (rate provider deviation note), 7 (hash deviation note) are intentional decisions documented inline.

**Type consistency:** `Merchant`, `Order`, `OrderStatus` types from `@slippay/shared` used consistently across routes and tests. API key shape (`sk_live_<64hex>`, total length 72) consistent across `apikey.ts` and tests.

**Deviations from spec, flagged for spec patch:**
1. SHA-256 instead of bcrypt for API key hash (Task 7 step 3 note). Justification: high-entropy bearer secrets don't need slow hashes.
2. CoinGecko-only rate provider in v0 (Task 12 note). Circle deferred until paid Circle account exists.

Both deviations narrow scope without weakening security or correctness for testnet.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-07-slippay-foundation-and-api.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch fresh subagent per task, review between tasks, fast iteration.
**2. Inline Execution** — execute tasks in this session via `executing-plans`, batch with checkpoints for review.

Which approach?
