-- Durable attendance history + admin usage/geography analytics.
-- Fixes day-level attendance moving when session_attendance rows are reused.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create schema if not exists mysession_private;
revoke all on schema mysession_private from public, anon, authenticated;

alter table public.profiles
  add column if not exists country_code text,
  add column if not exists country_detected_at timestamptz,
  add column if not exists location_source text;

alter table public.profiles
  drop constraint if exists profiles_country_code_check;

alter table public.profiles
  add constraint profiles_country_code_check
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

create table if not exists public.attendance_visit_history (
  id bigint generated always as identity primary key,
  source_attendance_id uuid not null,
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null,
  left_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_visit_history_source_joined_key
    unique (source_attendance_id, joined_at)
);

create index if not exists attendance_visit_history_joined_at_idx
  on public.attendance_visit_history (joined_at);

create index if not exists attendance_visit_history_user_joined_idx
  on public.attendance_visit_history (user_id, joined_at desc);

create index if not exists attendance_visit_history_session_joined_idx
  on public.attendance_visit_history (session_id, joined_at desc);

alter table public.attendance_visit_history enable row level security;
revoke all on table public.attendance_visit_history from public, anon, authenticated;
grant select, insert, update, delete on table public.attendance_visit_history to service_role;
grant usage, select on sequence public.attendance_visit_history_id_seq to service_role;

create table if not exists public.attendance_daily_users (
  attendance_date date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (attendance_date, user_id)
);

create index if not exists attendance_daily_users_user_date_idx
  on public.attendance_daily_users (user_id, attendance_date desc);

alter table public.attendance_daily_users enable row level security;
revoke all on table public.attendance_daily_users from public, anon, authenticated;
grant select, insert, update, delete on table public.attendance_daily_users to service_role;

