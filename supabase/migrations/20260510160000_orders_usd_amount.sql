-- supabase/migrations/20260510160000_orders_usd_amount.sql
-- BR-export wedge: merchants invoice global customers directly in USD.
-- usdc_amount = usd_amount at 1:1 (USDC is USD-pegged), no CoinGecko round trip.
-- Either brl_amount OR usd_amount must be set; enforced at the app layer
-- (zod schema) and via this CHECK constraint as a defense-in-depth backstop.

alter table orders add column if not exists usd_amount numeric(18,2);
alter table orders alter column brl_amount drop not null;

-- Defense-in-depth: enforce exactly one of brl_amount or usd_amount is set.
alter table orders add constraint orders_amount_xor
  check (
    (brl_amount is not null and usd_amount is null)
    or
    (brl_amount is null and usd_amount is not null)
  );

-- USD-denominated orders don't carry a BRL/USDC rate (USDC is USD-pegged 1:1).
alter table orders alter column rate_brl_usdc drop not null;
