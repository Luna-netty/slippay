-- Ramp transaction status, populated by provider webhooks (CriptoPix today).
--
-- Charge-model ramp providers (CriptoPix) have no GET-by-id endpoint: status is
-- delivered via webhook. This table is the local store the Anchor read methods
-- (getOnRampTransaction / getOffRampTransaction) resolve against.
--
-- Keyed by gateway_id (CriptoPix's "triple reconciliation" id, returned at
-- charge/withdraw creation and echoed on every webhook). partner_transaction_id
-- (our quote id) is indexed as a fallback handle.
--
-- Service-role only: RLS is enabled with no policies, so anon/auth clients see
-- nothing; the webhook writer and the API reader both use the service client,
-- which bypasses RLS. Mirrors 20260601230000_security_rls_lockdown.

create table if not exists ramp_transactions (
  gateway_id              text primary key,
  partner_transaction_id  text,
  transaction_id          text,
  business_id             text,
  provider                text not null default 'criptopix',
  transaction_type        text,
  transaction_status      text,
  error_type              text,
  error_message           text,
  user_id                 text,
  usdt_amount             numeric,
  reais_amount            numeric,
  br_code                 text,
  hash_web3               text,
  end_to_end_id           text,
  after_payment_id        text,
  raw                     jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists ramp_transactions_partner_tx_idx
  on ramp_transactions (partner_transaction_id);

alter table ramp_transactions enable row level security;
