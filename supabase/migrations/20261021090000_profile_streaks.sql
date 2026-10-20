-- Profile streaks: the signed-in person's own attendance streaks.
--
-- Uses mysession_private.attendance_streaks from 20261018130000 (same rules
-- as the admin dashboard: UTC days, ISO weeks from Monday; a streak stays
-- current until a whole period is missed). Only the person's own numbers;
-- other people's streaks are not exposed. Read-only.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.get_my_streaks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_today date := (statement_timestamp() at time zone 'UTC')::date;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'as_of', v_today,
    'calendar', 'UTC',
    'attended_today', exists (
      select 1 from public.attendance_daily_users d where d.user_id = v_user_id and d.attendance_date = v_today
    ),
    'days_this_week', (
      select count(*) from public.attendance_daily_users d
      where d.user_id = v_user_id and d.attendance_date >= date_trunc('week', v_today)::date and d.attendance_date <= v_today
    ),
    'days_this_month', (
      select count(*) from public.attendance_daily_users d
      where d.user_id = v_user_id and d.attendance_date >= date_trunc('month', v_today)::date and d.attendance_date <= v_today
    ),
    'streaks', coalesce((
      select jsonb_object_agg(s.unit, jsonb_build_object('current', s.current_streak, 'longest', s.longest_streak))
      from mysession_private.attendance_streaks(v_today, v_user_id) s
    ), '{}'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_my_streaks() from public, anon;
grant execute on function public.get_my_streaks() to authenticated;

comment on function public.get_my_streaks() is
  'Signed-in person''s own day/week/month/year attendance streaks (UTC), for the profile page.';
