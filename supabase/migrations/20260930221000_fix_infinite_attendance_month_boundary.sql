-- Keep infinite-room attendance aligned to one reporting calendar (UTC).
-- Previously infinite_room_daily_attendance used each member's profile timezone,
-- so a member in India joining on Sep 30 UTC could be counted in October.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function mysession_private.capture_monthly_attendance_from_infinite_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_month_start date;
begin
  v_month_start := date_trunc(
    'month',
    coalesce(new.created_at, statement_timestamp()) at time zone 'UTC'
  )::date;

  insert into public.monthly_attendance_users (month_start, user_id)
  values (v_month_start, new.user_id)
  on conflict do nothing;

  return new;
end;
$function$;

-- Backfill the correct UTC month for every durable infinite-room day record.
-- We intentionally do not delete old month rows here because a user may also
-- have genuinely attended that month through another session.
insert into public.monthly_attendance_users (month_start, user_id)
select distinct
  date_trunc('month', d.created_at at time zone 'UTC')::date,
  d.user_id
from public.infinite_room_daily_attendance d
where d.created_at is not null
on conflict do nothing;

-- Rebuild the new day-level admin cache using actual UTC timestamps rather
-- than the member-local attendance_date stored by the legacy infinite table.
truncate table public.attendance_daily_users;

insert into public.attendance_daily_users (
  attendance_date,
  user_id,
  first_seen_at,
  last_seen_at
)
select
  (h.joined_at at time zone 'UTC')::date,
  h.user_id,
  min(h.joined_at),
  max(coalesce(h.last_seen_at, h.left_at, h.joined_at))
from public.attendance_visit_history h
where h.joined_at is not null
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
  (d.created_at at time zone 'UTC')::date,
  d.user_id,
  min(d.created_at),
  max(d.created_at)
from public.infinite_room_daily_attendance d
where d.created_at is not null
group by 1, 2
on conflict (attendance_date, user_id)
do update set
  first_seen_at = least(public.attendance_daily_users.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(public.attendance_daily_users.last_seen_at, excluded.last_seen_at),
  updated_at = now();
