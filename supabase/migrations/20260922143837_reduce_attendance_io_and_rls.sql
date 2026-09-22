-- Attendance is a 90-second presence lease. Repeated calls inside 20 seconds
-- must not create a new heap tuple, WAL, or Realtime event.
create or replace function public.attendance_heartbeat(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then return; end if;
  update public.session_attendance
  set last_seen_at = now(), left_at = null
  where session_id = p_session_id and user_id = v_user_id
    and (left_at is not null or last_seen_at is null
         or last_seen_at < now() - interval '20 seconds');
end;
$$;

-- The seven-minute host lease needs no more than one write per minute.
-- A fresh lease still returns true even if the UPDATE was a no-op.
create or replace function public.heartbeat_infinite_room_host(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
begin
  if v_user_id is null then raise exception 'unauthorized'; end if;
  select s.host_id into v_owner_id from public.sessions s where s.id = p_session_id;
  if v_owner_id is not null and exists (
    select 1 from public.session_attendance a
    where a.session_id = p_session_id and a.user_id = v_owner_id
      and a.left_at is null
      and a.last_seen_at >= now() - interval '90 seconds'
  ) then
    delete from public.infinite_room_host_leases
    where session_id = p_session_id and user_id = v_user_id;
    return false;
  end if;
  update public.infinite_room_host_leases
  set heartbeat_at = now(), expires_at = now() + interval '7 minutes', updated_at = now()
  where session_id = p_session_id and user_id = v_user_id
    and expires_at > now()
    and (heartbeat_at is null or heartbeat_at < now() - interval '60 seconds');
  if found then return true; end if;
  return exists (
    select 1 from public.infinite_room_host_leases
    where session_id = p_session_id and user_id = v_user_id and expires_at > now()
  );
end;
$$;

-- Three constraints exactly duplicate the canonical key. Refuse schema drift,
-- do not CASCADE, and retain the reverse-key user/session index.
set lock_timeout = '5s';
do $$
declare
  redundant_name text;
  definition text;
begin
  select pg_get_constraintdef(c.oid) into definition from pg_constraint c
  where c.conrelid = 'public.session_attendance'::regclass
    and c.conname = 'session_attendance_session_user_key' and c.contype = 'u';
  if definition is distinct from 'UNIQUE (session_id, user_id)' then
    raise exception 'Canonical attendance uniqueness constraint is missing or changed';
  end if;
  foreach redundant_name in array array[
    'session_attendance_session_user_unique',
    'session_attendance_unique',
    'session_attendance_unique_session_user'
  ] loop
    select pg_get_constraintdef(c.oid) into definition from pg_constraint c
    where c.conrelid = 'public.session_attendance'::regclass
      and c.conname = redundant_name and c.contype = 'u';
    if definition is null then continue; end if;
    if definition <> 'UNIQUE (session_id, user_id)' then
      raise exception 'Unexpected attendance constraint definition: %', redundant_name;
    end if;
    execute format('alter table public.session_attendance drop constraint %I', redundant_name);
  end loop;
end;
$$;

-- auth.uid() is statement-constant. Preserve policy commands, roles, and
-- boolean expressions; change only the function-call evaluation strategy.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname, qual, with_check from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'session_attendance', 'sessions', 'session_chat_messages',
        'session_chat_message_reactions', 'intentions', 'panel_intentions'
      ])
  loop
    if position('auth.uid()' in coalesce(policy_row.qual, '')) > 0
       and policy_row.qual !~* '\(\s*select\s+auth\.uid\(\)' then
      execute format('alter policy %I on public.%I using (%s)',
        policy_row.policyname, policy_row.tablename,
        replace(policy_row.qual, 'auth.uid()', '(select auth.uid())'));
    end if;
    if position('auth.uid()' in coalesce(policy_row.with_check, '')) > 0
       and policy_row.with_check !~* '\(\s*select\s+auth\.uid\(\)' then
      execute format('alter policy %I on public.%I with check (%s)',
        policy_row.policyname, policy_row.tablename,
        replace(policy_row.with_check, 'auth.uid()', '(select auth.uid())'));
    end if;
  end loop;
end;
$$;
reset lock_timeout;
