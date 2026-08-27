-- One authoritative eligibility check for Infinite room creation.

create or replace function public.get_infinite_room_creator_eligibility()
returns table (
  attended_count bigint,
  hosted_count bigint,
  eligible boolean
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_attended bigint := 0;
  v_hosted bigint := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_attended := public.calculate_lifetime_session_count(v_user_id);

  select count(*)
    into v_hosted
  from public.sessions s
  where s.host_id = v_user_id
    and coalesce(s.status, 'active') not in ('cancelled', 'deleted');

  return query
  select
    coalesce(v_attended, 0),
    coalesce(v_hosted, 0),
    coalesce(v_attended, 0) >= 50 and coalesce(v_hosted, 0) >= 5;
end;
$$;

revoke all on function public.get_infinite_room_creator_eligibility()
  from public, anon;
grant execute on function public.get_infinite_room_creator_eligibility()
  to authenticated, service_role;

notify pgrst, 'reload schema';
