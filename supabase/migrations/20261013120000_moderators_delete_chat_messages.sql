-- Let room moderators remove messages from a session's public chat.
--
-- Allowed: app super-admins (public.is_app_admin()), the session host, the
-- active temporary host of an infinite room, and users assigned the
-- "moderator" role for that session. Only public (non-direct) messages; each
-- person can still delete their own messages through the existing policy.
--
-- SECURITY DEFINER so it does not depend on the table's own RLS policies,
-- which live outside these migrations. The caller is checked here instead.
-- Variables take their column types via %TYPE so comparisons work whether ids
-- are stored as uuid or text, and still use the primary-key index.

create or replace function public.moderate_delete_chat_message(p_message_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_message_id public.session_chat_messages.id%type;
  v_session_id public.session_chat_messages.session_id%type;
  v_scope text;
  v_session_key public.sessions.id%type;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  v_message_id := p_message_id;

  select m.session_id, coalesce(m.scope, 'general')
    into v_session_id, v_scope
  from public.session_chat_messages m
  where m.id = v_message_id;

  if not found then
    -- Already gone (for example deleted by its author): nothing to do.
    return false;
  end if;

  if v_scope = 'direct' then
    raise exception 'direct_messages_not_moderated' using errcode = '42501';
  end if;

  v_session_key := v_session_id::text;

  if not (
    public.is_app_admin()
    or exists (
      select 1 from public.sessions s
      where s.id = v_session_key and s.host_id::text = v_uid::text
    )
    or exists (
      select 1 from public.session_role_assignments r
      where r.session_id::text = v_session_id::text
        and r.user_id::text = v_uid::text
        and r.role = 'moderator'
    )
    or exists (
      select 1 from public.infinite_room_host_leases h
      where h.session_id::text = v_session_id::text
        and h.user_id::text = v_uid::text
        and h.expires_at > now()
    )
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  delete from public.session_chat_message_reactions where message_id::text = v_message_id::text;
  delete from public.session_chat_messages where id = v_message_id;
  return true;
end;
$$;

revoke all on function public.moderate_delete_chat_message(text) from public, anon;
grant execute on function public.moderate_delete_chat_message(text) to authenticated;
