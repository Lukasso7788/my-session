create table if not exists public.focus_shield_saved_lists (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  constraint focus_shield_saved_lists_id_length check (char_length(id) between 1 and 80),
  constraint focus_shield_saved_lists_name_length check (char_length(name) between 1 and 80),
  constraint focus_shield_saved_lists_configuration_object check (jsonb_typeof(configuration) = 'object')
);

create index if not exists focus_shield_saved_lists_user_updated_idx
  on public.focus_shield_saved_lists (user_id, updated_at desc);

alter table public.focus_shield_saved_lists enable row level security;

drop policy if exists "focus_shield_saved_lists_select_own" on public.focus_shield_saved_lists;
create policy "focus_shield_saved_lists_select_own"
  on public.focus_shield_saved_lists
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "focus_shield_saved_lists_insert_own" on public.focus_shield_saved_lists;
create policy "focus_shield_saved_lists_insert_own"
  on public.focus_shield_saved_lists
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "focus_shield_saved_lists_update_own" on public.focus_shield_saved_lists;
create policy "focus_shield_saved_lists_update_own"
  on public.focus_shield_saved_lists
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "focus_shield_saved_lists_delete_own" on public.focus_shield_saved_lists;
create policy "focus_shield_saved_lists_delete_own"
  on public.focus_shield_saved_lists
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete
  on table public.focus_shield_saved_lists
  to authenticated;
