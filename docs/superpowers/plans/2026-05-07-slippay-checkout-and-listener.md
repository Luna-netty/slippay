# SlipPay Checkout + Listener Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buyer-facing React checkout that builds an atomic Stellar tx (merchant USDC payment + platform fee), signs with `stellar-wallets-kit`, and submits to Horizon. Plus a Node listener container that consumes Horizon SSE streams, matches memos, and updates `orders.status='paid'`. Ships when an end-to-end testnet payment runs from API order create → checkout sign → listener detect → DB update, exercised manually with Freighter testnet.

**Architecture:** `apps/web` is a Vite SPA with two functional routes (`/checkout/:order_id`, root marketing placeholder) and Plan-C placeholders for `/signup`, `/login`, `/dashboard`. `apps/listener` is a Node container that opens one Horizon SSE stream per active merchant address, persists a per-address cursor in `listener_state`, and writes order updates with `service_role` privileges. Webhook *delivery* lives in Plan C; this plan only enqueues `webhook_deliveries` rows.

**Tech Stack:** React 18, Vite 5, Tailwind 3, react-router-dom 6, `@stellar/stellar-sdk` (latest stable), `@creit.tech/stellar-wallets-kit`, Node 22 + TypeScript 5 (listener), `@supabase/supabase-js` 2.x, `eventsource` polyfill (or native fetch streaming), vitest 2 (unit tests).

**Reference spec:** `docs/superpowers/specs/2026-05-07-slippay-design.md` (commit `72a98b0`). Plan A shipped as `v0.0.1-foundation` (commit `fbfa165`).

---

## Decisions consolidated for Plan B

| Decision | Choice | Rationale |
|---|---|---|
| Web framework | Vite + React + Tailwind | matches spec §3.2, fast dev loop, no SSR needed for SPA checkout. |
| Routing | react-router-dom 6 | smallest viable router, declarative, plays well with Vite. |
| State | None (props + URL params) | one route does real work, `useState`/`useEffect` is enough; redux/zustand is yagni. |
| Wallet integration | `stellar-wallets-kit` | exact spec call; vendor-neutral wallet picker. |
| Stellar SDK | `@stellar/stellar-sdk` (`npm:@stellar/stellar-sdk`) | spec; works in browser bundle and Node. **Pin exact version at scaffold (Task 1).** |
| Listener language | Node + TypeScript | same SDK works server-side, share types via `@slippay/shared`, no Deno-on-VM weirdness for long-lived process. |
| Listener container | Plain Node, not Bun | Bun's HTTP+SSE are fine but Stellar SDK Node-compat is more battle-tested. |
| Listener stream | `server.payments().forAccount(...).cursor(...).stream(...)` | Stellar SDK's first-class streaming API; auto-handles SSE protocol. |
| Listener persistence | service_role Supabase client | bypasses RLS; cursor stored in `listener_state`. |
| Webhook delivery | Plan C | this plan only ENQUEUES `webhook_deliveries`. delivery worker + retries + HMAC are Plan C. |
| Platform Stellar address | testnet keypair, stored in env | generate at Task 9; mainnet is a separate Plan C decision. |

### Falsifiable prediction (60% conf)

End-to-end testnet payment lifecycle (API create → checkout connect → wallet sign → listener detect within 10s → DB updated) ships in **≤3 weeks** of operator + Claude work. Above that = Stellar SDK or wallet-kit integration friction is the bottleneck.

---

## File structure

```
slippay/
├── apps/
│   ├── web/                                  # React SPA
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── postcss.config.cjs
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx                       # router root
│   │   │   ├── index.css                     # tailwind directives
│   │   │   ├── lib/
│   │   │   │   ├── api.ts                    # fetch wrapper for slippay API
│   │   │   │   ├── stellar.ts                # SDK helpers (build atomic tx)
│   │   │   │   └── wallet.ts                 # stellar-wallets-kit setup
│   │   │   ├── pages/
│   │   │   │   ├── Home.tsx                  # placeholder
│   │   │   │   └── Checkout.tsx              # the meat of Plan B
│   │   │   └── components/
│   │   │       ├── Countdown.tsx
│   │   │       └── PayButton.tsx
│   │   └── test/
│   │       ├── stellar.test.ts               # tx build unit
│   │       └── api.test.ts                   # api client unit
│   └── listener/                             # Node service
│       ├── package.json
│       ├── tsconfig.json
│       ├── Dockerfile
│       ├── .dockerignore
│       ├── src/
│       │   ├── main.ts                       # entry
│       │   ├── config.ts                     # env loading
│       │   ├── db.ts                         # supabase service-role client
│       │   ├── horizon.ts                    # SSE subscription per address
│       │   ├── matcher.ts                    # memo + amount + asset match
│       │   ├── reconciler.ts                 # update order, enqueue webhook
│       │   └── log.ts                        # structured logging
│       └── test/
│           ├── matcher.test.ts
│           └── reconciler.test.ts
├── packages/shared/src/
│   └── network.ts                            # NEW: typed network constants helper
└── docs/superpowers/plans/
    └── 2026-05-07-slippay-checkout-and-listener.md   # this file
```

Each file has one responsibility. Web pages are leaf components; logic lives in `lib/`. Listener is split: `horizon.ts` (transport), `matcher.ts` (decision), `reconciler.ts` (DB writes).

---

## Conventions (carried from Plan A)

- Conventional Commits, Co-Authored-By trailer for Claude.
- TDD: failing test first when behavior is testable in unit form. UI/SSE integration: write integration test or manual smoke; don't fake unit tests for layers that are mostly I/O.
- Tests live next to code: web in `apps/web/test/`, listener in `apps/listener/test/`.

---

## Task 1 · Web scaffold (Vite + React + Tailwind + router)

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.cjs`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/pages/Home.tsx`

- [ ] **Step 1: Create apps/web/package.json**

```json
{
  "name": "@slippay/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@slippay/shared": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: vite.config.ts**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
```

