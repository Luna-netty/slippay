# Anchor Providers · Comparative Memo

**Date:** 2026-05-28 · **For:** Manuel + Mario · **Status:** pre-decision, for BD calls
**Scope:** the 5 providers Mario surfaced (Conduit, Transfero, Bitso, Transfi, Coinbase) evaluated for **Slippay's BR-domestic Pix ↔ USDC-Stellar leg** under the post-Res 561 regulatory frame.

This is a triage memo, not an integration plan. Output: which 1-2 to prioritize in the BD pipeline, what to ask in each call, what NOT to commit code to yet.

---

## TL;DR · the 90-second read

Only **Transfero** and **Nvio Brasil (Bitso's BR subsidiary)** are **BCB-licensed Payment Institutions in Brazil**. Everything else operates either through a partner or only on the offshore leg of cross-border payments.

After Res 561 (effective 2026-10-01) and the Feb 2026 stablecoin-as-câmbio reclassification, **only BCB-authorized institutions can legally buy/sell/transfer stablecoins for Brazilian residents through regulated channels**. This collapses the field from 5 candidates to 2 if Slippay's narrative is "domestic Pix → USDC-Stellar, inside the BR perimeter."

| provider | BCB-licensed PI | BR-domestic Pix↔stablecoin | best fit for Slippay |
|---|---|---|---|
| **Transfero** | ✓ (since Sep/2023) | ✓ | **#1** · primary candidate · BR-native + crypto-native |
| **Nvio (Bitso BR)** | ✓ (recent, R$65.9M capital) | ✓ (BitsoPay announced) | **#2** · scale + brand + LatAm reach |
| Conduit | no | corridor-only (US-domiciled) | partnership for global expansion, not BR anchor |
| Transfi | no | requires BR PI partnership | defer · cross-border-first model conflicts with 561 |
| Coinbase Onramp | no | unclear · likely no PIX | defer · US-first, Stellar support unclear |

**Recommended prioritization for Mario's BD pipeline:**

1. **Transfero** — fechar primeiro
2. **Nvio Brasil (Bitso)** — fechar segundo
3. Everything else — manter no radar, **não comprometer engineering** até pós-Rio

---

## Regulatory landscape · why the matrix collapses

Three BCB rules, all 2026, define the field:

- **Res. BCB 561** (publicada 30/04/2026, vigor **01/10/2026**) — proíbe eFX providers de usar stablecoin/crypto pra liquidar a perna offshore de pagamentos cross-border regulados. Fonte: [coindesk.com/.../brazil-s-central-bank-bans-stablecoin](https://www.coindesk.com/policy/2026/05/02/brazil-s-central-bank-bans-stablecoin-and-crypto-settlement-in-cross-border-payments).
- **Stablecoin = câmbio · vigor 02/02/2026** — USDT, USDC, BRL-pegged passam a ser tratados sob regime de FX. Só instituições BCB-autorizadas (bancos de câmbio tradicionais + SPSAVs licenciados) podem operar essa rota pra residentes BR.
- **Res. BCB 494** (e atualizações 495/506) — janelas de autorização pra Instituições de Pagamento, prazos definitivos em 31/05/2026. Quem não pediu autorização nesse prazo opera ilegal a partir da data.

**Consequência operacional pra Slippay:** o anchor que destrava "Pix → USDC-Stellar dentro do BR" precisa **obrigatoriamente** ser uma PI BCB-autorizada ou uma SPSAV licenciada. Estrangeiros sem essa licença operam ou via parceiro local autorizado, ou na perna offshore (que Res 561 fecha em out/26).

Isso é compatibilidade **vinculante**, não preferência. Slippay assinar contrato com Conduit/Transfi/Coinbase sem um partner BCB-autorizado no meio é projeto que para em out/26.

---

## Per-provider · what we know + what to ask

### 1. Transfero · **PRIMARY CANDIDATE**

**O que é**: blockchain-based financial infra, baseado no Rio, fundado em 2015 por Guilherme Murtinho e Claudio Just. Produto principal: **BaaSiC** (Banking-as-a-Service infra Cripto), com 3 categorias: Pay In, Pay Out, Trade.

**Regulatório · VERIFICADO**: **Instituição de Pagamento autorizada pelo BCB desde setembro/2023** (Panorama Crypto · out/2024). Cumpre o requisito Res 561 estruturalmente.

**API surface (do que a docs expõe)**:
- Pay In · QR codes dinâmicos + deposit order management
- Pay Out · payment processing + groups + receipts
- Trade · não detalhado publicamente
- Autenticação + Postman collection + callback config

**O que falta saber · perguntas pro BD call**:
1. Stablecoins suportadas? (USDT prioritário, USDC?, BRZ?, Stellar Native USDC pela Circle?)
2. **Stellar chain support** — eles operam o SAC do USDC-Circle em Stellar mainnet? Ou só via wrap em EVM?
3. Fees: % por on-ramp Pix→USDC, % por off-ramp USDC→Pix, fee de custódia se houver
4. Latência típica do "Pix in → USDC creditado em address do cliente": 5s? 30s? minutos?
5. KYB pra Slippay como merchant: documentação exigida + prazo de onboarding
6. KYC do end-user: nível mínimo (CPF only? selfie? proof of address?), limite diário sem reKYC
7. Sandbox: tempo até primeira tx funcionando + se aceita test wallets Stellar gerados client-side
8. Modelo comercial: white-label (Slippay branded) ou co-branded?
9. SLA + uptime histórico
10. Existing customers pra reference call? (especialmente se algum opera em Stellar)

**Vantagem estratégica vs Bitso**: Transfero é menor e crypto-native desde o dia 1. Decisão técnica deles é mais alinhada com Slippay. Provavelmente mais ágil em integração.

**Risco**: tamanho. Se eles colapsarem (small fintech, capital limitado), Slippay perde o anchor. Mitigação: contrato de portabilidade explícita pra outro PI, ou redundância via Bitso.

### 2. Nvio Brasil (Bitso) · **SECONDARY CANDIDATE**

**O que é**: subsidiária BR da Bitso (maior exchange cripto da LatAm). Bitso Payouts + Funding = APIs RESTful que expõem withdrawal + funding services regulated end-to-end.

**Regulatório · VERIFICADO**: Nvio Brasil **autorizada pelo BCB como Instituição de Pagamento**, modalidades de emissor de moeda eletrônica + instrumento de pagamento pós-pago. Capital social R$ 65,9 milhões. BitsoPay (crypto wallet + Pix) anunciado. Fonte: [Finsiders Brasil · Bitso BC](https://finsidersbrasil.com.br/noticias-sobre-fintechs/instituicao-de-pagamento-da-bitso-recebe-aval-do-bc-para-operar/).

**Cobertura geográfica**: Brasil (Pix in/out, BRL withdrawal), México (SPEI/CLABE), Colômbia (PSE), Argentina (ARS).

**API surface**:
- Auth · signed requests
- Deposit · QR codes BR, CLABE MX, etc.
- Payout · withdrawals fiat + cripto
- **USDC com "Multi-Network Support"** + payouts travel-rule-compliant
- Sandbox · "First Steps" doc disponível

**O que falta saber · perguntas pro BD call**:
1. **Stellar network support no USDC payouts/funding?** A doc menciona "Multi-Network" mas lista Base explicitamente — Stellar precisa ser confirmado
2. BitsoPay BR · timeline pra GA? está em waitlist ou launch?
3. Fees pra Pix in → USDC out · % + flat fee
4. KYB para Slippay como merchant institucional
5. Pode operar em modelo B2B2C com Slippay branding ou Bitso branding é fixo?
6. Limites diários por end-user
7. Custódia · USDC fica em conta Bitso até payout, ou se transfere direto pra wallet do cliente?
8. SLA + suporte tier institucional

**Vantagem estratégica vs Transfero**: scale, liquidez, brand reconhecido na LatAm. Capital suficiente pra atender Slippay sem stress operacional. Se Slippay escala pra outros mercados LatAm, mesma API serve.

**Risco**: priorização. Bitso é grande e Slippay é cliente pequeno. Pode ser deprioritizado em features ou response time. Mitigação: lock-in via contrato comercial com SLA explícito.

### 3. Conduit · **DEFER · PARTNERSHIP NOT ANCHOR**

**O que é**: US-domiciled stablecoin payment infra. Slogan: "move money effortlessly across stablecoins, USD, and local currencies."

**Regulatório**: NÃO é BCB-licensed PI. Opera nos EUA + corridors globais.

**Posicionamento real**: Conduit é boa pra **B2B cross-border** (ex: SaaS US recebendo de cliente BR via USDC, depois off-ramp em USD). Pra Slippay BR-domestic, ela é a perna ERRADA do circuito — opera offshore.

**Quando usar**: quando Slippay expandir pra B2B internacional (merchant US, buyer BR). Não agora.

**Pra Mario na BD call**: explore como **parceiro de distribution** futuro, não como anchor. Eles têm uma rede de partners — podem indicar Slippay como o on/off-ramp BR deles, e Slippay indica eles como rota pra clientes que precisam de USD em destino US.

### 4. Transfi · **DEFER · CROSS-BORDER COLLIDE COM RES 561**

**O que é**: cross-border payments + crypto ramp + payouts/collections. Opera em BR via Pix + Itaú Unibanco (per blog deles).

**Regulatório**: NÃO é BCB-licensed PI. Cita Itaú como provedor de Pix.

**API surface**: REST + webhooks, KYC obrigatório de sender/receiver, sandbox com simulação de status.

**Conflito Res 561**: o modelo Transfi é cross-border-first. "USDT Payout and Collection in Brazil – via PIX and Itaú Unibanco" é exatamente o caso que Res 561 fecha em out/26. Eles vão precisar reestruturar pra operar via partner BCB-PI ou perder o BR market.

**Pra Mario na BD call**: pergunta direta · *"qual é o roadmap regulatório de vocês pós-Res 561? operam via partner BCB-PI? quem?"* — se a resposta for vaga, sinaliza que Transfi não tem o trilho doméstico legal e Slippay não pode depender deles.

### 5. Coinbase Developer Platform · **DEFER · STELLAR + BR INCERTOS**

**O que é**: Coinbase Commerce + Onramp + suite de payments via Coinbase Developer Platform. URL fetched returned 403 + redirect, então dados detalhados pendentes.

**Regulatório**: NÃO é BCB-licensed PI. Onramp BR existe via parceiros locais.

**Suspeitas a confirmar**:
- **Stellar chain support**: histórico de Coinbase é EVM-first (Base é deles). Stellar pode não estar coberto pelo Onramp. Verificar antes de tudo.
- **BRL settlement**: Coinbase Onramp historicamente paga em USDC pra wallet do user, BRL → USDC via Pix é coberto, mas o user fica com USDC numa wallet Coinbase, não em Stellar mainnet diretamente.

**Pra Mario na BD call**: 
1. Stellar SAC USDC suportado no Onramp out-of-the-box?
2. White-label possível ou é "powered by Coinbase" obrigatório?
3. Fees explícitos pra Pix→USDC-Stellar
4. Latência típica
5. KYC do end-user é Coinbase-side ou Slippay-side?

**Risco específico**: lock-in. Coinbase tende a empurrar ICP pra Base (chain deles), o que conflita com Slippay-on-Stellar.

---

## Decision matrix · onde focar engineering esforço

| ação | provider primário | esforço | quando |
|---|---|---|---|
| BD call · fechar partnership comercial | Transfero | 1 call · 1-2 semanas decisão | esta semana |
| BD call · ter segundo no bolso | Bitso | 1 call · paralelo | esta semana |
| Implementar adapter `AnchorProvider` em código | só após contrato comercial fechado | 2-3 semanas focused engineering | **pós-Rio** (após D+11) |
| Conduit/Transfi/Coinbase | manter docs lidas pra contexto | zero engineering | quando Slippay expandir pra B2B internacional ou outro mercado LatAm |

---

## Anti-padrão a evitar

**"Vamos integrar 5 anchors em paralelo pra ter optionality."**

Não. Cinco integrações de payment provider tem mínimo 2-3 semanas por uma. Quintuplicar isso é projeto de 3-4 meses. Slippay tem zero clientes pagantes hoje (memory `project_customer_state`). O bottleneck não é optionality de anchor — é **fechar o primeiro contrato comercial com UM anchor BCB-autorizado**, validar com merchants reais, e crescer dali.

A linha defensável pro Derick + Wlad + qualquer mentor sênior: *"escolhemos Transfero porque é BR-licensed + crypto-native + ágil. Bitso é backup. Os outros 3 são partnerships de expansão futura, não anchors."* Foco.

---

## Próximos passos concretos

1. **Mario**: agenda call com Transfero (BD level), prepara as 10 perguntas listadas. Meta: ter resposta de fees, Stellar support, e KYB timeline em ≤7 dias.
2. **Mario**: agenda call com Bitso (Nvio Brasil) com as 8 perguntas listadas. Meta: mesma janela.
3. **Manuel**: leva esse memo pro Derick às 19:30 se ele perguntar sobre anchor strategy. Tem resposta estruturada já.
4. **Pós-Rio (a partir de 09/06)**: escolha definitiva Transfero ou Bitso, assinatura de term sheet, e SÓ ENTÃO começa engineering do adapter.

---

## Fontes verificadas

- [Brazil's central bank bans stablecoin and crypto settlement in cross-border payments · CoinDesk · 2026-05-02](https://www.coindesk.com/policy/2026/05/02/brazil-s-central-bank-bans-stablecoin-and-crypto-settlement-in-cross-border-payments)
- [Instituição de pagamento da Bitso (Nvio Brasil) recebe aval do BC · Finsiders Brasil](https://finsidersbrasil.com.br/noticias-sobre-fintechs/instituicao-de-pagamento-da-bitso-recebe-aval-do-bc-para-operar/)
- [Transfero recebe autorização do Central Bank · Panorama Crypto · 2024-10](https://panoramacrypto.com/transfero-receives-authorization-from-the-central-bank-and-can-operate-as-a-payment-institution/)
- [Bitso Payouts + Funding · Getting Started](https://docs.bitso.com/bitso-payouts-funding/docs/getting-started)
- [Transfero Docs · docs.transfero.com](https://docs.transfero.com/)
- [Conduit Docs · docs.conduit.financial](https://docs.conduit.financial/)
- [Transfi Developer Hub · docs.transfi.com](https://docs.transfi.com/docs/welcome-to-transfi-developer-hub)
- Coinbase Developer Platform · `coinbase.com/en-br/developer-platform/payments` retornou 403 na fetch automatizada; precisa de leitura humana direta antes de qualquer call.

---

## Disclaimer

Este memo é baseado em informações públicas + busca web em 28/05/2026. Não substitui contato direto com BD + jurídico de cada provider. Fees, prazos e cobertura podem ter mudado. Antes de qualquer assinatura, validar números com term sheet do provider + advogado regulatório BR.
