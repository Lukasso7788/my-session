-- Free Flow cleanup closes abandoned rooms by setting sessions.status to
-- 'cancelled'. Preserve the current sessions_status_check expression and
-- extend it with the cancelled terminal status instead of hard-coding the
-- existing status list, so this migration is safe if production has gained
-- additional valid statuses outside the original schema migration.

do $$
declare
  current_check_expression text;
begin
  select pg_get_expr(c.conbin, c.conrelid)
    into current_check_expression
  from pg_constraint c
  where c.conrelid = 'public.sessions'::regclass
    and c.conname = 'sessions_status_check'
    and c.contype = 'c';

  if current_check_expression is null then
    raise exception 'sessions_status_check was not found on public.sessions';
  end if;

  -- If cancelled is already explicitly allowed, leave the constraint alone.
  if position('''cancelled''' in lower(current_check_expression)) = 0 then
    alter table public.sessions
      drop constraint sessions_status_check;

    execute format(
      'alter table public.sessions add constraint sessions_status_check check ((status = %L) or (%s))',
      'cancelled',
      current_check_expression
    );
  end if;
end;
$$;

notify pgrst, 'reload schema';
