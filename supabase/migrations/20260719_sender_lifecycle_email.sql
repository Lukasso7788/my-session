-- Apply manually in Supabase SQL Editor. The application intentionally does not
-- auto-run database migrations.

create extension if not exists pgcrypto;

create table if not exists public.email_automation_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lifecycle_email_enabled boolean not null default true,
  marketing_email_enabled boolean not null default false,
  weekly_recap_enabled boolean not null default true,
  session_reminders_enabled boolean not null default true,
  reactivation_email_enabled boolean not null default true,
  timezone text not null default 'UTC',
  quiet_hours_start time null,
  quiet_hours_end time null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_event_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  email text not null,
  event_type text not null,
  properties jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','dead','cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  sent_at timestamptz null
);

alter table public.email_event_outbox
  add column if not exists claimed_at timestamptz null;

drop index if exists public.email_event_outbox_delivery_idx;
create index if not exists email_event_outbox_delivery_idx
  on public.email_event_outbox(status, next_attempt_at, claimed_at, created_at);
create index if not exists email_event_outbox_user_idx
  on public.email_event_outbox(user_id, created_at desc);

alter table public.email_automation_preferences enable row level security;
alter table public.email_event_outbox enable row level security;

drop policy if exists "email preferences select own" on public.email_automation_preferences;
create policy "email preferences select own" on public.email_automation_preferences
  for select using (auth.uid() = user_id);
drop policy if exists "email preferences insert own" on public.email_automation_preferences;
create policy "email preferences insert own" on public.email_automation_preferences
  for insert with check (auth.uid() = user_id);
drop policy if exists "email preferences update own" on public.email_automation_preferences;
create policy "email preferences update own" on public.email_automation_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.email_event_outbox from anon, authenticated;
revoke all on public.email_automation_preferences from anon;
grant select, insert, update on public.email_event_outbox to service_role;
grant select, insert, update on public.email_automation_preferences to service_role;
grant select, insert, update on public.email_automation_preferences to authenticated;

create or replace function public.sender_event_category(p_event_type text)
returns text language sql immutable as $$
  select case
    when p_event_type in ('weekly_recap_ready') then 'weekly'
    when p_event_type in ('session_booked','session_cancelled','session_no_show') then 'reminder'
    when p_event_type in ('inactive_seven_days','inactive_fourteen_days','inactive_thirty_days') then 'reactivation'
    when p_event_type in ('pricing_viewed','checkout_started','host_candidate_detected','referral_candidate','referral_signup','testimonial_candidate','technical_issue_resolved') then 'marketing'
    else 'lifecycle'
  end
$$;

create or replace function public.sender_event_is_allowed(p_user_id uuid, p_event_type text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_category text;
  v_preferences public.email_automation_preferences%rowtype;
begin
  if p_event_type = 'subscriber_preferences_updated' then return true; end if;
  if p_user_id is null then return false; end if;

  select * into v_preferences
  from public.email_automation_preferences
  where user_id = p_user_id;
  v_category := public.sender_event_category(p_event_type);

  if not found then return v_category <> 'marketing'; end if;
  if not v_preferences.lifecycle_email_enabled then return false; end if;
  if v_category = 'marketing' then return v_preferences.marketing_email_enabled; end if;
  if v_category = 'weekly' then return v_preferences.weekly_recap_enabled; end if;
  if v_category = 'reminder' then return v_preferences.session_reminders_enabled; end if;
  if v_category = 'reactivation' then return v_preferences.reactivation_email_enabled; end if;
  return true;
end
$$;

revoke all on function public.sender_event_is_allowed(uuid,text) from public, anon, authenticated;
grant execute on function public.sender_event_is_allowed(uuid,text) to service_role;

create or replace function public.sender_user_properties(p_user_id uuid)
returns jsonb language sql security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'user_id', u.id,
    'first_name', coalesce(nullif(split_part(coalesce(p.full_name, u.raw_user_meta_data->>'full_name', u.email), ' ', 1),''),'Friend'),
    'timezone', coalesce(ep.timezone, u.raw_user_meta_data->>'timezone','UTC'),
    'signup_date', u.created_at,
    'plan', coalesce(ue.plan,'free'),
    'lifecycle_email_enabled', coalesce(ep.lifecycle_email_enabled,true),
    'marketing_email_enabled', coalesce(ep.marketing_email_enabled,false),
    'weekly_recap_enabled', coalesce(ep.weekly_recap_enabled,true),
    'session_reminders_enabled', coalesce(ep.session_reminders_enabled,true),
    'reactivation_email_enabled', coalesce(ep.reactivation_email_enabled,true),
    'upgrade_url','https://mysession.club/pricing'
  )
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.user_entitlements ue on ue.user_id = u.id
  left join public.email_automation_preferences ep on ep.user_id = u.id
  where u.id = p_user_id
