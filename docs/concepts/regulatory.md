# Regulatory framing

SlipPay operates in a regulated payments space. Pretending otherwise is
a product strategy that survives until the first enforcement action.
This page is what we know, what we assume, and what's an open risk.

> **Disclaimer**: this is operational summary, not legal advice. For any
> specific deployment, consult a Brazilian payments lawyer.

## The Brazilian regulatory landscape (2026)

### Lei 14.478/2022 — Marco Legal das Criptomoedas

In force since June 2023. Defines virtual asset service providers (VASPs)
in Portuguese as **Prestadores de Serviços de Ativos Virtuais (PSAVs)**.
Establishes:

- registration requirement with a regulator (BCB designated)
- KYC obligations (Lei 9.613/1998 anti-money-laundering compatible)
- segregation of customer assets

Source: [Lei 14.478](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2022/lei/L14478.htm)

### BCB Resoluções 519, 520, 521 (10 Nov 2025)

Implementing regulations. **In force 2 February 2026** (most provisions);
foreign-capital reporting from 4 May 2026.

| resolution | scope |
|---|---|
| 519 | governance and prudential requirements for SPSAVs (specific PSAVs) |
| 520 | minimum capital tiers (~R$2M+ depending on activity) |
| 521 | **classifies stablecoin trading as `operações de câmbio`** (FX) |
| 561 | **classifies cross-border stablecoin operations as `câmbio`** (FX); see below |

The 521 reclassification is the load-bearing fact for SlipPay. It means:
**any actor that mediates BRL ↔ USDC for a Brazilian user is operating
inside the FX market** and must comply with FX rules (which require either
a banco autorizado or a partnership with one).

Source: [Machado Meyer summary](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/bancario-seguros-e-financeiro-ij/regulamentacao-de-vasps-no-mercado-de-cambio)

### BCB Resolução 561 — cross-border stablecoin as câmbio

Resolution 561 extends the 521 reasoning to the cross-border case: a stablecoin
operation that moves value across the border for a Brazilian user is classified
as an `operação de câmbio` (foreign-exchange). This matters directly for any
cross-border take-rate. A fee charged on a BRL-to-foreign or foreign-to-BRL
stablecoin flow sits inside the FX perimeter, so a "cross-border payments PSP
that skims a spread on the corridor" model is not available to SlipPay without a
banco autorizado or an FX-licensed partner on that leg. Charging a cross-border
spread directly is an FX operation, not a software fee.

SlipPay's response is the domestic-USD-account framing: position the product as
a dollar-denominated account and payment surface used inside Brazil (receive,
hold, and pay USDC domestically), rather than as a cross-border corridor with a
take-rate. The domestic framing keeps SlipPay's own monetization on the software
side (merchant API, checkout, settlement infrastructure) and pushes any actual
BRL/FX leg into a licensed partner's perimeter, consistent with the
partnership-with-VASP architecture below. This is a constraint to design around,
not a stop: it tells us where a fee can and cannot legally sit.

### Self-custody not banned, but VASP must KYC the wallet

Earlier drafts of the consultation tried to forbid stablecoin transfers to
self-custody wallets. The final resolutions softened this to a KYC-of-
counterparty requirement: VASPs may transfer to self-custody, but they
must identify the wallet owner and document origin/destination of funds.

This is friendly to SlipPay's non-custodial model: the merchant address is
still merchant-controlled; the VASP partner just needs to record who owns
which address.

## What this means for SlipPay

### Non-custodial does NOT exempt from regulation

If SlipPay accepts BRL via Pix from a Brazilian buyer and delivers USDC
to a Brazilian merchant, that flow is **operação de câmbio + virtual asset
service** even if SlipPay never holds the BRL for more than a millisecond.
The non-custodial framing applies to *funds*, not to *regulatory perimeter*.

This is the failure mode that kills naïve "we don't hold the money so
we're not regulated" pitches.

### The partnership-with-VASP architecture

SlipPay's design is to **never operate the BRL leg directly**. Instead:

1. SlipPay is a **technology provider**: merchant API, hosted checkout,
   memo-matched on-chain settlement, webhook delivery.
2. A **licensed BR VASP** (Transfero, Bitso, or equivalent) handles the
   regulated leg: receives BRL via Pix from the buyer, performs KYC,
   conducts the FX operation, and mints USDC to the merchant's address
   on Stellar.
3. The buyer sees one flow ("pay with SlipPay"); the regulated leg is
   inside the anchor's perimeter, not SlipPay's.

```
        buyer (BRL)
             |
             v
       Pix to anchor
             |
             v   (anchor handles: KYC, AML, FX,
        anchor       BCB reporting, capital requirement)
             |
             v
       USDC to merchant Stellar address
             |
             v
       SlipPay listener observes (read-only)
             |
             v
       SlipPay fires webhook to merchant
```

SlipPay's role is the developer-experience layer: the merchant API, the
hosted checkout UI, the order matching, the webhooks. The anchor's role
is the regulated-flow leg.

## Status of the partnership

Drafted, not signed. See `docs/outreach/transfero.md` and
`docs/outreach/bitso.md` for the partnership pitch templates. **Mainnet
launch is gated on at least one anchor partnership being live.** Without
it, SlipPay can technically run on testnet but cannot legally operate
buyer-side Pix flow on mainnet for Brazilian users.

## What SlipPay does *not* need a license for

If SlipPay only:

- runs the merchant API and hosted checkout,
- polls Stellar payments via Horizon `/payments`,
- fires webhooks,
- charges merchants a SaaS fee (in USD via Stripe-equivalent, **not** in
  BRL via Pix),

