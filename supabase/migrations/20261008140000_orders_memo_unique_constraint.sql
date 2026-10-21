-- Migration: Add unique constraint to orders.memo
-- Fixes: slippay-labs/slippay#71

-- Enforce unique constraint on orders.memo so two orders can never share the same payment memo
alter table orders
  add constraint orders_memo_unique
  unique (memo);
