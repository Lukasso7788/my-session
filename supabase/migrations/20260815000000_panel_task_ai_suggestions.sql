alter table public.panel_intentions
  add column if not exists ai_suggestion jsonb,
  add column if not exists ai_suggestion_for_text text,
  add column if not exists ai_suggestion_updated_at timestamptz;

comment on column public.panel_intentions.ai_suggestion is
  'Last generated paid AI suggestion for this task.';
comment on column public.panel_intentions.ai_suggestion_for_text is
  'Exact task text used to generate ai_suggestion; mismatches invalidate the cache.';