then SlipPay is a software company, not a financial institution. The
licensed leg sits at the anchor.

## What SlipPay *would* need a license for

If SlipPay decided to:

- accept Pix BRL into a SlipPay-controlled bank account,
- mint or hold USDC issuance,
- offer custody of merchant or buyer funds,
- run an FX desk,

then SlipPay would need to be either a SPSAV with R$2M+ minimum capital
under Resolução 520 OR partner with a banco autorizado for the FX
component. The 6–12 month licensing timeline is incompatible with the
2026-Q3 mainnet plan.

## Comex câmbio leg

Converting R$ to USD (or USD to R$) for a foreign trade operation is câmbio — the
most tightly regulated activity in the Brazilian payment stack. Anything touching
that conversion is inside the BCB's FX perimeter regardless of how the tech is
structured.

### How SlipPay stays outside the FX perimeter

The structure that keeps SlipPay outside VASP/câmbio obligations is the same
partnership-with-licensed-party model applied to the comex surface, but the
licensed party in this case is **4P Finance** (the câmbio partner):

- **4P** holds the FX license, **originates the câmbio** conversion (BRL→USDC or
  USDC→BRL), and is the regulated actor for BCB reporting, AML, and capital
  requirements.
- **SlipPay** is the technology platform: builds unsigned transactions, surfaces the
  WYSIWYS signing gate, routes settlement, and never holds user funds or touches the
  conversion directly.
- The corporate wallet (Privy embedded, Solana) is **user-owned**. SlipPay's servers
  never hold a key with authority over it.

```
 company (BRL, e.g. importer paying supplier)
         |
         v
   4P Finance (câmbio origination: licensed, KYC, FX, BCB reporting)
         |
         v
   USDC to company's Privy wallet (user-owned, non-custodial)
         |
         v
   SlipPay builds unsigned tx → WYSIWYS gate → user signs → settlement
```

**This structure only holds while SlipPay does not custody funds and does not
originate FX.** The regulatory classification follows the architecture. If
SlipPay were to hold USDC on behalf of a corporate user, or intermediate the
BRL/USDC conversion directly (e.g., collect BRL via a SlipPay-controlled account
and settle USDC from it), SlipPay would be inside the câmbio perimeter and would
need either an FX license or a banco autorizado as counterparty. The architecture
is the compliance posture.

> **Not legal advice.** The framing above describes the architectural intent and
> the reasoning on which it rests. Consult a Brazilian lawyer specializing in
> câmbio and BACEN regulation before any live comex operation.

## Yield (DeFindex) — corporate treasury framing

The comex surface earns yield on idle USDC via DeFindex (on-chain yield aggregator
on Solana). The regulatory posture for a CNPJ managing its own treasury is more
defensible than a consumer "savings" product — a company deciding what to do with
its own working capital is not the same as a retail deposit product.

That said, how the product is described matters as much as what it is:

- Describe the **asset**: USDC, self-custody, variable on-chain yield, **principal
  at risk** (DeFi protocols carry smart-contract and liquidity risk).
- Never promise a return, never quote a fixed APY as a forward commitment. Promising
  a specific return is what triggers securities classification under CVM rules
  (investment contract), regardless of the underlying instrument.
- The yield is presented as what it is: a current market rate from on-chain
  protocols, not a product guarantee.

> **Not legal advice.** CVM classification depends on how a product is marketed and
> how it is structured contractually. A Brazilian securities lawyer should review
> any corporate treasury pitch before it goes to market.

## Other jurisdictions (brief)

| jurisdiction | relevant regulation | impact |
|---|---|---|
| US | GENIUS Act (signed July 18, 2025) | clarifies USDC issuance; positive for SlipPay's USDC settlement claim |
| EU | MiCA Phase 2 in 2026 | USDC and EURC are MiCA-compliant; EU merchants can legally accept |
| LATAM (ex-BR) | varies country by country | SlipPay does not specifically target other LATAM markets in v0.1 |

## Known regulatory open risks

1. **Anchor partner falling out of compliance**. If Transfero/Bitso loses
   its license, SlipPay's Pix-in flow stops. Mitigation: integrate with
   2+ anchors from day one for failover.
2. **BCB issuing supplementary guidance** that classifies our flow more
   strictly. Mitigation: maintain a relationship with one of the major BR
   payments law firms (Demarest, Machado Meyer, or BMA) for fast-turn
   legal opinions.
3. **Stablecoin reclassification at MiCA or US level**. Lower impact;
   SlipPay's BR positioning is independent of these markets in v0.1.
4. **Tax obligations for merchants** receiving USDC. Brazilian Receita
   Federal expects merchants to declare crypto holdings monthly above
   R$30k. SlipPay doesn't file on the merchant's behalf; this is
   merchant's responsibility, surfaced in onboarding docs.

## What the marketing must not claim

Per memory `feedback_marketing_must_match_runtime`, every claim on the
landing page should be verifiable in code. Specifically:

- ✘ "fully regulated" — not yet; depends on anchor partnership
- ✘ "licensed PSP" — not a PSP and not licensed
- ✘ "non-custodial means no regulation" — false under Res 521
- ✓ "non-custodial settlement" — true; precise claim about funds
- ✓ "technology layer on top of licensed VASPs" — true after partnership
- ✓ "BRL leg handled by licensed BR anchor" — true after partnership

When the partnership lands, the landing copy and this doc both update.
Until then, the landing carries a "pre-launch" pre-suasion stamp and
mainnet is gated.