- [ ] **Step 4: tailwind.config.ts**

```ts
import type { Config } from "tailwindcss";
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
} satisfies Config;
```

- [ ] **Step 5: postcss.config.cjs**

```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 6: index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SlipPay</title>
  </head>
  <body class="bg-zinc-950 text-zinc-100 antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 8: src/main.tsx**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
```

- [ ] **Step 9: src/App.tsx**

```tsx
import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home.tsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="*" element={<div className="p-8">not found</div>} />
    </Routes>
  );
}
```

- [ ] **Step 10: src/pages/Home.tsx**

```tsx
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-semibold">SlipPay</h1>
      <p className="text-zinc-400 mt-2">checkout app · pre-launch</p>
    </main>
  );
}
```

- [ ] **Step 11: Install + smoke**

```sh
cd /home/galmanus/projects/slippay
pnpm install
pnpm --filter @slippay/web dev &
sleep 3
curl -sI http://localhost:5173/ | head -1
kill %1
```

Expected: `HTTP/1.1 200 OK` from Vite dev server.

- [ ] **Step 12: Commit**

```sh
git add apps/web pnpm-lock.yaml package.json
git commit -m "$(cat <<'EOF'
feat(web): vite + react + tailwind scaffold with router

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 · API client + checkout page skeleton

**Files:**
- Create: `apps/web/src/lib/api.ts`, `apps/web/src/pages/Checkout.tsx`, `apps/web/src/components/Countdown.tsx`, `apps/web/test/api.test.ts`
- Modify: `apps/web/src/App.tsx` (add `/checkout/:id` route)

- [ ] **Step 1: Failing test for api client**

`apps/web/test/api.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchOrder } from "../src/lib/api.ts";

describe("fetchOrder", () => {
  it("calls /v1/orders/:id and returns order", async () => {
    const fakeOrder = { id: "abc", brl_amount: "10.00", usdc_amount: "1.7240000", memo: "f".repeat(64), status: "pending", expires_at: "2099-01-01T00:00:00Z" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ order: fakeOrder }), { status: 200 })));
    const result = await fetchOrder("abc");
    expect(result.id).toBe("abc");
    expect(result.status).toBe("pending");
  });

  it("throws on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "not_found" }), { status: 404 })));
    await expect(fetchOrder("missing")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, expect fail**

```sh
pnpm --filter @slippay/web test
```

- [ ] **Step 3: Implement lib/api.ts**

```ts
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:54321/functions/v1/api";

export interface PublicOrder {
  id: string;
  brl_amount: string | number;
  usdc_amount: string;
  memo: string;
  status: string;
  expires_at: string;
  paid_at: string | null;
  tx_hash: string | null;
  created_at: string;
  external_ref: string | null;
  merchant_id: string;
}

export async function fetchOrder(id: string): Promise<PublicOrder> {
  const r = await fetch(`${API_BASE}/v1/orders/${id}`);
  if (!r.ok) throw new Error(`fetch_order_${r.status}`);
  const j = await r.json() as { order: PublicOrder };
  return j.order;
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Implement Countdown component**

`apps/web/src/components/Countdown.tsx`:

```tsx
import { useEffect, useState } from "react";

export function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const m = Math.floor(remaining / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);
  if (remaining === 0) return <span className="text-red-400">expired</span>;
  return <span className="tabular-nums">{m}:{s.toString().padStart(2,"0")}</span>;
}
```

- [ ] **Step 6: Implement Checkout page (skeleton — wallet/sign comes in later tasks)**

`apps/web/src/pages/Checkout.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchOrder, type PublicOrder } from "../lib/api.ts";
import { Countdown } from "../components/Countdown.tsx";

export default function Checkout() {
  const { order_id } = useParams<{ order_id: string }>();
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!order_id) return;
    fetchOrder(order_id).then(setOrder).catch(e => setError(e.message));
  }, [order_id]);

  if (error) return <div className="p-8 text-red-400">{error}</div>;
  if (!order) return <div className="p-8 text-zinc-400">loading...</div>;

  return (
    <main className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-semibold">pay with crypto</h1>
      <div className="mt-8 rounded-lg bg-zinc-900 p-6">
        <div className="text-sm text-zinc-500">amount due</div>
        <div className="text-3xl font-semibold mt-1">R$ {Number(order.brl_amount).toFixed(2)}</div>
        <div className="text-zinc-500 mt-2 tabular-nums">{order.usdc_amount} USDC</div>
        <div className="mt-6 text-sm text-zinc-500">
          expires in <Countdown expiresAt={order.expires_at} />
        </div>
      </div>
      <button disabled className="mt-6 w-full rounded-lg bg-zinc-800 text-zinc-500 py-3">
        connect wallet (Task 4)
      </button>
    </main>
  );
}
```

- [ ] **Step 7: Add route in App.tsx**

```tsx
import Checkout from "./pages/Checkout.tsx";
// ...inside <Routes>
<Route path="/checkout/:order_id" element={<Checkout />} />
```

- [ ] **Step 8: Manual smoke**

```sh
pnpm --filter @slippay/web dev
# in another terminal: hit /checkout/<some-real-order-id> from Plan A
```

Expected: page renders amount + countdown.

- [ ] **Step 9: Commit**

```sh
git commit -m "$(cat <<'EOF'
feat(web): api client + checkout page skeleton (no wallet yet)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 · Wallet connect via stellar-wallets-kit

**Files:**
- Create: `apps/web/src/lib/wallet.ts`, `apps/web/src/components/PayButton.tsx`
- Modify: `apps/web/package.json` (add `@creit.tech/stellar-wallets-kit`), `apps/web/src/pages/Checkout.tsx` (replace placeholder button)

- [ ] **Step 1: Add dependency**

```sh
pnpm --filter @slippay/web add @creit.tech/stellar-wallets-kit
```

- [ ] **Step 2: Implement wallet.ts**

