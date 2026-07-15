-- Time-specific bookings for always-open infinite rooms.

alter table public.session_bookings
  add column if not exists booked_start_time timestamptz,
  add column if not exists booked_end_time timestamptz,
  add column if not exists booking_note text;

create index if not exists session_bookings_planned_start_idx
  on public.session_bookings (session_id, booked_start_time)
  where booked_start_time is not null;

create or replace function public.get_public_session_bookings_with_times(
  p_session_ids uuid[]
)
returns table (
  session_id uuid,
  user_id uuid,
  full_name text,
  avatar_url text,
  booked_start_time timestamptz,
  booked_end_time timestamptz,
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
    b.created_at
  from public.session_bookings b
  left join public.profiles p on p.id = b.user_id
  where b.session_id = any(coalesce(p_session_ids, '{}'::uuid[]))
  order by b.booked_start_time asc nulls last, b.created_at asc;
$$;

revoke all on function public.get_public_session_bookings_with_times(uuid[])
  from public;
grant execute on function public.get_public_session_bookings_with_times(uuid[])
  to anon, authenticated, service_role;
