create table if not exists public.infinite_room_host_leases (
  session_id uuid primary key,
  user_id uuid not null,
  claimed_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint infinite_room_host_leases_session_id_fkey
    foreign key (session_id) references public.sessions(id) on delete cascade,
  constraint infinite_room_host_leases_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade
);

create index if not exists infinite_room_host_leases_user_id_idx
  on public.infinite_room_host_leases(user_id);
create index if not exists infinite_room_host_leases_expires_at_idx
  on public.infinite_room_host_leases(expires_at);

alter table public.infinite_room_host_leases enable row level security;

drop policy if exists "Room host leases are readable" on public.infinite_room_host_leases;
create policy "Room host leases are readable"
  on public.infinite_room_host_leases
  for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.infinite_room_host_leases from anon, authenticated;
grant select on public.infinite_room_host_leases to anon, authenticated;

create or replace function public.claim_infinite_room_host(p_session_id uuid)
returns setof public.infinite_room_host_leases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
  v_is_infinite boolean := false;
  v_result public.infinite_room_host_leases%rowtype;
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;

  select
    s.host_id,
    (
      lower(coalesce(s.session_format_type, '')) = 'infinite'
      or lower(coalesce(s.format, '')) = 'infinite'
      or coalesce(s.schedule ->> 'kind', '') = 'infinite_room'
      or jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array'
      or jsonb_typeof(s.schedule -> 'phases') = 'array'
    )
  into v_owner_id, v_is_infinite
  from public.sessions s
  where s.id = p_session_id;

  if not found then
    raise exception 'session_not_found';
  end if;
  if not v_is_infinite then
    raise exception 'not_infinite_room';
  end if;
  if v_owner_id = v_user_id then
    raise exception 'session_owner_already_host';
  end if;

  if not exists (
    select 1
    from public.session_attendance a
    where a.session_id = p_session_id
      and a.user_id = v_user_id
      and a.left_at is null
      and a.last_seen_at >= now() - interval '90 seconds'
  ) then
    raise exception 'participant_not_present';
  end if;

  if v_owner_id is not null and exists (
    select 1
    from public.session_attendance a
    where a.session_id = p_session_id
      and a.user_id = v_owner_id
      and a.left_at is null
      and a.last_seen_at >= now() - interval '90 seconds'
  ) then
    raise exception 'session_owner_present';
  end if;

  insert into public.infinite_room_host_leases (
    session_id,
    user_id,
    claimed_at,
    heartbeat_at,
    expires_at,
    updated_at
  ) values (
    p_session_id,
    v_user_id,
    now(),
    now(),
    now() + interval '7 minutes',
    now()
  )
  on conflict (session_id) do update
    set user_id = excluded.user_id,
        claimed_at = case
          when infinite_room_host_leases.user_id = excluded.user_id
            then infinite_room_host_leases.claimed_at
          else excluded.claimed_at
        end,
        heartbeat_at = excluded.heartbeat_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    where infinite_room_host_leases.expires_at <= now()
       or infinite_room_host_leases.user_id = excluded.user_id
  returning * into v_result;

  if v_result.session_id is null then
    raise exception 'active_host_already_claimed';
  end if;

  return next v_result;
end;
$$;

create or replace function public.heartbeat_infinite_room_host(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;

  select s.host_id into v_owner_id
  from public.sessions s
  where s.id = p_session_id;

  if v_owner_id is not null and exists (
    select 1
    from public.session_attendance a
    where a.session_id = p_session_id
      and a.user_id = v_owner_id
      and a.left_at is null
      and a.last_seen_at >= now() - interval '90 seconds'
  ) then
    delete from public.infinite_room_host_leases
    where session_id = p_session_id and user_id = v_user_id;
    return false;
  end if;

  update public.infinite_room_host_leases
  set heartbeat_at = now(),
      expires_at = now() + interval '7 minutes',
      updated_at = now()
  where session_id = p_session_id
    and user_id = v_user_id
    and expires_at > now();

  return found;
end;
$$;

create or replace function public.release_infinite_room_host(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;

  delete from public.infinite_room_host_leases
  where session_id = p_session_id and user_id = v_user_id;
  return found;
end;
$$;

revoke all on function public.claim_infinite_room_host(uuid) from public, anon;
revoke all on function public.heartbeat_infinite_room_host(uuid) from public, anon;
revoke all on function public.release_infinite_room_host(uuid) from public, anon;
grant execute on function public.claim_infinite_room_host(uuid) to authenticated;
grant execute on function public.heartbeat_infinite_room_host(uuid) to authenticated;
grant execute on function public.release_infinite_room_host(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'infinite_room_host_leases'
  ) then
    alter publication supabase_realtime
      add table public.infinite_room_host_leases;
  end if;
end;
$$;
