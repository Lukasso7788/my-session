-- Let authenticated MySession admins review every room report in the admin UI.
-- Report creation continues to go through the server-side service-role endpoint.
alter table public.session_reports enable row level security;

drop policy if exists "App admins can read session reports"
  on public.session_reports;

create policy "App admins can read session reports"
  on public.session_reports
  for select
  to authenticated
  using (public.is_app_admin());

grant select on table public.session_reports to authenticated;
