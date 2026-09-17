begin;

alter table public.sessions
  add column if not exists is_pinned boolean not null default false,
  add column if not exists screen_share_required boolean not null default false;

comment on column public.sessions.is_pinned is
  'Super-admin catalog ordering flag for Infinity rooms. No end-user badge is rendered.';

comment on column public.sessions.screen_share_required is
  'When enabled, non-host participants are warned twice and disconnected if screen sharing remains off.';

update public.sessions
set screen_share_required = true
where coalesce(schedule #>> '{room_policies,screen_share_required}', 'false') = 'true'
  and screen_share_required = false;

create index if not exists sessions_infinite_pinned_catalog_idx
  on public.sessions (is_pinned desc, start_time, id)
  where is_hidden = false;

create or replace function public.set_infinite_room_catalog_pinned(
  p_session_id uuid,
  p_pinned boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_app_admin() then
    raise exception 'admin_required';
  end if;

  update public.sessions s
  set is_pinned = coalesce(p_pinned, false)
  where s.id = p_session_id
    and (
      lower(coalesce(s.session_format_type, '')) = 'infinite'
      or lower(coalesce(s.format, '')) = 'infinite'
      or coalesce(s.schedule ->> 'kind', '') = 'infinite_room'
      or jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array'
      or jsonb_typeof(s.schedule -> 'phases') = 'array'
    );

  if not found then
    raise exception 'infinite_session_not_found';
  end if;

  return coalesce(p_pinned, false);
end;
$$;

revoke all on function public.set_infinite_room_catalog_pinned(uuid, boolean)
  from public, anon;
grant execute on function public.set_infinite_room_catalog_pinned(uuid, boolean)
  to authenticated;

notify pgrst, 'reload schema';

commit;
