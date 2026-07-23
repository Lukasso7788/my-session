-- Super-admin is a server-verified role. The UI consumes is_app_admin(), while
-- RLS remains the final authority for editing/deleting sessions.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.admin_users (user_id)
select '0b4d80c8-0c06-47a4-82ab-f2e0cea1e3f0'::uuid
where not exists (
  select 1
  from public.admin_users
  where user_id = '0b4d80c8-0c06-47a4-82ab-f2e0cea1e3f0'::uuid
);

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to authenticated;

drop policy if exists "App admins can read every session" on public.sessions;
create policy "App admins can read every session"
  on public.sessions
  for select
  to authenticated
  using (public.is_app_admin());

drop policy if exists "App admins can update every session" on public.sessions;
create policy "App admins can update every session"
  on public.sessions
  for update
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists "App admins can delete every session" on public.sessions;
create policy "App admins can delete every session"
  on public.sessions
  for delete
  to authenticated
  using (public.is_app_admin());

-- Run this after creating the MySession user in Supabase Authentication. It
-- deliberately requires a real Auth/Profile row instead of fabricating one.
create or replace function public.assign_mysession_infinite_room_ownership(
  p_mysession_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if auth.uid() is null and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'admin_required';
  end if;

  if auth.uid() is not null and not public.is_app_admin() then
    raise exception 'admin_required';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = p_mysession_user_id
  ) then
    raise exception 'mysession_profile_not_found';
  end if;

  update public.profiles
  set full_name = 'MySession'
  where id = p_mysession_user_id;

  update public.sessions s
  set host_id = p_mysession_user_id,
      host_name = 'MySession'
  where lower(coalesce(s.session_format_type, '')) = 'infinite'
     or lower(coalesce(s.format, '')) = 'infinite'
     or coalesce(s.schedule ->> 'kind', '') = 'infinite_room'
     or jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array'
     or jsonb_typeof(s.schedule -> 'phases') = 'array';

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.assign_mysession_infinite_room_ownership(uuid) from public, anon;
grant execute on function public.assign_mysession_infinite_room_ownership(uuid) to authenticated;
