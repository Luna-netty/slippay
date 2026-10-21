-- Migration: backfill orders.platform_fee_bp, enforce NOT NULL, set default 297, and add CHECK constraint [0, 1000]
-- Fixes: slippay-labs/slippay#96

-- 1. Backfill existing orders from merchant's platform_fee_bp, fallback to 297
update orders o
set platform_fee_bp = coalesce(m.platform_fee_bp, 297)
from merchants m
where o.merchant_id = m.id and o.platform_fee_bp is null;

-- Fallback for any orphan orders without matching merchant
update orders
set platform_fee_bp = 297
where platform_fee_bp is null;

-- 2. Set default to 297 (canonical default platform fee, 2.97%)
alter table orders
  alter column platform_fee_bp set default 297;

-- 3. Enforce NOT NULL
alter table orders
  alter column platform_fee_bp set not null;

-- 4. Enforce CHECK constraint (between 0 and 1000 bp, i.e. 0% to 10%)
alter table orders
  add constraint orders_platform_fee_bp_check
  check (platform_fee_bp between 0 and 1000);