```ts
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  FREIGHTER_ID,
} from "@creit.tech/stellar-wallets-kit";

const network = (import.meta.env.VITE_STELLAR_NETWORK ?? "TESTNET").toUpperCase();
export const NETWORK = network === "PUBLIC" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET;

export const kit = new StellarWalletsKit({
  network: NETWORK,
  selectedWalletId: FREIGHTER_ID,
  modules: allowAllModules(),
});

export async function connectWallet(): Promise<string> {
  await kit.openModal({
    onWalletSelected: async (option) => kit.setWallet(option.id),
  });
  const { address } = await kit.getAddress();
  return address;
}

export async function signTx(xdr: string): Promise<string> {
  const { signedTxXdr } = await kit.signTransaction(xdr, { networkPassphrase: NETWORK });
  return signedTxXdr;
}
```

- [ ] **Step 3: Implement PayButton component (states only, real signing in Task 5)**

```tsx
// components/PayButton.tsx
import { useState } from "react";
import { connectWallet } from "../lib/wallet.ts";

export function PayButton({ onConnected }: { onConnected: (addr: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-6">
      <button
        disabled={loading}
        onClick={async () => {
          setLoading(true); setError(null);
          try {
            const addr = await connectWallet();
            onConnected(addr);
          } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "wallet error");
          } finally { setLoading(false); }
        }}
        className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black py-3 font-semibold disabled:opacity-50"
      >
        {loading ? "connecting..." : "connect wallet"}
      </button>
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Wire into Checkout page**

In `pages/Checkout.tsx`, add wallet state:

```tsx
const [walletAddress, setWalletAddress] = useState<string | null>(null);
// ...replace placeholder button:
{!walletAddress
  ? <PayButton onConnected={setWalletAddress} />
  : <div className="mt-6 text-sm text-zinc-400">connected: {walletAddress.slice(0,8)}...{walletAddress.slice(-4)}</div>}
```

- [ ] **Step 5: Manual smoke**

```sh
pnpm --filter @slippay/web dev
# install Freighter testnet, navigate to /checkout/<id>, click connect
```

Expected: wallet picker modal opens; on Freighter select, address appears.

- [ ] **Step 6: Commit**

```sh
git commit -m "$(cat <<'EOF'
feat(web): wallet connect via stellar-wallets-kit (Freighter, Lobstr, xBull, Albedo, Hana)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 · Atomic tx build (Stellar SDK)

**Files:**
- Create: `apps/web/src/lib/stellar.ts`, `apps/web/test/stellar.test.ts`
- Modify: `apps/web/package.json` (add `@stellar/stellar-sdk`)

- [ ] **Step 1: Add SDK**

```sh
pnpm --filter @slippay/web add @stellar/stellar-sdk
```

- [ ] **Step 2: Failing test**

`apps/web/test/stellar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildAtomicTx } from "../src/lib/stellar.ts";

describe("buildAtomicTx", () => {
  const merchant = "G" + "A".repeat(55);
  const platform = "G" + "B".repeat(55);
  const buyer = { publicKey: () => "G" + "C".repeat(55), accountId: () => "G" + "C".repeat(55) };

  it("returns XDR with 2 payment operations", async () => {
    const xdr = await buildAtomicTx({
      buyerPublicKey: "G" + "C".repeat(55),
      buyerSequence: "1234567890",
      merchantAddress: merchant,
      platformAddress: platform,
      usdcAmount: "10.0000000",
      platformFeeBp: 100,
      memo: "ab".repeat(32),
      network: "TESTNET",
      maxTime: Math.floor(Date.now()/1000) + 1800,
    });
    expect(typeof xdr).toBe("string");
    expect(xdr.length).toBeGreaterThan(50);
  });

  it("rejects zero usdc_amount", async () => {
    await expect(buildAtomicTx({
      buyerPublicKey: "G" + "C".repeat(55),
      buyerSequence: "1",
      merchantAddress: merchant,
      platformAddress: platform,
      usdcAmount: "0",
      platformFeeBp: 100,
      memo: "ab".repeat(32),
      network: "TESTNET",
      maxTime: Math.floor(Date.now()/1000) + 1800,
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run, expect fail**

- [ ] **Step 4: Implement stellar.ts**

```ts
import {
  Account,
  Asset,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { NETWORK as TESTNET_USDC_ISSUER, USDC_ASSET_CODE } from "@slippay/shared";
// Note: when @slippay/shared exposes NETWORK as the {testnet,mainnet} object, import accordingly.
// We'll use a simpler local map below to avoid coupling at build time.

const ISSUERS: Record<string, string> = {
  TESTNET: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  PUBLIC:  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
};

const PASSPHRASES: Record<string, string> = {
  TESTNET: Networks.TESTNET,
  PUBLIC:  Networks.PUBLIC,
};

export interface BuildAtomicTxArgs {
  buyerPublicKey: string;
  buyerSequence: string;        // current sequence as string
  merchantAddress: string;
  platformAddress: string;
  usdcAmount: string;           // 7-decimal string (Stellar precision)
  platformFeeBp: number;        // basis points; 100 = 1%
  memo: string;                 // 64 hex chars
  network: "TESTNET" | "PUBLIC";
  maxTime: number;              // unix seconds
}

export async function buildAtomicTx(args: BuildAtomicTxArgs): Promise<string> {
  const total = Number(args.usdcAmount);
  if (!isFinite(total) || total <= 0) throw new Error("invalid_amount");
  const fee = total * (args.platformFeeBp / 10_000);
  const merchantShare = (total - fee).toFixed(7);
  const feeShare = fee.toFixed(7);

  const issuer = ISSUERS[args.network];
  const usdc = new Asset(USDC_ASSET_CODE, issuer);

  const account = new Account(args.buyerPublicKey, args.buyerSequence);
  const memoBytes = Buffer.from(args.memo, "hex");
  if (memoBytes.length !== 32) throw new Error("invalid_memo");

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASES[args.network],
    memo: Memo.hash(memoBytes),
    timebounds: { minTime: 0, maxTime: args.maxTime },
  })
    .addOperation(Operation.payment({
      destination: args.merchantAddress,
      asset: usdc,
      amount: merchantShare,
    }))
    .addOperation(Operation.payment({
      destination: args.platformAddress,
      asset: usdc,
      amount: feeShare,
    }))
    .build();

  return tx.toXDR();
}
```

- [ ] **Step 5: Tests pass**

- [ ] **Step 6: Commit**

```sh
git commit -m "$(cat <<'EOF'
feat(web): atomic stellar tx builder (merchant payment + platform fee + memo hash)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 · Sign + submit + wallet rejection handling

