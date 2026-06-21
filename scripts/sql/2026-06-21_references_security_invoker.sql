-- Convert reference-domain SECURITY DEFINER functions to SECURITY INVOKER
-- Date: 2026-06-21
--
-- New RLS policy added:
--   references_update_recipient – lets the recipient add a reply to a reference
--     (no UPDATE policy existed on the references table)
--
-- Functions intentionally left as SECURITY DEFINER:
--   create_reference_v2 → calls create_notification (EXECUTE revoked from authenticated)

begin;

-- ──────────────────────────────────────────────────────────────────────────────
-- New RLS policy
-- ──────────────────────────────────────────────────────────────────────────────

drop policy if exists references_update_recipient on public."references";
create policy references_update_recipient
  on public."references"
  for update
  to authenticated
  using  (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────────
-- create_reference  (connections_read_own + syncs_select_participants + references_insert_author)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.create_reference(
  p_connection_id uuid,
  p_recipient_id uuid,
  p_sentiment text,
  p_body text,
  p_context text default 'connection'::text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_connection record;
  v_sync_exists bool := false;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_recipient_id = v_me then
    raise exception 'cannot_reference_self';
  end if;

  if p_sentiment not in ('positive', 'neutral', 'negative') then
    raise exception 'invalid_sentiment';
  end if;

  if length(trim(coalesce(p_body, ''))) < 8 then
    raise exception 'reference_body_too_short';
  end if;

  select c.*
    into v_connection
  from public.connections c
  where c.id = p_connection_id
    and c.status = 'accepted'
    and c.blocked_by is null
    and (c.requester_id = v_me or c.target_id = v_me)
  limit 1;

  if v_connection is null then
    raise exception 'connection_not_eligible_for_reference';
  end if;

  if not (
    (v_connection.requester_id = v_me and v_connection.target_id = p_recipient_id)
    or
    (v_connection.target_id = v_me and v_connection.requester_id = p_recipient_id)
  ) then
    raise exception 'recipient_not_in_connection';
  end if;

  select exists (
    select 1
    from public.syncs s
    where s.connection_id = p_connection_id
  ) into v_sync_exists;

  if not v_sync_exists then
    raise exception 'references_require_completed_sync';
  end if;

  insert into public.references (
    connection_id,
    author_id,
    recipient_id,
    context,
    sentiment,
    body
  )
  values (
    p_connection_id,
    v_me,
    p_recipient_id,
    coalesce(nullif(trim(p_context), ''), 'connection'),
    p_sentiment,
    trim(p_body)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- reply_reference_receiver  (new references_update_recipient covers the UPDATE)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.reply_reference_receiver(p_reference_id uuid, p_reply_text text)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_clean text := trim(coalesce(p_reply_text, ''));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if char_length(v_clean) < 2 or char_length(v_clean) > 400 then
    raise exception 'invalid_reply_length';
  end if;

  update public.references r
  set reply_text = v_clean,
      replied_by = v_me,
      replied_at = now()
  where r.id = p_reference_id
    and r.recipient_id = v_me
    and r.reply_text is null
    and r.created_at >= now() - interval '15 days';

  if not found then
    raise exception 'reference_reply_not_allowed';
  end if;

  return p_reference_id;
end;
$$;

commit;
