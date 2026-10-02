-- Reduce Supabase write amplification from room attendance heartbeats and
-- improve the hottest chat-reaction read path.
--
-- Goals:
-- 1. Keep the client heartbeat cadence/retry behavior unchanged.
-- 2. Persist session_attendance at most about once per minute while active.
-- 3. Stop mirroring every heartbeat into two analytics-history tables.
-- 4. Preserve join/rejoin/leave history and UTC day boundaries.
-- 5. Reduce auto-analyze churn on the tiny, very frequently updated
--    session_attendance table.
-- 6. Add a covering access path for the high-volume reaction batch query.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.attendance_heartbeat(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
begin
  if v_user_id is null then
    return;
  end if;

  -- Normal active heartbeat. Do not include left_at in the SET list when it is
  -- already NULL. That keeps the hot path eligible for HOT heap updates instead
  -- of unnecessarily touching indexes whose predicates depend on left_at.
  update public.session_attendance
  set last_seen_at = v_now
  where session_id = p_session_id
    and user_id = v_user_id
    and left_at is null
    and (
      last_seen_at is null
      or last_seen_at < v_now - interval '55 seconds'
    );

  if found then
    return;
  end if;

  -- Recovery path only: if a stale row was previously marked as left, revive
  -- it. Normal heartbeats never rewrite left_at.
  update public.session_attendance
  set
    last_seen_at = v_now,
    left_at = null
  where session_id = p_session_id
    and user_id = v_user_id
    and left_at is not null;
end;
$function$;

create or replace function mysession_private.capture_attendance_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_end timestamptz;
  v_new_end timestamptz;
  v_old_seen timestamptz;
  v_new_seen timestamptz;
  v_crossed_utc_day boolean := false;
  v_crossed_checkpoint boolean := false;
begin
  if tg_op = 'INSERT' then
    insert into public.attendance_visit_history (
      source_attendance_id,
      session_id,
      user_id,
      joined_at,
      left_at,
      last_seen_at
    )
    values (
      new.id,
      new.session_id,
      new.user_id,
      new.joined_at,
      new.left_at,
      new.last_seen_at
    )
    on conflict (source_attendance_id, joined_at)
    do update set
      session_id = excluded.session_id,
      user_id = excluded.user_id,
      left_at = excluded.left_at,
      last_seen_at = greatest(
        coalesce(public.attendance_visit_history.last_seen_at, public.attendance_visit_history.joined_at),
        coalesce(excluded.last_seen_at, excluded.left_at, excluded.joined_at)
      ),
      updated_at = now();

    -- A join establishes the daily unique-attendance fact. There is no reason
    -- to write the same daily row again on every heartbeat.
    perform mysession_private.upsert_daily_attendance(new.user_id, new.joined_at);
    return new;
  end if;

  v_old_seen := coalesce(old.last_seen_at, old.left_at, old.joined_at);
  v_new_seen := coalesce(new.last_seen_at, new.left_at, new.joined_at);

  -- A rejoin reuses the live row by changing joined_at. Finalize the previous
  -- visit first, then open the new durable visit.
  if old.joined_at is distinct from new.joined_at then
    v_old_end := coalesce(old.left_at, old.last_seen_at, old.joined_at);

    insert into public.attendance_visit_history (
      source_attendance_id,
      session_id,
      user_id,
      joined_at,
      left_at,
      last_seen_at
    )
    values (
      old.id,
      old.session_id,
      old.user_id,
      old.joined_at,
      old.left_at,
      old.last_seen_at
    )
    on conflict (source_attendance_id, joined_at)
    do update set
      session_id = excluded.session_id,
      user_id = excluded.user_id,
      left_at = coalesce(excluded.left_at, public.attendance_visit_history.left_at),
      last_seen_at = greatest(
        coalesce(public.attendance_visit_history.last_seen_at, public.attendance_visit_history.joined_at),
        coalesce(excluded.last_seen_at, excluded.left_at, excluded.joined_at)
      ),
      updated_at = now();

    perform mysession_private.upsert_daily_attendance(old.user_id, old.joined_at);
    perform mysession_private.upsert_daily_attendance(old.user_id, v_old_end);

    insert into public.attendance_visit_history (
      source_attendance_id,
      session_id,
      user_id,
      joined_at,
      left_at,
      last_seen_at
    )
    values (
      new.id,
      new.session_id,
      new.user_id,
      new.joined_at,
      new.left_at,
      new.last_seen_at
    )
    on conflict (source_attendance_id, joined_at)
    do update set
      session_id = excluded.session_id,
      user_id = excluded.user_id,
      left_at = excluded.left_at,
      last_seen_at = greatest(
        coalesce(public.attendance_visit_history.last_seen_at, public.attendance_visit_history.joined_at),
        coalesce(excluded.last_seen_at, excluded.left_at, excluded.joined_at)
      ),
      updated_at = now();

    perform mysession_private.upsert_daily_attendance(new.user_id, new.joined_at);
    return new;
  end if;

  -- A real leave/recovery transition is important history and should be
  -- persisted immediately.
  if old.left_at is distinct from new.left_at then
    v_new_end := coalesce(new.left_at, new.last_seen_at, new.joined_at);

    insert into public.attendance_visit_history (
      source_attendance_id,
      session_id,
      user_id,
      joined_at,
      left_at,
      last_seen_at
    )
    values (
      new.id,
      new.session_id,
      new.user_id,
      new.joined_at,
      new.left_at,
      new.last_seen_at
    )
    on conflict (source_attendance_id, joined_at)
    do update set
      session_id = excluded.session_id,
      user_id = excluded.user_id,
      left_at = excluded.left_at,
      last_seen_at = greatest(
        coalesce(public.attendance_visit_history.last_seen_at, public.attendance_visit_history.joined_at),
        coalesce(excluded.last_seen_at, excluded.left_at, excluded.joined_at)
      ),
      updated_at = now();

    perform mysession_private.upsert_daily_attendance(new.user_id, new.joined_at);
    perform mysession_private.upsert_daily_attendance(new.user_id, v_new_end);
    return new;
  end if;

  -- Ordinary heartbeats are the hot path. Keep exact live presence in
  -- session_attendance, but only checkpoint the analytics visit every five
  -- minutes. Always checkpoint a UTC day transition so daily unique attendance
  -- remains exact even when someone stays in the room through midnight.
  if old.last_seen_at is distinct from new.last_seen_at then
    if v_old_seen is not null and v_new_seen is not null then
      v_crossed_utc_day :=
        (v_old_seen at time zone 'UTC')::date
        is distinct from
        (v_new_seen at time zone 'UTC')::date;

      v_crossed_checkpoint :=
        floor(extract(epoch from v_old_seen) / 300)
        is distinct from
        floor(extract(epoch from v_new_seen) / 300);
    end if;

    if v_crossed_utc_day then
      perform mysession_private.upsert_daily_attendance(new.user_id, v_new_seen);
    end if;

    if v_crossed_utc_day or v_crossed_checkpoint then
      insert into public.attendance_visit_history (
        source_attendance_id,
        session_id,
        user_id,
        joined_at,
        left_at,
        last_seen_at
      )
      values (
        new.id,
        new.session_id,
        new.user_id,
        new.joined_at,
        new.left_at,
        new.last_seen_at
      )
      on conflict (source_attendance_id, joined_at)
      do update set
        last_seen_at = greatest(
          coalesce(public.attendance_visit_history.last_seen_at, public.attendance_visit_history.joined_at),
          coalesce(excluded.last_seen_at, excluded.joined_at)
        ),
        updated_at = now();
    end if;
  end if;

  return new;
end;
$function$;

-- This table has only a few thousand live rows but historically received
-- millions of heartbeat updates. Its row distribution changes slowly, so the
-- default analyze threshold causes needless repeated ANALYZE work.
alter table public.session_attendance set (
  autovacuum_analyze_threshold = 1000,
  autovacuum_analyze_scale_factor = 0.50
);

-- Chat reaction bootstrap/refetch query:
-- WHERE session_id = ? AND message_id = ANY(?) ORDER BY created_at DESC
create index if not exists session_chat_reactions_session_message_time_idx
  on public.session_chat_message_reactions (
    session_id,
    message_id,
    created_at desc
  );

comment on function public.attendance_heartbeat(uuid) is
  'Presence heartbeat with ~60s write gating to reduce WAL; client may call more frequently for retry safety.';

comment on function mysession_private.capture_attendance_history() is
  'Durable attendance history: immediate join/rejoin/leave/day-boundary writes, 5-minute heartbeat checkpoints.';
