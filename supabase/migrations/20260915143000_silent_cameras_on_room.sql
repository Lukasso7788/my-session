begin;

-- Silent rooms keep video accountability while permanently disabling
-- participant microphone publication at the LiveKit token level.
alter table public.sessions
  add column if not exists microphone_locked boolean not null default false;

comment on column public.sessions.microphone_locked is
  'When enabled, participants cannot publish microphone or screen-share audio tracks.';

-- Preserve the policy if it was already written only into schedule JSON.
update public.sessions
set microphone_locked = true
where coalesce(schedule #>> '{room_policies,microphone_locked}', 'false') = 'true'
  and microphone_locked = false;

do $$
declare
  v_owner_id uuid := 'ccdfa263-9c1f-4cb0-a9c1-b57f41b191bc'::uuid;
  v_session_id uuid;
  v_schedule jsonb := jsonb_build_object(
    'kind', 'infinite_room',
    'variant', 'silent_cameras_on',
    'room_policies', jsonb_build_object(
      'camera_required', true,
      'public_chat_disabled', false,
      'microphone_locked', true
    )
  );
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = v_owner_id
  ) then
    raise exception 'mysession_profile_not_found';
  end if;

  select s.id
    into v_session_id
  from public.sessions s
  where coalesce(s.schedule ->> 'variant', '') = 'silent_cameras_on'
  order by s.created_at asc nulls last, s.id
  limit 1;

  if v_session_id is null then
    insert into public.sessions (
      title,
      description,
      host_id,
      host_name,
      start_time,
      duration_minutes,
      format,
      schedule,
      status,
      session_format_type,
      max_participants,
      is_private,
      is_hidden,
      camera_required,
      public_chat_disabled,
      microphone_locked
    ) values (
      'Silent · Cameras On 24/7',
      'Silent coworking room open 24/7. Keep your camera on for presence and accountability. Microphones are permanently disabled — join anytime, set your intention, and focus alongside others.',
      v_owner_id,
      'MySession',
      now(),
      1440,
      'infinite',
      v_schedule,
      'active',
      'infinite',
      16,
      false,
      false,
      true,
      false,
      true
    );
  else
    update public.sessions
    set
      title = 'Silent · Cameras On 24/7',
      description = 'Silent coworking room open 24/7. Keep your camera on for presence and accountability. Microphones are permanently disabled — join anytime, set your intention, and focus alongside others.',
      host_id = v_owner_id,
      host_name = 'MySession',
      start_time = least(coalesce(start_time, now()), now()),
      duration_minutes = 1440,
      format = 'infinite',
      schedule = v_schedule,
      status = 'active',
      session_format_type = 'infinite',
      max_participants = 16,
      is_private = false,
      is_hidden = false,
      camera_required = true,
      public_chat_disabled = false,
      microphone_locked = true
    where id = v_session_id;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
