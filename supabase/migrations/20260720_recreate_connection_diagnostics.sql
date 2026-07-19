-- Destructive reset requested to remove the oversized legacy diagnostics table.
-- The new table stores compact rows, samples routine events at the client, and
-- retains only 14 days of data.

drop table if exists public.connection_diagnostics cascade;

create table public.connection_diagnostics (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session_id uuid null,
  user_id uuid null references auth.users(id) on delete set null,
  event_type text not null check (char_length(event_type) between 1 and 80),
  visibility_state text null,
  network_online boolean null,
  room_state text null,
  livekit_connected boolean not null default false,
  browser text null,
  browser_version text null,
  os text null,
  device_type text null,
  effective_connection_type text null,
  connection_type text null,
  downlink real null,
  rtt integer null,
  save_data boolean null,
  hidden_for_ms bigint null,
  disconnect_reason text null,
  remote_participants smallint null,
  mic_on boolean null,
  cam_on boolean null,
  sample_rate real not null default 0.05 check (sample_rate > 0 and sample_rate <= 1),
  details jsonb not null default '{}'::jsonb
);

create index connection_diagnostics_created_at_idx
  on public.connection_diagnostics (created_at desc);

create index connection_diagnostics_event_device_idx
  on public.connection_diagnostics (event_type, device_type, created_at desc);

alter table public.connection_diagnostics enable row level security;

create policy "users insert own connection diagnostics"
  on public.connection_diagnostics
  for insert
  to authenticated
  with check (auth.uid() = user_id);

revoke all on table public.connection_diagnostics from anon;
grant insert on table public.connection_diagnostics to authenticated;
grant usage, select on sequence public.connection_diagnostics_id_seq to authenticated;
grant all on table public.connection_diagnostics to service_role;
grant all on sequence public.connection_diagnostics_id_seq to service_role;

create or replace function public.prune_connection_diagnostics(
  retention_days integer default 14
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_rows bigint;
begin
  delete from public.connection_diagnostics
  where created_at < now() - make_interval(days => greatest(1, least(retention_days, 90)));

  get diagnostics deleted_rows = row_count;
  return deleted_rows;
end;
$$;

revoke all on function public.prune_connection_diagnostics(integer)
  from public, anon, authenticated;
grant execute on function public.prune_connection_diagnostics(integer)
  to service_role;

create extension if not exists pg_cron;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'prune-connection-diagnostics'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'prune-connection-diagnostics',
    '17 3 * * *',
    'select public.prune_connection_diagnostics(14);'
  );
end;
$$;
