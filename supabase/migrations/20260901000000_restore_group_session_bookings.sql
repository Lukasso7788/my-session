-- Restore ordinary group-session bookings and guarantee host reservations.
--
-- Timeline phases are shared by scheduled and infinite sessions. They must
-- never be used by themselves to classify a session as infinite.

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

create or replace function public.is_infinite_session(p_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select
      lower(coalesce(s.session_format_type, '')) = 'infinite'
      or lower(coalesce(s.format, '')) = 'infinite'
      or lower(coalesce(s.schedule ->> 'kind', '')) = 'infinite_room'
    from public.sessions s
    where s.id = p_session_id
  ), false);
$$;

revoke all on function public.is_infinite_session(uuid)
  from public, anon, authenticated;

create or replace function public.validate_infinite_room_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_infinite_session(new.session_id) then
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

create or replace function public.save_session_booking(
  p_session_id uuid,
  p_booked_start_time timestamptz default null,
  p_booked_end_time timestamptz default null,
  p_booking_note text default null,
  p_booking_role text default 'participant'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_host_id uuid;
  v_is_infinite boolean := false;
  v_booking public.session_bookings%rowtype;
  v_existing_id public.session_bookings.id%type;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select s.host_id, public.is_infinite_session(s.id)
  into v_session_host_id, v_is_infinite
  from public.sessions s
  where s.id = p_session_id;

  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  if p_booking_role not in ('participant', 'host') then
    raise exception 'invalid_booking_role' using errcode = '22023';
  end if;

  if p_booking_role = 'host'
     and not v_is_infinite
     and v_session_host_id is distinct from v_user_id then
    raise exception 'only_session_owner_can_book_as_host' using errcode = '42501';
  end if;

  if (p_booked_start_time is null) <> (p_booked_end_time is null) then
    raise exception 'booking_time_range_incomplete' using errcode = '22023';
  end if;

  if p_booked_start_time is not null and p_booked_end_time <= p_booked_start_time then
    raise exception 'booking_end_must_follow_start' using errcode = '22023';
  end if;

  if v_is_infinite
     and (p_booked_start_time is null or p_booked_end_time is null) then
    raise exception 'infinite_room_booking_requires_time_range' using errcode = '22023';
  end if;

  if p_booked_end_time is not null and p_booked_end_time <= now() then
    raise exception 'booking_must_end_in_future' using errcode = '22023';
  end if;

  select b.id
  into v_existing_id
  from public.session_bookings b
  where b.session_id = p_session_id
    and b.user_id = v_user_id
  order by b.created_at desc nulls last, b.id desc
  limit 1
  for update;

  if v_existing_id is null then
    insert into public.session_bookings (
      session_id,
      user_id,
      booked_start_time,
      booked_end_time,
      booking_note,
      booking_role
    ) values (
      p_session_id,
      v_user_id,
      p_booked_start_time,
      p_booked_end_time,
      nullif(trim(coalesce(p_booking_note, '')), ''),
      p_booking_role
    )
    returning * into v_booking;
  else
    update public.session_bookings b
    set booked_start_time = p_booked_start_time,
        booked_end_time = p_booked_end_time,
        booking_note = nullif(trim(coalesce(p_booking_note, '')), ''),
        booking_role = p_booking_role
    where b.id = v_existing_id
      and b.user_id = v_user_id
    returning b.* into v_booking;
  end if;

  return to_jsonb(v_booking);
end
$$;

revoke all on function public.save_session_booking(uuid, timestamptz, timestamptz, text, text)
  from public, anon;
grant execute on function public.save_session_booking(uuid, timestamptz, timestamptz, text, text)
  to authenticated, service_role;

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
  left join public.profiles p on p.id = b.user_id
  where b.session_id = any(coalesce(p_session_ids, '{}'::uuid[]))
    and (
      not public.is_infinite_session(b.session_id)
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

create or replace function public.ensure_scheduled_session_host_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.host_id is null or public.is_infinite_session(new.id) then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.host_id is distinct from new.host_id
     and old.host_id is not null then
    update public.session_bookings b
    set booking_role = 'participant'
    where b.session_id = new.id
      and b.user_id = old.host_id
      and coalesce(b.booking_role, 'participant') = 'host';
  end if;

  update public.session_bookings b
  set booking_role = 'host',
      booked_start_time = null,
      booked_end_time = null
  where b.session_id = new.id
    and b.user_id = new.host_id;

  if not found then
    insert into public.session_bookings (
      session_id,
      user_id,
      booked_start_time,
      booked_end_time,
      booking_role
    ) values (
      new.id,
      new.host_id,
      null,
      null,
      'host'
    );
  end if;

  return new;
end
$$;

revoke all on function public.ensure_scheduled_session_host_booking()
  from public, anon, authenticated;

drop trigger if exists ensure_scheduled_session_host_booking_trigger
  on public.sessions;
create trigger ensure_scheduled_session_host_booking_trigger
after insert or update of host_id, session_format_type, format, schedule
on public.sessions
for each row execute function public.ensure_scheduled_session_host_booking();

-- Repair existing scheduled sessions. Existing participant bookings belonging
-- to the owner become host bookings; missing owner bookings are inserted.
update public.session_bookings b
set booking_role = 'host',
    booked_start_time = null,
    booked_end_time = null
from public.sessions s
where s.id = b.session_id
  and s.host_id = b.user_id
  and s.host_id is not null
  and not public.is_infinite_session(s.id);

insert into public.session_bookings (
  session_id,
  user_id,
  booked_start_time,
  booked_end_time,
  booking_role
)
select
  s.id,
  s.host_id,
  null,
  null,
  'host'
from public.sessions s
where s.host_id is not null
  and not public.is_infinite_session(s.id)
  and not exists (
    select 1
    from public.session_bookings b
    where b.session_id = s.id
      and b.user_id = s.host_id
  );

notify pgrst, 'reload schema';
