-- Align public community counts with the existing lifetime attendance counter.
-- A repeat visit to an infinite room on a new local day counts as another
-- attended session. The old leaderboard's count(distinct session_id) did not.
-- Keep public hosted sessions separate: attending is not the same as hosting.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Adding a return column requires replacing the function signature. There are
-- no database dependents; DROP/CREATE is transactional in this migration.
drop function public.community_hosts(integer);

create function public.community_hosts(p_limit integer default 120)
returns table(
  user_id uuid,
  full_name text,
  avatar_url text,
  bio text,
  country_code text,
  hosted_sessions bigint,
  focus_rate numeric,
  focus_feedback_count bigint,
  last_hosted_at timestamptz,
  next_session_id uuid,
  next_session_title text,
  next_session_start timestamptz,
  attended_sessions bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  with host_stats as (
    select
      s.host_id,
      count(*) filter (
        where s.start_time is not null
          and s.start_time <= statement_timestamp()
      )::bigint as hosted_sessions,
      max(s.start_time) filter (
        where s.start_time is not null
          and s.start_time <= statement_timestamp()
      ) as last_hosted_at
    from public.sessions s
    where s.host_id is not null
      and coalesce(s.status, 'planned') <> 'cancelled'
      and coalesce(s.is_hidden, false) = false
      and coalesce(s.is_private, false) = false
      and coalesce(s.is_infinite, false) = false
    group by s.host_id
  ),
  feedback as (
    select
      f.host_id,
      round(avg(f.rating)::numeric, 1) as focus_rate,
      count(*)::bigint as focus_feedback_count
    from public.session_feedback f
    where f.host_id is not null
      and f.user_id is distinct from f.host_id
      and f.rating is not null
      and f.rating between 0 and 100
    group by f.host_id
  )
  select
    p.id as user_id,
    coalesce(nullif(btrim(p.full_name), ''), 'MySession member') as full_name,
    p.avatar_url,
    nullif(btrim(p.bio), '') as bio,
    p.country_code,
    hs.hosted_sessions,
    feedback.focus_rate,
    coalesce(feedback.focus_feedback_count, 0::bigint) as focus_feedback_count,
    hs.last_hosted_at,
    next_session.id as next_session_id,
    next_session.title as next_session_title,
    next_session.start_time as next_session_start,
    coalesce(p.attended_sessions_count, 0)::bigint as attended_sessions
  from host_stats hs
  join public.profiles p on p.id = hs.host_id
  left join feedback on feedback.host_id = hs.host_id
  left join lateral (
    select s.id, s.title, s.start_time
    from public.sessions s
    where s.host_id = hs.host_id
      and s.start_time > statement_timestamp()
      and coalesce(s.status, 'planned') <> 'cancelled'
      and coalesce(s.is_hidden, false) = false
      and coalesce(s.is_private, false) = false
      and coalesce(s.is_infinite, false) = false
    order by s.start_time asc
    limit 1
  ) next_session on true
  where hs.hosted_sessions > 0
  order by hs.hosted_sessions desc, feedback.focus_rate desc nulls last, full_name
  limit greatest(1, least(coalesce(p_limit, 120), 250));
$function$;

revoke all on function public.community_hosts(integer) from public, anon, authenticated;
grant execute on function public.community_hosts(integer) to anon, authenticated, service_role;

comment on function public.community_hosts(integer) is
  'Public host directory: public past hosted rooms, lifetime attended sessions from profiles, focus feedback, and next public session.';

create or replace function public.community_user_leaderboard(p_limit integer default 150)
returns table(
  user_id uuid,
  full_name text,
  avatar_url text,
  country_code text,
  sessions_count bigint,
  focus_hours numeric,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  with activity as (
    select
      h.user_id,
      round((
        sum(
          greatest(
            0,
            extract(epoch from (
              greatest(
                h.joined_at,
                coalesce(h.left_at, h.last_seen_at, h.joined_at)
              ) - h.joined_at
            ))
          )
        ) / 3600.0
      )::numeric, 1) as focus_hours,
      max(coalesce(h.left_at, h.last_seen_at, h.joined_at)) as last_seen_at
    from public.attendance_visit_history h
    group by h.user_id
  )
  select
    p.id as user_id,
    coalesce(nullif(btrim(p.full_name), ''), 'MySession member') as full_name,
    p.avatar_url,
    p.country_code,
    coalesce(p.attended_sessions_count, 0)::bigint as sessions_count,
    coalesce(a.focus_hours, 0::numeric) as focus_hours,
    a.last_seen_at
  from public.profiles p
  left join activity a on a.user_id = p.id
  where coalesce(p.attended_sessions_count, 0) > 0
  order by sessions_count desc, focus_hours desc, full_name
  limit greatest(1, least(coalesce(p_limit, 150), 300));
$function$;

revoke all on function public.community_user_leaderboard(integer) from public, anon, authenticated;
grant execute on function public.community_user_leaderboard(integer) to anon, authenticated, service_role;

comment on function public.community_user_leaderboard(integer) is
  'Public member leaderboard: canonical lifetime attendance count and durable visit focus hours.';
