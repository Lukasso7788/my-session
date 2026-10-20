-- Dedicated, opt-in Plunk retention delivery. No historical Sender queue replay.
create table public.retention_email_config (
  id boolean primary key default true check(id), enabled boolean not null default false,
  started_at timestamptz not null default now()
);
insert into public.retention_email_config(id) values(true);
create table public.retention_email_opt_outs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.retention_email_sends (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('first_session','second_session','return_7','return_14','missed_session','booking_reminder','weekly_recap')),
  logical_key text not null unique, status text not null default 'processing'
    check(status in ('processing','accepted','cancelled','failed','uncertain')),
  created_at timestamptz not null default now(), first_attempt_at timestamptz,
  sent_at timestamptz, last_error text, provider_id text,
  payload jsonb not null default '{}'
);
create index retention_email_user_recent on public.retention_email_sends(user_id,created_at desc);
alter table public.retention_email_config enable row level security;
alter table public.retention_email_opt_outs enable row level security;
alter table public.retention_email_sends enable row level security;
revoke all on public.retention_email_config,public.retention_email_opt_outs,public.retention_email_sends from public,anon,authenticated;
grant select,insert,update on public.retention_email_config,public.retention_email_opt_outs,public.retention_email_sends to service_role;
create schema if not exists mysession_private;
grant usage on schema mysession_private to service_role;