$$;

revoke all on function public.sender_user_properties(uuid) from public, anon, authenticated;
grant execute on function public.sender_user_properties(uuid) to service_role;

create or replace function public.enqueue_sender_event(
  p_user_id uuid,
  p_email text,
  p_event_type text,
  p_properties jsonb,
  p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  v_id uuid;
  v_category text;
  v_preferences public.email_automation_preferences%rowtype;
begin
  if coalesce(trim(p_email), '') = '' or coalesce(trim(p_idempotency_key), '') = '' then return null; end if;
  select * into v_preferences from public.email_automation_preferences where user_id = p_user_id;
  v_category := public.sender_event_category(p_event_type);

  if found then
    if not v_preferences.lifecycle_email_enabled then return null; end if;
    if v_category = 'marketing' and not v_preferences.marketing_email_enabled then return null; end if;
    if v_category = 'weekly' and not v_preferences.weekly_recap_enabled then return null; end if;
    if v_category = 'reminder' and not v_preferences.session_reminders_enabled then return null; end if;
    if v_category = 'reactivation' and not v_preferences.reactivation_email_enabled then return null; end if;
  elsif v_category = 'marketing' then
    -- No explicit consent means no marketing import/event.
    return null;
  end if;

  insert into public.email_event_outbox(user_id,email,event_type,properties,idempotency_key)
  values (
    p_user_id,
    lower(trim(p_email)),
    p_event_type,
    coalesce(public.sender_user_properties(p_user_id),'{}'::jsonb) || coalesce(p_properties,'{}'::jsonb),
    p_idempotency_key
  )
  on conflict (idempotency_key) do nothing returning id into v_id;
  return v_id;
end
$$;

revoke all on function public.enqueue_sender_event(uuid,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.enqueue_sender_event(uuid,text,text,jsonb,text) to service_role;

create or replace function public.claim_email_event_outbox(p_limit integer default 25)
returns setof public.email_event_outbox
language plpgsql security definer set search_path = public as $$
begin
  update public.email_event_outbox
  set status = 'failed', claimed_at = null, next_attempt_at = now(),
      last_error = coalesce(last_error,'stale_processing_lease_recovered')
  where status = 'processing'
    and (claimed_at is null or claimed_at < now() - interval '15 minutes');

  update public.email_event_outbox
  set status = 'cancelled', claimed_at = null, last_error = 'email_preference_disabled'
  where status in ('pending','failed')
    and not public.sender_event_is_allowed(user_id,event_type);

  return query
  with candidates as (
    select id from public.email_event_outbox
    where status in ('pending','failed') and next_attempt_at <= now()
    order by created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,25),100))
  ), claimed as (
    update public.email_event_outbox e set status = 'processing', claimed_at = now()
    from candidates c where e.id = c.id returning e.*
  ) select * from claimed;
end
$$;

revoke all on function public.claim_email_event_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_email_event_outbox(integer) to service_role;

create or replace function public.on_sender_preferences_changed()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text;
  v_properties jsonb;
begin
  select email into v_email from auth.users where id = new.user_id;
  if coalesce(trim(v_email),'') = '' then return new; end if;

  v_properties := public.sender_user_properties(new.user_id) || jsonb_build_object(
    'lifecycle_email_enabled',new.lifecycle_email_enabled,
    'marketing_email_enabled',new.marketing_email_enabled,
    'weekly_recap_enabled',new.weekly_recap_enabled,
    'session_reminders_enabled',new.session_reminders_enabled,
    'reactivation_email_enabled',new.reactivation_email_enabled,
    'timezone',new.timezone
  );

  insert into public.email_event_outbox(user_id,email,event_type,properties,idempotency_key)
  values (
    new.user_id,
    lower(trim(v_email)),
    'subscriber_preferences_updated',
    v_properties,
    'subscriber_preferences_updated:'||new.user_id||':'||encode(digest(v_properties::text,'sha256'),'hex')
  )
  on conflict (idempotency_key) do nothing;
  return new;
end
$$;

