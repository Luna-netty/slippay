-- x402 protocol integration for Slippay.
--
-- An x402_resource is a piece of content (URL, text, JSON) that a merchant
-- gates behind a one-shot Stellar USDC payment. The first GET returns
-- HTTP 402 with x402-compliant headers describing how to pay. Once the
-- listener observes the payment (via the existing orders.memo discipline),
-- the next GET returns the content.
--
-- Reuses orders table for the payment record: every x402 GET creates a
-- pending order with a per-request memo; the listener marks it paid
-- normally; the x402 endpoint just reads orders.status.

create table x402_resources (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references merchants(id) on delete cascade,
  slug            text not null,
  -- price in USDC, decimal string with up to 7 fractional digits
  usd_amount      text not null,
  -- The content delivered on 200. Either inline_content (text/json/etc) OR
  -- redirect_url (for "pay to access this URL" flows).
  inline_content  text,
  inline_mime     text default 'application/json',
  redirect_url    text,
  description     text,
  created_at      timestamptz not null default now(),
  unique (merchant_id, slug)
);

create index x402_resources_merchant_idx on x402_resources(merchant_id);

-- Join order ↔ resource so the x402 GET can find the active payment intent
-- for the (resource, paying client) tuple. The client identifier is its IP
-- in v0.1 (it's a "browser-or-agent comes from somewhere" world); v0.2 can
-- bind to a wallet address quoted in X-PAYMENT-INTENT header.
alter table orders
  add column if not exists x402_resource_id uuid references x402_resources(id) on delete set null,
  add column if not exists x402_client_id   text;

create index if not exists orders_x402_lookup_idx
  on orders(x402_resource_id, x402_client_id, status);
