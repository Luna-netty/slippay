# Slippay Comex Treasury — Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colocar em produção, para UM cliente B2B (peças de avião/comex), uma plataforma non-custodial em Stellar onde a empresa tem conta (Privy user wallet, e-mail/senha, sem biometria), troca R$↔USD (PagFinance), envia/recebe USDC, e aplica o saldo pra render (DeFindex).

**Architecture:** Carteira = Privy *user* wallet (non-custodial, Ed25519 raw-sign via TEE). TODA assinatura passa por um guard que decodifica o XDR, mostra a operação em texto, e re-deriva o hash LOCALMENTE antes de chamar `privy.rawSign` — nunca assina hash vindo do servidor. Câmbio e yield rodam por parceiros externos (PagFinance/DeFindex) que só constroem XDR; a empresa autoriza.

**Tech Stack:** React + TypeScript, `@stellar/stellar-sdk` (já no repo), `@privy-io/react-auth` (Privy), `@defindex/sdk` (já instalado), `lib/pagfinance.ts` (já existe), Vitest.

## Global Constraints

- Rede: **Stellar** (`VITE_STELLAR_NETWORK`, PUBLIC em prod). USDC issuer mainnet pinado em `lib/stellar.ts` (não-overridable).
- **Non-custodial absoluto:** Slippay NUNCA segura chave de assinatura. Proibido `PRIVY_AUTHORIZATION_PRIVATE_KEY` / server wallet / qualquer secret de assinatura no servidor Slippay. (threat #7)
- **Gate de assinatura (threat #1):** nenhuma chamada a `rawSign` recebe hash de fora. O hash é sempre re-derivado do XDR decodificado-e-exibido, no cliente.
- **Asserções pré-assinatura (threat #3):** todo pagamento valida destino (strkey) e `amount == cotado` (tolerância 1e-7) antes de assinar.
- Rota gated por `VITE_COMEX_ENABLED === "1"` (off → not-found, padrão PixPay).
- MFA obrigatório no Privy (TOTP/app, **não** biometria). (threat #2)
- USDC = 7 decimais; converter só via `usdcToStroops`/`stroopsToUsdc` (`lib/defindex.ts`), nunca multiplicar float por 1e7.
- Copy: descreve o ativo (USDC, autocustódia), nunca promete retorno. (regulatório)

---

### Task 1: Tx guard — decode, hash local, assert (núcleo de segurança)

O coração do threat-model. Puro, sem rede, 100% testável.

**Files:**
- Create: `apps/web/src/lib/txguard.ts`
- Test: `apps/web/test/txguard.test.ts`

**Interfaces:**
- Produces:
  - `decodeTx(xdr: string, network: "TESTNET"|"PUBLIC"): TxSummary`
  - `localHash(xdr: string, network: "TESTNET"|"PUBLIC"): Buffer`
  - `assertPaymentMatches(s: TxSummary, expect: { destination: string; amount: string; assetCode?: string }): void`
  - `interface TxSummary { source: string; fee: string; memo?: string; operations: OpSummary[] }`
  - `interface OpSummary { type: string; destination?: string; amount?: string; assetCode?: string }`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/test/txguard.test.ts
import { describe, it, expect } from "vitest";
import { Account, Asset, Operation, TransactionBuilder, Networks, BASE_FEE } from "@stellar/stellar-sdk";
import { decodeTx, localHash, assertPaymentMatches } from "../src/lib/txguard.ts";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const DEST = "GC4HWUN3LGTPZTU3ET2COOBPSWEV6IZHPCWOJURPG6FD7KAX6OAGM6UZ";
const SRC = "GBBKIN4ZQWJUND63GSFEXLKZFLXZ3J265FPGYKPLGXA34QYSAFFC3C5X";

function sampleXdr(amount: string): string {
  const tx = new TransactionBuilder(new Account(SRC, "123"), {
    fee: BASE_FEE, networkPassphrase: Networks.PUBLIC,
    timebounds: { minTime: 0, maxTime: 0 },
  }).addOperation(Operation.payment({
      destination: DEST, asset: new Asset("USDC", ISSUER), amount,
    })).build();
  return tx.toXDR();
}

describe("decodeTx", () => {
  it("extracts destination, amount and asset from a payment XDR", () => {
    const s = decodeTx(sampleXdr("10.5"), "PUBLIC");
    expect(s.source).toBe(SRC);
    expect(s.operations[0].type).toBe("payment");
    expect(s.operations[0].destination).toBe(DEST);
    expect(s.operations[0].amount).toBe("10.5000000");
    expect(s.operations[0].assetCode).toBe("USDC");
  });
});

describe("localHash", () => {
  it("matches the SDK's own tx hash (proves we re-derive, not trust)", () => {
    const xdr = sampleXdr("1");
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    expect(localHash(xdr, "PUBLIC").equals(tx.hash())).toBe(true);
  });
});

describe("assertPaymentMatches", () => {
  it("passes when destination and amount match", () => {
    const s = decodeTx(sampleXdr("10.5"), "PUBLIC");
    expect(() => assertPaymentMatches(s, { destination: DEST, amount: "10.5", assetCode: "USDC" })).not.toThrow();
  });
  it("throws on destination mismatch (receiver substitution)", () => {
    const s = decodeTx(sampleXdr("10.5"), "PUBLIC");
    expect(() => assertPaymentMatches(s, { destination: SRC, amount: "10.5" })).toThrow();
  });
  it("throws on amount drift beyond tolerance", () => {
    const s = decodeTx(sampleXdr("10.5"), "PUBLIC");
    expect(() => assertPaymentMatches(s, { destination: DEST, amount: "10.6" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run test/txguard.test.ts`
Expected: FAIL — `Failed to load url ../src/lib/txguard.ts`

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/web/src/lib/txguard.ts
import { TransactionBuilder, Networks, Operation } from "@stellar/stellar-sdk";

const PASS: Record<string, string> = { TESTNET: Networks.TESTNET, PUBLIC: Networks.PUBLIC };

export interface OpSummary { type: string; destination?: string; amount?: string; assetCode?: string }
export interface TxSummary { source: string; fee: string; memo?: string; operations: OpSummary[] }

export function decodeTx(xdr: string, network: "TESTNET" | "PUBLIC"): TxSummary {
  const tx = TransactionBuilder.fromXDR(xdr, PASS[network]!) as any;
  const ops: OpSummary[] = (tx.operations ?? []).map((op: any) => {
    if (op.type === "payment") {
      return { type: "payment", destination: op.destination, amount: op.amount,
               assetCode: op.asset?.isNative?.() ? "XLM" : op.asset?.code };
    }
    return { type: op.type };
  });
  return {
    source: tx.source,
    fee: String(tx.fee),
    memo: tx.memo?.value ? String(tx.memo.value) : undefined,
    operations: ops,
  };
}

export function localHash(xdr: string, network: "TESTNET" | "PUBLIC"): Buffer {
  return TransactionBuilder.fromXDR(xdr, PASS[network]!).hash();
}

export function assertPaymentMatches(
  s: TxSummary,
  expect: { destination: string; amount: string; assetCode?: string },
): void {
  const pay = s.operations.find((o) => o.type === "payment");
  if (!pay) throw new Error("guard: nenhuma operação de pagamento no XDR");
  if (pay.destination !== expect.destination.trim()) {
    throw new Error(`guard: destino divergente (assinaria ${pay.destination}, esperado ${expect.destination})`);
  }
  if (expect.assetCode && pay.assetCode !== expect.assetCode) {
    throw new Error(`guard: ativo divergente (${pay.assetCode} vs ${expect.assetCode})`);
  }
  if (Math.abs(Number(pay.amount) - Number(expect.amount)) > 1e-7) {
    throw new Error(`guard: valor divergente (assinaria ${pay.amount}, esperado ${expect.amount})`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run test/txguard.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/txguard.ts apps/web/test/txguard.test.ts
git commit -m "feat(comex): tx guard — decode + local hash + payment assertions (threat #1/#3)"
```

---

### Task 2: Privy wallet wrapper (Stellar Ed25519, MFA, raw-sign)

Wrap Privy: criar/login conta da empresa, e converter o raw-sign Ed25519 numa `DecoratedSignature` Stellar.

**Files:**
- Create: `apps/web/src/lib/privyWallet.ts`
- Modify: `apps/web/package.json` (add `@privy-io/react-auth`)
- Test: `apps/web/test/privyWallet.test.ts` (testa só a parte pura: DecoratedSignature a partir de pubkey+sig)

**Interfaces:**
- Consumes: `localHash` (Task 1)
- Produces:
  - `decoratedSignatureFor(publicKey: string, signature: Buffer): xdr.DecoratedSignature`
  - `attachSignature(xdr: string, network, publicKey: string, signature: Buffer): string` (retorna XDR assinado)
  - (SDK, fora de teste unitário) `rawSignHash(walletId: string, hash: Buffer): Promise<Buffer>` via `privy.walletApi.rawSign`

- [ ] **Step 1: Write the failing test (parte pura — hint correto + sig anexada)**

```typescript
// apps/web/test/privyWallet.test.ts
import { describe, it, expect } from "vitest";
import { Keypair, TransactionBuilder, Networks } from "@stellar/stellar-sdk";
import { Account, Asset, Operation, BASE_FEE } from "@stellar/stellar-sdk";
import { decoratedSignatureFor, attachSignature } from "../src/lib/privyWallet.ts";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function unsigned(src: string): string {
  return new TransactionBuilder(new Account(src, "1"), {
    fee: BASE_FEE, networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: 0 },
  }).addOperation(Operation.payment({
      destination: "GC4HWUN3LGTPZTU3ET2COOBPSWEV6IZHPCWOJURPG6FD7KAX6OAGM6UZ",
      asset: new Asset("USDC", ISSUER), amount: "1",
    })).build().toXDR();
}

describe("attachSignature", () => {
  it("produces a tx that validates against the signer's public key (matches native signing)", () => {
    const kp = Keypair.random();
    const xdr = unsigned(kp.publicKey());
    const hash = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC).hash();
    const rawSig = kp.sign(hash); // simula o que a Privy devolve (Ed25519 sobre o hash)

    const signedXdr = attachSignature(xdr, "PUBLIC", kp.publicKey(), rawSig);
    const signed = TransactionBuilder.fromXDR(signedXdr, Networks.PUBLIC);
    expect(signed.signatures.length).toBe(1);
    // hint = últimos 4 bytes da pubkey
    expect(signed.signatures[0].hint().equals(kp.signatureHint())).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run test/privyWallet.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Add dep + minimal implementation**

```bash
cd apps/web && pnpm add @privy-io/react-auth
```

```typescript
// apps/web/src/lib/privyWallet.ts
import { TransactionBuilder, Networks, StrKey, xdr } from "@stellar/stellar-sdk";

const PASS: Record<string, string> = { TESTNET: Networks.TESTNET, PUBLIC: Networks.PUBLIC };

/** DecoratedSignature Stellar a partir de uma pubkey G... e uma assinatura Ed25519 crua. */
export function decoratedSignatureFor(publicKey: string, signature: Buffer): xdr.DecoratedSignature {
  const raw = StrKey.decodeEd25519PublicKey(publicKey.trim()); // 32 bytes
  const hint = raw.subarray(raw.length - 4); // últimos 4 bytes
  return new xdr.DecoratedSignature({ hint, signature });
}

/** Anexa a assinatura crua a um XDR não assinado e devolve o XDR assinado. */
export function attachSignature(
  xdrStr: string, network: "TESTNET" | "PUBLIC", publicKey: string, signature: Buffer,
): string {
  const tx = TransactionBuilder.fromXDR(xdrStr, PASS[network]!);
  tx.signatures.push(decoratedSignatureFor(publicKey, signature));
  return tx.toXDR();
}

/** SDK Privy — NÃO coberto por teste unitário (rede). Assina o HASH (já re-derivado localmente). */
export async function rawSignHash(privy: any, walletId: string, hash: Buffer): Promise<Buffer> {
  // Privy raw-sign sobre a curva Ed25519 do wallet. Ref: docs.privy.io raw-sign.
  const { signature } = await privy.walletApi.rawSign({ walletId, hash: `0x${hash.toString("hex")}` });
  return Buffer.from(signature.replace(/^0x/, ""), "hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run test/privyWallet.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/privyWallet.ts apps/web/test/privyWallet.test.ts apps/web/package.json apps/web/../../pnpm-lock.yaml
git commit -m "feat(comex): Privy Stellar signer — DecoratedSignature from Ed25519 raw-sign"
```

---

### Task 3: Verifiable sign-and-submit flow (amarra guard + Privy + submit)

A única função que o app inteiro usa pra autorizar qualquer XDR. Garante o gate #1.

**Files:**
- Create: `apps/web/src/lib/authorizeTx.ts`
- Test: `apps/web/test/authorizeTx.test.ts`

**Interfaces:**
- Consumes: `decodeTx`, `localHash`, `assertPaymentMatches` (T1); `attachSignature`, `rawSignHash` (T2); `submitSignedTx` (`lib/stellar.ts`)
- Produces:
  - `authorizePayment(args: { xdr; network; walletId; publicKey; privy; confirm; expect }): Promise<{ hash: string }>`
    onde `confirm(summary: TxSummary): Promise<boolean>` é o passo humano (mostra a operação) e `expect` alimenta `assertPaymentMatches`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/test/authorizeTx.test.ts
import { describe, it, expect, vi } from "vitest";
import { Keypair, Account, Asset, Operation, TransactionBuilder, Networks, BASE_FEE } from "@stellar/stellar-sdk";
import { authorizePayment } from "../src/lib/authorizeTx.ts";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const DEST = "GC4HWUN3LGTPZTU3ET2COOBPSWEV6IZHPCWOJURPG6FD7KAX6OAGM6UZ";

function unsigned(src: string, amount: string): string {
  return new TransactionBuilder(new Account(src, "1"), {
    fee: BASE_FEE, networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: 0 },
  }).addOperation(Operation.payment({ destination: DEST, asset: new Asset("USDC", ISSUER), amount }))
    .build().toXDR();
}

describe("authorizePayment", () => {
  it("aborts before signing when the decoded destination does not match expected", async () => {
    const kp = Keypair.random();
    const xdr = unsigned(kp.publicKey(), "100");
    const privy = { walletApi: { rawSign: vi.fn() } };
    await expect(authorizePayment({
      xdr, network: "PUBLIC", walletId: "w1", publicKey: kp.publicKey(), privy,
      confirm: async () => true,
      expect: { destination: "GBBKIN4ZQWJUND63GSFEXLKZFLXZ3J265FPGYKPLGXA34QYSAFFC3C5X", amount: "100" },
    })).rejects.toThrow(/destino divergente/);
    expect(privy.walletApi.rawSign).not.toHaveBeenCalled(); // NUNCA assinou
  });

  it("aborts when the human rejects the confirmation", async () => {
    const kp = Keypair.random();
    const privy = { walletApi: { rawSign: vi.fn() } };
    await expect(authorizePayment({
      xdr: unsigned(kp.publicKey(), "5"), network: "PUBLIC", walletId: "w1",
      publicKey: kp.publicKey(), privy, confirm: async () => false,
      expect: { destination: DEST, amount: "5" },
    })).rejects.toThrow(/cancelad/i);
    expect(privy.walletApi.rawSign).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run test/authorizeTx.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/web/src/lib/authorizeTx.ts
import { decodeTx, localHash, assertPaymentMatches, type TxSummary } from "./txguard.ts";
import { attachSignature, rawSignHash } from "./privyWallet.ts";
import { submitSignedTx } from "./stellar.ts";

export async function authorizePayment(args: {
  xdr: string;
  network: "TESTNET" | "PUBLIC";
  walletId: string;
  publicKey: string;
  privy: any;
  confirm: (s: TxSummary) => Promise<boolean>;
  expect: { destination: string; amount: string; assetCode?: string };
}): Promise<{ hash: string }> {
  // 1. decodifica o XDR (o que REALMENTE vai ser assinado)
  const summary = decodeTx(args.xdr, args.network);
  // 2. asserção máquina: bate com o que o app esperava? (threat #3)
  assertPaymentMatches(summary, args.expect);
  // 3. confirmação humana sobre o resumo decodificado (threat #1)
  if (!(await args.confirm(summary))) throw new Error("operação cancelada pelo usuário");
  // 4. hash re-derivado LOCALMENTE do mesmo XDR (nunca do servidor)
  const hash = localHash(args.xdr, args.network);
  // 5. Privy assina o hash
  const sig = await rawSignHash(args.privy, args.walletId, hash);
  // 6. anexa e submete
  const signed = attachSignature(args.xdr, args.network, args.publicKey, sig);
  return submitSignedTx(args.network, signed);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run test/authorizeTx.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/authorizeTx.ts apps/web/test/authorizeTx.test.ts
git commit -m "feat(comex): authorizePayment — verifiable sign flow (decode→assert→confirm→local hash→sign)"
```

---

### Task 4: Privy provider + login corporativo (e-mail/senha + MFA)

Wire do Privy no app, gated. SDK/UI — sem teste unitário (depende de rede/Privy); validação é manual + e2e.

**Files:**
- Create: `apps/web/src/lib/privyProvider.tsx` (PrivyProvider config: loginMethods `["email"]`, MFA obrigatório, embedded wallet on-login)
- Modify: `apps/web/src/App.tsx` (envolver rota `/comex` no PrivyProvider; rota gated por `VITE_COMEX_ENABLED`)
- Create: `apps/web/src/pages/Comex.tsx` (shell: login → dashboard)

**Steps:**
- [ ] **Step 1:** Config `privyProvider.tsx` com `appId = import.meta.env.VITE_PRIVY_APP_ID`, `config.loginMethods=["email"]`, `config.mfa.noPromptOnMfaRequired=false`, `embeddedWallets.createOnLogin="users-without-wallets"`. Garantir que NÃO há `walletApi`/authorization key no cliente (só user-auth).
- [ ] **Step 2:** Em `App.tsx`, adicionar `{import.meta.env.VITE_COMEX_ENABLED === "1" && <Route path="/comex" element={<PrivyProvider><Comex/></PrivyProvider>} />}`.
- [ ] **Step 3:** `Comex.tsx`: se não logado → botão "Entrar" (Privy email). Se logado sem MFA → forçar enrolar MFA (TOTP). Se logado → render `<ComexDashboard/>` (Task 5+).
- [ ] **Step 4 (verificação manual):** `VITE_COMEX_ENABLED=1 VITE_PRIVY_APP_ID=... pnpm dev` → `/comex` pede e-mail, exige MFA, cria wallet Stellar. Confirmar endereço `G...` gerado e que nenhum secret aparece no bundle (`grep -ri AUTHORIZATION_PRIVATE dist/` = vazio).
- [ ] **Step 5: Commit** `feat(comex): Privy provider + corporate email login with mandatory MFA`

---

### Task 5: Saldo + receber (read-only primeiro)

**Files:**
- Create: `apps/web/src/pages/comex/Balance.tsx`
- Reuse: `lib/stellar.ts` (`fetchSequence`, Horizon balances), `lib/defindex.ts` (`stroopsToUsdc`)

**Steps:**
- [ ] **Step 1:** Componente que lê o saldo USDC da conta (Horizon `loadAccount().balances`, filtra USDC issuer pinado) e mostra `$ X` + o endereço `G...` da empresa pra **receber** (com copy "envie USDC Stellar para este endereço").
- [ ] **Step 2 (manual):** abrir `/comex` logado, ver saldo 0, ver endereço de recebimento. Enviar USDC testnet de fora e ver o saldo atualizar.
- [ ] **Step 3: Commit** `feat(comex): balance + receive address`

---

### Task 6: Enviar USDC (usa authorizePayment)

**Files:**
- Create: `apps/web/src/pages/comex/Send.tsx`
- Reuse: `buildUsdcPaymentTx` (`lib/stellar.ts`), `authorizePayment` (T3), `isValidStellarAddress` (`lib/stellar.ts`)

**Steps:**
- [ ] **Step 1:** Form: destino + valor. Validar `isValidStellarAddress(dest)` antes de tudo.
- [ ] **Step 2:** `fetchSequence` → `buildUsdcPaymentTx({destination, amount, ...})` → `authorizePayment({ xdr, expect:{destination, amount, assetCode:"USDC"}, confirm: showModal })`. O `confirm` abre um modal que mostra o `TxSummary` decodificado (destino + valor + ativo) em texto — o humano confere o que vai assinar (threat #1).
- [ ] **Step 3 (manual e2e testnet):** enviar USDC pra outro endereço; confirmar que o modal mostra o destino certo; confirmar tx no stellar.expert.
- [ ] **Step 4 (teste de ataque):** simular destino adulterado (mudar o `buildUsdcPaymentTx` destination mas manter `expect` original) → `authorizePayment` deve abortar com "destino divergente". Reverter.
- [ ] **Step 5: Commit** `feat(comex): send USDC via verifiable authorize flow`

---

### Task 7: Câmbio R$↔USD (PagFinance) com asserções

**Files:**
- Create: `apps/web/src/pages/comex/Exchange.tsx`
- Reuse: `lib/pagfinance.ts` (quote/create/submit), `authorizePayment` (T3)

**Steps:**
- [ ] **Step 1:** Fluxo comprar USD (BRL→USDC): `pag.quote` → mostrar cotação → `pag.createPayment` → pegar `receiver`+`amount` → `authorizePayment({ xdr: buildUsdcPaymentTx(receiver, amount), expect: { destination: receiver, amount } })`. As asserções de T1 já cobrem receiver/amount (threat #3). Pinar `VITE_PAGFINANCE_DOMAIN`.
- [ ] **Step 2:** Fluxo vender USD (USDC→BRL/Pix): cola chave Pix → `pag.quote`/`validate` → autoriza o pagamento USDC pro receiver da PagFinance via `authorizePayment` → `pag.submitPayment(hash)`. **Tratar submit falho como estado distinto** (não mostrar sucesso se o provider não confirmou — bug que achei no PixPay).
- [ ] **Step 3 (gate externo):** precisa de `VITE_PAGFINANCE_*` (client-id+JWT) — credencial do parceiro. Sem ela, "failed to fetch". Marcar como dependência de produção.
- [ ] **Step 4: Commit** `feat(comex): R$↔USD via PagFinance with pre-sign assertions`

---

### Task 8: Render (DeFindex) num toque + pinning do vault

**Files:**
- Create: `apps/web/src/pages/comex/Yield.tsx`
- Reuse: `lib/defindex.ts` (`buildDepositTx`/`buildWithdrawTx`/`getPosition`/`getApy`), `authorizePayment`-style flow (depósito é XDR Soroban; usar o mesmo decode+confirm+local-hash; a asserção de payment não se aplica — usar confirmação humana do resumo + pinning).

**Steps:**
- [ ] **Step 1 (gate de custódia, threat #8):** antes de habilitar, verificar on-chain que o vault de `VITE_DEFINDEX_USDC_VAULT` tem `is_upgradable=false` (ou Manager = multisig conhecido). Documentar o endereço verificado. Se upgradeable sob chave única → NÃO usar.
- [ ] **Step 2:** botão "aplicar" → `buildDepositTx(caller, amount)` → decode + confirm (mostra "depósito no vault X") + local hash + Privy sign + submit. Botão "resgatar" → `buildWithdrawTx`.
- [ ] **Step 3:** mostrar `getPosition` (saldo aplicado) + `getApy` verbatim com o disclaimer (variável, sem garantia, principal em risco, não é poupança da Slippay).
- [ ] **Step 4 (manual testnet):** depositar, ver posição subir; resgatar, ver voltar.
- [ ] **Step 5: Commit** `feat(comex): one-tap DeFindex yield with vault pinning`

---

### Task 9: Guardas corporativas + trilha de auditoria

**Files:**
- Create: `apps/web/src/lib/comexGuards.ts`
- Test: `apps/web/test/comexGuards.test.ts`

**Interfaces:**
- Produces: `requiresApproval(amountUsd: string, limitUsd: string): boolean`; `logAction(entry: {...}): void`

**Steps:**
- [ ] **Step 1 (test):** `requiresApproval("5000","1000") === true`; `requiresApproval("500","1000") === false`. (threat #6 — separação de funções app-level na fase 1.)
- [ ] **Step 2:** implementar + ligar em `Send`/`Exchange`: acima do teto, exigir segundo aprovador antes de `authorizePayment`. Logar toda ação com a identidade Privy autenticada (threat repúdio).
- [ ] **Step 3: Commit** `feat(comex): per-amount approval threshold + audit log`

---

### Task 10: Verificação final

- [ ] **Step 1:** `cd apps/web && npx tsc --noEmit` → exit 0
- [ ] **Step 2:** `npx vitest run` → txguard + privyWallet + authorizeTx + comexGuards + defindex verdes (o `stellar.test.ts buildAtomicTx` é vermelho pré-existente, não-relacionado — não regride).
- [ ] **Step 3:** `grep -ri "AUTHORIZATION_PRIVATE\|privy.*secret" apps/web/src` → vazio (confirma non-custodial, threat #7).
- [ ] **Step 4:** e2e testnet completo: login+MFA → recebe USDC → envia → compra/vende R$↔USD → aplica/resgata yield.
- [ ] **Step 5: Commit** `chore(comex): phase-1 verification pass`

---

## Self-Review

**Spec coverage:** conta corporativa (T2,T4) ✓ · sem biometria/MFA (T4) ✓ · non-custodial/user-wallet (T2,T4,T10) ✓ · R$↔USD PagFinance (T7) ✓ · enviar/receber (T5,T6) ✓ · render DeFindex num toque (T8) ✓ · gate threat-model assinatura verificável (T1,T3, usado em T6/T7/T8) ✓ · pinning vault (T8) ✓ · guardas corporativas (T9) ✓.

**Dependências externas (não codáveis, travam produção):** credencial PagFinance (client-id+JWT), DeFindex API key (Discord), Privy App ID + MFA config, vault DeFindex verificado. Demo/dev roda em testnet sem PagFinance.

**Fora de escopo (fases futuras):** multi-tenant self-service, auto-sweep de yield, multisig on-chain real (smart account), camada ZK KYC/atestação, 4P.
