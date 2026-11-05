-- Admin dashboard: hosting and paid subscribers by calendar month (UTC).
--
--   Hours hosted
--     Group sessions: scheduled length of sessions that started and had at
--     least one attendance record (cut at now for one still running).
--     Infinite rooms: time the host was actually in the room inside their
--     own host windows (host bookings + host slots). Overlapping windows and
--     several open tabs count once.
--   Unique hosts: people with any hosted time above in the month.
--   Paid subscribers: people whose paid entitlement (Stripe checkout or
--     webhook; admin grants and founding access excluded) covers part of the
--     month. user_entitlements keeps only the current period, so earlier
--     months of a long-running subscription are not reconstructed.
--
-- Read-only; no new tables.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.admin_monthly_host_stats(
  p_start_month date,
  p_end_month date
)
returns table(
  month_start date,
  hours_hosted numeric,
  group_hours numeric,
  infinite_hours numeric,
  unique_hosts bigint,
  host_ids uuid[],
  paid_subscribers bigint,
  subscriber_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or not public.is_app_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_start_month is null or p_end_month is null
     or p_start_month <> date_trunc('month', p_start_month::timestamp)::date
     or p_end_month <> date_trunc('month', p_end_month::timestamp)::date
     or p_end_month <= p_start_month
     or p_end_month > p_start_month + interval '36 months' then
    raise exception 'Invalid monthly host stats range' using errcode = '22023';
  end if;

  return query
  with months as (
    select
      m::date as report_month,
      tstzrange(m at time zone 'UTC', (m + interval '1 month') at time zone 'UTC') as span
    from generate_series(p_start_month::timestamp, (p_end_month - interval '1 month')::timestamp, interval '1 month') as m
  ),
  range_start as (
    select lower(span) as at from months order by report_month limit 1
  ),
  group_hosting as (
    select
      s.host_id as user_id,
      tstzrange(
        s.start_time,
        least(s.start_time + make_interval(mins => greatest(coalesce(s.duration_minutes, 0), 0)), now())
      ) as hosted
    from public.sessions s
    where s.host_id is not null
      and coalesce(s.session_format_type, 'group') <> 'infinite'
      and coalesce(s.description, '') not like 'one-on-one:%'
      and s.start_time <= now()
      and s.start_time >= (select at from range_start) - interval '1 day'
      and exists (select 1 from public.attendance_visit_history h where h.session_id = s.id)
  ),
  host_windows as (
    select b.session_id, b.user_id, tstzrange(b.booked_start_time, b.booked_end_time) as win
    from public.session_bookings b
    where b.booking_role = 'host'
      and b.booked_start_time is not null
      and b.booked_end_time > b.booked_start_time
      and public.is_infinite_session(b.session_id)
    union all
    select hs.session_id, hs.user_id, tstzrange(hs.starts_at, hs.ends_at)
    from public.infinite_room_host_slots hs
    where hs.ends_at > hs.starts_at
  ),
  windows_by_host as (
    select session_id, user_id, range_agg(win) as wins
    from host_windows
    where upper(win) >= (select at from range_start)
    group by session_id, user_id
  ),
  presence_by_host as (
    select h.session_id, h.user_id,
      range_agg(tstzrange(h.joined_at, greatest(h.joined_at, coalesce(h.left_at, h.last_seen_at, h.joined_at)))) as present
    from public.attendance_visit_history h
    join windows_by_host w on w.session_id = h.session_id and w.user_id = h.user_id
    where coalesce(h.left_at, h.last_seen_at, h.joined_at) > h.joined_at
    group by h.session_id, h.user_id
  ),
  infinite_hosting as (
    select w.user_id, piece as hosted
    from windows_by_host w
    join presence_by_host p on p.session_id = w.session_id and p.user_id = w.user_id
    cross join lateral unnest(w.wins * p.present) as piece
  ),
  hosting as (
    select 'group' as kind, user_id, hosted from group_hosting
    union all
    select 'infinite', user_id, hosted from infinite_hosting
  ),
  hosting_by_month as (
    select
      mo.report_month,
      ho.kind,
      ho.user_id,
      extract(epoch from (upper(ho.hosted * mo.span) - lower(ho.hosted * mo.span))) / 3600.0 as hours
    from months mo
    join hosting ho on ho.hosted && mo.span
  ),
  host_totals as (
    select
      report_month,
      round(sum(hours)::numeric, 1) as total_hours,
      round((sum(hours) filter (where kind = 'group'))::numeric, 1) as g_hours,
      round((sum(hours) filter (where kind = 'infinite'))::numeric, 1) as i_hours,
      count(distinct user_id) filter (where hours > 0) as hosts,
      array_agg(distinct user_id) filter (where hours > 0) as ids
    from hosting_by_month
    group by report_month
  ),
  paid as (
    select
      e.user_id,
      case
        when e.plan = 'lifetime' then
          tstzrange(coalesce(e.lifetime_granted_at, e.current_period_start, e.created_at), null)
        else
          tstzrange(coalesce(e.current_period_start, e.created_at), e.current_period_end)
      end as covered
    from public.user_entitlements e
    where e.plan in ('pro_monthly', 'pro_yearly', 'lifetime')
      and e.source in ('checkout_confirm', 'stripe_webhook')
  ),
  paid_by_month as (
    select
      mo.report_month,
      count(distinct pa.user_id) as subscribers,
      array_agg(distinct pa.user_id) as ids
    from months mo
    join paid pa on pa.covered && mo.span and lower(mo.span) <= now()
    group by mo.report_month
  )
  select
    mo.report_month,
    coalesce(ht.total_hours, 0),
    coalesce(ht.g_hours, 0),
    coalesce(ht.i_hours, 0),
    coalesce(ht.hosts, 0)::bigint,
    coalesce(ht.ids, '{}'::uuid[]),
    coalesce(pm.subscribers, 0)::bigint,
    coalesce(pm.ids, '{}'::uuid[])
  from months mo
  left join host_totals ht on ht.report_month = mo.report_month
  left join paid_by_month pm on pm.report_month = mo.report_month
  order by mo.report_month;
end;
$function$;

revoke all on function public.admin_monthly_host_stats(date, date)
  from public, anon;
grant execute on function public.admin_monthly_host_stats(date, date)
  to authenticated, service_role;
