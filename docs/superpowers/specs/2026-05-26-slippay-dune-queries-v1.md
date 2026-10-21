# SlipPay × Dune — 4 queries de subscription-intelligence

**Status:** DRAFT para revisão do Wave antes de publicar. Não publicar dashboard
até ≥1 pagamento real no contrato mainnet (regra do Wave).

**Contrato (mainnet):** `CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN`
**Dashboard alvo:** `dune.com/slippay/subscription-intelligence`

---

## Gate técnico que o Wave/Claudin precisa fechar ANTES de rodar

As 4 queries abaixo estão escritas contra o schema Stellar do Dune, mas **dois
identificadores dependem do data-catalog e precisam ser confirmados** em
https://docs.dune.com/data-catalog/stellar antes de colar no Dune:

1. **nome da tabela de eventos de contrato.** Aqui assumido como
   `stellar.history_contract_events`. Pode ser `stellar.contract_events`. Confirmar.
2. **layout das colunas de topics/data.** Aqui assumido: `topics` (array de
   ScVal base64-encoded XDR) + `data` (ScVal base64) + `contract_id` (string
   strkey C...) + `closed_at` (timestamp do ledger). Confirmar nomes exatos.

**Decode dos topics/data:** os topics vêm como ScVal XDR base64. O primeiro
topic é o `Symbol` do nome do evento. Dune pode ter função nativa de decode de
ScVal Stellar — se tiver, usar. Se não, o filtro por nome de evento é feito
casando o base64 do `Symbol("subscription_charged")` literal (constante, não
muda). Os comentários de cada query marcam onde isso entra com `-- ⚠ DECODE`.

Definição operacional travada **antes** de escrever a query e **imutável depois**
(regra do Wave: é onde 100% das fraudes de métrica on-chain moram).

---

## Q1 · active_subscriptions

```sql
-- DEFINIÇÃO OPERACIONAL (travada · não muda):
-- "Assinatura ativa" = wallet (buyer) distinta que emitiu >=1 evento
-- subscription_charged do contrato SlipPay nos últimos 35 dias.
-- Por que 35 e não 30: ciclo de cobrança mensal varia (28-31d) + atraso de
-- submit; 35d evita marcar como churn quem só atrasou o ciclo. Conta WALLET
-- ÚNICA, não cobrança — duas cobranças da mesma wallet = 1 ativa.
SELECT count(DISTINCT buyer) AS active_subscriptions
FROM (
  SELECT
    -- ⚠ DECODE: buyer é topics[2] (Address). topics[1] é o Symbol do evento.
    decode_scval_address(topics[2]) AS buyer
  FROM stellar.history_contract_events
  WHERE contract_id = 'CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN'
    -- ⚠ DECODE: casa o Symbol do evento em topics[1]
    AND decode_scval_symbol(topics[1]) = 'subscription_charged'
    AND closed_at >= now() - interval '35' day
)
```

## Q2 · mrr_usd

```sql
-- DEFINIÇÃO OPERACIONAL (travada):
-- MRR = soma do campo `amount` de todos os subscription_charged dos últimos
-- 30 dias. amount tem 7 casas decimais (stroops do token). USDC é USD-pegged
-- 1:1 — NÃO usamos oracle de preço (USDC≈USD por construção; oracle seria
-- precisão falsa). Se o token for XLM (SAC nativo), a conversão exige preço e
-- esta query NÃO cobre — assume token = USDC. Confirmar token do merchant.
SELECT
  sum(amount_decimal) AS mrr_usd
FROM (
  SELECT
    -- ⚠ DECODE: amount é o 2º elemento do data tuple (i128, 7 decimais).
    -- data = (id, amount, charges_done, next_due)
    decode_scval_i128(data, 1) / 1e7 AS amount_decimal
  FROM stellar.history_contract_events
  WHERE contract_id = 'CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN'
    AND decode_scval_symbol(topics[1]) = 'subscription_charged'
    AND closed_at >= now() - interval '30' day
)
```

## Q3 · churn_30d

```sql
-- DEFINIÇÃO OPERACIONAL (travada · IMUTÁVEL):
-- churn = (wallets que cobraram no mês N E NÃO cobraram no mês N+1)
--         / (wallets que cobraram no mês N).
-- "mês" = janela de 30 dias. N = [60d atrás, 30d atrás). N+1 = [30d atrás, agora).
-- Wallet conta no denominador só se estava ativa em N. Numerador = ativas em N
-- ausentes em N+1. Resultado entre 0 e 1.
WITH charged AS (
  SELECT
    decode_scval_address(topics[2]) AS buyer,
    closed_at
  FROM stellar.history_contract_events
  WHERE contract_id = 'CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN'
    AND decode_scval_symbol(topics[1]) = 'subscription_charged'
    AND closed_at >= now() - interval '60' day
),
month_n AS (
  SELECT DISTINCT buyer FROM charged
  WHERE closed_at >= now() - interval '60' day
    AND closed_at <  now() - interval '30' day
),
month_n1 AS (
  SELECT DISTINCT buyer FROM charged
  WHERE closed_at >= now() - interval '30' day
)
SELECT
  CASE WHEN (SELECT count(*) FROM month_n) = 0 THEN NULL  -- n=0 honesto: sem base, churn indefinido
  ELSE
    CAST((SELECT count(*) FROM month_n WHERE buyer NOT IN (SELECT buyer FROM month_n1)) AS double)
    / (SELECT count(*) FROM month_n)
  END AS churn_30d
```

## Q4 · cohort_retention

```sql
-- DEFINIÇÃO OPERACIONAL (travada):
-- cohort = mês da PRIMEIRA subscription_charged de cada wallet (mês de
-- aquisição, NÃO mês de calendário). retention[M+k] = % das wallets do cohort
-- que ainda têm >=1 cobrança no mês k posterior à aquisição. Heatmap.
WITH first_charge AS (
  SELECT
    buyer,
    date_trunc('month', min(closed_at)) AS cohort_month
  FROM (
    SELECT
      decode_scval_address(topics[2]) AS buyer,
      closed_at
    FROM stellar.history_contract_events
    WHERE contract_id = 'CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN'
      AND decode_scval_symbol(topics[1]) = 'subscription_charged'
  )
  GROUP BY 1
),
activity AS (
  SELECT DISTINCT
    decode_scval_address(topics[2]) AS buyer,
    date_trunc('month', closed_at) AS active_month
  FROM stellar.history_contract_events
  WHERE contract_id = 'CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN'
    AND decode_scval_symbol(topics[1]) = 'subscription_charged'
)
SELECT
  f.cohort_month,
  date_diff('month', f.cohort_month, a.active_month) AS month_offset,
  count(DISTINCT a.buyer) AS retained,
  CAST(count(DISTINCT a.buyer) AS double)
    / count(DISTINCT f.buyer) OVER (PARTITION BY f.cohort_month) AS retention_pct
FROM first_charge f
JOIN activity a ON a.buyer = f.buyer
GROUP BY 1, 2, f.buyer
ORDER BY 1, 2
```

---

## Notas de honestidade (pro pitch SCF)

- **Hoje todas retornam n≈0** — mainnet tem só 1 charge de demo (F5, 16/05),
  zero assinatura recorrente real. Por isso NÃO publicar ainda.
- Nenhuma query depende de dado off-chain (email, etc.) — tese "verificável
  on-chain" intacta.
- USDC tratado 1:1 USD sem oracle — declarado no comentário da Q2.
- Quando publicar: o endpoint `GET /api/v1/metrics/dune-snapshot` cacheia
  (TTL 1h) e a seção `/metrics` do site renderiza + linka pro dashboard público.