create or replace function mysession_private.upsert_daily_attendance(
  p_user_id uuid,
  p_seen_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen_at timestamptz := coalesce(p_seen_at, statement_timestamp());
  v_day date := (coalesce(p_seen_at, statement_timestamp()) at time zone 'UTC')::date;
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.attendance_daily_users (
    attendance_date,
    user_id,
    first_seen_at,
    last_seen_at
  )
  values (
    v_day,
    p_user_id,
    v_seen_at,
    v_seen_at
  )
  on conflict (attendance_date, user_id)
  do update set
    first_seen_at = least(public.attendance_daily_users.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(public.attendance_daily_users.last_seen_at, excluded.last_seen_at),
    updated_at = now();
end;
$$;

revoke all on function mysession_private.upsert_daily_attendance(uuid, timestamptz)
  from public, anon, authenticated;

create or replace function mysession_private.capture_attendance_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_end timestamptz;
  v_new_end timestamptz;
begin
  if tg_op = 'INSERT' then
    insert into public.attendance_visit_history (
      source_attendance_id,
      session_id,
      user_id,
      joined_at,
      left_at,
      last_seen_at
    )
    values (
      new.id,
      new.session_id,
      new.user_id,
      new.joined_at,
      new.left_at,
      new.last_seen_at
    )
    on conflict (source_attendance_id, joined_at)
    do update set
      session_id = excluded.session_id,
      user_id = excluded.user_id,
      left_at = coalesce(excluded.left_at, public.attendance_visit_history.left_at),
      last_seen_at = greatest(
        coalesce(public.attendance_visit_history.last_seen_at, public.attendance_visit_history.joined_at),
        coalesce(excluded.last_seen_at, excluded.joined_at)
      ),
      updated_at = now();

    perform mysession_private.upsert_daily_attendance(new.user_id, new.joined_at);
    perform mysession_private.upsert_daily_attendance(
      new.user_id,
      coalesce(new.last_seen_at, new.left_at, new.joined_at)
    );
    return new;
  end if;

  if old.joined_at is distinct from new.joined_at then
    v_old_end := coalesce(old.left_at, old.last_seen_at, old.joined_at);

    insert into public.attendance_visit_history (
      source_attendance_id,
      session_id,
      user_id,
      joined_at,
      left_at,
      last_seen_at
    )
    values (
      old.id,
      old.session_id,
      old.user_id,
      old.joined_at,
      old.left_at,
      old.last_seen_at
    )
    on conflict (source_attendance_id, joined_at)
    do update set
      session_id = excluded.session_id,
      user_id = excluded.user_id,
      left_at = coalesce(excluded.left_at, public.attendance_visit_history.left_at),
      last_seen_at = greatest(
        coalesce(public.attendance_visit_history.last_seen_at, public.attendance_visit_history.joined_at),
        coalesce(excluded.last_seen_at, excluded.joined_at)
      ),
      updated_at = now();

    perform mysession_private.upsert_daily_attendance(old.user_id, old.joined_at);
    perform mysession_private.upsert_daily_attendance(old.user_id, v_old_end);
  end if;

  insert into public.attendance_visit_history (
    source_attendance_id,
    session_id,
    user_id,
    joined_at,
    left_at,
    last_seen_at
  )
  values (
    new.id,
    new.session_id,
    new.user_id,
    new.joined_at,
    new.left_at,
    new.last_seen_at
  )
  on conflict (source_attendance_id, joined_at)
  do update set
    session_id = excluded.session_id,
    user_id = excluded.user_id,
    left_at = excluded.left_at,
    last_seen_at = greatest(
      coalesce(public.attendance_visit_history.last_seen_at, public.attendance_visit_history.joined_at),
      coalesce(excluded.last_seen_at, excluded.left_at, excluded.joined_at)
    ),
    updated_at = now();

  v_new_end := coalesce(new.last_seen_at, new.left_at, new.joined_at);
  perform mysession_private.upsert_daily_attendance(new.user_id, new.joined_at);
  perform mysession_private.upsert_daily_attendance(new.user_id, v_new_end);

  return new;
end;
$$;

revoke all on function mysession_private.capture_attendance_history()
  from public, anon, authenticated;

drop trigger if exists capture_attendance_history on public.session_attendance;
create trigger capture_attendance_history
after insert or update of joined_at, left_at, last_seen_at
on public.session_attendance
for each row
execute function mysession_private.capture_attendance_history();

-- Seed durable history with the current known visit for each live attendance row.
insert into public.attendance_visit_history (
  source_attendance_id,
  session_id,
  user_id,
  joined_at,
  left_at,
  last_seen_at,
  created_at,
  updated_at
)
select
  a.id,
  a.session_id,
  a.user_id,
  a.joined_at,
  a.left_at,
  a.last_seen_at,
  coalesce(a.joined_at, now()),
  now()
from public.session_attendance a
where a.joined_at is not null
on conflict (source_attendance_id, joined_at)
do update set
  left_at = excluded.left_at,
  last_seen_at = excluded.last_seen_at,
  updated_at = now();

-- Seed day-level history from what is still knowable.
insert into public.attendance_daily_users (
  attendance_date,
  user_id,
  first_seen_at,
  last_seen_at
)
select
  (a.joined_at at time zone 'UTC')::date,
  a.user_id,
  min(a.joined_at),
  max(coalesce(a.last_seen_at, a.left_at, a.joined_at))
from public.session_attendance a
where a.joined_at is not null
group by 1, 2
on conflict (attendance_date, user_id)
do update set
  first_seen_at = least(public.attendance_daily_users.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(public.attendance_daily_users.last_seen_at, excluded.last_seen_at),
  updated_at = now();

insert into public.attendance_daily_users (
  attendance_date,
  user_id,
  first_seen_at,
  last_seen_at
)
select
  d.attendance_date,
  d.user_id,
  min(d.created_at),
  max(d.created_at)
from public.infinite_room_daily_attendance d
group by d.attendance_date, d.user_id
on conflict (attendance_date, user_id)
do update set
  first_seen_at = least(public.attendance_daily_users.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(public.attendance_daily_users.last_seen_at, excluded.last_seen_at),
  updated_at = now();

create or replace function public.admin_usage_analytics(
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(7, least(coalesce(p_days, 30), 90));
  v_now timestamptz := statement_timestamp();
  v_today date := (statement_timestamp() at time zone 'UTC')::date;
  v_start_date date;
  v_start timestamptz;
  v_result jsonb;
begin
  if (select auth.uid()) is null or not public.is_app_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  v_start_date := v_today - (v_days - 1);
  v_start := v_start_date::timestamp at time zone 'UTC';

  with
  visit_bounds as (
    select
      h.id,
      h.session_id,
      h.user_id,
      h.joined_at,
      least(
        v_now,
        greatest(
          h.joined_at,
          coalesce(h.left_at, h.last_seen_at, h.joined_at)
        )
      ) as ended_at
    from public.attendance_visit_history h
    where h.joined_at < v_now
      and coalesce(h.left_at, h.last_seen_at, h.joined_at) >= v_start
  ),
  day_slots as (
    select generate_series(v_start_date, v_today, interval '1 day')::date as day
  ),
  daily as (
    select
      d.day,
      coalesce((
        select count(distinct adu.user_id)
        from public.attendance_daily_users adu
        where adu.attendance_date = d.day
      ), 0)::bigint as unique_attendees,
      coalesce((
        select count(*)
        from public.attendance_visit_history h
        where (h.joined_at at time zone 'UTC')::date = d.day
      ), 0)::bigint as visits,
      coalesce((
        select count(distinct vb.session_id)
        from visit_bounds vb
        where vb.joined_at < ((d.day + 1)::timestamp at time zone 'UTC')
          and vb.ended_at >= (d.day::timestamp at time zone 'UTC')
      ), 0)::bigint as attended_sessions,
      coalesce((
        select round((
          sum(
            greatest(
              0,
              extract(epoch from (
                least(vb.ended_at, ((d.day + 1)::timestamp at time zone 'UTC'))
                - greatest(vb.joined_at, (d.day::timestamp at time zone 'UTC'))
              ))
            )
          ) / 3600.0
        )::numeric, 2)
        from visit_bounds vb
        where vb.joined_at < ((d.day + 1)::timestamp at time zone 'UTC')
          and vb.ended_at > (d.day::timestamp at time zone 'UTC')
      ), 0)::numeric as member_hours
    from day_slots d
  ),
  hour_slots as (
    select generate_series(
      date_trunc('hour', v_start),
      date_trunc('hour', v_now),
      interval '1 hour'
    ) as hour_start
  ),
  hour_bucket as (
    select
      hs.hour_start,
      coalesce(round((
        sum(
          greatest(
            0,
            extract(epoch from (
              least(vb.ended_at, hs.hour_start + interval '1 hour')
              - greatest(vb.joined_at, hs.hour_start)
            ))
          )
        ) / 3600.0
      )::numeric, 3), 0)::numeric as attendee_hours,
      count(distinct vb.user_id) filter (
        where vb.joined_at < hs.hour_start + interval '1 hour'
          and vb.ended_at > hs.hour_start
      )::bigint as unique_attendees,
      count(distinct vb.session_id) filter (
        where vb.joined_at < hs.hour_start + interval '1 hour'
          and vb.ended_at > hs.hour_start
      )::bigint as active_sessions
    from hour_slots hs
    left join visit_bounds vb
      on vb.joined_at < hs.hour_start + interval '1 hour'
     and vb.ended_at > hs.hour_start
    group by hs.hour_start
  ),
  hourly as (
    select
      extract(hour from hour_start at time zone 'UTC')::int as hour_of_day,
      round((sum(attendee_hours) / v_days)::numeric, 2) as avg_people,
      round(max(attendee_hours)::numeric, 2) as peak_people,
      count(*) filter (where attendee_hours > 0)::int as active_windows,
      count(*) filter (where attendee_hours = 0)::int as empty_windows,
      round(avg(active_sessions)::numeric, 2) as avg_active_sessions
    from hour_bucket
    group by 1
    order by 1
  ),
  countries as (
    select
      p.country_code,
      count(*)::bigint as users
    from public.profiles p
    where p.country_code is not null
    group by p.country_code
    order by users desc, p.country_code
  ),
  timezone_regions as (
    select
      case
        when p.timezone is null or btrim(p.timezone) = '' or p.timezone = 'UTC' then 'Unknown'
        when position('/' in p.timezone) > 0 then split_part(p.timezone, '/', 1)
        else p.timezone
      end as region,
      count(*)::bigint as users
    from public.profiles p
    where p.country_code is null
    group by 1
    order by users desc, region
  ),
  summary as (
    select
      (select count(distinct user_id) from public.attendance_daily_users where attendance_date = v_today)::bigint as unique_attendees_today,
      (select count(distinct user_id) from public.attendance_daily_users where attendance_date >= v_today - 6)::bigint as unique_attendees_7d,
      (select count(distinct user_id) from public.attendance_daily_users where attendance_date >= v_today - 29)::bigint as unique_attendees_30d,
      (select count(*) from public.attendance_visit_history where joined_at >= (v_today::timestamp at time zone 'UTC'))::bigint as visits_today,
      (select count(*) from public.attendance_visit_history where joined_at >= ((v_today - 6)::timestamp at time zone 'UTC'))::bigint as visits_7d,
      (select count(*) from public.attendance_visit_history where joined_at >= ((v_today - 29)::timestamp at time zone 'UTC'))::bigint as visits_30d,
      (select count(distinct session_id) from public.attendance_visit_history where joined_at >= (v_today::timestamp at time zone 'UTC'))::bigint as attended_sessions_today,
      (select count(distinct session_id) from public.attendance_visit_history where joined_at >= ((v_today - 6)::timestamp at time zone 'UTC'))::bigint as attended_sessions_7d,
      (select count(distinct session_id) from public.attendance_visit_history where joined_at >= ((v_today - 29)::timestamp at time zone 'UTC'))::bigint as attended_sessions_30d,
      coalesce((
        select round((
          sum(
            greatest(
              0,
              extract(epoch from (
                least(vb.ended_at, v_now)
                - greatest(vb.joined_at, v_now - interval '7 days')
              ))
            )
          ) / 3600.0
        )::numeric, 2)
        from visit_bounds vb
        where vb.joined_at < v_now
          and vb.ended_at > v_now - interval '7 days'
      ), 0)::numeric as member_hours_7d,
      coalesce((
        select round((
          sum(
            greatest(
              0,
              extract(epoch from (
                least(vb.ended_at, v_now)
                - greatest(vb.joined_at, v_now - interval '7 days')
              ))
            )
          ) / 3600.0
        )::numeric, 2)
        from visit_bounds vb
        join public.sessions s on s.id = vb.session_id
        where s.host_id = vb.user_id
          and vb.joined_at < v_now
          and vb.ended_at > v_now - interval '7 days'
      ), 0)::numeric as host_presence_hours_7d,
      coalesce((
        select round((sum(coalesce(s.duration_minutes, 0)) / 60.0)::numeric, 2)
        from public.sessions s
        where s.start_time >= v_now - interval '7 days'
          and s.start_time <= v_now
          and coalesce(s.is_infinite, false) = false
      ), 0)::numeric as scheduled_hours_7d,
      (select min(joined_at) from public.attendance_visit_history) as tracked_from,
      (select count(*) from public.profiles)::bigint as total_profiles,
      (select count(*) from public.profiles where country_code is not null)::bigint as profiles_with_country
  )
  select jsonb_build_object(
    'summary', (
      select to_jsonb(s) from summary s
    ),
    'daily', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', daily.day,
          'uniqueAttendees', daily.unique_attendees,
          'visits', daily.visits,
          'attendedSessions', daily.attended_sessions,
          'memberHours', daily.member_hours,
          'attendeeIds', coalesce((
            select jsonb_agg(adu.user_id order by adu.user_id)
            from public.attendance_daily_users adu
            where adu.attendance_date = daily.day
          ), '[]'::jsonb)
        )
        order by daily.day
      )
      from daily
    ), '[]'::jsonb),
    'hourly', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'hour', hourly.hour_of_day,
          'avgPeople', hourly.avg_people,
          'peakPeople', hourly.peak_people,
          'activeWindows', hourly.active_windows,
          'emptyWindows', hourly.empty_windows,
          'avgActiveSessions', hourly.avg_active_sessions
        )
        order by hourly.hour_of_day
      )
      from hourly
    ), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'countryCode', countries.country_code,
          'users', countries.users
        )
        order by countries.users desc, countries.country_code
      )
      from countries
    ), '[]'::jsonb),
    'timezoneRegions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'region', timezone_regions.region,
          'users', timezone_regions.users
        )
        order by timezone_regions.users desc, timezone_regions.region
      )
      from timezone_regions
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_usage_analytics(integer)
  from public, anon;
grant execute on function public.admin_usage_analytics(integer)
  to authenticated, service_role;
