-- Fix admin attendance records so historical/day counters use durable attendance
-- history instead of the mutable live session_attendance rows.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.admin_daily_attendance_history(
  p_start_date date,
  p_end_date date
)
returns table(
  attendance_date date,
  unique_attendees bigint,
  attendance_records bigint,
  attended_sessions bigint,
  attendee_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or not public.is_app_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_start_date is null
     or p_end_date is null
     or p_end_date <= p_start_date
     or p_end_date > p_start_date + interval '36 months' then
    raise exception 'Invalid daily attendance range' using errcode = '22023';
  end if;

  return query
  with people as (
    select
      d.attendance_date as report_date,
      count(*)::bigint as attendees,
      array_agg(d.user_id order by d.user_id) as ids
    from public.attendance_daily_users d
    where d.attendance_date >= p_start_date
      and d.attendance_date < p_end_date
    group by d.attendance_date
  ),
  visits as (
    select
      (h.joined_at at time zone 'UTC')::date as report_date,
      count(*)::bigint as records,
      count(distinct h.session_id)::bigint as sessions
    from public.attendance_visit_history h
    where h.joined_at >= (p_start_date::timestamp at time zone 'UTC')
      and h.joined_at < (p_end_date::timestamp at time zone 'UTC')
    group by 1
  ),
  dates as (
    select report_date from people
    union
    select report_date from visits
  )
  select
    dates.report_date,
    coalesce(people.attendees, 0::bigint),
    coalesce(visits.records, 0::bigint),
    coalesce(visits.sessions, 0::bigint),
    coalesce(people.ids, array[]::uuid[])
  from dates
  left join people on people.report_date = dates.report_date
  left join visits on visits.report_date = dates.report_date
  order by dates.report_date;
end;
$function$;

revoke all on function public.admin_daily_attendance_history(date, date)
  from public, anon;
grant execute on function public.admin_daily_attendance_history(date, date)
  to authenticated, service_role;

-- The monthly unique-attendance source was already durable, but its visit count
-- still read mutable session_attendance rows. Use the durable visit history so
-- repeated visits/rejoins can increase the monthly attendance-record counter.
create or replace function public.admin_monthly_attendance(
  p_start_month date,
  p_end_month date
)
returns table(
  month_start date,
  unique_attendees bigint,
  attendance_records bigint,
  attended_sessions bigint,
  attendee_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or not public.is_app_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_start_month is null or p_end_month is null
     or p_start_month <> date_trunc('month', p_start_month::timestamp)::date
     or p_end_month <> date_trunc('month', p_end_month::timestamp)::date
     or p_end_month <= p_start_month
     or p_end_month > p_start_month + interval '36 months' then
    raise exception 'Invalid monthly attendance range' using errcode = '22023';
  end if;

  return query
  with visit_counts as (
    select
      date_trunc('month', h.joined_at at time zone 'UTC')::date as visit_month,
      count(*)::bigint as records,
      count(distinct h.session_id)::bigint as sessions
    from public.attendance_visit_history h
    where h.joined_at >= (p_start_month::timestamp at time zone 'UTC')
      and h.joined_at < (p_end_month::timestamp at time zone 'UTC')
    group by 1
  ),
  people as (
    select
      m.month_start as report_month,
      count(*)::bigint as attendees,
      array_agg(m.user_id order by m.user_id) as ids
    from public.monthly_attendance_users m
    where m.month_start >= p_start_month
      and m.month_start < p_end_month
    group by m.month_start
  )
  select
    p.report_month,
    p.attendees,
    coalesce(v.records, 0::bigint),
    coalesce(v.sessions, 0::bigint),
    p.ids
  from people p
  left join visit_counts v on v.visit_month = p.report_month
  order by p.report_month;
end;
$function$;

comment on function public.admin_daily_attendance_history(date, date) is
  'Admin-only durable daily attendance aggregates for record counters and drilldowns.';
