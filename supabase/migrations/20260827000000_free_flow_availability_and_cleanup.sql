-- Free Flow creation is earned through product activity, but it no longer
-- depends on a full standard room. A second Free Flow is allowed only after
-- the currently visible one is full.

create or replace function public.validate_free_flow_infinite_room()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_attended bigint := 0;
  v_hosted bigint := 0;
  v_blocks integer := 0;
  v_has_available_free_flow boolean := false;
begin
  if coalesce(new.schedule ->> 'variant', '') <> 'free_flow'
     and coalesce((new.schedule ->> 'free_flow')::boolean, false) = false then
    return new;
  end if;

  if tg_op = 'INSERT' and v_user_id is not null then
    v_attended := public.calculate_lifetime_session_count(v_user_id);

    select count(*)
      into v_hosted
    from public.sessions s
    where s.host_id = v_user_id
      and coalesce(s.status, 'active') not in ('cancelled', 'deleted');

    if v_attended < 50 or v_hosted < 5 then
      raise exception 'free_flow_requires_50_attended_and_5_hosted_sessions'
        using errcode = '42501';
    end if;

    select exists (
      select 1
      from public.sessions s
      left join public.room_live_count_leases l on l.session_id = s.id
      where coalesce(s.status, 'active') not in ('cancelled', 'deleted')
        and coalesce(s.is_hidden, false) = false
        and coalesce(s.is_private, false) = false
        and (
          coalesce(s.schedule ->> 'variant', '') = 'free_flow'
          or coalesce((s.schedule ->> 'free_flow')::boolean, false) = true
        )
        and coalesce(l.live_count, 0) < greatest(1, coalesce(s.max_participants, 8))
    ) into v_has_available_free_flow;

    if v_has_available_free_flow then
      raise exception 'an_available_free_flow_room_already_exists'
        using errcode = '23505';
    end if;
  end if;

  v_blocks := coalesce(
    jsonb_array_length(
      case
        when jsonb_typeof(new.schedule -> 'blocks') = 'array' then new.schedule -> 'blocks'
        when jsonb_typeof(new.schedule -> 'phases') = 'array' then new.schedule -> 'phases'
        when jsonb_typeof(new.schedule -> 'timer' -> 'phases') = 'array' then new.schedule -> 'timer' -> 'phases'
        else '[]'::jsonb
      end
    ),
    0
  );

  if v_blocks > 9 then
    raise exception 'free_flow_timeline_is_limited_to_9_blocks'
      using errcode = '22023';
  end if;

  new.session_format_type := 'infinite';
  new.format := 'infinite';
  new.schedule := jsonb_set(new.schedule, '{kind}', '"infinite_room"', true);
  new.schedule := jsonb_set(new.schedule, '{max_timeline_blocks}', '9', true);
  return new;
end;
$$;

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
    schedule = jsonb_set(coalesce(s.schedule, '{}'::jsonb), '{auto_closed}', 'true', true)
  where coalesce(s.status, 'active') not in ('cancelled', 'deleted')
    and coalesce(s.is_hidden, false) = false
    and greatest(
      coalesce(s.created_at, now()),
      coalesce(
        (select max(l0.updated_at) from public.room_live_count_leases l0 where l0.session_id = s.id),
        s.created_at
      ),
      coalesce(
        (select max(h0.expires_at) from public.infinite_room_host_leases h0 where h0.session_id = s.id),
        s.created_at
      )
    ) <= now() - interval '10 minutes'
    and (
      coalesce(s.schedule ->> 'variant', '') = 'free_flow'
      or coalesce((s.schedule ->> 'free_flow')::boolean, false) = true
    )
    and not exists (
      select 1
      from public.room_live_count_leases l
      where l.session_id = s.id
        and l.updated_at >= now() - interval '90 seconds'
        and coalesce(l.live_count, 0) > 0
    )
    and not exists (
      select 1
      from public.infinite_room_host_leases h
      where h.session_id = s.id
        and h.expires_at > now()
    );

  get diagnostics v_cleaned = row_count;
  return v_cleaned;
end;
$$;

revoke all on function public.cleanup_empty_free_flow_rooms() from public;
grant execute on function public.cleanup_empty_free_flow_rooms() to service_role;

create extension if not exists pg_cron;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
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
