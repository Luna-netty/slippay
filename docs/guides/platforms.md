# Plataformas de e-commerce

O SlipPay funciona como meio de pagamento em várias plataformas. Todas usam o
mesmo motor por baixo (`POST /api/v1/orders` → `checkout_url` → webhook de
confirmação), então adicionar uma plataforma é um adaptador, não um produto novo.

## WooCommerce — pronto

Plugin oficial (`plugins/woocommerce-slippay/`, v0.2.0). Instala, configura a
chave de API + webhook secret, e o SlipPay aparece como opção de pagamento no
checkout. Quando o comprador paga, o pedido vira **pago automaticamente** — você
não toca em nada. Veja o passo a passo em [docs/guides/woocommerce.md].

## VTEX — conector funcional

Conector via [Payment Provider Protocol](https://developers.vtex.com/docs/guides/payments-integration-payment-provider-protocol)
(`apps/vtex-connector/`). O fluxo `createPayment → SlipPay → checkout` está
funcional e testado contra o backend de produção. A homologação oficial da VTEX
(suite de testes obrigatória) ainda está pendente.

## Shopify — conector funcional

Conector via [Payments App](https://shopify.dev/docs/apps/build/payments)
(`apps/shopify-connector/`). O comprador escolhe SlipPay no checkout, é
redirecionado para pagar, e a sessão é finalizada quando o pagamento confirma. O
fluxo está funcional; a aprovação/listagem oficial como Shopify Payments App
ainda está pendente.

## Outras plataformas

Nuvemshop, VTEX, Loja Integrada, Yampi e qualquer storefront: como o motor é o
mesmo (criar pedido + receber webhook), uma nova plataforma é um adaptador sobre
a API. Veja [docs/guides/drop-in-sdk.md] para integração via API/SDK direto.

## O que é honesto dizer hoje

- **WooCommerce**: pronto para usar.
- **VTEX e Shopify**: conector funcional, homologação da plataforma pendente.
- **Recebimento em USDC**: funciona hoje. **Entrada via Pix**: depende do parceiro
  de câmbio licenciado (em definição) — veja [docs/concepts/regulatory.md].
