-- Convert miscellaneous SECURITY DEFINER functions to SECURITY INVOKER
-- Date: 2026-06-21
--
-- New RLS policy added:
--   references_update_author – lets the author edit their own reference body/sentiment
--     (references_update_recipient was added earlier for the recipient reply; author
--      edits a different operation on the same table)
--
-- Functions intentionally left as SECURITY DEFINER:
--   send_event_invitation      → calls create_notification
--   cx_can_use_profile_username → reads profile_username_history cross-user
--                                 (users_own_username_history RLS blocks cross-user reads)
--   cx_profile_request_response_stats → reads connections cross-user
--                                        (connections_read_own only shows own connections)
--   set_event_response         → INSERT into event_members (no INSERT policy for non-host members)
--   update_event (newer sig)   → calls cx_ensure_event_thread (EXECUTE revoked from authenticated)

begin;

-- ──────────────────────────────────────────────────────────────────────────────
-- New RLS policy
-- ──────────────────────────────────────────────────────────────────────────────

drop policy if exists references_update_author on public."references";
create policy references_update_author
  on public."references"
  for update
  to authenticated
  using  (author_id = auth.uid())
  with check (author_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────────
-- log_dance_move_practice
--   dance_moves_user_update_own     → UPDATE WHERE user_id = auth.uid()
--   dance_move_practice_logs_insert_own → INSERT WHERE user_id = auth.uid()
--   dance_move_practice_logs_delete_own → DELETE WHERE user_id = auth.uid()
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.log_dance_move_practice(
  p_move_id uuid,
  p_confidence_after smallint default null::smallint,
  p_quick_note text default null::text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_user uuid;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if p_confidence_after is not null and (p_confidence_after < 1 or p_confidence_after > 5) then
    raise exception 'invalid_confidence';
  end if;

  if p_quick_note is not null and char_length(p_quick_note) > 500 then
    raise exception 'quick_note_too_long';
  end if;

  update public.dance_moves_user
  set
    practice_count = coalesce(practice_count, 0) + 1,
    last_practiced_at = now(),
    confidence = coalesce(p_confidence_after, confidence),
    updated_at = now()
  where id = p_move_id
    and user_id = v_user;

  if not found then
    raise exception 'move_not_found';
  end if;

  insert into public.dance_move_practice_logs (move_id, user_id, confidence_after, quick_note)
  values (p_move_id, v_user, p_confidence_after, nullif(trim(p_quick_note), ''));

  delete from public.dance_move_practice_logs l
  using (
    select id
    from (
      select
        id,
        row_number() over (partition by move_id, user_id order by created_at desc, id desc) as rn
      from public.dance_move_practice_logs
      where move_id = p_move_id
        and user_id = v_user
    ) ranked
    where ranked.rn > 50
  ) old_rows
  where l.id = old_rows.id;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- send_message
--   connections_read_own          → SELECT to validate participant + accepted
--   messages_select_participants  → SELECT for rate-limit counts
--   messages_insert_participants  → INSERT (sender_id = auth.uid() + participant)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.send_message(p_connection_id uuid, p_body text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_conn record;
  v_count_min int;
  v_count_day int;
  v_clean_body text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  v_clean_body := trim(coalesce(p_body, ''));
  if length(v_clean_body) < 1 or length(v_clean_body) > 1000 then
    raise exception 'Message length invalid';
  end if;

  -- no links, emails, phone numbers, or handles
  if v_clean_body ~* '(https?://|www\.)' then raise exception 'Links not allowed'; end if;
  if v_clean_body ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' then raise exception 'Emails not allowed'; end if;
  if v_clean_body ~* '[@#][A-Za-z0-9_]+' then raise exception 'Handles not allowed'; end if;
  if v_clean_body ~* '(\+?\d[\d\s().-]{7,}\d)' then raise exception 'Phone numbers not allowed'; end if;

  -- Critical MVP gate: accepted + unblocked only
  select *
  into v_conn
  from public.connections
  where id = p_connection_id
    and (requester_id = auth.uid() or target_id = auth.uid())
    and status = 'accepted'
    and blocked_by is null
  limit 1;

  if v_conn is null then
    raise exception 'No permission for this connection';
  end if;

  -- 20 messages/min/thread
  select count(*) into v_count_min
  from public.messages
  where connection_id = p_connection_id
    and created_at >= now() - interval '1 minute';

  if v_count_min >= 20 then
    raise exception 'Rate limit: 20 per minute';
  end if;

  -- 100 messages/day/user
  select count(*) into v_count_day
  from public.messages
  where sender_id = auth.uid()
    and created_at >= now() - interval '1 day';

  if v_count_day >= 100 then
    raise exception 'Daily limit reached';
  end if;

  insert into public.messages (connection_id, sender_id, body)
  values (p_connection_id, auth.uid(), v_clean_body);
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- update_reference_author  (new references_update_author covers this UPDATE)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.update_reference_author(
  p_reference_id uuid,
  p_sentiment text,
  p_body text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_sentiment not in ('positive', 'neutral', 'negative') then
    raise exception 'invalid_sentiment';
  end if;

  if char_length(trim(coalesce(p_body, ''))) < 8 then
    raise exception 'reference_body_too_short';
  end if;

  update public.references r
  set sentiment = p_sentiment,
      body = trim(p_body),
      edit_count = coalesce(r.edit_count, 0) + 1,
      last_edited_at = now()
  where r.id = p_reference_id
    and r.author_id = v_me
    and coalesce(r.edit_count, 0) < 1
    and r.created_at >= now() - interval '10 days';

  if not found then
    raise exception 'reference_update_not_allowed';
  end if;

  return p_reference_id;
end;
$$;

commit;
