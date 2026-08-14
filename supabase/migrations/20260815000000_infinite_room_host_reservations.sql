-- Scheduled participant/host reservations for always-open infinite rooms.

alter table public.session_bookings
  add column if not exists booking_role text not null default 'participant';

alter table public.session_bookings
  drop constraint if exists session_bookings_booking_role_check;

alter table public.session_bookings
  add constraint session_bookings_booking_role_check
  check (booking_role in ('participant', 'host'));

alter table public.session_bookings
  drop constraint if exists session_bookings_time_range_check;

alter table public.session_bookings
  add constraint session_bookings_time_range_check
  check (
    (booked_start_time is null and booked_end_time is null)
    or (
      booked_start_time is not null
      and booked_end_time is not null
      and booked_end_time > booked_start_time
    )
  );

create index if not exists session_bookings_upcoming_infinite_idx
  on public.session_bookings (booked_start_time, booked_end_time, booking_role, session_id)
  where booked_start_time is not null and booked_end_time is not null;

create or replace function public.validate_infinite_room_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_infinite boolean := false;
begin
  select (
    lower(coalesce(s.session_format_type, '')) = 'infinite'
    or lower(coalesce(s.format, '')) = 'infinite'
    or coalesce(s.schedule ->> 'kind', '') = 'infinite_room'
    or jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array'
    or jsonb_typeof(s.schedule -> 'phases') = 'array'
  ) into v_is_infinite
  from public.sessions s
  where s.id = new.session_id;

  if coalesce(v_is_infinite, false) then
    if new.booked_start_time is null or new.booked_end_time is null then
      raise exception 'infinite_room_booking_requires_time_range';
    end if;
    if new.booked_end_time <= now() then
      raise exception 'infinite_room_booking_must_be_future';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists validate_infinite_room_booking_trigger on public.session_bookings;
create trigger validate_infinite_room_booking_trigger
before insert or update of session_id, booked_start_time, booked_end_time, booking_role
on public.session_bookings
for each row execute function public.validate_infinite_room_booking();

create or replace function public.cleanup_expired_infinite_room_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.session_bookings b
  using public.sessions s
  where s.id = b.session_id
    and b.booked_end_time is not null
    and b.booked_end_time <= now()
    and (
      lower(coalesce(s.session_format_type, '')) = 'infinite'
      or lower(coalesce(s.format, '')) = 'infinite'
      or coalesce(s.schedule ->> 'kind', '') = 'infinite_room'
      or jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array'
      or jsonb_typeof(s.schedule -> 'phases') = 'array'
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;

revoke all on function public.cleanup_expired_infinite_room_bookings()
  from public, anon, authenticated;
grant execute on function public.cleanup_expired_infinite_room_bookings()
  to service_role;

drop function if exists public.get_public_session_bookings_with_times(uuid[]);

create function public.get_public_session_bookings_with_times(
  p_session_ids uuid[]
)
returns table (
  session_id uuid,
  user_id uuid,
  full_name text,
  avatar_url text,
  booked_start_time timestamptz,
  booked_end_time timestamptz,
  booking_role text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    b.session_id,
    b.user_id,
    p.full_name,
    p.avatar_url,
    b.booked_start_time,
    b.booked_end_time,
    coalesce(b.booking_role, 'participant'),
    b.created_at
  from public.session_bookings b
  join public.sessions s on s.id = b.session_id
  left join public.profiles p on p.id = b.user_id
  where b.session_id = any(coalesce(p_session_ids, '{}'::uuid[]))
    and (
      not (
        lower(coalesce(s.session_format_type, '')) = 'infinite'
        or lower(coalesce(s.format, '')) = 'infinite'
        or coalesce(s.schedule ->> 'kind', '') = 'infinite_room'
        or jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array'
        or jsonb_typeof(s.schedule -> 'phases') = 'array'
      )
      or (
        b.booked_start_time is not null
        and b.booked_end_time is not null
        and b.booked_end_time > now()
      )
    )
  order by b.booked_start_time asc nulls last, b.created_at asc;
$$;

revoke all on function public.get_public_session_bookings_with_times(uuid[])
  from public;
grant execute on function public.get_public_session_bookings_with_times(uuid[])
  to anon, authenticated, service_role;
