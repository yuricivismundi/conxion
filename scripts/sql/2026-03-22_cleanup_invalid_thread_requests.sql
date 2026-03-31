begin;

-- 1) Cancel pending hosting requests that have neither:
--    - a trip context
--    - nor an accepted/unblocked connection between the two members
with invalid_hosting as (
  select hr.id
  from public.hosting_requests hr
  where lower(coalesce(hr.status, 'pending')) = 'pending'
    and hr.trip_id is null
    and not exists (
      select 1
      from public.connections c
      where (
        (c.requester_id = hr.sender_user_id and c.target_id = hr.recipient_user_id)
        or
        (c.requester_id = hr.recipient_user_id and c.target_id = hr.sender_user_id)
      )
        and lower(coalesce(c.status::text, '')) = 'accepted'
        and c.blocked_by is null
    )
),
updated_hosting as (
  update public.hosting_requests hr
  set status = 'cancelled',
      decided_at = coalesce(hr.decided_at, now()),
      updated_at = now()
  where hr.id in (select id from invalid_hosting)
  returning hr.id
)
update public.thread_contexts tc
set status_tag = 'cancelled',
    resolved_at = coalesce(tc.resolved_at, now()),
    updated_at = now()
where tc.source_table = 'hosting_requests'
  and tc.source_id in (select id from updated_hosting)
  and tc.status_tag = 'pending';

-- 2) Cancel pending activities that do not have an accepted base relationship
--    on the same thread. Activities must be layered on top of an accepted
--    connection/trip/hosting/event context, not stand alone.
with invalid_activities as (
  select a.id
  from public.activities a
  where lower(coalesce(a.status, 'pending')) = 'pending'
    and not exists (
      select 1
      from public.thread_contexts tc
      where tc.thread_id = a.thread_id
        and tc.source_table <> 'activities'
        and tc.context_tag in ('connection_request', 'trip_join_request', 'hosting_request', 'event_chat')
        and tc.status_tag in ('accepted', 'active', 'completed')
    )
),
updated_activities as (
  update public.activities a
  set status = 'cancelled',
      resolved_at = coalesce(a.resolved_at, now()),
      updated_at = now()
  where a.id in (select id from invalid_activities)
  returning a.id
)
update public.thread_contexts tc
set status_tag = 'cancelled',
    resolved_at = coalesce(tc.resolved_at, now()),
    updated_at = now()
where tc.source_table = 'activities'
  and tc.source_id in (select id from updated_activities)
  and tc.status_tag = 'pending';

-- 3) Remove duplicate connection contexts on the same thread.
--    Keep the newest/most relevant single connection request context.
with ranked as (
  select
    tc.id,
    row_number() over (
      partition by tc.thread_id, tc.context_tag
      order by
        case
          when tc.status_tag = 'pending' then 0
          when tc.status_tag in ('accepted', 'active', 'completed') then 1
          else 2
        end,
        tc.updated_at desc,
        tc.created_at desc,
        tc.id desc
    ) as rn
  from public.thread_contexts tc
  where tc.source_table = 'connections'
    and tc.context_tag = 'connection_request'
)
delete from public.thread_contexts tc
using ranked r
where tc.id = r.id
  and r.rn > 1;

commit;
