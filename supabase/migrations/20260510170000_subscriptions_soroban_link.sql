-- supabase/migrations/20260510170000_subscriptions_soroban_link.sql
-- Link a slippay subscription to its on-chain Soroban contract instance.
--
-- soroban_contract_id is the contract address (same for all subs that share
--   a contract instance, e.g., the M1 deployed CBWJ3LQGO7H...HRHA).
-- soroban_subscription_id is the 32-byte nonce (hex) that keys this specific
--   subscription within the contract storage.
--
-- Both nullable: subs are off-chain orchestrated by default; setting these
--   promotes the subscription to on-chain via the v0.1 Soroban contract.

alter table subscriptions
  add column if not exists soroban_subscription_id text;

-- Note: soroban_contract_id column already exists from initial subscriptions
-- migration (20260510140000). This adds the per-subscription nonce.

create index subscriptions_soroban_idx
  on subscriptions(soroban_contract_id, soroban_subscription_id)
  where soroban_subscription_id is not null;
