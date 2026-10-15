-- Ledger for one-time emails (for example the Founding Member thank-you):
-- one row per campaign and person, so a send can be resumed after a timeout
-- and nobody gets the same one-time email twice.
--
-- Written only by the server (service role) from the admin email page.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.one_time_email_sends (
  campaign text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  provider_id text null,
  last_error text null,
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz null,
  primary key (campaign, user_id)
);

create index if not exists one_time_email_sends_status_idx
  on public.one_time_email_sends (campaign, status);

alter table public.one_time_email_sends enable row level security;

revoke all on public.one_time_email_sends from anon, authenticated;
grant select, insert, update on public.one_time_email_sends to service_role;

comment on table public.one_time_email_sends is
  'One row per one-time email campaign and person; written by the admin email API.';
