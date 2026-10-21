# Circuito mínimo: agente paga agente (A2A) — desenho, sem código

> Trabalho da noite de 25/06 (Manuel dormindo). Entrega = **o circuito**, não implementação.
> Base: design do "gui" + inventário real do stack (Explore, 25/06). Conclusão do inventário:
> **as 5 peças já existem no repo — é wiring, não build do zero.**

## A tese (uma frase)
Um agente paga outro agente por algo de valor, **sem humano no loop**, e o dinheiro liquida
on-chain. Se isso roda **uma vez ponta a ponta**, a tese deixa de ser slide e vira fato.

## A grey zone (precisa)
Não é o pagamento — pagamento máquina-a-máquina já existe. O cinza é **quem é o titular da
transação quando os dois lados são agentes autônomos e ninguém apertou botão**. Regulador não
tem resposta fechada em 2026. Estratégia: rodar primeiro e definir o formato. O ativo é a
**posição (first-mover) + o registro assinado limpo**, não o código. Linha de defesa: o
**mandato** (autorização humana na raiz, só não a cada tx) + **non-custodial** + **registro**.

## As 5 peças → o que já existe (arquivos reais)

| # | Peça | Já existe? | Onde |
|---|------|-----------|------|
| 1 | **Vendedor (agente A)** — endpoint que cobra (402) | ✅ **pronto, live mainnet** | `supabase/functions/api/routes/x402.ts` (registra recurso → GET devolve 402 com payTo/amount/memo/asset). Smoke: `apps/listener/_x402-mainnet-smoke.mjs` |
| 2 | **Comprador (agente B)** — paga sozinho dentro de teto | 🟡 **peças existem, falta a cola** | `packages/slippay-mcp/src/chain.ts` `pay()`, `apps/web/src/lib/stellar.ts` `buildUsdcPaymentTx`, o smoke assina+paga — mas como **script**, não como agente que decide |
| 3 | **Trilho** — Stellar USDC, segundos, sub-centavo | ✅ pronto | `lib/stellar.ts` (build/sign/submit) + `slippay-mcp/src/chain.ts` (RPC) |
| 4 | **Teto (mandate)** — B só gasta ≤ limite assinado antes | ✅ pronto (2 formatos) | **per-call:** attester surface `packages/slippay-attester` (max_amount + velocity, atestação ed25519 in-surface). **recorrente:** allowance do `contracts/subscription` |
| 5 | **Registro** — rastro assinado por tx | ✅ pronto | tx na Horizon + atestação assinada (`oracle.mjs` attest/verify) + eventos do contrato + order record |

## O único build real: a cola do comprador
Tudo existe; falta **um loop de agente comprador x402 com checagem de mandato**. Hoje o
`_x402-mainnet-smoke.mjs` faz GET→paga→repõe prova, mas é script disparado por humano. A cola
é transformá-lo num **agente que decide**:

1. GET no endpoint de A → recebe 402 (preço X em USDC, memo, payTo)
2. **decisão autônoma:** X ≤ teto do mandato? (ex.: ≤ 0.10/tx, ≤ 5 USDC/dia) — lê do attester surface
3. pede **atestação in-surface** ao oracle (`POST /attest`) → assina que está dentro do mandato
4. paga USDC na Stellar (`chain.pay` / `buildUsdcPaymentTx`) — a carteira de B assina, non-custodial
5. repõe a prova no endpoint → recebe o dado
6. grava no **registro**: {quem, quanto, por quê (slug), sob qual mandato (hash do surface), tx hash, sig da atestação}

Isso é **pequeno** (o smoke + um gate de teto + chamada ao attester). É o coração da tese.

## O menor teste real (exato)
- Dois agentes que eu controlo, **processos separados**. A = vendedor x402 de um dado bobo
  ($0.01). B = comprador autônomo com mandato (surface: 0.10/tx, 5/dia).
- B, sozinho: GET A → 402 → 0.01 ≤ 0.10 → atestação → paga USDC **testnet** → repõe → recebe o dado.
  **Nenhum toque humano depois do start.**
- Liquida na testnet; o registro grava o rastro assinado.
- Depois repete com **alguns centavos de USDC real (mainnet)** pra provar que não é simulação
  (o x402 já é mainnet-live).

Prova 3 coisas de uma vez: **rail funciona** (técnico) · **agente decide e paga dentro de
mandato** (a tese) · **trilha auditável** (a defesa e o ativo).

## Qual ponta primeiro (resposta ao gui)
**Vendedor já está pronto — zero build.** Registra um recurso x402 ($0.01) e ele cobra hoje
(minutos). Então sobe o **vendedor primeiro** só pra ver respondendo. O **comprador autônomo é
a única cola a construir** e é o coração da tese — constrói segundo, pequeno. Ordem:
**(1) vendedor (grátis, agora) → (2) loop do comprador (o build) → (3) roda o teste.**

## Gates / riscos (a linha jurídica + design)
- **Testnet primeiro.** Mainnet só alguns centavos pra provar que não é simulação.
- **Non-custodial sempre:** a carteira de B assina; Slippay nunca segura. Esse circuito é
  liquidação USDC pura (sem perna fiat) → **superfície regulatória mais leve** que o câmbio do comex.
- **O mandato é a autorização humana na raiz** (defesa: existe consentimento humano, só não por tx).
- **O registro é o ativo** — manter assinado/limpo desde a tx #1. Quem improvisa apaga histórico.
- **Titularidade quando os dois lados são agentes** = item de advogado (já sinalizado). O teste
  **não precisa** disso resolvido (testnet, agentes meus); escalar pra contrapartes reais precisa.
- Vetores (STRIDE-lite): agente B comprometido gastando demais → **capado pelo mandato + attester
  fail-closed**; replay de atestação → **single-use/velocity**; vendedor rogue → perda limitada
  ao teto (0.10). Nunca custodiar, nunca originar câmbio.

## Próximo passo quando o Manuel acordar
Aprovar a ordem (vendedor→comprador→roda) e me liberar pra **implementar a cola do comprador**
(é o único build, ~pequeno) + rodar o teste testnet. Aí escrevo o plano de implementação
(writing-plans) e executo.
