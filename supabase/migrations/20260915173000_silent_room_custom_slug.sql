begin;

do $$
declare
  v_slug text := 'silentroom';
  v_owner_id uuid := 'ccdfa263-9c1f-4cb0-a9c1-b57f41b191bc'::uuid;
  v_session_id uuid;
  v_conflicting_session_id uuid;
  v_registry_owner_id uuid;
  v_registry_owner_type text;
begin
  select s.id
    into v_session_id
  from public.sessions s
  where coalesce(s.schedule ->> 'variant', '') = 'silent_cameras_on'
  order by s.created_at asc nulls last, s.id
  limit 1;

  if v_session_id is null then
    raise exception 'silent_cameras_on_room_not_found';
  end if;

  -- Never steal the requested slug from a different session.
  select s.id
    into v_conflicting_session_id
  from public.sessions s
  where lower(coalesce(s.custom_slug, '')) = v_slug
    and s.id <> v_session_id
  limit 1;

  if v_conflicting_session_id is not null then
    raise exception 'public_slug_already_taken: %', v_slug;
  end if;

  select p.owner_id, p.owner_type
    into v_registry_owner_id, v_registry_owner_type
  from public.public_url_slugs p
  where lower(p.slug) = v_slug
  limit 1;

  if v_registry_owner_id is not null
     and (
       coalesce(v_registry_owner_type, '') <> 'session'
       or v_registry_owner_id <> v_session_id
     ) then
    raise exception 'public_slug_already_taken: %', v_slug;
  end if;

  -- The sessions custom-slug trigger can treat an existing registry row as a
  -- collision even when it already points to this same session. Remove only
  -- this room's own registry row inside the transaction, then recreate it.
  delete from public.public_url_slugs
  where lower(slug) = v_slug
    and owner_type = 'session'
    and owner_id = v_session_id;

  update public.sessions
  set custom_slug = v_slug
  where id = v_session_id
    and custom_slug is distinct from v_slug;

  insert into public.public_url_slugs (
    slug,
    owner_type,
    owner_id,
    host_user_id,
    updated_at
  ) values (
    v_slug,
    'session',
    v_session_id,
    v_owner_id,
    now()
  )
  on conflict (slug) do update
  set
    owner_type = excluded.owner_type,
    owner_id = excluded.owner_id,
    host_user_id = excluded.host_user_id,
    updated_at = excluded.updated_at;
end;
$$;

notify pgrst, 'reload schema';

commit;
