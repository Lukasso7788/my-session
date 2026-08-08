-- Apply manually in Supabase SQL Editor before using private access restrictions.
-- This table is intentionally service-role only. Authenticated users, including
-- the affected account, cannot select its rows through PostgREST.

create extension if not exists pgcrypto;

create table if not exists public.account_access_controls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_by_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (length(btrim(reason)) > 0),
  internal_notes text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint account_access_controls_time_order
    check (expires_at is null or expires_at > starts_at)
);

create index if not exists account_access_controls_active_user_idx
  on public.account_access_controls (user_id, starts_at, expires_at, created_at desc)
  where revoked_at is null;

alter table public.account_access_controls enable row level security;
alter table public.account_access_controls force row level security;

revoke all on table public.account_access_controls from public;
revoke all on table public.account_access_controls from anon;
revoke all on table public.account_access_controls from authenticated;
grant all on table public.account_access_controls to service_role;

comment on table public.account_access_controls is
  'Private server-side account access state. Never expose through client-side Supabase queries.';