create or replace function mysession_private.retention_candidates(p_user uuid default null)
returns table(user_id uuid,email text,first_name text,timezone text,kind text,logical_key text,payload jsonb,priority integer)
language sql stable security definer set search_path=pg_catalog,public,auth,mysession_private as $$
with visits as (
  select a.user_id,a.session_id,a.joined_at,
    least(now(),greatest(a.joined_at,coalesce(a.left_at,a.last_seen_at,a.joined_at))) ended_at,
    greatest(0,extract(epoch from (least(now(),coalesce(a.left_at,a.last_seen_at,a.joined_at))-a.joined_at))) seconds,
    coalesce(s.is_infinite,false) infinite
  from public.session_attendance a join public.sessions s on s.id=a.session_id
  where p_user is null or a.user_id=p_user
), stats as (
  select user_id,count(*) visits,max(ended_at) last_active,
    count(distinct case when seconds>=600 then session_id::text||case when infinite then ':'||(joined_at at time zone 'UTC')::date::text else '' end end) qualified,
    max(ended_at) filter(where seconds>=600) last_qualified,
    count(distinct case when ended_at>now()-interval '7 days' and seconds>=600 then session_id::text||case when infinite then ':'||(joined_at at time zone 'UTC')::date::text else '' end end) week_count,
    floor(sum(greatest(0,extract(epoch from(ended_at-greatest(joined_at,now()-interval '7 days'))))) filter(where ended_at>now()-interval '7 days')/60) week_minutes
  from visits group by user_id
), users as (
  select u.id,u.email,u.created_at,coalesce(nullif(split_part(trim(p.full_name),' ',1),''),'there') first_name,
    coalesce(t.name,'UTC') timezone,ep.marketing_email_enabled marketing,
    coalesce(ep.session_reminders_enabled,true) reminders,coalesce(ep.weekly_recap_enabled,true) weekly,
    coalesce(ep.reactivation_email_enabled,true) reactivation,
    st.*,cfg.started_at,
    exists(select 1 from public.session_bookings b join public.sessions s on s.id=b.session_id
      where b.user_id=u.id and not coalesce(s.is_infinite,false) and s.status not in ('cancelled','closed','ended')
      and coalesce(b.booked_start_time,s.start_time)>now()) booked
  from auth.users u
  cross join public.retention_email_config cfg
  left join public.profiles p on p.id=u.id
  left join public.email_automation_preferences ep on ep.user_id=u.id
  left join pg_catalog.pg_timezone_names t on t.name=coalesce(nullif(p.timezone,''),ep.timezone,'UTC')
  left join stats st on st.user_id=u.id
  where (p_user is null or u.id=p_user) and u.email_confirmed_at is not null
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<now())
    and coalesce(ep.lifecycle_email_enabled,true)
    and not exists(select 1 from public.retention_email_opt_outs o where o.user_id=u.id)
), candidates as (
  select u.id,u.email,u.first_name,u.timezone,'first_session' kind,'first_session:'||u.id logical_key,'{}'::jsonb payload,20 priority
  from users u where u.marketing and coalesce(u.visits,0)=0 and not u.booked and u.created_at<=now()-interval '24 hours'
  union all
  select u.id,u.email,u.first_name,u.timezone,'second_session','second_session:'||u.id,'{}',15
  from users u where u.marketing and u.qualified=1 and not u.booked
    and u.last_qualified between now()-interval '7 days' and now()-interval '24 hours'
    and u.last_active<=now()-interval '24 hours'
  union all
  select u.id,u.email,u.first_name,u.timezone,'return_7','return_7:'||u.id||':'||u.last_active::text,'{}',30
  from users u where u.marketing and u.reactivation and not u.booked and u.last_active<=now()-interval '7 days'
  union all
  select u.id,u.email,u.first_name,u.timezone,'return_14','return_14:'||u.id||':'||u.last_active::text,'{}',35
  from users u where u.marketing and u.reactivation and not u.booked and u.last_active<=now()-interval '14 days'
    and exists(select 1 from public.retention_email_sends x where x.logical_key='return_7:'||u.id||':'||u.last_active::text
      and x.status='accepted' and x.sent_at<=now()-interval '7 days')
  union all
  select u.id,u.email,u.first_name,u.timezone,'weekly_recap',
    'weekly_recap:'||u.id||':'||date_trunc('week',now() at time zone u.timezone)::date::text,
    jsonb_build_object('sessionCount',u.week_count,'minutes',coalesce(u.week_minutes,0)),50
  from users u where u.marketing and u.weekly and u.week_count>0
    and extract(isodow from now() at time zone u.timezone)=1
    and now()>=u.started_at+interval '7 days'
  union all
  select u.id,u.email,u.first_name,u.timezone,'missed_session','missed_session:'||b.id,
    jsonb_build_object('sessionTitle',s.title),10
  from users u join public.session_bookings b on b.user_id=u.id join public.sessions s on s.id=b.session_id
  where u.marketing and not u.booked and not coalesce(s.is_infinite,false) and s.status not in ('cancelled')
    and coalesce(b.booked_end_time,s.start_time+make_interval(mins=>coalesce(s.duration_minutes,60)))
      between greatest(u.started_at,now()-interval '30 hours') and now()-interval '2 hours'
    and not exists(select 1 from public.session_attendance a where a.user_id=u.id and a.session_id=s.id)
  union all
  select u.id,u.email,u.first_name,u.timezone,'booking_reminder',
    'booking_reminder:'||b.id||':'||coalesce(b.booked_start_time,s.start_time)::text,
    jsonb_build_object('sessionTitle',s.title,'sessionStart',coalesce(b.booked_start_time,s.start_time),
      'sessionUrl','https://mysession.club/'||coalesce(nullif(s.custom_slug,''),nullif(s.slug,''),s.id::text)),0
  from users u join public.session_bookings b on b.user_id=u.id join public.sessions s on s.id=b.session_id
  where u.reminders and not coalesce(s.is_infinite,false) and s.status not in ('cancelled','closed','ended')
    and coalesce(b.booked_start_time,s.start_time) between now()+interval '5 minutes' and now()+interval '20 minutes'
    and b.reminder_30m_sent_at is null
    and not exists(select 1 from public.session_attendance a where a.user_id=u.id and a.session_id=s.id and a.last_seen_at>now()-interval '2 minutes')
)
select c.* from candidates c where not exists(
  select 1 from public.retention_email_sends x where x.logical_key=c.logical_key
    and x.status in ('accepted','cancelled','uncertain','failed')
) order by priority,id;
$$;
revoke all on function mysession_private.retention_candidates(uuid) from public,anon,authenticated;
grant execute on function mysession_private.retention_candidates(uuid) to service_role;

