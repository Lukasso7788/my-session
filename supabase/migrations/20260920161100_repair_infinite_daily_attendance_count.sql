-- Daily attendance is history; session_attendance remains the one-row live lease.
-- Use the saved profile timezone (UTC if missing/invalid), never the browser clock.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.is_infinite_attendance_session(p_session_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((
    select lower(coalesce(s.session_format_type, '')) = 'infinite'
      or lower(coalesce(s.format, '')) in ('infinite', 'infinite_room')
      or lower(coalesce(s.schedule ->> 'kind', '')) like '%infinite%'
      or coalesce(jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array', false)
      or coalesce(jsonb_typeof(s.schedule -> 'timer' -> 'segments') = 'array', false)
      or coalesce(jsonb_typeof(s.schedule -> 'phases') = 'array', false)
      or coalesce(jsonb_typeof(s.schedule -> 'segments') = 'array', false)
    from public.sessions s where s.id = p_session_id
  ), false);
$$;
revoke all on function public.is_infinite_attendance_session(uuid) from public, anon, authenticated;
grant execute on function public.is_infinite_attendance_session(uuid) to service_role;

create or replace function public.attendance_profile_timezone(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select z.name from public.profiles p
    join pg_catalog.pg_timezone_names z on z.name = nullif(btrim(p.timezone), '')
    where p.id = p_user_id limit 1
  ), 'UTC');
$$;
revoke all on function public.attendance_profile_timezone(uuid) from public, anon, authenticated;
grant execute on function public.attendance_profile_timezone(uuid) to service_role;

create or replace function public.calculate_lifetime_session_count(p_user_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select
    (select count(distinct a.session_id)
     from public.session_attendance a
     where a.user_id = p_user_id and a.joined_at is not null
       and not public.is_infinite_attendance_session(a.session_id))
    + (select count(*) from public.infinite_room_daily_attendance d
       where d.user_id = p_user_id);
$$;
revoke all on function public.calculate_lifetime_session_count(uuid) from public, anon, authenticated;
grant execute on function public.calculate_lifetime_session_count(uuid) to service_role;

create or replace function public.recompute_attended_sessions_count(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_count bigint;
begin
  -- Serialize concurrent room/day writes for this user's derived counter.
  -- The following separate statement gets a fresh READ COMMITTED snapshot.
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then return; end if;
  v_count := public.calculate_lifetime_session_count(p_user_id);
  update public.profiles set attended_sessions_count = v_count
  where id = p_user_id and attended_sessions_count is distinct from v_count;
end;
$$;
revoke all on function public.recompute_attended_sessions_count(uuid) from public, anon, authenticated;
grant execute on function public.recompute_attended_sessions_count(uuid) to service_role;

-- Eliminate the old incremental triggers: they ran after the recount trigger
-- and added an extra +1, and neither path included the daily history.
drop trigger if exists trg_sync_attended_sessions_count_del on public.session_attendance;
drop trigger if exists trg_sync_attended_sessions_count_ins on public.session_attendance;
drop trigger if exists trg_sync_attended_sessions_count_upd on public.session_attendance;

create or replace function public.tg_session_attendance_recount()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_attended_sessions_count(old.user_id);
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id = old.user_id and new.session_id = old.session_id
       and (new.joined_at is null) = (old.joined_at is null) then
      return new; -- A reconnect cannot change a regular session's contribution.
    end if;
    if old.user_id is distinct from new.user_id then
      perform public.recompute_attended_sessions_count(old.user_id);
    end if;
  end if;
  perform public.recompute_attended_sessions_count(new.user_id);
  return new;
end;
$$;
revoke all on function public.tg_session_attendance_recount() from public, anon, authenticated;
drop trigger if exists session_attendance_recount on public.session_attendance;
create trigger session_attendance_recount
after insert or delete or update of joined_at, user_id, session_id
on public.session_attendance for each row
execute function public.tg_session_attendance_recount();

create or replace function public.tg_infinite_daily_attendance_recount()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_attended_sessions_count(old.user_id);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    perform public.recompute_attended_sessions_count(old.user_id);
  end if;
  perform public.recompute_attended_sessions_count(new.user_id);
  return new;
end;
$$;
revoke all on function public.tg_infinite_daily_attendance_recount() from public, anon, authenticated;
drop trigger if exists infinite_daily_attendance_recount on public.infinite_room_daily_attendance;
create trigger infinite_daily_attendance_recount
after insert or delete or update of user_id, session_id, attendance_date
on public.infinite_room_daily_attendance for each row
execute function public.tg_infinite_daily_attendance_recount();

create or replace function public.tg_capture_infinite_daily_attendance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_timezone text; v_day date;
begin
  if new.joined_at is null or new.left_at is not null
     or not public.is_infinite_attendance_session(new.session_id) then return new; end if;
  v_timezone := public.attendance_profile_timezone(new.user_id);
  v_day := (statement_timestamp() at time zone v_timezone)::date;
  -- Index lookup only for normal heartbeats. No profile UPDATE or history INSERT
  -- on same-day heartbeats; the UNIQUE constraint also handles concurrent tabs.
  if not exists (
    select 1 from public.infinite_room_daily_attendance
    where session_id = new.session_id and user_id = new.user_id and attendance_date = v_day
  ) then
    insert into public.infinite_room_daily_attendance(session_id, user_id, attendance_date, timezone)
    values (new.session_id, new.user_id, v_day, v_timezone)
    on conflict (session_id, user_id, attendance_date) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.tg_capture_infinite_daily_attendance() from public, anon, authenticated;
drop trigger if exists attendance_daily_capture on public.session_attendance;
create trigger attendance_daily_capture
after insert or update of joined_at, last_seen_at on public.session_attendance
for each row execute function public.tg_capture_infinite_daily_attendance();

-- Backward-compatible endpoint for clients deployed before this repair.
-- Presence must already be confirmed; the capture trigger handles first entry.
create or replace function public.record_infinite_room_daily_attendance(
  p_session_id uuid, p_timezone text default 'UTC'
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_timezone text;
  v_inserted integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_infinite_attendance_session(p_session_id) then return false; end if;
  if not exists (
    select 1 from public.session_attendance
    where session_id = p_session_id and user_id = v_user_id
      and joined_at is not null and left_at is null
      and last_seen_at >= statement_timestamp() - interval '2 minutes'
  ) then return false; end if;
  -- Keep p_timezone in the signature for old clients, but do not let different
  -- devices choose different calendar boundaries for the same account.
  v_timezone := public.attendance_profile_timezone(v_user_id);
  insert into public.infinite_room_daily_attendance(session_id, user_id, attendance_date, timezone)
  values (p_session_id, v_user_id, (statement_timestamp() at time zone v_timezone)::date, v_timezone)
  on conflict (session_id, user_id, attendance_date) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;
revoke all on function public.record_infinite_room_daily_attendance(uuid,text) from public, anon;
grant execute on function public.record_infinite_room_daily_attendance(uuid,text) to authenticated, service_role;

-- Only backfill a proven entry for pairs with NO daily history.
-- Never invent days between joined_at and last_seen_at, or rewrite existing dates.
insert into public.infinite_room_daily_attendance(session_id,user_id,attendance_date,timezone,created_at)
select a.session_id, a.user_id,
       (a.joined_at at time zone public.attendance_profile_timezone(a.user_id))::date,
       public.attendance_profile_timezone(a.user_id), a.joined_at
from public.session_attendance a
where a.joined_at is not null and public.is_infinite_attendance_session(a.session_id)
  and not exists (select 1 from public.infinite_room_daily_attendance d
                  where d.session_id=a.session_id and d.user_id=a.user_id)
on conflict (session_id,user_id,attendance_date) do nothing;

-- Reconcile the stored profile display with the existing daily ledger immediately.
do $$
declare v_id uuid;
begin
  for v_id in select id from public.profiles order by id loop
    perform public.recompute_attended_sessions_count(v_id);
  end loop;
end;
$$;
