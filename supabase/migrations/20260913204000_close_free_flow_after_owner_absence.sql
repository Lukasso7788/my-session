-- Close public Free Flow infinite rooms when their owner has been absent for
-- ten minutes. The owner is the session host (`sessions.host_id`). Presence is
-- derived from `session_attendance`, whose heartbeat is refreshed by the room
-- client every 30 seconds. Other participants and temporary host leases do not
-- keep a Free Flow room alive after its owner leaves.

create or replace function public.cleanup_empty_free_flow_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleaned integer := 0;
begin
  update public.sessions s
  set
    status = 'cancelled',
    is_hidden = true,
    schedule = jsonb_set(
      jsonb_set(
        coalesce(s.schedule, '{}'::jsonb),
        '{auto_closed}',
        'true'::jsonb,
        true
      ),
      '{auto_close_reason}',
      to_jsonb('owner_absent_10_minutes'::text),
      true
    )
  where coalesce(s.status, 'active') not in ('cancelled', 'deleted')
    and coalesce(s.is_hidden, false) = false
    and (
      coalesce(s.schedule ->> 'variant', '') = 'free_flow'
      or coalesce((s.schedule ->> 'free_flow')::boolean, false) = true
    )
    -- A fresh owner heartbeat always keeps the room alive.
    and not exists (
      select 1
      from public.session_attendance owner_live
      where owner_live.session_id = s.id
        and owner_live.user_id = s.host_id
        and owner_live.left_at is null
        and owner_live.last_seen_at >= now() - interval '90 seconds'
    )
    -- Start the 10-minute grace period from the owner's latest known presence
    -- event. If the owner never entered, fall back to room creation time.
    and coalesce(
      (
        select max(
          greatest(
            coalesce(owner_history.joined_at, '-infinity'::timestamptz),
            coalesce(owner_history.last_seen_at, '-infinity'::timestamptz),
            coalesce(owner_history.left_at, '-infinity'::timestamptz)
          )
        )
        from public.session_attendance owner_history
        where owner_history.session_id = s.id
          and owner_history.user_id = s.host_id
      ),
      s.created_at,
      '-infinity'::timestamptz
    ) <= now() - interval '10 minutes';

  get diagnostics v_cleaned = row_count;
  return v_cleaned;
end;
$$;

revoke all on function public.cleanup_empty_free_flow_rooms() from public;
grant execute on function public.cleanup_empty_free_flow_rooms() to service_role;

-- Keep the maintenance server-side so cleanup does not depend on any browser
-- being open. Recreate the named job defensively and run it once per minute.
create extension if not exists pg_cron;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'cleanup-empty-free-flow-rooms'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'cleanup-empty-free-flow-rooms',
    '* * * * *',
    'select public.cleanup_empty_free_flow_rooms();'
  );
end;
$$;

notify pgrst, 'reload schema';
