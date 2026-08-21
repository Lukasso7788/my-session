alter table public.profiles
  add column if not exists real_name_required boolean not null default false,
  add column if not exists real_name_required_at timestamptz,
  add column if not exists real_name_required_by uuid references auth.users(id) on delete set null;

create or replace function public.admin_require_real_name(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_app_admin() then
    raise exception 'admin_required';
  end if;

  update public.profiles
  set real_name_required = true,
      real_name_required_at = now(),
      real_name_required_by = auth.uid(),
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.admin_require_real_name(uuid) from public, anon;
grant execute on function public.admin_require_real_name(uuid) to authenticated;
