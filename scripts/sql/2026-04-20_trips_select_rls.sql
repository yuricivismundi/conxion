-- Add SELECT policies for trips table.
-- Owner can always read their own trip.
-- Accepted trip_request participants can also read the trip (needed for thread loading).

drop policy if exists trips_select_own on public.trips;
create policy trips_select_own
on public.trips for select
using (auth.uid() = user_id);

drop policy if exists trips_select_accepted_requester on public.trips;
create policy trips_select_accepted_requester
on public.trips for select
using (
  exists (
    select 1 from public.trip_requests tr
    where tr.trip_id = trips.id
      and tr.requester_id = auth.uid()
      and tr.status = 'accepted'
  )
);
