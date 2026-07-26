create table if not exists public.focus_shield_policies (
  user_id uuid primary key references auth.users(id) on delete cascade,
  policy jsonb not null default '{}'::jsonb,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.focus_shield_policies enable row level security;

drop policy if exists "focus_shield_policy_select_own" on public.focus_shield_policies;
create policy "focus_shield_policy_select_own"
on public.focus_shield_policies for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "focus_shield_policy_insert_own" on public.focus_shield_policies;
create policy "focus_shield_policy_insert_own"
on public.focus_shield_policies for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "focus_shield_policy_update_own" on public.focus_shield_policies;
create policy "focus_shield_policy_update_own"
on public.focus_shield_policies for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.touch_focus_shield_policy_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists focus_shield_policy_touch_updated_at on public.focus_shield_policies;
create trigger focus_shield_policy_touch_updated_at
before update on public.focus_shield_policies
for each row execute function public.touch_focus_shield_policy_updated_at();

grant select, insert, update on public.focus_shield_policies to authenticated;
