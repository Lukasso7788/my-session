begin;

update public.sessions
set title = '🤫 Silent Room - 24/7'
where coalesce(schedule ->> 'variant', '') = 'silent_cameras_on'
   or lower(coalesce(custom_slug, '')) = 'silentroom';

commit;
