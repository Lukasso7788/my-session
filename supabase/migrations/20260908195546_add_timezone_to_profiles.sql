alter table public.profiles
  add column if not exists timezone text;

update public.profiles as profile
set timezone = coalesce(
  (
    select timezone_name.name
    from pg_timezone_names as timezone_name
    where timezone_name.name = coalesce(
      nullif(trim(auth_user.raw_user_meta_data->>'timezone'), ''),
      nullif(trim(auth_user.raw_user_meta_data->>'time_zone'), ''),
      nullif(trim(auth_user.raw_user_meta_data->>'timeZone'), ''),
      nullif(trim(auth_user.raw_user_meta_data->>'tz'), '')
    )
    limit 1
  ),
  'UTC'
)
from auth.users as auth_user
where auth_user.id = profile.id
  and nullif(trim(profile.timezone), '') is null;

update public.profiles
set timezone = 'UTC'
where nullif(trim(timezone), '') is null;

alter table public.profiles
  alter column timezone set default 'UTC',
  alter column timezone set not null;

comment on column public.profiles.timezone is
  'User-selected IANA timezone used for profile display, scheduling, reminders, and attendance.';