**Files:**
- Modify: `apps/web/src/lib/stellar.ts` (add `submitTx`), `apps/web/src/pages/Checkout.tsx` (wire up sign+submit), `apps/web/src/lib/wallet.ts` (export `signTx`)

- [ ] **Step 1: Add fetchAccount + submitTx helpers in stellar.ts**

```ts
import { Horizon } from "@stellar/stellar-sdk";

const HORIZON: Record<string, string> = {
  TESTNET: "https://horizon-testnet.stellar.org",
  PUBLIC:  "https://horizon.stellar.org",
};

export async function fetchSequence(network: "TESTNET" | "PUBLIC", publicKey: string): Promise<string> {
  const server = new Horizon.Server(HORIZON[network]);
  const account = await server.loadAccount(publicKey);
  return account.sequence;
}

export async function submitSignedTx(network: "TESTNET" | "PUBLIC", signedXdr: string): Promise<{ hash: string }> {
  const server = new Horizon.Server(HORIZON[network]);
  const tx = TransactionBuilder.fromXDR(signedXdr, PASSPHRASES[network]);
  const res = await server.submitTransaction(tx);
  return { hash: (res as { hash: string }).hash };
}
```

- [ ] **Step 2: Add submit flow in Checkout.tsx**

Replace the simple "connected: ..." display with:

```tsx
{walletAddress && (
  <button
    onClick={async () => {
      setSubmitState("building");
      try {
        const network = (import.meta.env.VITE_STELLAR_NETWORK ?? "TESTNET").toUpperCase() as "TESTNET" | "PUBLIC";
        const seq = await fetchSequence(network, walletAddress);
        const xdr = await buildAtomicTx({
          buyerPublicKey: walletAddress,
          buyerSequence: seq,
          merchantAddress: order.merchant_stellar_address!,    // see Task 5b note
          platformAddress: import.meta.env.VITE_PLATFORM_ADDRESS!,
          usdcAmount: order.usdc_amount,
          platformFeeBp: 100,
          memo: order.memo,
          network,
          maxTime: Math.floor(new Date(order.expires_at).getTime() / 1000),
        });
        setSubmitState("signing");
        const signed = await signTx(xdr);
        setSubmitState("submitting");
        const { hash } = await submitSignedTx(network, signed);
        setTxHash(hash);
        setSubmitState("submitted");
      } catch (e: unknown) {
        setSubmitState("error");
        setError(e instanceof Error ? e.message : "unknown error");
      }
    }}
  >pay {order.usdc_amount} USDC</button>
)}
```

(Local state additions: `submitState`, `txHash`. Render appropriate UX per state.)

- [ ] **Step 2b: Plan-A patch — expose merchant_stellar_address on public order**

The current `GET /v1/orders/:id` returns `PUBLIC_FIELDS = "id,merchant_id,brl_amount,usdc_amount,memo,status,expires_at,paid_at,tx_hash,created_at,external_ref"`. The frontend needs `merchant.stellar_address` to build the tx. Two options:

(a) Add `merchant_stellar_address` to the public order response by joining merchants. **Preferred.**
(b) Frontend fetches a separate `/v1/checkout/:id` endpoint. More routes.

Implement (a):

In `supabase/functions/api/routes/orders.ts`, modify the `GET /:id` handler to:

```ts
r.get("/:id", async (c) => {
  const id = c.req.param("id");
  const sb = serviceClient();
  const { data, error } = await sb.from("orders")
    .select(`
      id, merchant_id, brl_amount, usdc_amount, memo, status,
      expires_at, paid_at, tx_hash, created_at, external_ref,
      merchants ( stellar_address )
    `)
    .eq("id", id).maybeSingle();
  if (error || !data) return c.json({ error: "not_found" }, 404);
  const merchant_stellar_address = (data.merchants as { stellar_address: string | null } | null)?.stellar_address ?? null;
  const { merchants, ...rest } = data;
  return c.json({ order: { ...rest, merchant_stellar_address } });
});
```

Update `apps/web/src/lib/api.ts` `PublicOrder` type to include `merchant_stellar_address: string | null`.

Update `apps/web/test/api.test.ts` to assert it round-trips.

Update `supabase/functions/api/test/orders.test.ts` (the public detail test) to assert the field is present.

- [ ] **Step 3: Run all tests** — `pnpm test` at root + `pnpm --filter @slippay/api test` (or `cd supabase/functions/api && deno test ...`).

- [ ] **Step 4: Commit (single commit, includes both web and api changes)**

```sh
git commit -m "$(cat <<'EOF'
feat(checkout): sign + submit atomic tx via wallet, expose merchant address on public order

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 · Status polling + paid view

**Files:**
- Modify: `apps/web/src/pages/Checkout.tsx`

- [ ] **Step 1: Add polling hook**

After tx submit succeeds, frontend polls `GET /v1/orders/:id` every 2s until `status === "paid"` or `expires_at` passes.

```tsx
useEffect(() => {
  if (submitState !== "submitted" || !order_id) return;
  const id = setInterval(async () => {
    try {
      const fresh = await fetchOrder(order_id);
      setOrder(fresh);
      if (fresh.status === "paid") {
        clearInterval(id);
        setSubmitState("paid");
      }
    } catch {}
  }, 2000);
  return () => clearInterval(id);
}, [submitState, order_id]);
```

- [ ] **Step 2: Render terminal states**

```tsx
{submitState === "paid" && (
  <div className="mt-6 rounded-lg bg-emerald-900/30 border border-emerald-700 p-4">
    <div className="text-emerald-300 font-semibold">payment confirmed</div>
    {txHash && (
      <a className="text-xs text-emerald-200/70 hover:underline mt-1 block break-all"
         href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noreferrer">
        {txHash}
      </a>
    )}
  </div>
)}
```

- [ ] **Step 3: Commit**

```sh
git commit -m "$(cat <<'EOF'
feat(checkout): poll order status until paid, render confirmation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 · Listener scaffold (Node + TS)

