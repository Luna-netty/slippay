-- supabase/migrations/20260507100000_initial_schema.sql
create extension if not exists pgcrypto;

create table merchants (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique not null references auth.users(id) on delete cascade,
  display_name    text not null,
  email           text not null,
  stellar_address text,
  network         text not null default 'testnet' check (network in ('testnet','mainnet')),
  api_key_hash    text not null,
  api_key_prefix  text not null,
  webhook_url     text,
  webhook_secret  text not null,
  platform_fee_bp int  not null default 100 check (platform_fee_bp between 0 and 1000),
  active          bool not null default true,
  created_at      timestamptz not null default now()
);
create index merchants_apikey_idx on merchants(api_key_prefix);
create index merchants_address_active_idx on merchants(stellar_address) where active;

create table orders (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references merchants(id) on delete restrict,
  external_ref    text,
  brl_amount      numeric(12,2) not null check (brl_amount > 0),
  usdc_amount     numeric(12,7) not null check (usdc_amount > 0),
  rate_brl_usdc   numeric(12,7) not null,
  memo            text not null unique,
  status          text not null default 'pending'
                  check (status in ('pending','paid','underpaid','expired','cancelled','dead')),
  tx_hash         text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  paid_at         timestamptz
);
create index orders_merchant_status_idx on orders(merchant_id, status);
create index orders_memo_pending_idx on orders(memo) where status = 'pending';
create index orders_expires_pending_idx on orders(expires_at) where status = 'pending';

create table webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  type            text not null,
  attempt_n       int not null default 0,
  status          text not null default 'queued'
                  check (status in ('queued','sent','failed','dead')),
  response_code   int,
  response_body   text,
  payload         jsonb not null,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now()
);
create index webhook_pending_idx on webhook_deliveries(next_attempt_at)
  where status in ('queued','failed');

create table listener_state (
  account_id   text primary key,
  paging_token text not null,
  updated_at   timestamptz not null default now()
);