create or replace function public.retention_email_candidates(p_user uuid default null)
returns table(user_id uuid,email text,first_name text,timezone text,kind text,logical_key text,payload jsonb,priority integer)
language sql stable security invoker set search_path=pg_catalog,mysession_private as $$
  select * from mysession_private.retention_candidates(p_user);
$$;
revoke all on function public.retention_email_candidates(uuid) from public,anon,authenticated;
grant execute on function public.retention_email_candidates(uuid) to service_role;

create or replace function mysession_private.claim_retention(p_user uuid,p_key text)
returns setof public.retention_email_sends language plpgsql security definer
set search_path=pg_catalog,public,mysession_private as $$
declare c record; v_now timestamptz:=now();
begin
  if not (select enabled from public.retention_email_config where id) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('retention:'||p_user,0));
  select * into c from mysession_private.retention_candidates(p_user) where logical_key=p_key limit 1;
  if not found then return; end if;
  if exists(select 1 from public.retention_email_sends x where x.user_id=p_user
    and x.status='processing' and x.created_at>v_now-interval '10 minutes') then return; end if;
  -- Ambiguous/crashed delivery is never retried automatically (provider reconciliation required).
  update public.retention_email_sends set status='uncertain',last_error='delivery_outcome_unknown'
    where user_id=p_user and status='processing' and created_at<=v_now-interval '10 minutes';
  if c.kind<>'booking_reminder' then
    if (v_now at time zone c.timezone)::time < time '09:00' or (v_now at time zone c.timezone)::time >= time '18:00' then return; end if;
    if exists(select 1 from public.email_automation_preferences ep where ep.user_id=p_user and
      ep.quiet_hours_start is not null and ep.quiet_hours_end is not null and
      case when ep.quiet_hours_start<ep.quiet_hours_end then
        (v_now at time zone c.timezone)::time>=ep.quiet_hours_start and (v_now at time zone c.timezone)::time<ep.quiet_hours_end
      else (v_now at time zone c.timezone)::time>=ep.quiet_hours_start or (v_now at time zone c.timezone)::time<ep.quiet_hours_end end) then return; end if;
    if exists(select 1 from public.retention_email_sends x where x.user_id=p_user and x.kind<>'booking_reminder'
      and x.status in ('accepted','processing','uncertain') and coalesce(x.sent_at,x.created_at)>v_now-interval '24 hours') then return; end if;
    if exists(select 1 from public.daily_schedule_email_sends d where d.user_id=p_user
      and d.status='sent' and d.created_at>v_now-interval '24 hours') then return; end if;
  end if;
  return query insert into public.retention_email_sends(user_id,kind,logical_key,payload)
    values(p_user,c.kind,c.logical_key,c.payload||jsonb_build_object('firstName',c.first_name,'timezone',c.timezone))
    on conflict(logical_key) do nothing returning *;
end $$;
revoke all on function mysession_private.claim_retention(uuid,text) from public,anon,authenticated;
grant execute on function mysession_private.claim_retention(uuid,text) to service_role;
create or replace function public.claim_retention_email(p_user uuid,p_key text)
returns setof public.retention_email_sends language sql security invoker set search_path=pg_catalog,mysession_private as $$
  select * from mysession_private.claim_retention(p_user,p_key);
$$;
revoke all on function public.claim_retention_email(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_retention_email(uuid,text) to service_role;

create or replace function public.retention_digest_exclusions()
returns table(user_id uuid) language sql stable security invoker set search_path=pg_catalog,public,mysession_private as $$
  select distinct c.user_id from mysession_private.retention_candidates(null) c
  where c.kind<>'booking_reminder' and (select enabled from public.retention_email_config where id)
  union select s.user_id from public.retention_email_sends s where s.kind<>'booking_reminder'
    and s.status in ('accepted','processing','uncertain') and coalesce(s.sent_at,s.created_at)>now()-interval '24 hours';
$$;
revoke all on function public.retention_digest_exclusions() from public,anon,authenticated;
grant execute on function public.retention_digest_exclusions() to service_role;
