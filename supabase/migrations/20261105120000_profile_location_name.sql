-- Optional, self-chosen place shown on profiles. Independent of timezone
-- (which stays required) and of country_code (detected, used for pricing).
alter table public.profiles
  add column if not exists location_name text;

alter table public.profiles
  drop constraint if exists profiles_location_name_length;

alter table public.profiles
  add constraint profiles_location_name_length
  check (location_name is null or char_length(location_name) between 1 and 160);

comment on column public.profiles.location_name is
  'Optional place the member chose to show (any settlement). Not derived from timezone.';
