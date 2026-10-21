-- supabase/migrations/20260507100100_rls_policies.sql
alter table merchants enable row level security;
alter table orders enable row level security;
alter table webhook_deliveries enable row level security;
-- listener_state: no RLS, only service_role touches it

create policy merchants_self_select on merchants
  for select to authenticated
  using (auth_user_id = auth.uid());

create policy merchants_self_insert on merchants
  for insert to authenticated
  with check (auth_user_id = auth.uid());

create policy merchants_self_update on merchants
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy orders_via_merchant_select on orders
  for select to authenticated
  using (merchant_id in (select id from merchants where auth_user_id = auth.uid()));

create policy orders_via_merchant_insert on orders
  for insert to authenticated
  with check (merchant_id in (select id from merchants where auth_user_id = auth.uid()));

create policy orders_via_merchant_update on orders
  for update to authenticated
  using (merchant_id in (select id from merchants where auth_user_id = auth.uid()))
  with check (merchant_id in (select id from merchants where auth_user_id = auth.uid()));

create policy webhooks_via_merchant_select on webhook_deliveries
  for select to authenticated
  using (order_id in (
    select o.id from orders o
    join merchants m on m.id = o.merchant_id
    where m.auth_user_id = auth.uid()
  ));
