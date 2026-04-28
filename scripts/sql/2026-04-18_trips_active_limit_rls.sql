-- Enforce max 1 active trip per user via RLS policy on INSERT
-- Free users: 1 active trip. Plus users: unlimited (tripLimit = null handled client-side).
-- This policy blocks the insert at the DB level when the user already has >= 1 active trip.

begin;

-- Drop old insert policy if it exists, replace with limit-aware version
drop policy if exists trips_insert_own on public.trips;

create policy trips_insert_own on public.trips
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      -- Allow if the user has fewer than 1 active trip currently
      (select count(*) from public.trips t2
       where t2.user_id = auth.uid() and t2.status = 'active') < 1
    )
  );

commit;
