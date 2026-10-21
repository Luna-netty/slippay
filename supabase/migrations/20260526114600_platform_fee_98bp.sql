-- Platform fee 1% → 0.98% — positioning: cheapest in market (MoonPay = 1%).
-- Lowers the default for new merchants and migrates existing merchants still on
-- the old 1% default. Custom fees (anything other than the old 100 default) are
-- left untouched.
alter table merchants alter column platform_fee_bp set default 98;
update merchants set platform_fee_bp = 98 where platform_fee_bp = 100;

-- Capture model A (off-chain invoice): persist the fee per order so SlipPay has
-- a ledger to bill merchants from. Snapshot of the bp at order time + the USDC
-- fee amount. Nullable (pre-existing orders have no fee snapshot).
alter table orders add column if not exists platform_fee_bp int;
alter table orders add column if not exists fee_usdc numeric;
