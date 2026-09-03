-- Recurring Tasks for MySession.
-- A recurring template materializes into focus_plan_items and panel_intentions
-- when the user opens Tasks. This avoids requiring a background scheduler while
-- still keeping the Tasks panel synchronized across sessions.

create extension if not exists pgcrypto;

create table if not exists public.recurring_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.focus_plans(id) on delete set null,
  text text not null check (length(btrim(text)) > 0),
  interval_value integer not null default 1 check (interval_value >= 1),
  interval_unit text not null default 'day' check (interval_unit in ('day', 'week', 'month', 'year')),
  starts_on date not null default current_date,
  next_run_on date not null default current_date,
  last_generated_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_tasks_max_interval check (
    (interval_unit = 'day' and interval_value <= 365)
    or (interval_unit = 'week' and interval_value <= 52)
    or (interval_unit = 'month' and interval_value <= 12)
    or (interval_unit = 'year' and interval_value = 1)
  )
);

create index if not exists recurring_tasks_user_next_idx
  on public.recurring_tasks (user_id, active, next_run_on);

alter table public.recurring_tasks enable row level security;

drop policy if exists "Users can read own recurring tasks" on public.recurring_tasks;
create policy "Users can read own recurring tasks"
  on public.recurring_tasks for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own recurring tasks" on public.recurring_tasks;
create policy "Users can create own recurring tasks"
  on public.recurring_tasks for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own recurring tasks" on public.recurring_tasks;
create policy "Users can update own recurring tasks"
  on public.recurring_tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own recurring tasks" on public.recurring_tasks;
create policy "Users can delete own recurring tasks"
  on public.recurring_tasks for delete
  using (auth.uid() = user_id);

create or replace function public.touch_recurring_tasks_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists recurring_tasks_touch_updated_at on public.recurring_tasks;
create trigger recurring_tasks_touch_updated_at
before update on public.recurring_tasks
for each row execute function public.touch_recurring_tasks_updated_at();

-- Link generated task instances back to their recurring template. These columns
-- are additive and ignored by older clients.
alter table public.focus_plan_items
  add column if not exists recurring_task_id uuid references public.recurring_tasks(id) on delete set null,
  add column if not exists recurrence_date date;

create unique index if not exists focus_plan_items_recurring_occurrence_unique
  on public.focus_plan_items (recurring_task_id, recurrence_date)
  where recurring_task_id is not null and recurrence_date is not null;

create or replace function public.recurring_task_next_date(
  p_from date,
  p_value integer,
  p_unit text
)
returns date
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_unit = 'day' then
    return p_from + greatest(1, p_value);
  elsif p_unit = 'week' then
    return p_from + (greatest(1, p_value) * 7);
  elsif p_unit = 'month' then
    return (p_from + make_interval(months => greatest(1, p_value)))::date;
  elsif p_unit = 'year' then
    return (p_from + make_interval(years => greatest(1, p_value)))::date;
  end if;
  raise exception 'Unsupported recurring task interval unit: %', p_unit;
end;
$$;

create or replace function public.materialize_recurring_tasks()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_template public.recurring_tasks%rowtype;
  v_plan_id uuid;
  v_item_id uuid;
  v_next date;
  v_sort integer;
  v_generated integer := 0;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  for v_template in
    select *
    from public.recurring_tasks
    where user_id = v_user_id
      and active = true
      and next_run_on <= current_date
    order by next_run_on asc, created_at asc
    for update
  loop
    v_item_id := null;
    v_plan_id := v_template.plan_id;

    if v_plan_id is null or not exists (
      select 1 from public.focus_plans p
      where p.id = v_plan_id and p.user_id = v_user_id
    ) then
      select p.id into v_plan_id
      from public.focus_plans p
      where p.user_id = v_user_id
      order by p.updated_at desc nulls last, p.created_at asc
      limit 1;
    end if;

    -- A recurring template cannot materialize until it has a destination list.
    if v_plan_id is not null then
      select coalesce(max(i.sort_order), -1) + 1 into v_sort
      from public.focus_plan_items i
      where i.user_id = v_user_id and i.plan_id = v_plan_id;

      insert into public.focus_plan_items (
        user_id,
        plan_id,
        text,
        target_date,
        session_id,
        completed,
        sort_order,
        recurring_task_id,
        recurrence_date
      )
      values (
        v_user_id,
        v_plan_id,
        v_template.text,
        current_date,
        null,
        false,
        v_sort,
        v_template.id,
        current_date
      )
      on conflict (recurring_task_id, recurrence_date)
        where recurring_task_id is not null and recurrence_date is not null
      do nothing
      returning id into v_item_id;

      if v_item_id is not null then
        insert into public.panel_intentions (
          user_id,
          text,
          focus_plan_item_id,
          completed,
          visibility,
          sort_order
        )
        values (
          v_user_id,
          v_template.text,
          v_item_id,
          false,
          'public',
          v_sort
        );
        v_generated := v_generated + 1;
      end if;
    end if;

    if v_plan_id is not null then
      -- Skip missed historical copies. If a user comes back after a week, one
      -- current task appears, then the schedule advances to the next future date.
      v_next := v_template.next_run_on;
      loop
        v_next := public.recurring_task_next_date(
          v_next,
          v_template.interval_value,
          v_template.interval_unit
        );
        exit when v_next > current_date;
      end loop;

      update public.recurring_tasks
      set
        plan_id = v_plan_id,
        last_generated_on = current_date,
        next_run_on = v_next
      where id = v_template.id and user_id = v_user_id;
    end if;
  end loop;

  return v_generated;
end;
$$;

revoke all on function public.materialize_recurring_tasks() from public;
grant execute on function public.materialize_recurring_tasks() to authenticated;

-- Keep completion state aligned in both directions. This makes the virtual
-- Completed Tasks list truly global for task-list items even when completion
-- happens inside the cross-session Tasks panel.
create or replace function public.sync_panel_completion_to_focus_item()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.focus_plan_item_id is not null
     and new.completed is distinct from old.completed then
    update public.focus_plan_items
    set completed = new.completed
    where id = new.focus_plan_item_id
      and user_id = new.user_id
      and completed is distinct from new.completed;
  end if;
  return new;
end;
$$;

drop trigger if exists panel_completion_to_focus_item on public.panel_intentions;
create trigger panel_completion_to_focus_item
after update of completed on public.panel_intentions
for each row
when (old.completed is distinct from new.completed)
execute function public.sync_panel_completion_to_focus_item();

create or replace function public.sync_focus_item_completion_to_panel()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.panel_intentions
  set completed = new.completed
  where focus_plan_item_id = new.id
    and user_id = new.user_id
    and completed is distinct from new.completed;
  return new;
end;
$$;

drop trigger if exists focus_item_completion_to_panel on public.focus_plan_items;
create trigger focus_item_completion_to_panel
after update of completed on public.focus_plan_items
for each row
when (old.completed is distinct from new.completed)
execute function public.sync_focus_item_completion_to_panel();