drop trigger if exists sender_preferences_changed on public.email_automation_preferences;
create trigger sender_preferences_changed
after insert or update on public.email_automation_preferences
for each row execute function public.on_sender_preferences_changed();

create or replace function public.on_sender_user_confirmed()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if new.email_confirmed_at is not null and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    perform public.enqueue_sender_event(new.id,new.email,'user_registered',public.sender_user_properties(new.id),'user_registered:'||new.id);
  end if;
  return new;
end
$$;
drop trigger if exists sender_user_confirmed on auth.users;
create trigger sender_user_confirmed after insert or update of email_confirmed_at on auth.users
for each row execute function public.on_sender_user_confirmed();

create or replace function public.on_sender_session_booking()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare v_session record; v_email text; v_properties jsonb;
begin
  select id,title,start_time,duration_minutes,session_format_type into v_session from public.sessions where id = coalesce(new.session_id,old.session_id);
  select email into v_email from auth.users where id = coalesce(new.user_id,old.user_id) and email_confirmed_at is not null;
  v_properties := public.sender_user_properties(coalesce(new.user_id,old.user_id)) || jsonb_build_object(
    'session_id',v_session.id,'session_title',coalesce(v_session.title,'MySession focus session'),
    'session_start',v_session.start_time,'duration_minutes',coalesce(v_session.duration_minutes,0),
    'session_format',coalesce(v_session.session_format_type,'group'),
    'session_url','https://mysession.club/room-livekit/'||v_session.id
  );
  if tg_op = 'INSERT' then
    perform public.enqueue_sender_event(new.user_id,v_email,'session_booked',v_properties,'session_booked:'||new.session_id||':'||new.user_id||':'||new.id);
  else
    perform public.enqueue_sender_event(old.user_id,v_email,'session_cancelled',v_properties,'session_cancelled:'||old.session_id||':'||old.user_id||':'||old.id);
  end if;
  if tg_op = 'INSERT' then return new; end if;
  return old;
end
$$;
drop trigger if exists sender_session_booking on public.session_bookings;
create trigger sender_session_booking after insert or delete on public.session_bookings
for each row execute function public.on_sender_session_booking();

create or replace function public.on_sender_attendance_completed()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare v_email text; v_count integer; v_properties jsonb; v_minutes integer;
begin
  if new.left_at is null or (old.left_at is not null and old.left_at = new.left_at) then return new; end if;
  select email into v_email from auth.users where id = new.user_id and email_confirmed_at is not null;
  select count(*) into v_count from public.session_attendance where user_id = new.user_id;
  v_minutes := greatest(0,floor(extract(epoch from (coalesce(new.left_at,new.last_seen_at,now())-new.joined_at))/60));
  v_properties := public.sender_user_properties(new.user_id) || jsonb_build_object(
    'session_id',new.session_id,'session_count',v_count,'focused_minutes',v_minutes,
    'free_sessions_remaining',greatest(0,15-v_count),'sessions_url','https://mysession.club/sessions'
  );
  perform public.enqueue_sender_event(new.user_id,v_email,'session_completed',v_properties,'session_completed:'||new.session_id||':'||new.user_id);
  if v_count = 1 then perform public.enqueue_sender_event(new.user_id,v_email,'first_session_completed',v_properties,'first_session_completed:'||new.user_id); end if;
  if v_count = 2 then perform public.enqueue_sender_event(new.user_id,v_email,'second_session_completed',v_properties,'second_session_completed:'||new.user_id); end if;
  if v_count = 14 then perform public.enqueue_sender_event(new.user_id,v_email,'free_limit_warning',v_properties,'free_limit_warning:'||new.user_id); end if;
  if v_count >= 15 then perform public.enqueue_sender_event(new.user_id,v_email,'free_limit_reached',v_properties,'free_limit_reached:'||new.user_id); end if;
  return new;
end
$$;
drop trigger if exists sender_attendance_completed on public.session_attendance;
create trigger sender_attendance_completed after update of left_at on public.session_attendance
for each row execute function public.on_sender_attendance_completed();

