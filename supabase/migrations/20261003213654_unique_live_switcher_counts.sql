-- Keep card occupancy and deduplicated format-tab occupancy in one read.
-- The old get_live_counts RPC remains available to older deployed clients.
create or replace function public.get_live_counts_with_unique(
  p_group_session_ids uuid[],
  p_infinite_session_ids uuid[],
  p_ttl_seconds integer default 90
)
returns jsonb
language sql
stable
security definer
set search_path = public, auth, extensions
as $function$
  with rooms as (
    select distinct session_id, room_type
    from (
      select unnest(coalesce(p_group_session_ids, '{}'::uuid[])) as session_id,
             'group'::text as room_type
      union all
      select unnest(coalesce(p_infinite_session_ids, '{}'::uuid[])) as session_id,
             'infinite'::text as room_type
    ) requested
    where session_id is not null
  ), live as (
    select rooms.session_id, rooms.room_type, attendance.user_id
    from rooms
    join public.session_attendance attendance
      on attendance.session_id = rooms.session_id
     and attendance.last_seen_at > now() - make_interval(
       secs => greatest(1, least(coalesce(p_ttl_seconds, 90), 3600))
     )
  )
  select jsonb_build_object(
    'room_counts', coalesce((
      select jsonb_object_agg(session_id::text, live_count)
      from (
        select session_id, count(distinct user_id)::integer as live_count
        from live
        group by session_id
      ) per_room
    ), '{}'::jsonb),
    'group', (select count(distinct user_id) from live where room_type = 'group'),
    'infinite', (select count(distinct user_id) from live where room_type = 'infinite')
  );
$function$;

revoke all on function public.get_live_counts_with_unique(uuid[], uuid[], integer) from public;
grant execute on function public.get_live_counts_with_unique(uuid[], uuid[], integer) to anon, authenticated;
