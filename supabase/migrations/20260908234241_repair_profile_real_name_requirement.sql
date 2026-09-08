alter table public.profiles
  add column if not exists real_name_required boolean not null default false,
  add column if not exists real_name_required_at timestamptz,
  add column if not exists real_name_required_by uuid references auth.users(id) on delete set null;

comment on column public.profiles.real_name_required is
  'When true, the user must replace their current profile name with a real first name.';

create or replace function public.admin_require_real_name(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_user_id uuid := (select auth.uid());
begin
  if v_admin_user_id is null or not public.is_app_admin() then
    raise exception 'admin_required';
  end if;

  update public.profiles
  set real_name_required = true,
      real_name_required_at = now(),
      real_name_required_by = v_admin_user_id,
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.admin_require_real_name(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_require_real_name(uuid)
  to authenticated;
