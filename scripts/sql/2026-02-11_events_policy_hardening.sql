-- ConXion Events policy hardening + discovery behavior
-- Date: 2026-02-11
--
-- Purpose:
-- 1) Keep private events discoverable in Explore (request-invite flow)
-- 2) Prevent direct table inserts that bypass request RPC rules

begin;

-- Private events should be discoverable to authenticated members so they can request access.
do $$
begin
  if to_regclass('public.events') is null
     or to_regclass('public.event_members') is null
     or to_regclass('public.event_requests') is null then
    raise notice 'events/event_members/event_requests tables not found; run 2026-02-11_events_module.sql first.';
  else
    execute 'drop policy if exists events_select_visible on public.events';
    execute $policy$
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
      )
    $policy$;
  end if;
end $$;

-- Force request inserts to match private + published event constraints, even outside RPC.
do $$
begin
  if to_regclass('public.events') is null
     or to_regclass('public.event_requests') is null then
    raise notice 'events/event_requests tables not found; run 2026-02-11_events_module.sql first.';
  else
    execute 'drop policy if exists event_requests_insert_owner on public.event_requests';
    execute $policy$
      create policy event_requests_insert_owner
      on public.event_requests
      for insert
      to authenticated
      with check (
        requester_id = auth.uid()
        and exists (
          select 1
          from public.events e
          where e.id = event_requests.event_id
            and e.status = 'published'
            and e.visibility = 'private'
            and e.host_user_id <> auth.uid()
        )
      )
    $policy$;
  end if;
end $$;

commit;
