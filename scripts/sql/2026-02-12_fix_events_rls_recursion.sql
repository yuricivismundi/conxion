-- Hotfix: break RLS recursion on public.events
-- Use when you see:
-- "infinite recursion detected in policy for relation 'events'"

begin;

-- The recursion comes from events policy reading event_members/event_requests
-- while those tables also read events in their own policies.
-- Keep events policy self-contained.

drop policy if exists events_select_visible on public.events;

create policy events_select_visible
on public.events
for select
to authenticated
using (
  host_user_id = auth.uid()
  or (
    status = 'published'
    and visibility in ('public', 'private')
  )
);

commit;
