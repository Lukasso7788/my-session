-- Admin dashboard: returning people and attendance streaks.
--
-- Source: public.attendance_daily_users (one row per person per UTC day with
-- any attendance), the same durable day cache the dashboard's daily and
-- monthly counters use. Calendar is UTC, weeks start on Monday (ISO).
--
--   Returning: people with attendance on 2+ different days in a week or month
--   (several sessions on one day count once).
--   Streaks: consecutive days / weeks / months / years with attendance.
--   A streak is still "current" if the last period with attendance is this
--   period or the one before (today not attended yet does not break it).
--
-- Read-only; no new tables.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create schema if not exists mysession_private;
revoke all on schema mysession_private from public, anon, authenticated;

-- Period number for a date: consecutive periods differ by exactly 1.
create or replace function mysession_private.streak_period_n(p_unit text, p_day date)
returns integer language sql immutable set search_path = '' as $$
  select case p_unit
    when 'day' then p_day - date '2000-01-03'
    when 'week' then (date_trunc('week', p_day)::date - date '2000-01-03') / 7
    when 'month' then extract(year from p_day)::integer * 12 + extract(month from p_day)::integer
    else extract(year from p_day)::integer
  end;
$$;

-- Current and longest streak per person and unit, as of p_today.
create or replace function mysession_private.attendance_streaks(p_today date, p_user_id uuid default null)
returns table (user_id uuid, unit text, current_streak integer, longest_streak integer, last_period integer)
language sql stable security definer set search_path = '' as $$
  with units(unit) as (values ('day'), ('week'), ('month'), ('year')),
  periods as (
    select distinct d.user_id, u.unit, mysession_private.streak_period_n(u.unit, d.attendance_date) as n
    from public.attendance_daily_users d
    cross join units u
    where d.attendance_date <= p_today
      and (p_user_id is null or d.user_id = p_user_id)
  ),
  islands as (
    select x.user_id, x.unit, max(x.n) as end_n, count(*)::integer as len
    from (
      select p.user_id, p.unit, p.n, p.n - row_number() over (partition by p.user_id, p.unit order by p.n) as grp
      from periods p
    ) x
    group by x.user_id, x.unit, x.grp
  )
  select i.user_id,
         i.unit,
         coalesce(max(i.len) filter (where i.end_n >= mysession_private.streak_period_n(i.unit, p_today) - 1), 0),
         max(i.len),
         max(i.end_n)
  from islands i
  group by i.user_id, i.unit;
$$;

