-- ConXion Events RLS visibility fix
-- Date: 2026-02-14
--
-- Goal:
-- - Keep recursion-safe policies
-- - Enforce strict private visibility:
--   private events visible only to host or approved/accepted participants

begin;

do $$
begin
  if to_regclass('public.events') is null
     or to_regclass('public.event_members') is null
     or to_regclass('public.event_requests') is null then
    raise notice 'events module tables missing; skipping RLS visibility fix.';
    return;
  end if;

  create or replace function public.event_host_user_id(p_event_id uuid)
  returns uuid
  language sql
  security definer
  stable
  set search_path = public
  as $function$
    select e.host_user_id
    from public.events e
    where e.id = p_event_id
    limit 1;
  $function$;

  grant execute on function public.event_host_user_id(uuid) to authenticated;

  execute 'drop policy if exists event_members_select_visible on public.event_members';
  execute $policy$
    create policy event_members_select_visible
    on public.event_members
    for select
    to authenticated
    using (
      user_id = auth.uid()
      or public.event_host_user_id(event_id) = auth.uid()
      or public.is_app_admin(auth.uid())
    )
  $policy$;

  execute 'drop policy if exists event_requests_select_parties on public.event_requests';
  execute $policy$
    create policy event_requests_select_parties
    on public.event_requests
    for select
    to authenticated
    using (
      requester_id = auth.uid()
      or public.event_host_user_id(event_id) = auth.uid()
      or public.is_app_admin(auth.uid())
    )
  $policy$;

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
          and coalesce(e.hidden_by_admin, false) = false
          and e.host_user_id <> auth.uid()
      )
    )
  $policy$;

  execute 'drop policy if exists events_select_visible on public.events';
  execute $policy$
    create policy events_select_visible
    on public.events
    for select
    to authenticated
    using (
      host_user_id = auth.uid()
      or public.is_app_admin(auth.uid())
      or (
        status = 'published'
        and visibility = 'public'
        and coalesce(hidden_by_admin, false) = false
      )
      or (
        status = 'published'
        and visibility = 'private'
        and coalesce(hidden_by_admin, false) = false
        and exists (
          select 1
          from public.event_members em
          where em.event_id = events.id
            and em.user_id = auth.uid()
            and em.status in ('host', 'going', 'waitlist')
        )
      )
      or (
        status = 'published'
        and visibility = 'private'
        and coalesce(hidden_by_admin, false) = false
        and exists (
          select 1
          from public.event_requests er
          where er.event_id = events.id
            and er.requester_id = auth.uid()
            and er.status = 'accepted'
        )
      )
    )
  $policy$;
end $$;

commit;

