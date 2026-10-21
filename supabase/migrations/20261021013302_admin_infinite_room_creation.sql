-- Preserve the deployed guard (which differs from older repository copies).
-- Only server-managed app admins bypass community eligibility/capacity checks.
-- Timeline validation and session normalization continue to run for admins.
do $migration$
declare
  original text := pg_get_functiondef('public.validate_free_flow_infinite_room()'::regprocedure);
  needle text := 'if tg_op = ''INSERT'' and v_user_id is not null then';
  replacement text := 'if tg_op = ''INSERT'' and v_user_id is not null and not public.is_app_admin() then';
begin
  if position(replacement in original) > 0 then
    return;
  end if;
  if position(needle in original) = 0 then
    raise exception 'Unexpected Free Flow guard definition: review before applying';
  end if;
  execute replace(original, needle, replacement);
end;
$migration$;
