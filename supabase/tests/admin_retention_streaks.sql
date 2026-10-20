-- Rollback-only checks for 20261018130000_admin_retention_streaks.sql.
begin;

create schema if not exists rs_test;

create or replace function rs_test.ok(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FAILED: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end;
$$;

create or replace function rs_test.days(p_user uuid, variadic p_days date[])
returns void language sql as $$
  insert into public.attendance_daily_users (attendance_date, user_id, first_seen_at, last_seen_at)
  select d, p_user, d::timestamptz, d::timestamptz from unnest(p_days) d
  on conflict do nothing;
$$;

do $$
declare
  -- Wednesday.
  today date := '2026-10-14';
  a uuid := 'f0000000-0000-4000-8000-000000000001';
  b uuid := 'f0000000-0000-4000-8000-000000000002';
  c uuid := 'f0000000-0000-4000-8000-000000000003';
  d uuid := 'f0000000-0000-4000-8000-000000000004';
  r jsonb;
  s record;
begin
  insert into public.profiles (id, full_name) values (a, 'Daily Anna'), (b, 'Weekly Ben'), (c, 'Once Cleo'), (d, 'Old Dan');

  -- Anna: every day Oct 8..14 (7-day streak), plus a long-ago 10-day run.
  perform rs_test.days(a, '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14');
  perform rs_test.days(a, '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
                          '2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09', '2026-05-10');
  -- Ben: once a week for 5 weeks, last visit yesterday; twice this week? no, once.
  perform rs_test.days(b, '2026-09-14', '2026-09-22', '2026-09-30', '2026-10-06', '2026-10-13');
  -- Cleo: two days this month in the same week.
  perform rs_test.days(c, '2026-10-12', '2026-10-13');
  -- Dan: last seen months ago.
  perform rs_test.days(d, '2026-03-02', '2026-04-06', '2026-05-04');

  select * into s from mysession_private.attendance_streaks(today, a) where unit = 'day';
  perform rs_test.ok(s.current_streak = 7 and s.longest_streak = 10, 'daily: current 7, longest 10 from the old run');

  select * into s from mysession_private.attendance_streaks(today, b) where unit = 'week';
  perform rs_test.ok(s.current_streak = 5, 'weekly: five weeks in a row');
  select * into s from mysession_private.attendance_streaks(today, b) where unit = 'day';
  perform rs_test.ok(s.current_streak = 1, 'weekly visitor has no daily streak');

  -- Yesterday still counts as current; two days ago does not.
  select * into s from mysession_private.attendance_streaks('2026-10-15', a) where unit = 'day';
  perform rs_test.ok(s.current_streak = 7, 'a streak through yesterday is still current');
  select * into s from mysession_private.attendance_streaks('2026-10-16', a) where unit = 'day';
  perform rs_test.ok(s.current_streak = 0 and s.longest_streak = 10, 'a missed day ends the current streak');

  select * into s from mysession_private.attendance_streaks(today, d) where unit = 'month';
  perform rs_test.ok(s.current_streak = 0 and s.longest_streak = 3, 'monthly: old 3-month run is the record, not current');

  -- Future days are ignored.
  perform rs_test.days(c, '2026-10-20');
  select * into s from mysession_private.attendance_streaks(today, c) where unit = 'day';
  perform rs_test.ok(s.current_streak = 2, 'days after the as-of date are ignored');

  r := mysession_private.retention_streaks(today);
  perform rs_test.ok(r->>'calendar' = 'UTC' and r->>'week_start' = '2026-10-12', 'weeks start on Monday (UTC)');

  -- This week (Oct 12..): Anna 3 days, Ben 1, Cleo 2.
  perform rs_test.ok((r->'returning'->'weeks'->-1->>'active')::int = 3, 'active people this week');
  perform rs_test.ok((r->'returning'->'weeks'->-1->>'returning')::int = 2, 'returning (2+ days) this week');
  perform rs_test.ok((r->'returning'->'weeks'->-1->>'returning3')::int = 1, 'returning 3+ days this week');
  perform rs_test.ok(jsonb_array_length(r->'returning'->'weeks') = 12 and jsonb_array_length(r->'returning'->'months') = 12, '12 weeks and 12 months');

  -- October: Anna 7 days, Ben 2 (6th, 13th), Cleo 2.
  perform rs_test.ok((r->'returning'->'months'->-1->>'returning')::int = 3, 'returning (2+ days) this month');
  perform rs_test.ok(r->'returning'->'top'->'month'->0->>'full_name' = 'Daily Anna', 'top returner this month');

  perform rs_test.ok((r->'streaks'->'day'->>'on_streak')::int = 2, 'people on a daily streak of 2+ (Anna, Cleo)');
  perform rs_test.ok(r->'streaks'->'day'->'top'->0->>'full_name' = 'Daily Anna', 'top daily streak');
  perform rs_test.ok(r->'streaks'->'week'->'top'->0->>'full_name' = 'Weekly Ben', 'top weekly streak');
  perform rs_test.ok((r->'streaks'->'day'->'record'->>'longest')::int = 10, 'longest daily streak ever');
  perform rs_test.ok(
    (select (x->>'users')::int from jsonb_array_elements(r->'streaks'->'day'->'buckets') x where (x->>'min')::int = 7) = 1,
    'bucket: 1 person on a 7+ day streak');
  perform rs_test.ok(r->'streaks' ? 'year', 'yearly streaks are included');
end;
$$;

-- Profile: a person sees only their own streaks (real clock, so only shape and
-- relative facts are checked).
do $$
declare
  me uuid := 'f0000000-0000-4000-8000-000000000010';
  today date := (statement_timestamp() at time zone 'UTC')::date;
  r jsonb;
  failed boolean := false;
begin
  insert into public.profiles (id, full_name) values (me, 'Profile Me');
  perform rs_test.days(me, today - 2, today - 1, today);
  perform rs_test.days('f0000000-0000-4000-8000-000000000001', today);

  perform set_config('test.uid', me::text, true);
  r := public.get_my_streaks();
  perform rs_test.ok((r->'streaks'->'day'->>'current')::int = 3, 'profile: my 3-day streak');
  perform rs_test.ok((r->>'attended_today')::boolean, 'profile: attended today');
  perform rs_test.ok((r->>'days_this_month')::int >= 1 and r->'streaks' ? 'week' and r->'streaks' ? 'year', 'profile: all units present');

  perform set_config('test.uid', '', true);
  begin
    perform public.get_my_streaks();
  exception when others then failed := true;
  end;
  perform rs_test.ok(failed, 'profile: signed-out callers are refused');
end;
$$;

rollback;
