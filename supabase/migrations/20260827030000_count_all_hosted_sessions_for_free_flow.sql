-- Free Flow eligibility must use every session the user has hosted, regardless
-- of format. A user can be recorded either as the session owner/host or through
-- a host booking, so combine both sources and de-duplicate by session id.

create or replace function public.calculate_lifetime_hosted_session_count(
  p_user_id uuid default auth.uid()
)
returns bigint
language sql
stable
security definer
set search_path = public, auth
as $$
  select count(*)::bigint
  from (
    select s.id as session_id
    from public.sessions s
    where s.host_id = p_user_id
      and coalesce(s.status, 'active') not in ('cancelled', 'deleted')

    union

    select b.session_id
    from public.session_bookings b
    join public.sessions s on s.id = b.session_id
    where b.user_id = p_user_id
      and coalesce(b.booking_role, 'participant') = 'host'
      and coalesce(s.status, 'active') not in ('cancelled', 'deleted')
  ) hosted_sessions;
$$;

revoke all on function public.calculate_lifetime_hosted_session_count(uuid)
  from public, anon;
grant execute on function public.calculate_lifetime_hosted_session_count(uuid)
  to authenticated, service_role;

create or replace function public.get_infinite_room_creator_eligibility()
returns table (
  attended_count bigint,
  hosted_count bigint,
  eligible boolean
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_attended bigint := 0;
  v_hosted bigint := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_attended := public.calculate_lifetime_session_count(v_user_id);
  v_hosted := public.calculate_lifetime_hosted_session_count(v_user_id);

  return query
  select
    coalesce(v_attended, 0),
    coalesce(v_hosted, 0),
    coalesce(v_attended, 0) >= 50 and coalesce(v_hosted, 0) >= 5;
end;
$$;

revoke all on function public.get_infinite_room_creator_eligibility()
  from public, anon;
grant execute on function public.get_infinite_room_creator_eligibility()
  to authenticated, service_role;

-- Keep the INSERT guard consistent with the UI eligibility RPC. This replaces
-- the earlier trigger function, which counted only sessions.host_id rows.
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
    v_hosted := public.calculate_lifetime_hosted_session_count(v_user_id);

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

notify pgrst, 'reload schema';
