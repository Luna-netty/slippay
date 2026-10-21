-- Migration: add precision/scale, NOT NULL constraint, non-negative CHECK, and backfill fee_usdc on orders
-- Fixes: slippay-labs/slippay#99

-- 1. Backfill existing orders where fee_usdc is NULL
update orders o
set fee_usdc = coalesce(
  round(o.usdc_amount * coalesce(o.platform_fee_bp, m.platform_fee_bp, 297) / 10000.0, 7),
  0
)
from merchants m
where o.merchant_id = m.id and o.fee_usdc is null;

-- Fallback for any orphan orders without matching merchant
update orders
set fee_usdc = 0
where fee_usdc is null;

-- 2. Set numeric precision and scale to numeric(20,7)
alter table orders
  alter column fee_usdc type numeric(20,7);

-- 3. Enforce NOT NULL
alter table orders
  alter column fee_usdc set not null;

-- 4. Enforce non-negative and max 7 decimal places check
alter table orders
  add constraint orders_fee_usdc_check
  check (fee_usdc >= 0 and scale(fee_usdc) <= 7);
