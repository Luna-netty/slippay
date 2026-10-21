-- supabase/migrations/20260510140000_subscriptions.sql
-- Subscriptions primitive: recurring billing relationships.
-- v1: off-chain orchestrated. Merchant calls POST /v1/subscriptions/:id/charge
-- to materialize an order each period. Listener confirms payment via the same
-- pipeline as one-shot orders.
-- v2 (planned): Soroban subscription contract auto-charges via pre-auth.

create type subscription_status as enum (
  'active', 'paused', 'cancelled', 'expired'
);

create table subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  merchant_id           uuid not null references merchants(id) on delete cascade,
  external_ref          text,
  buyer_stellar_address text,                                      -- optional: known buyer pubkey
  buyer_email           text,                                      -- optional: for invoice emails
  asset_code            text not null default 'USDC' check (asset_code in ('USDC', 'PYUSD')),
  brl_amount            numeric(18,2) not null check (brl_amount > 0),
  period_seconds        int  not null check (period_seconds >= 86400),  -- min 1 day
  max_periods           int  check (max_periods is null or max_periods > 0),
  charges_done          int  not null default 0,
  status                subscription_status not null default 'active',
  expires_at            timestamptz,
  last_charge_at        timestamptz,
  next_charge_at        timestamptz not null default now(),
  soroban_contract_id   text,                                      -- set when v2 contract deployed
  webhook_url           text,                                      -- override merchant.webhook_url
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index subscriptions_merchant_idx     on subscriptions(merchant_id);
create index subscriptions_status_due_idx   on subscriptions(status, next_charge_at) where status = 'active';
create index subscriptions_external_ref_idx on subscriptions(merchant_id, external_ref) where external_ref is not null;

-- Link orders to subscriptions when they originate from one.
alter table orders add column subscription_id uuid references subscriptions(id) on delete set null;
create index orders_subscription_idx on orders(subscription_id) where subscription_id is not null;

-- RLS: merchants only see their own subscriptions.
alter table subscriptions enable row level security;

create policy subscriptions_select_own on subscriptions
  for select using (
    merchant_id in (select id from merchants where auth_user_id = auth.uid())
  );

create policy subscriptions_insert_own on subscriptions
  for insert with check (
    merchant_id in (select id from merchants where auth_user_id = auth.uid())
  );

create policy subscriptions_update_own on subscriptions
  for update using (
    merchant_id in (select id from merchants where auth_user_id = auth.uid())
  );

-- Service role bypasses RLS by default; api uses service_role.
-- Buyer-facing reads (e.g., from a portal) would need a different policy.
