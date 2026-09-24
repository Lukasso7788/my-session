-- The live session_attendance row is deliberately reused on every join, so
-- joined_at cannot be the source of historical monthly unique-user counts.
-- Keep a small, durable fact for each user/calendar month instead.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Trigger helpers are not exposed through the public Data API.
create schema if not exists mysession_private;
revoke all on schema mysession_private from public, anon, authenticated;

create table public.monthly_attendance_users (
  month_start date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (month_start, user_id),
  constraint monthly_attendance_users_month_start_check
    check (month_start = date_trunc('month', month_start::timestamp)::date)
);

-- The primary key supports month aggregates. This index keeps auth-user
-- deletion from scanning the whole ledger as history grows.
create index monthly_attendance_users_user_id_idx
  on public.monthly_attendance_users (user_id);

alter table public.monthly_attendance_users enable row level security;
revoke all on table public.monthly_attendance_users from public, anon, authenticated;
grant select on table public.monthly_attendance_users to service_role;

-- Scheduled rooms have one live attendance row per session/user. Capture only
-- a change of month; a heartbeat never updates joined_at and cannot write here.
create function mysession_private.capture_monthly_attendance_from_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month_start date;
begin
  if new.joined_at is null or public.is_infinite_attendance_session(new.session_id) then
    return new;
  end if;

  v_month_start := date_trunc('month', new.joined_at at time zone 'UTC')::date;
  if tg_op = 'UPDATE'
     and old.session_id = new.session_id
     and old.joined_at is not null
     and date_trunc('month', old.joined_at at time zone 'UTC')::date = v_month_start then
    return new;
  end if;

  insert into public.monthly_attendance_users (month_start, user_id)
  values (v_month_start, new.user_id)
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function mysession_private.capture_monthly_attendance_from_session()
  from public, anon, authenticated;

create trigger capture_monthly_attendance_from_session
  after insert or update of joined_at on public.session_attendance
  for each row execute function mysession_private.capture_monthly_attendance_from_session();

-- Infinite rooms already write a unique daily history row in the user's
-- saved timezone. Only a NEW day can create the corresponding monthly fact.
create function mysession_private.capture_monthly_attendance_from_infinite_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.monthly_attendance_users (month_start, user_id)
  values (date_trunc('month', new.attendance_date::timestamp)::date, new.user_id)
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function mysession_private.capture_monthly_attendance_from_infinite_day()
  from public, anon, authenticated;

create trigger capture_monthly_attendance_from_infinite_day
  after insert on public.infinite_room_daily_attendance
  for each row execute function mysession_private.capture_monthly_attendance_from_infinite_day();

-- Recover everything still knowable. The old one-row-per-room model cannot
-- reconstruct earlier visits after joined_at has already been overwritten.
insert into public.monthly_attendance_users (month_start, user_id)
select distinct date_trunc('month', a.joined_at at time zone 'UTC')::date, a.user_id
from public.session_attendance a
where a.joined_at is not null
on conflict do nothing;

insert into public.monthly_attendance_users (month_start, user_id)
select distinct date_trunc('month', d.attendance_date::timestamp)::date, d.user_id
from public.infinite_room_daily_attendance d
on conflict do nothing;

-- The admin dashboard needs aggregated historical counts and person IDs for
-- drilldown. Do not broaden table RLS or ship the raw daily ledger to clients.
create function public.admin_monthly_attendance(
  p_start_month date,
  p_end_month date
)
returns table (
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
as $$
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
  with visits as (
    select
      date_trunc('month', a.joined_at at time zone 'UTC')::date as visit_month,
      a.session_id
    from public.session_attendance a
    join public.sessions s on s.id = a.session_id
    where a.joined_at >= (p_start_month::timestamp at time zone 'UTC')
      and a.joined_at < (p_end_month::timestamp at time zone 'UTC')
      and not (
        lower(coalesce(s.session_format_type, '')) = 'infinite'
        or lower(coalesce(s.format, '')) in ('infinite', 'infinite_room')
        or lower(coalesce(s.schedule ->> 'kind', '')) like '%infinite%'
        or coalesce(jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array', false)
        or coalesce(jsonb_typeof(s.schedule -> 'timer' -> 'segments') = 'array', false)
        or coalesce(jsonb_typeof(s.schedule -> 'phases') = 'array', false)
        or coalesce(jsonb_typeof(s.schedule -> 'segments') = 'array', false)
      )
    union all
    select
      date_trunc('month', d.attendance_date::timestamp)::date,
      d.session_id
    from public.infinite_room_daily_attendance d
    where d.attendance_date >= p_start_month
      and d.attendance_date < p_end_month
  ),
  visit_counts as (
    select v.visit_month, count(*)::bigint as records,
           count(distinct v.session_id)::bigint as sessions
    from visits v
    group by v.visit_month
  ),
  people as (
    select m.month_start as report_month, count(*)::bigint as attendees,
           array_agg(m.user_id order by m.user_id) as ids
    from public.monthly_attendance_users m
    where m.month_start >= p_start_month and m.month_start < p_end_month
    group by m.month_start
  )
  select p.report_month, p.attendees,
         coalesce(v.records, 0::bigint),
         coalesce(v.sessions, 0::bigint),
         p.ids
  from people p
  left join visit_counts v on v.visit_month = p.report_month
  order by p.report_month;
end;
$$;

revoke all on function public.admin_monthly_attendance(date, date)
  from public, anon;
grant execute on function public.admin_monthly_attendance(date, date)
  to authenticated, service_role;