**Files:**
- Create: `apps/listener/package.json`, `tsconfig.json`, `Dockerfile`, `.dockerignore`, `src/main.ts`, `src/config.ts`, `src/log.ts`

- [ ] **Step 1: package.json**

```json
{
  "name": "@slippay/listener",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@slippay/shared": "workspace:*",
    "@stellar/stellar-sdk": "*",
    "@supabase/supabase-js": "^2.45.4"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: src/log.ts**

```ts
type Level = "info" | "warn" | "error" | "debug";
export function log(level: Level, msg: string, ctx: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...ctx }));
}
```

- [ ] **Step 4: src/config.ts**

```ts
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
export const config = {
  supabaseUrl: need("SUPABASE_URL"),
  supabaseServiceRoleKey: need("SUPABASE_SERVICE_ROLE_KEY"),
  network: (process.env.STELLAR_NETWORK ?? "TESTNET").toUpperCase() as "TESTNET" | "PUBLIC",
  merchantPollMs: Number(process.env.MERCHANT_POLL_MS ?? "30000"),
};
```

- [ ] **Step 5: src/main.ts (entry stub)**

```ts
import { config } from "./config.ts";
import { log } from "./log.ts";

async function main() {
  log("info", "listener_starting", { network: config.network });
  // Tasks 8-12 will fill in the actual subscription logic here.
  process.on("SIGTERM", () => { log("info", "listener_stop"); process.exit(0); });
  // keep alive
  await new Promise(() => {});
}

main().catch(e => { log("error", "fatal", { error: String(e) }); process.exit(1); });
```

- [ ] **Step 6: Dockerfile**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared ./packages/shared
COPY apps/listener/package.json ./apps/listener/
RUN pnpm install --frozen-lockfile
COPY apps/listener ./apps/listener
RUN pnpm --filter @slippay/listener build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/listener/dist ./apps/listener/dist
COPY --from=builder /app/apps/listener/package.json ./apps/listener/
WORKDIR /app/apps/listener
USER node
CMD ["node", "dist/main.js"]
```

- [ ] **Step 7: .dockerignore**

```
node_modules
dist
.env*
.git
**/*.test.ts
test
```

- [ ] **Step 8: Smoke**

```sh
pnpm install
pnpm --filter @slippay/listener dev
# expect log: {"level":"info","msg":"listener_starting",...}
```

- [ ] **Step 9: Commit**

```sh
git commit -m "$(cat <<'EOF'
feat(listener): node + ts container scaffold with config and structured logs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 · Listener matcher (pure logic, fully unit tested)

**Files:**
- Create: `apps/listener/src/matcher.ts`, `apps/listener/test/matcher.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// test/matcher.test.ts
import { describe, it, expect } from "vitest";
import { matchPaymentToOrder, type StellarPaymentEvent } from "../src/matcher.ts";

const order = {
  id: "ord-1",
  memo: "ab".repeat(32),
  usdc_amount: "10.0000000",
  merchant_stellar_address: "G" + "M".repeat(55),
  platform_fee_bp: 100,
};

const validEvent: StellarPaymentEvent = {
  memo_type: "hash",
  memo_b64: Buffer.from("ab".repeat(32), "hex").toString("base64"),
  successful: true,
  asset_code: "USDC",
  asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  to: "G" + "M".repeat(55),
  amount: "9.9000000",   // matches merchant share with 1% fee
  hash: "txhash",
};

describe("matchPaymentToOrder", () => {
  it("matches valid USDC payment with correct memo + amount", () => {
    expect(matchPaymentToOrder(validEvent, order, "TESTNET")).toEqual({ outcome: "paid" });
  });

  it("returns underpaid when amount short", () => {
    const e = { ...validEvent, amount: "5.0000000" };
    expect(matchPaymentToOrder(e, order, "TESTNET")).toEqual({ outcome: "underpaid", expected: "9.9000000", received: "5.0000000" });
  });

  it("ignores when memo doesnt match", () => {
    const e = { ...validEvent, memo_b64: Buffer.from("cd".repeat(32), "hex").toString("base64") };
    expect(matchPaymentToOrder(e, order, "TESTNET").outcome).toBe("ignore");
  });

  it("ignores when wrong asset", () => {
    const e = { ...validEvent, asset_code: "XLM", asset_issuer: undefined };
    expect(matchPaymentToOrder(e, order, "TESTNET").outcome).toBe("ignore");
  });

  it("ignores unsuccessful tx", () => {
    const e = { ...validEvent, successful: false };
    expect(matchPaymentToOrder(e, order, "TESTNET").outcome).toBe("ignore");
  });
});
```

- [ ] **Step 2: Implement matcher.ts**

```ts
import { NETWORK, USDC_ASSET_CODE } from "@slippay/shared";

export interface StellarPaymentEvent {
  memo_type: string;
  memo_b64: string;       // base64-encoded raw memo bytes
  successful: boolean;
  asset_code?: string;
  asset_issuer?: string;
  to: string;
  amount: string;
  hash: string;
}

export interface OrderForMatch {
  id: string;
  memo: string;                          // hex
  usdc_amount: string;
  merchant_stellar_address: string;
  platform_fee_bp: number;
}

