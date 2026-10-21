-- audit-003 · L3 idempotency at DB level
--
-- Without a unique constraint on (order_id, type) for terminal event types,
-- a Horizon stream restart that replays a paid event re-inserts a
-- webhook_deliveries row, causing duplicate webhook delivery to the merchant.
-- The reconciler.ts:13 status filter blocks the orders mutation, but the
-- insert below it has no such guard. This partial unique index closes the
-- gap at the database level: the second insert will throw a unique-violation
-- which the listener treats as a no-op.

create unique index if not exists webhook_deliveries_terminal_unique
  on webhook_deliveries(order_id, type)
  where type in ('order.paid', 'order.underpaid', 'subscription.charged');
