-- Plunk consumes only events created after an explicit, operator-chosen cutover.
-- Do not replay the historical Sender backlog into newly enabled workflows.
-- The existing Sender RPC and outbox schema are retained for rollback/audit.

create or replace function public.claim_plunk_email_event_outbox(
  p_limit integer,
  p_cutover_at timestamptz
)
returns setof public.email_event_outbox
language plpgsql security definer set search_path = public as $$
begin
  if p_cutover_at is null then
    raise exception 'plunk_cutover_required';
  end if;

  update public.email_event_outbox
  set status = 'failed', claimed_at = null, next_attempt_at = now(),
      last_error = coalesce(last_error, 'stale_processing_lease_recovered')
  where status = 'processing'
    and created_at >= p_cutover_at
    and (claimed_at is null or claimed_at < now() - interval '15 minutes');

  update public.email_event_outbox
  set status = 'cancelled', claimed_at = null,
      last_error = 'email_preference_disabled'
  where status in ('pending', 'failed')
    and created_at >= p_cutover_at
    and not public.sender_event_is_allowed(user_id, event_type);

  return query
  with candidates as (
    select id from public.email_event_outbox
    where status in ('pending', 'failed')
      and created_at >= p_cutover_at
      and next_attempt_at <= now()
    order by created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  ), claimed as (
    update public.email_event_outbox e
    set status = 'processing', claimed_at = now()
    from candidates c where e.id = c.id
    returning e.*
  )
  select * from claimed;
end
$$;