export type MatchOutcome =
  | { outcome: "paid" }
  | { outcome: "underpaid"; expected: string; received: string }
  | { outcome: "ignore"; reason?: string };

export function matchPaymentToOrder(
  ev: StellarPaymentEvent,
  order: OrderForMatch,
  network: "TESTNET" | "PUBLIC",
): MatchOutcome {
  if (!ev.successful) return { outcome: "ignore", reason: "not_successful" };
  if (ev.memo_type !== "hash") return { outcome: "ignore", reason: "memo_type" };
  if (ev.asset_code !== USDC_ASSET_CODE) return { outcome: "ignore", reason: "asset_code" };

  const expectedIssuer = network === "PUBLIC" ? NETWORK.mainnet.usdc_issuer : NETWORK.testnet.usdc_issuer;
  if (ev.asset_issuer !== expectedIssuer) return { outcome: "ignore", reason: "asset_issuer" };

  if (ev.to !== order.merchant_stellar_address) return { outcome: "ignore", reason: "destination" };

  // memo: order.memo is hex; ev.memo_b64 is base64 of the same 32 bytes
  const evMemoHex = Buffer.from(ev.memo_b64, "base64").toString("hex");
  if (evMemoHex !== order.memo) return { outcome: "ignore", reason: "memo_mismatch" };

  // amount: expected is merchant_share = total * (1 - fee_bp/10000)
  const total = Number(order.usdc_amount);
  const expectedMerchantShare = (total * (1 - order.platform_fee_bp / 10_000)).toFixed(7);
  if (Number(ev.amount) >= Number(expectedMerchantShare)) return { outcome: "paid" };

  return { outcome: "underpaid", expected: expectedMerchantShare, received: ev.amount };
}
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```sh
git commit -m "$(cat <<'EOF'
feat(listener): pure matcher (memo + amount + asset + destination) with full unit coverage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 · Reconciler (DB writes + webhook enqueue)

**Files:**
- Create: `apps/listener/src/db.ts`, `apps/listener/src/reconciler.ts`, `apps/listener/test/reconciler.test.ts`

- [ ] **Step 1: db.ts**

```ts
import { createClient } from "@supabase/supabase-js";
import { config } from "./config.ts";
export const db = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
```

- [ ] **Step 2: Failing test for reconciler**

```ts
// test/reconciler.test.ts
import { describe, it, expect, vi } from "vitest";
import { reconcileMatch } from "../src/reconciler.ts";

const mockDb = {
  from: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
};

