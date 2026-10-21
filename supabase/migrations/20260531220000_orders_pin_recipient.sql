-- Pin the merchant's payout (Stellar) address onto each order at creation.
--
-- Before this, the checkout page (routes/orders.ts) and the listener matcher
-- (apps/listener) resolved merchant_stellar_address via a LIVE join to the
-- merchants table. A merchant who rotated their Stellar address after a buyer
-- consented could redirect the funds of an in-flight order, or break the match
-- so a paid order never credits. This is the SettlementAgent "recipient-drift"
-- defense made real in the live charge path: the consented recipient is pinned
-- at order creation and is what both checkout and settlement use thereafter.

alter table orders add column if not exists merchant_stellar_address text;

-- Backfill existing orders from their merchant's current address (one-time;
-- in-flight pending orders keep paying the address shown at checkout).
update orders o
   set merchant_stellar_address = m.stellar_address
  from merchants m
 where o.merchant_id = m.id
   and o.merchant_stellar_address is null;
