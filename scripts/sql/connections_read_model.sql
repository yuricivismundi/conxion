-- Central read-model for connection visibility/state.
-- Run this in Supabase SQL editor.

create or replace function public.app_visible_connections(p_user_id uuid)
returns table (
  id uuid,
  requester_id uuid,
  target_id uuid,
  status text,
  blocked_by uuid,
  created_at timestamptz,
  connect_context text,
  connect_reason text,
  connect_reason_role text,
  connect_note text,
  trip_id uuid,
  other_user_id uuid,
  is_blocked boolean,
  is_visible_in_messages boolean,
  is_incoming_pending boolean,
  is_outgoing_pending boolean,
  is_accepted_visible boolean
)
language sql
stable
as $$
  select
    c.id,
    c.requester_id,
    c.target_id,
    c.status::text as status,
    c.blocked_by,
    c.created_at,
    c.connect_context::text as connect_context,
    c.connect_reason::text as connect_reason,
    c.connect_reason_role::text as connect_reason_role,
    c.connect_note::text as connect_note,
    c.trip_id,
    case when c.requester_id = p_user_id then c.target_id else c.requester_id end as other_user_id,
    (c.status = 'blocked' or c.blocked_by is not null) as is_blocked,
    (c.status = 'accepted' and c.blocked_by is null) as is_visible_in_messages,
    (c.status = 'pending' and c.target_id = p_user_id) as is_incoming_pending,
    (c.status = 'pending' and c.requester_id = p_user_id) as is_outgoing_pending,
    (c.status = 'accepted' and c.blocked_by is null) as is_accepted_visible
  from public.connections c
  where c.requester_id = p_user_id or c.target_id = p_user_id
  order by c.created_at desc nulls last;
$$;

grant execute on function public.app_visible_connections(uuid) to authenticated;

comment on function public.app_visible_connections(uuid)
is 'Unified read model for pending/accepted/blocked visibility and direction for one user.';

