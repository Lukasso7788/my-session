-- Let a host book the same window on several days in an infinite room
-- ("host every day this week").
--
-- session_bookings keeps one row per person per room: several clients upsert
-- on (session_id, user_id), so that rule stays. The first day is still saved
-- there through save_session_booking; the extra days live in this table.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.infinite_room_host_slots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint infinite_room_host_slots_range check (ends_at > starts_at),
  constraint infinite_room_host_slots_unique unique (session_id, user_id, starts_at)
);

create index if not exists infinite_room_host_slots_session_idx
  on public.infinite_room_host_slots (session_id, ends_at);

alter table public.infinite_room_host_slots enable row level security;

-- Readable like the room's bookings; writes go through the function below,
-- and people can remove their own slots.
drop policy if exists "Host slots are readable" on public.infinite_room_host_slots;
create policy "Host slots are readable"
  on public.infinite_room_host_slots for select
  to anon, authenticated
  using (true);

drop policy if exists "Hosts remove their own slots" on public.infinite_room_host_slots;
create policy "Hosts remove their own slots"
  on public.infinite_room_host_slots for delete
  to authenticated
  using (user_id = auth.uid());

revoke all on public.infinite_room_host_slots from anon, authenticated;
grant select on public.infinite_room_host_slots to anon, authenticated;
grant delete on public.infinite_room_host_slots to authenticated;

-- p_slots: [{"starts_at": "...", "ends_at": "..."}, ...], up to 14 slots,
-- each at most 24 hours long and starting within the next 15 days. Slots that
-- already ended are skipped; saving the same start again updates its end.
create or replace function public.save_infinite_room_host_slots(
  p_session_id uuid,
  p_slots jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_slot jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_saved integer := 0;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if not public.is_infinite_session(p_session_id) then
    raise exception 'infinite_room_required' using errcode = '22023';
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) > 14 then
    raise exception 'invalid_slots' using errcode = '22023';
  end if;

  for v_slot in select value from jsonb_array_elements(p_slots) loop
    v_start := nullif(v_slot ->> 'starts_at', '')::timestamptz;
    v_end := nullif(v_slot ->> 'ends_at', '')::timestamptz;

    if v_start is null or v_end is null or v_end <= v_start then
      raise exception 'invalid_slot_range' using errcode = '22023';
    end if;
    if v_end - v_start > interval '24 hours' then
      raise exception 'slot_too_long' using errcode = '22023';
    end if;
    if v_start > now() + interval '15 days' then
      raise exception 'slot_too_far_ahead' using errcode = '22023';
    end if;
    if v_end <= now() then
      continue;
    end if;

    insert into public.infinite_room_host_slots (session_id, user_id, starts_at, ends_at)
    values (p_session_id, v_user_id, v_start, v_end)
    on conflict (session_id, user_id, starts_at)
    do update set ends_at = excluded.ends_at;

    v_saved := v_saved + 1;
  end loop;

  return v_saved;
end;
$$;

revoke all on function public.save_infinite_room_host_slots(uuid, jsonb) from public, anon;
grant execute on function public.save_infinite_room_host_slots(uuid, jsonb) to authenticated, service_role;

comment on table public.infinite_room_host_slots is
  'Extra days a host booked in an infinite room (the first day stays in session_bookings).';
