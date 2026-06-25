-- Convert connection-domain SECURITY DEFINER functions to SECURITY INVOKER
-- Date: 2026-06-21
--
-- These functions had their own auth.uid() guards but ran as DB owner (bypassing RLS).
-- RLS on connections / connection_syncs / syncs already encodes the same authorization
-- rules, so SECURITY DEFINER is not needed.
--
-- New RLS policies added:
--   connection_syncs_update_participant  – lets requester or recipient update a sync row
--   syncs_update_owner                  – lets the completer update their own sync row
--                                         (required for ON CONFLICT DO UPDATE in mark_sync_completed)
--
-- Functions intentionally left as SECURITY DEFINER:
--   create_connection_request / create_connection_request_v2
--     → reads user_blocks in both directions (crosses RLS boundary; only own blocks visible)
--   propose_connection_sync / complete_connection_sync
--     → call create_notification which has EXECUTE revoked from authenticated

begin;

-- ──────────────────────────────────────────────────────────────────────────────
-- New RLS policies
-- ──────────────────────────────────────────────────────────────────────────────

drop policy if exists connection_syncs_update_participant on public.connection_syncs;
create policy connection_syncs_update_participant
  on public.connection_syncs
  for update
  to authenticated
  using  ((requester_id = auth.uid()) or (recipient_id = auth.uid()))
  with check ((requester_id = auth.uid()) or (recipient_id = auth.uid()));

drop policy if exists syncs_update_owner on public.syncs;
create policy syncs_update_owner
  on public.syncs
  for update
  to authenticated
  using  (completed_by = auth.uid())
  with check (completed_by = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────────
-- accept_connection_request  (connections_target_can_respond covers this UPDATE)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.accept_connection_request(p_connection_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  update public.connections c
  set status = 'accepted'
  where c.id = p_connection_id
    and c.target_id = v_me
    and c.status = 'pending';

  if not found then
    raise exception 'not_found_or_not_allowed';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- decline_connection_request  (connections_target_can_respond covers this UPDATE)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.decline_connection_request(p_connection_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  update public.connections c
  set status = 'declined'
  where c.id = p_connection_id
    and c.target_id = v_me
    and c.status = 'pending';

  if not found then
    raise exception 'not_found_or_not_allowed';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- undo_decline_connection_request  (connections_update_by_participants covers this)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.undo_decline_connection_request(p_connection_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  update public.connections c
  set status = 'pending'
  where c.id = p_connection_id
    and c.target_id = v_me
    and c.status = 'declined';

  if not found then
    raise exception 'not_found_or_not_allowed';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- cancel_connection_request  (connections_requester_can_delete_pending covers DELETE)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.cancel_connection_request(p_connection_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  delete from public.connections c
  where c.id = p_connection_id
    and c.requester_id = v_me
    and c.status = 'pending';

  if not found then
    raise exception 'not_found_or_not_allowed';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- block_connection
--   UPDATE: connections_update_by_participants
--   INSERT: connections_insert_request (requester_id = auth.uid())
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.block_connection(
  p_connection_id uuid default null::uuid,
  p_target_user_id uuid default null::uuid
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_conn_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_connection_id is not null then
    update public.connections c
      set status = 'blocked',
          blocked_by = v_me
    where c.id = p_connection_id
      and (c.requester_id = v_me or c.target_id = v_me)
    returning c.id into v_conn_id;

    if v_conn_id is null then
      raise exception 'connection_not_found_or_not_allowed';
    end if;

    return v_conn_id;
  end if;

  if p_target_user_id is null then
    raise exception 'missing_target_user_id';
  end if;

  if p_target_user_id = v_me then
    raise exception 'cannot_block_self';
  end if;

  insert into public.connections (requester_id, target_id, status, blocked_by)
  values (v_me, p_target_user_id, 'blocked', v_me)
  on conflict do nothing;

  select c.id
    into v_conn_id
  from public.connections c
  where ((c.requester_id = v_me and c.target_id = p_target_user_id)
      or (c.requester_id = p_target_user_id and c.target_id = v_me))
  limit 1;

  if v_conn_id is null then
    raise exception 'failed_to_block';
  end if;

  update public.connections
    set status = 'blocked',
        blocked_by = v_me
  where id = v_conn_id;

  return v_conn_id;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- unblock_connection  (connections_update_by_participants covers this UPDATE)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.unblock_connection(p_connection_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  update public.connections c
  set blocked_by = null,
      status = case when c.status = 'blocked' then 'accepted' else c.status end
  where c.id = p_connection_id
    and c.blocked_by = v_me;

  if not found then
    raise exception 'not_found_or_not_allowed';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- cancel_connection_sync  (new connection_syncs_update_participant covers UPDATE)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.cancel_connection_sync(p_sync_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_row record;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_row
  from public.connection_syncs s
  where s.id = p_sync_id
  limit 1;

  if v_row is null then
    raise exception 'sync_not_found';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'sync_not_pending';
  end if;

  if v_row.requester_id <> v_me and v_row.recipient_id <> v_me then
    raise exception 'not_authorized';
  end if;

  update public.connection_syncs
  set status = 'cancelled',
      updated_at = now()
  where id = p_sync_id;

  return p_sync_id;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- mark_sync_completed  (syncs_insert_owner + new syncs_update_owner cover INSERT ON CONFLICT DO UPDATE)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.mark_sync_completed(p_connection_id uuid, p_note text default null::text)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_ok bool := false;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select exists (
    select 1
    from public.connections c
    where c.id = p_connection_id
      and c.status = 'accepted'
      and c.blocked_by is null
      and (c.requester_id = v_me or c.target_id = v_me)
  ) into v_ok;

  if not v_ok then
    raise exception 'connection_not_eligible_for_sync';
  end if;

  insert into public.syncs(connection_id, completed_by, note)
  values (p_connection_id, v_me, nullif(trim(p_note), ''))
  on conflict (connection_id, completed_by)
  do update
    set completed_at = now(),
        note = excluded.note
  returning id into v_id;

  return v_id;
end;
$$;

commit;
