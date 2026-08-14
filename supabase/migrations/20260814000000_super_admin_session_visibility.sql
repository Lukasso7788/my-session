-- Super-admin-only catalog visibility for sessions.
-- Hidden sessions stay readable by id, so existing direct room links continue
-- to work. Client catalogs and public profile lists omit them.

alter table public.sessions
  add column if not exists is_hidden boolean not null default false;

create index if not exists sessions_visible_catalog_idx
  on public.sessions (session_format_type, start_time)
  where is_hidden = false;

create or replace function public.set_session_catalog_visibility(
  p_session_id uuid,
  p_hidden boolean
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

  update public.sessions
  set is_hidden = coalesce(p_hidden, false)
  where id = p_session_id;

  if not found then
    raise exception 'session_not_found';
  end if;

  return coalesce(p_hidden, false);
end;
$$;

revoke all on function public.set_session_catalog_visibility(uuid, boolean)
  from public, anon;
grant execute on function public.set_session_catalog_visibility(uuid, boolean)
  to authenticated;

-- Hidden infinite rooms must not be promoted by the Discord presence worker.
create or replace function public.get_active_infinite_rooms_for_discord(
  min_participants integer default 2,
  active_window_seconds integer default 90
)
returns table (
  session_id uuid,
  title text,
  participant_count bigint,
  is_private boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id as session_id,
    coalesce(nullif(trim(s.title), ''), 'Focus room') as title,
    count(distinct a.user_id) as participant_count,
    coalesce(s.is_private, false) as is_private
  from public.sessions s
  join public.session_attendance a on a.session_id = s.id
  where
    coalesce(s.is_private, false) = false
    and coalesce(s.is_hidden, false) = false
    and a.left_at is null
    and a.last_seen_at >= now() - make_interval(
      secs => greatest(30, least(coalesce(active_window_seconds, 90), 600))
    )
    and (
      lower(coalesce(s.session_format_type, '')) = 'infinite'
      or lower(coalesce(s.format, '')) = 'infinite'
      or coalesce(s.schedule ->> 'kind', '') = 'infinite_room'
      or jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array'
      or jsonb_typeof(s.schedule -> 'phases') = 'array'
    )
  group by s.id, s.title, s.is_private
  having count(distinct a.user_id) >= greatest(1, least(coalesce(min_participants, 2), 100))
  order by participant_count desc, s.id;
$$;

revoke all on function public.get_active_infinite_rooms_for_discord(integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_active_infinite_rooms_for_discord(integer, integer)
  to service_role;
