create extension if not exists pg_cron;

select cron.schedule(
  'slippay-expire-orders',
  '*/5 * * * *',
  $$
    update orders
    set status = 'expired'
    where status = 'pending'
      and expires_at < now();

    insert into webhook_deliveries (order_id, type, payload, next_attempt_at)
    select o.id, 'order.expired',
      jsonb_build_object(
        'type', 'order.expired',
        'data', jsonb_build_object(
          'id', o.id,
          'external_ref', o.external_ref,
          'brl_amount', o.brl_amount,
          'memo', o.memo,
          'expires_at', o.expires_at
        )
      ),
      now()
    from orders o
    where o.status = 'expired'
      and not exists (select 1 from webhook_deliveries w where w.order_id = o.id and w.type = 'order.expired');
  $$
);
