-- Waitlist capture for the "em breve" surfaces (/cofrinho, /receber, /empresas).
-- Anonymous visitors may INSERT their email; nobody anon can read it back.
-- Apply via Supabase SQL editor or `supabase db push`.

create table if not exists public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  source     text,                          -- which surface: cofrinho | receber | empresas
  lang       text,
  created_at timestamptz not null default now()
);

-- Dedupe the same email per surface (idempotent re-submits).
create unique index if not exists waitlist_email_source_uniq
  on public.waitlist (lower(email), coalesce(source, ''));

alter table public.waitlist enable row level security;

-- Anon may only INSERT. No SELECT/UPDATE/DELETE for anon (lead list stays private;
-- read it with the service role / dashboard).
drop policy if exists waitlist_anon_insert on public.waitlist;
create policy waitlist_anon_insert on public.waitlist
  for insert to anon, authenticated
  with check (true);
