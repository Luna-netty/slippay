-- audit-003 · L2 single-instance guard
--
-- Two listener pods both running watchAccount for the same merchant
-- account is a duplicate-charge / duplicate-delivery hazard, especially
-- during rolling deploys when the old pod overlaps the new pod for a
-- few seconds.
--
-- Lease-table approach: each pod acquires a per-account lease with TTL,
-- heartbeats while alive, releases on graceful shutdown. Crash-safe by
-- virtue of TTL — the next pod that polls past expires_at takes over.
-- Supabase JS service-role client supports the upsert/conditional-update
-- shape this needs without raw SQL.

create table if not exists listener_leases (
  account_id   text primary key,
  holder_id    text not null,
  acquired_at  timestamptz not null default now(),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);

create index if not exists listener_leases_expires_idx
  on listener_leases(expires_at);

comment on table listener_leases is
  'Per-account exclusivity lease for the Stellar listener. Pod identified by holder_id holds the right to watch account_id until expires_at. Refresh via UPDATE; release via DELETE.';
