-- Run after the repair migration. Uses inactive fixtures and ALWAYS rolls back.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $test$
declare
  v_user uuid; v_room uuid; v_regular uuid; v_base bigint; v_count bigint;
  v_day date; v_day_before date; v_tz text; v_row uuid;
begin
  -- Use an inactive existing attendance row; all modifications roll back.
  select a.user_id,a.session_id,a.id into v_user,v_room,v_row
  from public.session_attendance a join public.profiles p on p.id=a.user_id
  where public.is_infinite_attendance_session(a.session_id)
    and a.joined_at is not null
    and coalesce(a.last_seen_at,a.joined_at) < statement_timestamp()-interval '1 hour'
  order by a.last_seen_at nulls first limit 1;
  if v_user is null then raise exception 'No safe inactive test fixture'; end if;
  v_tz := public.attendance_profile_timezone(v_user);
  v_day := (statement_timestamp() at time zone v_tz)::date;
  v_day_before := v_day-1;

  delete from public.infinite_room_daily_attendance
  where user_id=v_user and session_id=v_room and attendance_date in (v_day,v_day_before);
  v_base := public.calculate_lifetime_session_count(v_user);

  insert into public.infinite_room_daily_attendance(session_id,user_id,attendance_date,timezone)
  values(v_room,v_user,v_day_before,v_tz);
  if public.calculate_lifetime_session_count(v_user) <> v_base+1 then raise exception 'Prior day count failed'; end if;

  -- Mimic the next-day heartbeat; no reconnect and no extra attendance RPC.
  update public.session_attendance set left_at=null,last_seen_at=statement_timestamp() where id=v_row;
  if public.calculate_lifetime_session_count(v_user) <> v_base+2 then raise exception 'New-day heartbeat failed'; end if;
  select attended_sessions_count into v_count from public.profiles where id=v_user;
  if v_count <> v_base+2 then raise exception 'Profile not synchronized'; end if;

  -- Many hours/rejoins/tabs on the same day still count once.
  update public.session_attendance set last_seen_at=statement_timestamp() where id=v_row;
  update public.session_attendance set joined_at=statement_timestamp(),last_seen_at=statement_timestamp() where id=v_row;
  if public.calculate_lifetime_session_count(v_user) <> v_base+2 then raise exception 'Same-day duplicate'; end if;
  select attended_sessions_count into v_count from public.profiles where id=v_user;
  if v_count <> v_base+2 then raise exception 'Reconnect counter drift'; end if;

  -- Authenticated old client cannot choose a second day by passing another zone.
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform public.record_infinite_room_daily_attendance(v_room,'Pacific/Kiritimati');
  perform public.record_infinite_room_daily_attendance(v_room,'America/Adak');
  if public.calculate_lifetime_session_count(v_user) <> v_base+2 then raise exception 'Client timezone split'; end if;

  -- UTC timestamps straddling Kyiv local midnight and DST use calendar dates.
  if ('2026-09-20 20:59:59+00'::timestamptz at time zone 'Europe/Kyiv')::date
      = ('2026-09-20 21:00:01+00'::timestamptz at time zone 'Europe/Kyiv')::date then
    raise exception 'Local midnight handling failed';
  end if;
  if ('2026-10-25 00:30+00'::timestamptz at time zone 'Europe/Kyiv')::date
      <> ('2026-10-25 01:30+00'::timestamptz at time zone 'Europe/Kyiv')::date then
    raise exception 'DST fallback incorrectly splits a day';
  end if;

  -- Normal sessions have no daily contribution and missing schedule keys are false.
  select id into v_regular from public.sessions where not public.is_infinite_attendance_session(id) limit 1;
  if v_regular is null then raise exception 'Regular sessions incorrectly classified'; end if;
  if public.is_infinite_attendance_session(gen_random_uuid()) is distinct from false then
    raise exception 'Classification must never be null';
  end if;
  if has_function_privilege('anon','public.recompute_attended_sessions_count(uuid)','execute')
     or has_function_privilege('authenticated','public.attendance_profile_timezone(uuid)','execute') then
    raise exception 'Internal helper exposed';
  end if;

  -- A second infinite room on the same date is a separate attendance unit.
  select id into v_regular from public.sessions
  where public.is_infinite_attendance_session(id) and id<>v_room
    and not exists (select 1 from public.infinite_room_daily_attendance d
      where d.session_id=sessions.id and d.user_id=v_user and d.attendance_date=v_day)
  limit 1;
  if v_regular is null then raise exception 'No second-room fixture'; end if;
  insert into public.infinite_room_daily_attendance(session_id,user_id,attendance_date,timezone)
  values(v_regular,v_user,v_day,v_tz);
  if public.calculate_lifetime_session_count(v_user) <> v_base+3 then raise exception 'Second room not counted'; end if;
  delete from public.infinite_room_daily_attendance where session_id=v_regular and user_id=v_user and attendance_date=v_day;

  -- Scheduled session reconnects stay one attendance, not one per date.
  select id into v_regular from public.sessions
  where not public.is_infinite_attendance_session(id)
    and not exists(select 1 from public.session_attendance a where a.session_id=sessions.id and a.user_id=v_user)
  limit 1;
  if v_regular is null then raise exception 'No scheduled-room fixture'; end if;
  insert into public.session_attendance(session_id,user_id,joined_at,last_seen_at)
  values(v_regular,v_user,statement_timestamp()-interval '1 day',statement_timestamp());
  if public.calculate_lifetime_session_count(v_user) <> v_base+3 then raise exception 'Scheduled entry not counted'; end if;
  update public.session_attendance set joined_at=statement_timestamp(),last_seen_at=statement_timestamp()
  where session_id=v_regular and user_id=v_user;
  if public.calculate_lifetime_session_count(v_user) <> v_base+3 then raise exception 'Scheduled rejoin overcount'; end if;
  if exists(select 1 from public.infinite_room_daily_attendance where session_id=v_regular and user_id=v_user) then
    raise exception 'Scheduled attendance leaked into daily ledger';
  end if;

  if exists(select 1 from public.profiles p
      where p.attended_sessions_count is distinct from public.calculate_lifetime_session_count(p.id)) then
    raise exception 'Counters disagree with canonical ledger';
  end if;
end;
$test$;

rollback;
select 'daily attendance regression assertions passed (rolled back)' as result;
