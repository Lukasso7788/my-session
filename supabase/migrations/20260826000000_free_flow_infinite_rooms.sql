-- Free Flow is stored as an infinite room variant so existing LiveKit routing,
-- attendance and legacy session_format_type constraints keep working.

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
  v_has_full_standard_room boolean := false;
begin
  if coalesce(new.schedule ->> 'variant', '') <> 'free_flow'
     and coalesce((new.schedule ->> 'free_flow')::boolean, false) = false then
    return new;
  end if;

  -- Updates made by backend maintenance retain the invariant below, while
  -- interactive creation is also subject to the product eligibility gate.
  if tg_op = 'INSERT' and v_user_id is not null then
    v_attended := public.calculate_lifetime_session_count(v_user_id);

    select count(*)
      into v_hosted
    from public.sessions s
    where s.host_id = v_user_id
      and coalesce(s.status, 'active') not in ('cancelled', 'deleted');

    select exists (
      select 1
      from public.sessions s
      left join public.room_live_count_leases l on l.session_id = s.id
      where lower(coalesce(s.session_format_type, '')) = 'infinite'
        and coalesce(s.is_hidden, false) = false
        and coalesce(s.is_private, false) = false
        and coalesce(s.title, '') ~* '\m(15/3|25/5|50/10|100/20)\M'
        and l.updated_at >= now() - interval '90 seconds'
        and l.live_count >= greatest(1, coalesce(s.max_participants, 16))
    ) into v_has_full_standard_room;

    if v_attended < 40 or v_hosted < 5 then
      raise exception 'free_flow_requires_40_attended_and_5_hosted_sessions'
        using errcode = '42501';
    end if;

    if not v_has_full_standard_room then
      raise exception 'free_flow_requires_a_full_standard_infinite_room'
        using errcode = '42501';
    end if;
  end if;

  v_blocks := coalesce(
    jsonb_array_length(
      case
        when jsonb_typeof(new.schedule -> 'blocks') = 'array'
          then new.schedule -> 'blocks'
        when jsonb_typeof(new.schedule -> 'phases') = 'array'
          then new.schedule -> 'phases'
        when jsonb_typeof(new.schedule -> 'timer' -> 'phases') = 'array'
          then new.schedule -> 'timer' -> 'phases'
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

drop trigger if exists sessions_validate_free_flow on public.sessions;
create trigger sessions_validate_free_flow
before insert or update of schedule on public.sessions
for each row
execute function public.validate_free_flow_infinite_room();
