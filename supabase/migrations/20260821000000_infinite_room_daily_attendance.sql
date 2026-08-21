-- Count one attendance unit per user, infinite room and local calendar day.
-- Live presence remains in session_attendance; this ledger is written once on
-- room entry and is never touched by the attendance heartbeat.

create table if not exists public.infinite_room_daily_attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  attendance_date date not null,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  constraint infinite_room_daily_attendance_unique
    unique (session_id, user_id, attendance_date)
);

create index if not exists infinite_room_daily_attendance_user_date_idx
  on public.infinite_room_daily_attendance (user_id, attendance_date desc);

alter table public.infinite_room_daily_attendance enable row level security;

drop policy if exists "Users can read their own infinite attendance"
  on public.infinite_room_daily_attendance;
create policy "Users can read their own infinite attendance"
  on public.infinite_room_daily_attendance
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.infinite_room_daily_attendance from public, anon;
grant select on table public.infinite_room_daily_attendance to authenticated;
grant all on table public.infinite_room_daily_attendance to service_role;

create or replace function public.record_infinite_room_daily_attendance(
  p_session_id uuid,
  p_timezone text default 'UTC'
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_timezone text;
  v_attendance_date date;
  v_inserted integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.sessions s
    where s.id = p_session_id
      and (
        lower(coalesce(s.session_format_type, '')) = 'infinite'
        or lower(coalesce(s.format, '')) = 'infinite'
        or coalesce(s.schedule ->> 'kind', '') = 'infinite_room'
        or jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array'
        or jsonb_typeof(s.schedule -> 'phases') = 'array'
      )
  ) then
    raise exception 'Infinite room not found' using errcode = 'P0002';
  end if;

  select name
  into v_timezone
  from pg_timezone_names
  where name = nullif(trim(p_timezone), '')
  limit 1;

  v_timezone := coalesce(v_timezone, 'UTC');
  v_attendance_date := (now() at time zone v_timezone)::date;

  insert into public.infinite_room_daily_attendance (
    session_id,
    user_id,
    attendance_date,
    timezone
  )
  values (p_session_id, v_user_id, v_attendance_date, v_timezone)
  on conflict (session_id, user_id, attendance_date) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

revoke all on function public.record_infinite_room_daily_attendance(uuid, text)
  from public, anon;
grant execute on function public.record_infinite_room_daily_attendance(uuid, text)
  to authenticated, service_role;

-- Preserve one historical attendance day for existing infinite-room users.
-- Older days cannot be reconstructed from the legacy one-row-per-room model.
insert into public.infinite_room_daily_attendance (
  session_id,
  user_id,
  attendance_date,
  timezone,
  created_at
)
select
  a.session_id,
  a.user_id,
  (a.joined_at at time zone 'UTC')::date,
  'UTC',
  a.joined_at
from public.session_attendance a
join public.sessions s on s.id = a.session_id
where a.joined_at is not null
  and (
    lower(coalesce(s.session_format_type, '')) = 'infinite'
    or lower(coalesce(s.format, '')) = 'infinite'
    or coalesce(s.schedule ->> 'kind', '') = 'infinite_room'
    or jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array'
    or jsonb_typeof(s.schedule -> 'phases') = 'array'
  )
on conflict (session_id, user_id, attendance_date) do nothing;

create or replace function public.calculate_lifetime_session_count(
  p_user_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = public, auth
as $$
  with regular_attendance as (
    select distinct a.session_id
    from public.session_attendance a
    join public.sessions s on s.id = a.session_id
    where a.user_id = p_user_id
      and not (
        lower(coalesce(s.session_format_type, '')) = 'infinite'
        or lower(coalesce(s.format, '')) = 'infinite'
        or coalesce(s.schedule ->> 'kind', '') = 'infinite_room'
        or jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array'
        or jsonb_typeof(s.schedule -> 'phases') = 'array'
      )
  )
  select
    (select count(*) from regular_attendance)
    +
    (select count(*)
     from public.infinite_room_daily_attendance d
     where d.user_id = p_user_id);
$$;

revoke all on function public.calculate_lifetime_session_count(uuid)
  from public, anon, authenticated;
grant execute on function public.calculate_lifetime_session_count(uuid)
  to service_role;

create or replace function public.get_lifetime_attendance_count()
returns bigint
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return public.calculate_lifetime_session_count(v_user_id);
end;
$$;

revoke all on function public.get_lifetime_attendance_count()
  from public, anon;
grant execute on function public.get_lifetime_attendance_count()
  to authenticated, service_role;