revoke all on function public.claim_plunk_email_event_outbox(integer,timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_plunk_email_event_outbox(integer,timestamptz)
  to service_role;

-- Plunk's unsubscribe page is authoritative for marketing opt-out. This is
-- called only by a Vercel webhook after verifying a server-only shared secret.
create or replace function public.record_plunk_marketing_unsubscribe(p_email text)
returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare
  v_user_id uuid;
begin
  if nullif(trim(coalesce(p_email, '')), '') is null then return false; end if;

  select id into v_user_id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then return false; end if;

  update public.email_automation_preferences
  set marketing_email_enabled = false, updated_at = now()
  where user_id = v_user_id and marketing_email_enabled = true;

  return found;
end
$$;

revoke all on function public.record_plunk_marketing_unsubscribe(text)
  from public, anon, authenticated;
grant execute on function public.record_plunk_marketing_unsubscribe(text)
  to service_role;

-- Only an explicit marketing toggle may change the Plunk subscription bit.
-- A timezone/recap edit must not silently re-subscribe someone who opted out
-- using Plunk's hosted unsubscribe page.
create or replace function public.on_sender_preferences_changed()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text;
  v_properties jsonb;
begin
  select email into v_email from auth.users where id = new.user_id;
  if coalesce(trim(v_email), '') = '' then return new; end if;

  v_properties := public.sender_user_properties(new.user_id) || jsonb_build_object(
    'lifecycle_email_enabled', new.lifecycle_email_enabled,
    'marketing_email_enabled', new.marketing_email_enabled,
    'marketing_consent_changed',
      case when tg_op = 'INSERT' then new.marketing_email_enabled
           else new.marketing_email_enabled is distinct from old.marketing_email_enabled end,
    'weekly_recap_enabled', new.weekly_recap_enabled,
    'session_reminders_enabled', new.session_reminders_enabled,
    'reactivation_email_enabled', new.reactivation_email_enabled,
    'timezone', new.timezone
  );

  insert into public.email_event_outbox(user_id,email,event_type,properties,idempotency_key)
  values (
    new.user_id,
    lower(trim(v_email)),
    'subscriber_preferences_updated',
    v_properties,
    -- Every preference change is a distinct logical event. A content hash
    -- would suppress a later re-opt-in after an opt-out with identical fields.
    'subscriber_preferences_updated:'||new.user_id||':'||gen_random_uuid()
  )
  on conflict (idempotency_key) do nothing;
  return new;
end
$$;

-- The old evaluator would emit first-time inactivity and stalled-signup events
-- for historical users on its first run. A new cutover-aware evaluator avoids
-- that mass backfill; intentional historical campaigns must be separate.
create or replace function public.evaluate_plunk_lifecycle_events(
  p_cutover_at timestamptz
)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_enqueued integer := 0;
  r record;
  v_last_seen timestamptz;
  v_stage integer;
  v_event_type text;
  v_key text;
  v_props jsonb;
begin
  if p_cutover_at is null then raise exception 'plunk_cutover_required'; end if;

  for r in
    select u.id, u.email from auth.users u
    where u.email_confirmed_at is not null
      and u.created_at >= p_cutover_at
      and u.created_at <= now() - interval '6 hours'
  loop
    if not exists(select 1 from public.session_bookings b where b.user_id = r.id)
       and not exists(select 1 from public.session_attendance a where a.user_id = r.id) then
      if public.enqueue_sender_event(r.id, r.email, 'registration_stalled',
        public.sender_user_properties(r.id), 'registration_stalled:'||r.id) is not null then
        v_enqueued := v_enqueued + 1;
      end if;
    end if;
  end loop;

  for r in
    select b.id booking_id, b.user_id, b.session_id, u.email,
      s.title, s.start_time
    from public.session_bookings b
    join public.sessions s on s.id = b.session_id
    join auth.users u on u.id = b.user_id
    where s.start_time >= p_cutover_at
      and s.start_time + make_interval(mins => coalesce(s.duration_minutes, 60))
        between now() - interval '30 hours' and now() - interval '2 hours'
      and not exists(select 1 from public.session_attendance a
        where a.session_id = b.session_id and a.user_id = b.user_id)
  loop
    v_props := public.sender_user_properties(r.user_id) || jsonb_build_object(
      'session_id', r.session_id, 'session_title', r.title,
      'session_start', r.start_time,
      'sessions_url', 'https://mysession.club/sessions');
    if public.enqueue_sender_event(r.user_id, r.email, 'session_no_show',
      v_props, 'session_no_show:'||r.booking_id) is not null then
      v_enqueued := v_enqueued + 1;
    end if;
  end loop;

  for r in
    select u.id, u.email from auth.users u
    where u.email_confirmed_at is not null
  loop
    select max(coalesce(a.last_seen_at, a.left_at, a.joined_at))
      into v_last_seen from public.session_attendance a where a.user_id = r.id;
    if v_last_seen is null or v_last_seen < p_cutover_at then continue; end if;
    v_stage := case when v_last_seen <= now() - interval '30 days' then 30
      when v_last_seen <= now() - interval '14 days' then 14
      when v_last_seen <= now() - interval '7 days' then 7 else 0 end;
    if v_stage > 0 then
      v_event_type := case v_stage when 30 then 'inactive_thirty_days'
        when 14 then 'inactive_fourteen_days' else 'inactive_seven_days' end;
      v_key := v_event_type||':'||r.id||':'||to_char(v_last_seen, 'YYYYMMDDHH24MI');
      if public.enqueue_sender_event(r.id, r.email, v_event_type,
        public.sender_user_properties(r.id) || jsonb_build_object(
          'last_active_at', v_last_seen,
          'sessions_url', 'https://mysession.club/sessions'), v_key) is not null then
        v_enqueued := v_enqueued + 1;
      end if;
    end if;
  end loop;

  for r in
    select u.id, u.email, e.trial_ends_at from public.user_entitlements e
    join auth.users u on u.id = e.user_id
    where e.status = 'trialing'
      and e.trial_ends_at between now() + interval '24 hours' and now() + interval '48 hours'
  loop
    if public.enqueue_sender_event(r.id, r.email,
      'trial_ending_forty_eight_hours', public.sender_user_properties(r.id) ||
      jsonb_build_object('trial_ends_at', r.trial_ends_at,
        'upgrade_url', 'https://mysession.club/pricing'),
      'trial_ending_forty_eight_hours:'||r.id||':'||r.trial_ends_at::date) is not null then
      v_enqueued := v_enqueued + 1;
    end if;
  end loop;

  for r in
    select u.id, u.email, count(distinct a.session_id) session_count,
      greatest(0, floor(sum(extract(epoch from
        (coalesce(a.left_at, a.last_seen_at) - a.joined_at))) / 60)) focused_minutes
    from auth.users u join public.session_attendance a on a.user_id = u.id
    where u.email_confirmed_at is not null
      and p_cutover_at <= now() - interval '7 days'
      and a.joined_at >= greatest(p_cutover_at, now() - interval '7 days')
    group by u.id, u.email
  loop
    if public.enqueue_sender_event(r.id, r.email, 'weekly_recap_ready',
      public.sender_user_properties(r.id) || jsonb_build_object(
        'session_count', r.session_count,
        'focused_minutes', r.focused_minutes,
        'week_start', date_trunc('week', now())::date,
        'sessions_url', 'https://mysession.club/sessions'),
      'weekly_recap:'||r.id||':'||date_trunc('week', now())::date) is not null then
      v_enqueued := v_enqueued + 1;
    end if;
  end loop;

  return jsonb_build_object('enqueued', v_enqueued, 'evaluated_at', now());
end
$$;

revoke all on function public.evaluate_plunk_lifecycle_events(timestamptz)
  from public, anon, authenticated;
grant execute on function public.evaluate_plunk_lifecycle_events(timestamptz)
  to service_role;
