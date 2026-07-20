-- Apply manually in Supabase SQL Editor after the Sender lifecycle migration.
-- Sender/outbox failures must never abort Supabase Auth user confirmation.

create or replace function public.on_sender_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email_confirmed_at is not null
    and (tg_op = 'INSERT' or old.email_confirmed_at is null)
  then
    begin
      perform public.enqueue_sender_event(
        new.id,
        new.email,
        'user_registered',
        public.sender_user_properties(new.id),
        'user_registered:' || new.id
      );
    exception when others then
      raise warning
        'sender_user_confirmed enqueue failed for user %: %',
        new.id,
        sqlerrm;
    end;
  end if;

  return new;
end;
$$;
