-- Persist participant and host reservations for scheduled and infinite sessions.
-- This migration is intentionally self-contained so it repairs projects where
-- one of the earlier incremental booking migrations was not applied.

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

create index if not exists session_bookings_user_session_idx
  on public.session_bookings (user_id, session_id, created_at desc);

create index if not exists session_bookings_upcoming_role_idx
  on public.session_bookings (session_id, booked_start_time, booked_end_time, booking_role)
  where booked_start_time is not null and booked_end_time is not null;

alter table public.session_bookings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'session_bookings'
      and policyname = 'Users can read their own session bookings'
  ) then
    create policy "Users can read their own session bookings"
      on public.session_bookings for select
      to authenticated
      using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'session_bookings'
      and policyname = 'Users can create their own session bookings'
  ) then
    create policy "Users can create their own session bookings"
      on public.session_bookings for insert
      to authenticated
      with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'session_bookings'
      and policyname = 'Users can update their own session bookings'
  ) then
    create policy "Users can update their own session bookings"
      on public.session_bookings for update
      to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'session_bookings'
      and policyname = 'Users can delete their own session bookings'
  ) then
    create policy "Users can delete their own session bookings"
      on public.session_bookings for delete
      to authenticated
      using (user_id = auth.uid());
  end if;
end
$$;

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
  v_booking public.session_bookings%rowtype;
  v_existing_id public.session_bookings.id%type;
  v_is_infinite boolean := false;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_booking_role not in ('participant', 'host') then
    raise exception 'invalid_booking_role' using errcode = '22023';
  end if;

  if (p_booked_start_time is null) <> (p_booked_end_time is null) then
    raise exception 'booking_time_range_incomplete' using errcode = '22023';
  end if;

  if p_booked_start_time is not null and p_booked_end_time <= p_booked_start_time then
    raise exception 'booking_end_must_follow_start' using errcode = '22023';
  end if;

  select (
    lower(coalesce(s.session_format_type, '')) = 'infinite'
    or lower(coalesce(s.format, '')) = 'infinite'
    or coalesce(s.schedule ->> 'kind', '') = 'infinite_room'
    or jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array'
    or jsonb_typeof(s.schedule -> 'phases') = 'array'
  )
  into v_is_infinite
  from public.sessions s
  where s.id = p_session_id;

  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  if coalesce(v_is_infinite, false)
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

notify pgrst, 'reload schema';