create or replace function public.evaluate_sender_lifecycle_events()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_enqueued integer := 0; r record; v_last_seen timestamptz; v_stage integer; v_event_type text; v_key text; v_props jsonb;
begin
  -- Registration stalled after six hours with no booking or attendance.
  for r in select u.id,u.email,u.created_at from auth.users u where u.email_confirmed_at is not null and u.created_at <= now()-interval '6 hours' loop
    if not exists(select 1 from public.session_bookings b where b.user_id=r.id) and not exists(select 1 from public.session_attendance a where a.user_id=r.id) then
      if public.enqueue_sender_event(r.id,r.email,'registration_stalled',public.sender_user_properties(r.id),'registration_stalled:'||r.id) is not null then v_enqueued:=v_enqueued+1; end if;
    end if;
  end loop;

  -- No-show two hours after the scheduled session end.
  for r in
    select b.id booking_id,b.user_id,b.session_id,u.email,s.title,s.start_time,coalesce(s.duration_minutes,60) duration_minutes
    from public.session_bookings b join public.sessions s on s.id=b.session_id join auth.users u on u.id=b.user_id
    where s.start_time + make_interval(mins=>coalesce(s.duration_minutes,60)) between now()-interval '30 hours' and now()-interval '2 hours'
      and not exists(select 1 from public.session_attendance a where a.session_id=b.session_id and a.user_id=b.user_id)
  loop
    v_props:=public.sender_user_properties(r.user_id)||jsonb_build_object('session_id',r.session_id,'session_title',r.title,'session_start',r.start_time,'sessions_url','https://mysession.club/sessions');
    if public.enqueue_sender_event(r.user_id,r.email,'session_no_show',v_props,'session_no_show:'||r.booking_id) is not null then v_enqueued:=v_enqueued+1; end if;
  end loop;

  -- Inactivity stages reset naturally when last_seen_at changes because it is part of the key.
  for r in select u.id,u.email,u.created_at from auth.users u where u.email_confirmed_at is not null loop
    select max(coalesce(a.last_seen_at,a.left_at,a.joined_at)) into v_last_seen from public.session_attendance a where a.user_id=r.id;
    if v_last_seen is null then continue; end if;
    v_stage:=case when v_last_seen<=now()-interval '30 days' then 30 when v_last_seen<=now()-interval '14 days' then 14 when v_last_seen<=now()-interval '7 days' then 7 else 0 end;
    if v_stage>0 then
      v_event_type:=case v_stage when 30 then 'inactive_thirty_days' when 14 then 'inactive_fourteen_days' else 'inactive_seven_days' end;
      v_key:=v_event_type||':'||r.id||':'||to_char(v_last_seen,'YYYYMMDDHH24MI');
      if public.enqueue_sender_event(r.id,r.email,v_event_type,public.sender_user_properties(r.id)||jsonb_build_object('last_active_at',v_last_seen,'sessions_url','https://mysession.club/sessions'),v_key) is not null then v_enqueued:=v_enqueued+1; end if;
    end if;
  end loop;

  -- Trial ending in 24-48 hours.
  for r in select u.id,u.email,e.trial_ends_at from public.user_entitlements e join auth.users u on u.id=e.user_id where e.status='trialing' and e.trial_ends_at between now()+interval '24 hours' and now()+interval '48 hours' loop
    if public.enqueue_sender_event(r.id,r.email,'trial_ending_forty_eight_hours',public.sender_user_properties(r.id)||jsonb_build_object('trial_ends_at',r.trial_ends_at,'upgrade_url','https://mysession.club/pricing'),'trial_ending_forty_eight_hours:'||r.id||':'||r.trial_ends_at::date) is not null then v_enqueued:=v_enqueued+1; end if;
  end loop;

  -- Weekly recap for users active in the last seven days.
  for r in
    select u.id,u.email,count(distinct a.session_id) session_count,
      greatest(0,floor(sum(extract(epoch from (coalesce(a.left_at,a.last_seen_at)-a.joined_at)))/60)) focused_minutes
    from auth.users u join public.session_attendance a on a.user_id=u.id
    where u.email_confirmed_at is not null and a.joined_at>=now()-interval '7 days'
    group by u.id,u.email
  loop
    if public.enqueue_sender_event(r.id,r.email,'weekly_recap_ready',public.sender_user_properties(r.id)||jsonb_build_object('session_count',r.session_count,'focused_minutes',r.focused_minutes,'week_start',date_trunc('week',now())::date,'sessions_url','https://mysession.club/sessions'),'weekly_recap:'||r.id||':'||date_trunc('week',now())::date) is not null then v_enqueued:=v_enqueued+1; end if;
  end loop;
  return jsonb_build_object('enqueued',v_enqueued,'evaluated_at',now());
end
$$;

revoke all on function public.evaluate_sender_lifecycle_events() from public, anon, authenticated;
grant execute on function public.evaluate_sender_lifecycle_events() to service_role;
