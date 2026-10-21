# Slippay — Reposicionamento + Sprint Rio (Stellar 37 Graus)

**Data:** 2026-05-26 · **Deadline:** residência Rio 8-11/jun/2026 (13 dias) · **Autor:** Manuel + Claude
**Status atual:** ranqueado 24/30 no Stellar 37 Graus · grant em risco · Manuel desempregado, alta prioridade

---

## 1. Diagnóstico (verificado)

Slippay em 24º **não é problema técnico** — contrato Soroban vivo, prova on-chain real, não-custodial. O painel que ranqueia é de **investidores de finanças digitais** (não engenheiros). O que segura o 24º:

1. **Tese exposta:** pitch atual = "billing globally / cross-border / MoneyGram 180 países". A **Res. BCB 561** (pub. 30/04/2026, vigência 01/10/2026) proíbe provedores eFX de usar stablecoin para liquidar remessas cross-border. Um jurado lê o pitch e mentalmente elimina por risco regulatório.
2. **Commodity:** "gateway Pix→stablecoin cross-border" é categoria lotada.
3. **Produto errado descrito:** o fluxo REAL do Slippay é **doméstico** (comprador BR paga Pix → merchant BR recebe USD-stablecoin), e a 561 **não toca** nisso. O pitch descreve um produto pior e mais exposto do que o que foi construído.

## 2. Decisão: REPOSICIONAR, não pivotar

Mesma engenharia (Soroban, Pix-in, stablecoin-out, não-custodial). Narrativa nova. Rebuild de produto em 13 dias seria suicídio de calendário.

## 3. Mapa competitivo (verificado de bundle JS + GitHub, 2026-05-26)

| Projeto | Rank | O que é | Tração | Custódia |
|---|---|---|---|---|
| **PigFi/SmartPig** (ChatPayGo) | #3 | Poupança B2C consumidor: Pix→USDC→yield Blend 5,87%, gamificado | **Waitlist, 0 usuários** | Custodial-UX |
| **ChatCheckout** (mesma empresa) | — | Checkout merchant chat-first, Pix→USDC→Pix | Pré-tração | **Escrow custodial** |
| **WalletNow** (#4) | #4 | Não-encontrável (walletnow.app = colisão ChangeNOW) | Desconhecido | — |
| **AgentPay/x402** | ~#5 | Agent-payments x402 Stellar, tese SDF | **0 stars, testnet, 0 agentes** | Não-custodial |

**Insight central:** o campo inteiro está **pré-tração**. A dimensão "uso real" está vazia — quem a ocupar salta na frente numa métrica que ninguém tem.

**Concorrente real:** não o PigFi (consumidor, não colide), mas o **ChatCheckout** — e ele é **escrow-custodial + chat-first**. Espaço vazio = **não-custodial + checkout standalone**.

## 4. Posicionamento (locked)

- **Headline de marca:** "a conta em dólar que mora dentro do Pix"
- **Foco:** RECEBIMENTO merchant (não poupança — PigFi já ocupa poupança). "PigFi guarda, Slippay recebe."
- **"Por que agora" (âncoras verificadas, MEXC/Chainalysis Q1-2026):**
  - Brasil: $6,9bi compras cripto Q1/2026, **98% stablecoin** ($6,8bi)
  - $6-8bi/mês, ~90% stablecoin · +250% YoY · 5º mundo em adoção
  - Motivo: hedge contra o real (inflação histórica)
- **Wedge defensável (3 pistas vazias):** não-custodial · recebimento merchant standalone · tração real
- **Fosso 561:** gateways cross-border viram ilegais 01/out; Slippay doméstico sobrevive

## 5. Sprint de 13 dias — workstreams sequenciados

### WS1 — Validação jurídica (CAMINHO CRÍTICO, bloqueia claims de compliance)
- Pergunta formulada já enviada ao agente jurídico de Manuel (interação 519/520/521 ↔ 561 ↔ arquitetura anchor)
- Resolve: BRL→USDC doméstico é câmbio? quem precisa ser instituição autorizada? Slippay pode afirmar "561-imune por design" sem propaganda enganosa?
- **Sem isso, o slide de compliance é blefe.** Confiança atual da claim: 60%.

### WS2 — Tração (MAIOR ALAVANCAGEM)
- Meta: **3-5 merchants brasileiros reais** recebendo via Slippay antes do Rio (Manuel confirmou factível)
- Cada merchant real = diferenciador devastador num cohort 100% pré-tração
- Entregável: logos + volume processado + 1-2 depoimentos curtos

### WS3 — Narrativa + landing rewrite
- Reescrever landing (apps/web) pro eixo doméstico/recebimento
- Matar "billing globally / cross-border / MoneyGram"
- Concrete-first (memory: feedback_landing_clarity_default) + âncoras Q1-2026

### WS4 — Pitch deck Rio
- Slide moat 561 ("concorrentes filam ilegais, nós não")
- Slide diferenciação ("PigFi guarda, Slippay recebe" + não-custodial vs escrow)
- Slide x402-adjacency (UM só, honesto: "x402-ready na perna stablecoin", disanalogia <5s declarada)
- Slide tração (os 3-5 merchants)

### WS5 — Demo "dolarização em 1 toque"
- Ao vivo, confiável: comprador paga Pix → merchant vê dólar na carteira em ~6s, on-chain verificável
- Reusa contrato Soroban + listener existentes

## 6. Riscos / failure modes nomeados

1. **Compliance no palco sem aval jurídico** → jurado fura com "519 classifica como câmbio, quem é sua instituição autorizada?" e Manuel trava. FATAL. Mitigação: WS1 bloqueante.
2. **Caça-merchant consome 13 dias e entrega 2 logos fracos + pitch mal-ensaiado** → perde em narrativa pro AgentPay. Mitigação: timebox WS2, paralelizar WS3-5.
3. **Over-claim x402** → vira competir no jogo do AgentPay e perder. Mitigação: 1 slide, disanalogia explícita.
4. **PigFi/ChatCheckout pivota pra não-custodial merchant** antes do Rio → fecha o whitespace. Baixa prob (escrow é arquitetural neles), mas monitorar.

## 7. Critério de sucesso (falsificável)

- **Pré-Rio:** ≥3 merchants reais processando · landing + deck + demo prontos · aval jurídico do slide 561
- **Rio:** subir de 24º. Threshold: top-15 (faixa Instawards). Abaixo disso → reposicionamento não foi load-bearing, recalibrar.

## 8. Despriorizado

- **Etherfuse off-ramp** (ver memory slippay-pix-stellar-etherfuse): não move ranking. Off-ramp doméstico é 561-safe mas secundário ao sprint. Retomar pós-Rio.
