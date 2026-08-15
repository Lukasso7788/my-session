begin;

alter table public.sessions
  add column if not exists camera_required boolean not null default false,
  add column if not exists public_chat_disabled boolean not null default false;

comment on column public.sessions.camera_required is
  'When enabled, non-host participants are warned twice and disconnected if their camera remains off.';

comment on column public.sessions.public_chat_disabled is
  'When enabled, general room chat is disabled while participant-to-host DMs remain available.';

-- Preserve policies that were already stored in schedule.room_policies by the
-- first frontend implementation.
update public.sessions
set camera_required = true
where coalesce(schedule #>> '{room_policies,camera_required}', 'false') = 'true'
  and camera_required = false;

update public.sessions
set public_chat_disabled = true
where coalesce(schedule #>> '{room_policies,public_chat_disabled}', 'false') = 'true'
  and public_chat_disabled = false;

commit;