describe("reconcileMatch", () => {
  it("updates pending order to paid and enqueues webhook on outcome=paid", async () => {
    mockDb.single.mockResolvedValueOnce({ data: { id: "ord-1", status: "paid" }, error: null });
    mockDb.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await reconcileMatch(mockDb as any, { id: "ord-1", merchant_id: "m-1" } as any, { outcome: "paid" }, "txhash");
    expect(mockDb.update).toHaveBeenCalledWith(expect.objectContaining({ status: "paid", tx_hash: "txhash" }));
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("is idempotent on already-paid order (no-op)", async () => {
    mockDb.update.mockReset(); mockDb.insert.mockReset();
    mockDb.single.mockResolvedValueOnce({ data: null, error: null }); // no row matched
    await reconcileMatch(mockDb as any, { id: "ord-1", merchant_id: "m-1" } as any, { outcome: "paid" }, "txhash");
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Implement reconciler.ts**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchOutcome, OrderForMatch } from "./matcher.ts";
import { log } from "./log.ts";

export async function reconcileMatch(
  db: SupabaseClient,
  order: OrderForMatch & { merchant_id: string },
  outcome: MatchOutcome,
  txHash: string,
) {
  if (outcome.outcome === "ignore") return;

  const newStatus = outcome.outcome === "paid" ? "paid" : "underpaid";

  const { data, error } = await db.from("orders")
    .update({ status: newStatus, tx_hash: txHash, paid_at: newStatus === "paid" ? new Date().toISOString() : null })
    .eq("id", order.id)
    .eq("status", "pending")          // idempotency guard
    .select("*").single();

  if (error || !data) {
    log("warn", "reconcile_skipped", { order_id: order.id, error: error?.message ?? "no_pending_row" });
    return;
  }

  const payload = {
    type: outcome.outcome === "paid" ? "order.paid" : "order.underpaid",
    data: {
      id: order.id,
      external_ref: data.external_ref,
      brl_amount: data.brl_amount,
      usdc_amount: data.usdc_amount,
      tx_hash: txHash,
      memo: order.memo,
      paid_at: data.paid_at,
      ...(outcome.outcome === "underpaid" ? { expected: outcome.expected, received: outcome.received } : {}),
    },
  };

  await db.from("webhook_deliveries").insert({
    order_id: order.id,
    type: payload.type,
    payload,
  });

  log("info", "order_reconciled", { order_id: order.id, status: newStatus, tx_hash: txHash });
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```sh
git commit -m "$(cat <<'EOF'
feat(listener): reconciler updates order + enqueues webhook (idempotent)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 · Horizon SSE consumer (single account)

**Files:**
- Create: `apps/listener/src/horizon.ts`
- Modify: `apps/listener/src/main.ts`

- [ ] **Step 1: Implement horizon.ts**

```ts
import { Horizon } from "@stellar/stellar-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchPaymentToOrder, type StellarPaymentEvent } from "./matcher.ts";
import { reconcileMatch } from "./reconciler.ts";
import { log } from "./log.ts";
import { NETWORK } from "@slippay/shared";

const HORIZON: Record<"TESTNET"|"PUBLIC", string> = {
  TESTNET: NETWORK.testnet.horizon,
  PUBLIC:  NETWORK.mainnet.horizon,
};

export interface AccountWatcherDeps {
  db: SupabaseClient;
  network: "TESTNET" | "PUBLIC";
  accountId: string;
}

export async function watchAccount({ db, network, accountId }: AccountWatcherDeps): Promise<() => void> {
  const server = new Horizon.Server(HORIZON[network]);

  // resume cursor
  const { data: stateRow } = await db.from("listener_state").select("paging_token").eq("account_id", accountId).maybeSingle();
  const cursor = stateRow?.paging_token ?? "now";

  log("info", "stream_open", { account: accountId, cursor });

  const stop = server.payments()
    .forAccount(accountId)
    .cursor(cursor)
    .stream({
      onmessage: async (raw: any) => {
        try {
          if (raw.type !== "payment") return;
          const tx = await raw.transaction();
          const ev: StellarPaymentEvent = {
            memo_type: tx.memo_type,
            memo_b64: tx.memo ?? "",
            successful: tx.successful,
            asset_code: raw.asset_code,
            asset_issuer: raw.asset_issuer,
            to: raw.to,
            amount: raw.amount,
            hash: raw.transaction_hash,
          };

          // find candidate order by memo
          const memoHex = ev.memo_type === "hash" ? Buffer.from(ev.memo_b64, "base64").toString("hex") : "";
          if (!memoHex) {
            await db.from("listener_state").upsert({ account_id: accountId, paging_token: raw.paging_token, updated_at: new Date().toISOString() });
            return;
          }
          const { data: order } = await db.from("orders")
            .select("id, merchant_id, memo, usdc_amount, merchants ( stellar_address, platform_fee_bp )")
            .eq("memo", memoHex)
            .eq("status", "pending")
            .maybeSingle();

          if (order) {
            const merchant = (order as any).merchants as { stellar_address: string; platform_fee_bp: number };
            const orderForMatch = {
              id: order.id,
              merchant_id: order.merchant_id,
              memo: order.memo,
              usdc_amount: order.usdc_amount,
              merchant_stellar_address: merchant.stellar_address,
              platform_fee_bp: merchant.platform_fee_bp,
            };
            const outcome = matchPaymentToOrder(ev, orderForMatch, network);
            await reconcileMatch(db, orderForMatch, outcome, ev.hash);
          }

          // advance cursor regardless of match outcome
          await db.from("listener_state").upsert({ account_id: accountId, paging_token: raw.paging_token, updated_at: new Date().toISOString() });
        } catch (e) {
          log("error", "stream_event_error", { error: String(e) });
        }
      },
      onerror: (e: unknown) => log("error", "stream_error", { account: accountId, error: String(e) }),
    });

  return stop;
}
```

- [ ] **Step 2: Wire into main.ts (single hardcoded test account for now)**

```ts
import { config } from "./config.ts";
import { db } from "./db.ts";
import { watchAccount } from "./horizon.ts";
import { log } from "./log.ts";

async function main() {
  log("info", "listener_starting", { network: config.network });

  // load active merchants once for now (Task 11 makes this dynamic)
  const { data: merchants } = await db.from("merchants").select("id, stellar_address").eq("active", true).not("stellar_address", "is", null);
  const stops: Array<() => void> = [];
  for (const m of merchants ?? []) {
    if (!m.stellar_address) continue;
    stops.push(await watchAccount({ db, network: config.network, accountId: m.stellar_address }));
  }

  process.on("SIGTERM", () => { log("info", "listener_stop"); for (const s of stops) s(); process.exit(0); });
  await new Promise(() => {});
}

main().catch(e => { log("error", "fatal", { error: String(e) }); process.exit(1); });
```

- [ ] **Step 3: Smoke (manual)** — set env, run `pnpm --filter @slippay/listener dev`, watch logs as a Plan-A merchant address receives a testnet tx.

- [ ] **Step 4: Commit**

```sh
git commit -m "$(cat <<'EOF'
feat(listener): horizon SSE per-account stream with cursor persistence

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11 · Multi-merchant subscription manager + reconnect

**Files:**
- Create: `apps/listener/src/manager.ts`, `apps/listener/test/manager.test.ts`
- Modify: `apps/listener/src/main.ts`

- [ ] **Step 1: Implement manager.ts (poll merchants table every 30s, open/close streams as set changes)**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { watchAccount } from "./horizon.ts";
import { log } from "./log.ts";
import { config } from "./config.ts";

interface Active { stop: () => void; }

export function startManager(db: SupabaseClient) {
  const active = new Map<string, Active>();

  async function tick() {
    const { data, error } = await db.from("merchants").select("stellar_address").eq("active", true).not("stellar_address", "is", null);
    if (error) { log("error", "manager_query_failed", { error: error.message }); return; }
    const desired = new Set((data ?? []).map(r => r.stellar_address as string));

    // start new
    for (const addr of desired) {
      if (!active.has(addr)) {
        try {
          const stop = await watchAccount({ db, network: config.network, accountId: addr });
          active.set(addr, { stop });
          log("info", "manager_started", { addr });
        } catch (e) {
          log("error", "manager_start_failed", { addr, error: String(e) });
        }
      }
    }
    // stop removed
    for (const addr of [...active.keys()]) {
      if (!desired.has(addr)) {
        active.get(addr)?.stop();
        active.delete(addr);
        log("info", "manager_stopped", { addr });
      }
    }
  }

  tick();
  const id = setInterval(tick, config.merchantPollMs);

  return () => {
    clearInterval(id);
    for (const a of active.values()) a.stop();
    active.clear();
  };
}
```

- [ ] **Step 2: Replace main.ts body with manager start**

```ts
import { config } from "./config.ts";
import { db } from "./db.ts";
import { startManager } from "./manager.ts";
import { log } from "./log.ts";

async function main() {
  log("info", "listener_starting", { network: config.network });
  const stop = startManager(db);
  process.on("SIGTERM", () => { log("info", "listener_stop"); stop(); process.exit(0); });
  await new Promise(() => {});
}

main().catch(e => { log("error", "fatal", { error: String(e) }); process.exit(1); });
```

- [ ] **Step 3: Reconnect logic note**

The `Horizon.Server.payments().stream()` API auto-reconnects internally per Stellar SDK docs (built on EventSource). If a stream errors fatally, we log via `onerror` but the SDK retries. If the SDK gives up, `manager.tick()` will reopen on next poll because the stop fn would not be in `active`. **Edge case unhandled in v0:** active.has(addr) returns true while the stream is silently dead. Acceptable for testnet smoke; for mainnet, add a heartbeat (last-event timestamp) and force-restart if stale > 60s. Document as Plan-C work.

- [ ] **Step 4: Commit**

```sh
git commit -m "$(cat <<'EOF'
feat(listener): subscription manager polls merchants and opens/closes streams

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12 · End-to-end testnet smoke (manual)

**Goal:** prove the full lifecycle: API order → checkout sign → listener detect → DB updated.

- [ ] **Step 1: Setup**

```sh
# in repo root
supabase start  # if not running
pnpm --filter @slippay/web dev          # terminal 1
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... STELLAR_NETWORK=TESTNET \
  pnpm --filter @slippay/listener dev   # terminal 2
supabase functions serve api --no-verify-jwt --env-file .env.local  # terminal 3
```

- [ ] **Step 2: Generate platform + merchant testnet keypairs**

```sh
# generate platform
node -e "const k=(await import('@stellar/stellar-sdk')).Keypair.random();console.log({pub:k.publicKey(),sec:k.secret()})"
# generate merchant
node -e "const k=(await import('@stellar/stellar-sdk')).Keypair.random();console.log({pub:k.publicKey(),sec:k.secret()})"
```

Fund both via Friendbot:

```sh
curl -s "https://friendbot.stellar.org/?addr=<PLATFORM_PUB>" | jq .successful
curl -s "https://friendbot.stellar.org/?addr=<MERCHANT_PUB>" | jq .successful
```

Add USDC trustline to merchant + platform (one-time, via Stellar Lab or `node` script).

- [ ] **Step 3: Set platform address in web .env**

`apps/web/.env.local`:

```
VITE_STELLAR_NETWORK=TESTNET
VITE_PLATFORM_ADDRESS=<PLATFORM_PUB>
VITE_API_BASE=http://127.0.0.1:54321/functions/v1/api
```

- [ ] **Step 4: Set merchant address on a Plan-A merchant**

```sh
# via psql or supabase studio
update merchants set stellar_address='<MERCHANT_PUB>', active=true where ...;
```

- [ ] **Step 5: Sign up buyer wallet**

Install Freighter (chrome extension), switch to testnet, fund via Freighter UI (it has a testnet faucet button), add USDC trustline.

- [ ] **Step 6: Run lifecycle**

a. `curl -X POST .../v1/orders` with `brl_amount: "10.00"` against the Plan-A merchant API key. Save the returned `id`.

b. Open `http://localhost:5173/checkout/<id>` in browser. See amount + countdown.

c. Click "connect wallet" → Freighter opens → approve.

d. Click "pay X USDC" → Freighter prompts to sign → approve.

e. Watch listener logs (terminal 2) — expect `stream_event` then `order_reconciled` with the order id.

f. Browser polls and transitions to "payment confirmed" view with stellar.expert link.

- [ ] **Step 7: Verify DB state**

```sh
psql ... -c "select id, status, tx_hash, paid_at from orders order by created_at desc limit 1;"
psql ... -c "select id, type, status, payload->>'tx_hash' from webhook_deliveries order by next_attempt_at desc limit 5;"
```

Expected: order row has `status='paid'`, `tx_hash` populated, `paid_at` filled. webhook_deliveries has one row with `type='order.paid'`, `status='queued'`.

- [ ] **Step 8: Tag**

```sh
git tag -a v0.0.2-checkout-listener -m "Checkout signs atomic tx; listener detects on-chain payment; webhook enqueued"
```

---

## Self-review

**Spec coverage check:**

| Spec section | Task |
|---|---|
| §3.2 web/checkout (wallet connect + sign + submit) | Tasks 1–6 |
| §3.3 listener (Horizon SSE, memo match, reconcile) | Tasks 7–11 |
| §5 payment flow steps 4–8 (sign, submit, listener detect, frontend poll) | Tasks 4–6, 10 |
| §3.4 webhook delivery semantics | **Plan C** (this plan only enqueues) |
| §3.2 dashboard | **Plan C** |
| §7 testing — unit for matcher and tx builder; integration covered by manual smoke | Tasks 4, 8, 9, 12 |
| §8 deploy | **Plan C** |
| §9 security checklist (CSP, deploy fingerprint pinning, SRI) | **Plan C** |

**Gaps deliberately deferred to Plan C:** webhook delivery worker + retries + HMAC, dashboard, CI deploys, Playwright E2E, security hardening, mainnet flip.

**Placeholder scan:** none. Task 11 step 3 calls out a known edge case (silent dead stream) as Plan-C work — explicit, not lazy.

**Type consistency:**
- `OrderForMatch` interface used in `matcher.ts` and `horizon.ts` consistently.
- `MatchOutcome` discriminated union used in matcher and reconciler.
- `PublicOrder` interface in `apps/web/src/lib/api.ts` will gain `merchant_stellar_address: string | null` in Task 5b — both the api response and the type update happen in the same commit.

**Deviations from spec, flagged:**
1. `apps/web/src/lib/wallet.ts` reads network from `VITE_STELLAR_NETWORK`. Spec doesn't pin a particular env-var name. Documented in Task 3.
2. Listener uses 30s polling for merchant set changes (Task 11) instead of subscribing to Postgres LISTEN/NOTIFY or a Supabase realtime channel. Polling is simpler and acceptable for v0 (≤10 merchants). Spec doesn't require realtime here.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-07-slippay-checkout-and-listener.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch fresh subagent per task, review between, fast iteration. Same flow as Plan A.
**2. Inline Execution** — execute tasks in this session via `executing-plans`, batched checkpoints.

Which approach?
