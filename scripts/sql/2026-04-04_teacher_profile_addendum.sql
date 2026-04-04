begin;

-- ---------------------------------------------------------------------------
-- teacher_profiles: add availability_tags and base_country
-- ---------------------------------------------------------------------------

alter table public.teacher_profiles
  add column if not exists availability_tags  text[] not null default '{}',
  add column if not exists base_country       text null;

-- ---------------------------------------------------------------------------
-- teacher_regular_classes: add country column
-- (venue_name already correct per original migration)
-- ---------------------------------------------------------------------------

alter table public.teacher_regular_classes
  add column if not exists country text null;

commit;