create or replace function mysession_private.retention_streaks(p_today date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_week date := date_trunc('week', p_today)::date;
  v_month date := date_trunc('month', p_today)::date;
  v_returning jsonb;
  v_streaks jsonb;
begin
  -- Returning people: last 12 weeks and last 12 months, newest last.
  with days as (
    select d.user_id, d.attendance_date as day
    from public.attendance_daily_users d
    where d.attendance_date <= p_today
      and d.attendance_date >= (v_month - interval '11 months')::date - 7
  ),
  per_week as (
    select user_id, date_trunc('week', day)::date as start_date, count(*)::integer as days
    from days group by 1, 2
  ),
  per_month as (
    select user_id, date_trunc('month', day)::date as start_date, count(*)::integer as days
    from days group by 1, 2
  ),
  week_series as (
    select (v_week - g * 7) as start_date from generate_series(0, 11) g
  ),
  month_series as (
    select (v_month - make_interval(months => g))::date as start_date from generate_series(0, 11) g
  ),
  weeks as (
    select s.start_date,
           count(c.user_id)::integer as active,
           count(c.user_id) filter (where c.days >= 2)::integer as returning,
           count(c.user_id) filter (where c.days >= 3)::integer as returning3
    from week_series s left join per_week c on c.start_date = s.start_date
    group by s.start_date
  ),
  months as (
    select s.start_date,
           count(c.user_id)::integer as active,
           count(c.user_id) filter (where c.days >= 2)::integer as returning,
           count(c.user_id) filter (where c.days >= 3)::integer as returning3
    from month_series s left join per_month c on c.start_date = s.start_date
    group by s.start_date
  ),
  returners as (
    select 'week' as scope, c.user_id, c.days from per_week c where c.start_date = v_week and c.days >= 2
    union all
    select 'month', c.user_id, c.days from per_month c where c.start_date = v_month and c.days >= 2
    union all
    select 'prev_month', c.user_id, c.days from per_month c
    where c.start_date = (v_month - interval '1 month')::date and c.days >= 2
  ),
  ranked_returners as (
    select r.*, row_number() over (partition by r.scope order by r.days desc, r.user_id) as rk
    from returners r
  )
  select jsonb_build_object(
    'weeks', (select coalesce(jsonb_agg(jsonb_build_object('start', w.start_date, 'active', w.active, 'returning', w.returning, 'returning3', w.returning3) order by w.start_date), '[]') from weeks w),
    'months', (select coalesce(jsonb_agg(jsonb_build_object('start', m.start_date, 'active', m.active, 'returning', m.returning, 'returning3', m.returning3) order by m.start_date), '[]') from months m),
    'top', (
      select coalesce(jsonb_object_agg(t.scope, t.people), '{}')
      from (
        select rr.scope, jsonb_agg(jsonb_build_object('user_id', rr.user_id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'days', rr.days) order by rr.rk) as people
        from ranked_returners rr left join public.profiles p on p.id = rr.user_id
        where rr.rk <= 20
        group by rr.scope
      ) t
    )
  ) into v_returning;

  -- Streaks by unit: how many people are on a streak of at least N, the top
  -- current streaks and the longest streak ever.
  with s as (
    select * from mysession_private.attendance_streaks(p_today, null)
  ),
  thresholds(unit, min_len) as (
    values ('day', 2), ('day', 3), ('day', 5), ('day', 7), ('day', 14), ('day', 30),
           ('week', 2), ('week', 3), ('week', 4), ('week', 8), ('week', 12), ('week', 26), ('week', 52),
           ('month', 2), ('month', 3), ('month', 6), ('month', 12),
           ('year', 2), ('year', 3), ('year', 5)
  ),
  buckets as (
    select t.unit,
           jsonb_agg(jsonb_build_object('min', t.min_len,
             'users', (select count(*) from s where s.unit = t.unit and s.current_streak >= t.min_len)) order by t.min_len) as b
    from thresholds t group by t.unit
  ),
  ranked as (
    select s.*,
           row_number() over (partition by s.unit order by s.current_streak desc, s.longest_streak desc, s.user_id) as rk_current,
           row_number() over (partition by s.unit order by s.longest_streak desc, s.current_streak desc, s.user_id) as rk_longest
    from s
  ),
  per_unit as (
    select u.unit,
           jsonb_build_object(
             'buckets', coalesce((select b.b from buckets b where b.unit = u.unit), '[]'),
             'on_streak', (select count(*) from s where s.unit = u.unit and s.current_streak >= 2),
             'top', coalesce((
               select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
                                                   'current', r.current_streak, 'longest', r.longest_streak) order by r.rk_current)
               from ranked r left join public.profiles p on p.id = r.user_id
               where r.unit = u.unit and r.rk_current <= 10 and r.current_streak >= 2
             ), '[]'),
             'record', (
               select jsonb_build_object('user_id', r.user_id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
                                         'longest', r.longest_streak, 'current', r.current_streak)
               from ranked r left join public.profiles p on p.id = r.user_id
               where r.unit = u.unit and r.rk_longest = 1
             )
           ) as data
    from (values ('day'), ('week'), ('month'), ('year')) u(unit)
  )
  select jsonb_object_agg(per_unit.unit, per_unit.data) into v_streaks from per_unit;

  return jsonb_build_object(
    'as_of', p_today,
    'calendar', 'UTC',
    'week_start', v_week,
    'month_start', v_month,
    'returning', v_returning,
    'streaks', v_streaks
  );
end;
$$;

revoke all on all functions in schema mysession_private from public, anon, authenticated;

create or replace function public.admin_retention_streaks(p_as_of date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or not coalesce(public.is_app_admin(), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return mysession_private.retention_streaks(coalesce(p_as_of, (statement_timestamp() at time zone 'UTC')::date));
end;
$function$;

revoke all on function public.admin_retention_streaks(date) from public, anon;
grant execute on function public.admin_retention_streaks(date) to authenticated, service_role;

comment on function public.admin_retention_streaks(date) is
  'Admin-only: people returning on 2+ days per week/month and day/week/month/year attendance streaks (UTC).';
