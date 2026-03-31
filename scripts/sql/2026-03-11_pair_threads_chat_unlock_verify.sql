-- ConXion Messaging Refactor Verification
-- Date: 2026-03-11
-- Run after:
--   1) scripts/sql/2026-03-09_unified_inbox_request_threads.sql
--   2) scripts/sql/2026-03-11_pair_threads_chat_unlock.sql

-- ------------------------------------------------------------
-- A) Duplicate direct pair threads (must be zero rows)
-- ------------------------------------------------------------
select
  direct_user_low,
  direct_user_high,
  count(*) as duplicate_count,
  array_agg(id order by created_at asc) as thread_ids
from public.threads
where thread_type = 'direct'
  and direct_user_low is not null
  and direct_user_high is not null
group by direct_user_low, direct_user_high
having count(*) > 1;

-- ------------------------------------------------------------
-- B) Legacy connection threads still with messages/contexts
-- Should be zero rows after migration move
-- ------------------------------------------------------------
select
  t.id as legacy_connection_thread_id,
  count(distinct tm.id) as message_count,
  count(distinct tc.id) as context_count
from public.threads t
left join public.thread_messages tm on tm.thread_id = t.id
left join public.thread_contexts tc on tc.thread_id = t.id
where t.thread_type = 'connection'
group by t.id
having count(distinct tm.id) > 0 or count(distinct tc.id) > 0;

-- ------------------------------------------------------------
-- C) Pending contexts pinning is correct
-- Should return zero rows (pending must be pinned, non-pending unpinned)
-- ------------------------------------------------------------
select
  id,
  thread_id,
  context_tag,
  status_tag,
  is_pinned
from public.thread_contexts
where (status_tag = 'pending' and is_pinned is not true)
   or (status_tag <> 'pending' and is_pinned is true);

-- ------------------------------------------------------------
-- D) Event request contexts mapped to direct threads (1:1)
-- Should return zero rows
-- ------------------------------------------------------------
select
  tc.id,
  tc.thread_id,
  t.thread_type,
  tc.context_tag,
  tc.source_table
from public.thread_contexts tc
join public.threads t on t.id = tc.thread_id
where tc.source_table = 'event_requests'
  and tc.context_tag = 'event_chat'
  and t.thread_type <> 'direct';

-- ------------------------------------------------------------
-- E) Chat unlock matrix per thread
-- Review output: unlocked should be true only when expected
-- ------------------------------------------------------------
select
  t.id as thread_id,
  t.thread_type,
  t.created_at,
  (
    select jsonb_agg(
      jsonb_build_object(
        'context', tc.context_tag,
        'status', tc.status_tag,
        'source_table', tc.source_table,
        'source_id', tc.source_id
      )
      order by tc.updated_at desc
    )
    from public.thread_contexts tc
    where tc.thread_id = t.id
  ) as contexts,
  (
    select count(*)
    from public.thread_messages tm
    where tm.thread_id = t.id
      and coalesce(tm.message_type, 'text') = 'text'
  ) as text_message_count,
  (
    select bool_or(c.status = 'blocked' or c.blocked_by is not null)
    from public.thread_contexts tc
    join public.connections c
      on tc.source_table = 'connections'
     and tc.source_id = c.id
    where tc.thread_id = t.id
  ) as has_blocked_connection,
  case
    when exists (
      select 1
      from public.thread_participants tp
      where tp.thread_id = t.id
        and tp.user_id = auth.uid()
    )
    then
      case
        when to_regprocedure('public.cx_thread_chat_unlocked(uuid,uuid)') is not null
          then public.cx_thread_chat_unlocked(t.id, auth.uid())
        else null
      end
    else null
  end as unlocked_for_me
from public.threads t
where t.thread_type in ('direct', 'event')
order by t.created_at desc
limit 200;

-- ------------------------------------------------------------
-- F) Threads currently locked but with pending-only history
-- Useful to validate requirement #7
-- ------------------------------------------------------------
select
  t.id as thread_id,
  t.thread_type,
  min(tc.created_at) as first_context_at,
  max(tc.updated_at) as last_context_at,
  count(*) filter (where tc.status_tag = 'pending') as pending_count,
  count(*) filter (where tc.status_tag = 'declined') as declined_count,
  count(*) filter (where tc.status_tag = 'cancelled') as cancelled_count,
  count(*) filter (where tc.status_tag in ('accepted', 'active')) as accepted_or_active_count,
  case
    when to_regprocedure('public.cx_thread_chat_unlocked(uuid,uuid)') is not null
      then public.cx_thread_chat_unlocked(t.id, auth.uid())
    else null
  end as unlocked_for_me
from public.threads t
join public.thread_contexts tc on tc.thread_id = t.id
where t.thread_type = 'direct'
group by t.id, t.thread_type
having count(*) filter (where tc.status_tag in ('accepted', 'active')) = 0
order by last_context_at desc
limit 200;

-- ------------------------------------------------------------
-- G) Optional quick smoke for current user pairs
-- Shows thread + participants + lock status
-- ------------------------------------------------------------
select
  t.id as thread_id,
  t.thread_type,
  t.direct_user_low,
  t.direct_user_high,
  array_agg(tp.user_id order by tp.user_id) as participants,
  case
    when to_regprocedure('public.cx_thread_chat_unlocked(uuid,uuid)') is not null
      then public.cx_thread_chat_unlocked(t.id, auth.uid())
    else null
  end as unlocked_for_me
from public.threads t
join public.thread_participants tp on tp.thread_id = t.id
where t.thread_type = 'direct'
  and exists (
    select 1 from public.thread_participants me
    where me.thread_id = t.id and me.user_id = auth.uid()
  )
group by t.id, t.thread_type, t.direct_user_low, t.direct_user_high
order by t.created_at desc
limit 100;
