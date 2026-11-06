-- Public sessions can be created only by people who have attended at least 10
-- sessions (the canonical lifetime count, calculate_lifetime_session_count).
-- Private sessions (is_private = true, direct link only) are open to everyone.
-- Admins are exempt. Server-side inserts (service role, auth.uid() is null),
-- such as 1:1 partner sessions from api/livekit/admin.ts, are not affected.
-- Existing sessions are not changed. Mirrors src/lib/hostingEligibility.ts.

create or replace function public.enforce_public_session_host_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_attended bigint;
begin
  if v_user_id is null or coalesce(new.is_private, false) then
    return new;
  end if;
  -- Only creating a public session or making a private one public is
  -- checked; an update that leaves a public session public is not.
  if tg_op = 'UPDATE' and coalesce(old.is_private, false) = false then
    return new;
  end if;
  if public.is_app_admin() then
    return new;
  end if;

  v_attended := coalesce(public.calculate_lifetime_session_count(v_user_id), 0);
  if v_attended < 10 then
    raise exception 'Public sessions open after 10 attended sessions (you have %).', v_attended
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_public_session_host_attendance() from public, anon, authenticated;

drop trigger if exists enforce_public_session_host_attendance on public.sessions;
create trigger enforce_public_session_host_attendance
  before insert or update of is_private on public.sessions
  for each row execute function public.enforce_public_session_host_attendance();
