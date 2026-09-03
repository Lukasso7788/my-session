-- Optional per-list emoji for the redesigned Tasks sidebar.
alter table public.focus_plans
  add column if not exists emoji text;

comment on column public.focus_plans.emoji is
  'Optional emoji displayed next to the task list in the Tasks sidebar.';
