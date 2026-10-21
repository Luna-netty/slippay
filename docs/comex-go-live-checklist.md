# Comex (tesouraria B2B · Base) — checklist de GO-LIVE

O app está construído e gated; nada transacional aparece em produção até
`VITE_PRIVY_APP_ID` existir. **A 4P liquida USDC na rede Base**, então o comex roda
em Base (EVM) — Privy EVM, transferências de USDC ERC-20, non-custodial.

Branch: `feat/comex-treasury-phase1`. **Nenhum contrato a deployar** (usa o USDC
nativo da Circle na Base).

---

## 0. Pré-requisitos
- [ ] **Privy App ID** — criar em dashboard.privy.io. **É o único bloqueio real.**
- [x] **4P API key** — JÁ configurada em prod (`FOURP_API_KEY`, `FOURP_CHAIN=Base`, enabled).
- [ ] **(recomendado) RPC Base pago** (Alchemy/QuickNode/Base) — o público é rate-limited.

## 1. Configurar o app Privy (dashboard.privy.io)
- [ ] Login methods: **apenas e-mail** (sem biometria/passkey)
- [ ] **MFA habilitado** (TOTP)
- [ ] **Embedded wallets: Ethereum/EVM, createOnLogin** (sem Solana)

> **Status do Solana — referência, não roadmap.** A versão Solana do adapter de chain (`apps/web/src/lib/chain/solana/`) e os docs `SOLANA_FRONTEND_PORT.md` / `SOLANA_MIGRATION.md` existem no repo **apenas como referência técnica**. Eles NÃO estão ativos em produção: `/comex` aponta para Base (EVM) com Privy EVM wallet. O adapter Solana só carrega se `VITE_CHAIN=solana` for explicitamente configurado, o que a produção nunca faz. Não há data de cutover — Solana está congelado em `feat/solana-adapter` até o passo 4 (biometria Solana) provar em devnet + haver funding de devnet + ramp Solana ativa. Ver [`SOLANA_FRONTEND_PORT.md`](./SOLANA_FRONTEND_PORT.md) § "Cutover stays gated until 4 proves out + devnet funding + ramp". Ver também [`SOLANA_MIGRATION.md`](./SOLANA_MIGRATION.md) § "Migração em paralelo: a Stellar fica viva até a Solana funcionar".
- [ ] Default chain / allowed chains: **Base** (chain id 8453)
- [ ] Allowed domains: `app.slippay.cc`
- [ ] Copiar o **App ID**

## 2. Env do FRONTEND — `apps/web/.env.production`
(build-time; já tem `VITE_COMEX_ENABLED=1`)
- [ ] `VITE_PRIVY_APP_ID=<app id>`
- [ ] `VITE_BASE_NETWORK=mainnet`
- [ ] `VITE_BASE_RPC=<url do RPC pago>`  ← senão cai no público (frágil)
- [ ] `VITE_4P_OFFRAMP_RECEIVER=<endereço 0x da 4P>`  ← **segurança**: pino do receiver da venda. Sem isso a venda fica desabilitada; se a 4P retornar endereço diferente, a operação é bloqueada antes de assinar. Só preencher quando a 4P der o off-ramp.
- [ ] (USDC mainnet na Base é fixo no código — Circle `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, não setar)
- [ ] non-custodial: `grep -ri "AUTHORIZATION_PRIVATE\|secret" apps/web/src` = vazio

## 3. Backend 4P — JÁ CONFIGURADO (só verificar)
- [x] `FOURP_API_KEY` / `FOURP_CHAIN=Base` / `FOURP_ASSET=USDC` já no `.env` de prod.
- [ ] verificar: `curl https://app.slippay.cc/api/v1/4p/status` → `{enabled:true, chain:"Base", asset:"USDC"}`  (já retorna isso hoje)

## 4. Vender (off-ramp USDC→R$) — PENDENTE endpoint 4P
A **compra** (R$→USDC na Base, entregue na carteira da empresa) já está fiada e funciona.
A **venda** está estruturada (`ramp4p.ts`: `quoteOfframp4p`/`createOfframp4p`/`getOfframp4p`)
mas precisa do endpoint real da 4P:
- [ ] obter a doc do **off-ramp da 4P**
- [ ] adicionar `/api/4p/offramp{,/quote,/:id}` no backend (`supabase/functions/api/routes/fourp.ts`)
- [ ] ajustar os campos em `ramp4p.ts` ao contrato real
- até lá, a aba "vender" mostra "em ativação" (não quebra). **Para um importador que paga fornecedor lá fora, a venda NÃO está no caminho crítico** — comprar + enviar bastam.

## 5. Confirmar com a 4P (1 fato que trava o fluxo)
- [ ] a 4P entrega o USDC na **rede Base**, no **endereço 0x da carteira Privy** que o app passa? (confirmado que é Base; confirmar a entrega no endereço que passamos)
- [ ] estrutura "4P origina o câmbio (licenciada), Slippay é só plataforma non-custodial" acordada (mantém fora do VASP — ver `project_slippay_not_vasp`).

## 6. Build + deploy
- [ ] backup: `ssh manuel@165.22.10.194 "cp -r /opt/slippay-backend/apps/web/dist /opt/slippay-backend/apps/web/dist.bak-$(date +%Y%m%d-%H%M%S)"`
- [ ] build: `cd apps/web && VITE_COMEX_ENABLED=1 pnpm build`
- [ ] sanity local: `grep -c "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" dist/assets/index-*.js` > 0 (USDC Base no bundle)
- [ ] rsync: `rsync -az --checksum --delete dist/ manuel@165.22.10.194:/opt/slippay-backend/apps/web/dist/`
- [ ] confirmar bundle live == local

## 7. Smoke test (produção, R$50 de teste — ANTES do cliente)
- [ ] `/comex` abre o **app** (não mais a BusinessLanding) — login e-mail + **MFA**
- [ ] carteira EVM criada; **Saldo/Receber** mostra endereço `0x...` + saldo
- [ ] **Comprar**: R$50 → quote → código Pix → pagar → USDC cai na carteira (confirmar no **basescan.org**)
- [ ] **Enviar**: mandar USDC pequeno → ConfirmTxModal mostra **destino+valor corretos** → confirma → basescan confirma
- [ ] o resto do site (`/`, `/zk/`, `/pay`, `/checkout`) intacto
- [ ] **só depois disso o Mário deixa o cliente transacionar de verdade**

## 8. VERIFY-WITH-KEYS (confirmar contra a sessão Privy real)
- [ ] `comexBase.tsx`: chamadas exatas de `useWallets`/`useSendTransaction` da Privy EVM (validar com App ID ativo)
- [ ] gate de MFA (shape do `mfaMethods`)

## 9. Rollback
- env é build-time → rollback = redeploy de um backup: `rsync -az --delete dist.bak-<ts>/ /opt/slippay-backend/apps/web/dist/`
- backups em `/opt/slippay-backend/apps/web/dist.bak-*`

---

### Estado atual (25/06)
Portado pra **Base** (a 4P liquida em Base). Pronto e testado (tsc 0, **74 testes**, build 0),
gated, não-deployado o transacional: Privy EVM wallet + gate WYSIWYS (viem) + saldo/receber
+ enviar + comprar (4P, Base). Sem contrato a deployar. **Falta só o Privy App ID** (4P já
em prod). Venda/off-ramp e yield = fase 2. **Solana = referência, não roadmap** — ver a declaração de status no topo deste checklist. O adapter Solana existe em `feat/solana-adapter` mas `/comex` aponta pra Base.
