-- Repair environments where infinite booking fields were not applied.

alter table public.session_bookings
  add column if not exists booked_start_time timestamptz,
  add column if not exists booked_end_time timestamptz,
  add column if not exists booking_note text,
  add column if not exists booking_role text;

update public.session_bookings
set booking_role = 'participant'
where booking_role is null
   or booking_role not in ('participant', 'host');

alter table public.session_bookings
  alter column booking_role set default 'participant',
  alter column booking_role set not null;

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

drop trigger if exists validate_infinite_room_booking_trigger
  on public.session_bookings;
create trigger validate_infinite_room_booking_trigger
before insert or update of session_id, booked_start_time, booked_end_time, booking_role
on public.session_bookings
for each row execute function public.validate_infinite_room_booking();

notify pgrst, 'reload schema';
