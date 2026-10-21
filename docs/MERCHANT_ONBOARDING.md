# SlipPay — onboarding de merchant (ir live em ~10 min)

Do zero a receber em dólar. Cada passo é obrigatório; o passo 2 é o que mais
gente esquece e sem ele **nenhum pagamento funciona**.

## 1. Criar conta
- `app.slippay.cc` → **Criar conta de merchant** → e-mail + senha.
- Escolha a rede: **testnet** (testes) ou **mainnet** (dinheiro real).

## 2. Setar o endereço Stellar de recebimento ⚠️ CRÍTICO
Dashboard → **Settings** → campo **"Stellar receive address"** → cole o endereço
de uma carteira Stellar **que você controla** (Freighter, Lobstr, etc.).
- A carteira **precisa de trustline USDC** no issuer correto:
  - **mainnet:** `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
  - **testnet:** `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
- Sem endereço setado → `merchant_stellar_address: null` → o checkout não tem
  pra onde o comprador pagar → **zero recebimento.**

## 3. Pegar credenciais
Settings → copie a **API key** (`sk_live_...`) e defina o **webhook secret** (≥32 chars).
A key não é mostrada de novo — guarde.

## 4. Instalar na sua loja (escolha a plataforma)
Todas usam o mesmo motor (`POST /api/v1/orders` → `checkout_url`):
- **WooCommerce** — plugin `woocommerce-slippay` v0.2.0: instala, ativa, em
  WooCommerce → Pagamentos → SlipPay → cola `api_base=https://api.slippay.cc` +
  API key + webhook secret. Moeda da loja = **BRL**.
- **VTEX** — conector `apps/vtex-connector` (Payment Provider Protocol).
- **Shopify** — conector `apps/shopify-connector` (Payments App).
- **API direta** — `POST /api/v1/orders` com `Authorization: Bearer <key>` e `{"brl_amount":"49.90"}`.

## 5. Primeira venda (o fluxo do dinheiro)
1. Cobrança criada → `checkout_url` (`app.slippay.cc/checkout/...`).
2. Comprador paga **USDC** ao seu endereço + memo (hoje); **Pix** entra com o
   anchor de câmbio licenciado (em definição).
3. O **listener** detecta on-chain (memo + issuer + valor ≥ líquido) → ordem
   marcada **paid** em ~6s.
4. Seu endpoint recebe o webhook **`order.paid`** (HMAC-SHA256, com retries).

## 6. Taxa e faturamento
- Taxa **0,98%** por transação (mais barato que MoonPay 1%), registrada em cada ordem.
- `GET /api/v1/billing/fees?from&to` (key ou sessão) soma a taxa das ordens pagas
  no período — a base da sua fatura mensal.

## Hoje vs em breve
- **USDC-in:** funciona hoje (comprador cripto-nativo).
- **Pix-in:** depende do anchor de câmbio BR licenciado (Transfero / Mercado
  Bitcoin / Bity em diligência). Quando fechar, o comprador paga Pix e você
  recebe dólar igual.
