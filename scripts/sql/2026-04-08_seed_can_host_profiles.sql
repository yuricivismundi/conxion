-- Seed can_host = true on several real (non-test) profiles.
-- Picks the first 8 profiles ordered by created_at.
-- Safe to run multiple times.

update public.profiles
set
  can_host       = true,
  hosting_status = 'active',
  max_guests     = 2
where user_id in (
  select user_id
  from public.profiles
  where coalesce(is_test, false) = false
  order by created_at nulls last, user_id
  limit 8
);
