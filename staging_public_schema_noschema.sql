--
-- PostgreSQL database dump
--

\restrict 99pdRLY6xqsR8K9nf7PWA8lVgVizawBJWfUBwniQyNPlMlyY3wTRbc9OjgURfcS

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: connection_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.connection_status AS ENUM (
    'pending',
    'accepted',
    'blocked',
    'declined',
    'cancelled'
);


--
-- Name: accept_connection_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_connection_request(p_connection_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: active_event_limit_for_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.active_event_limit_for_user(p_user_id uuid) RETURNS integer
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
begin
  if public.is_app_admin(p_user_id) then
    return 100;
  end if;

  if public.is_organizer_verified(p_user_id) then
    return 25;
  end if;

  return 3;
end;
$$;


--
-- Name: app_visible_connections(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_visible_connections(p_user_id uuid) RETURNS TABLE(id uuid, requester_id uuid, target_id uuid, status text, blocked_by uuid, created_at timestamp with time zone, connect_context text, connect_reason text, connect_reason_role text, connect_note text, trip_id uuid, other_user_id uuid, is_blocked boolean, is_visible_in_messages boolean, is_incoming_pending boolean, is_outgoing_pending boolean, is_accepted_visible boolean)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: FUNCTION app_visible_connections(p_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.app_visible_connections(p_user_id uuid) IS 'Unified read model for pending/accepted/blocked visibility and direction for one user.';


--
-- Name: block_connection(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_connection(p_connection_id uuid DEFAULT NULL::uuid, p_target_user_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: bump_thread_message_daily_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_thread_message_daily_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count int := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if new.sender_id is distinct from auth.uid() then
    raise exception 'sender_mismatch';
  end if;

  insert into public.message_limits(user_id, date_key, sent_count)
  values (new.sender_id, current_date, 1)
  on conflict (user_id, date_key)
  do update set sent_count = public.message_limits.sent_count + 1
  returning sent_count into v_count;

  if v_count > 100 then
    raise exception 'daily_limit_reached';
  end if;

  return new;
end;
$$;


--
-- Name: can_submit_event_feedback(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_submit_event_feedback(p_event_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_event public.events;
  v_attended boolean := false;
begin
  if p_event_id is null or p_user_id is null then
    return false;
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    return false;
  end if;

  if coalesce(v_event.hidden_by_admin, false) then
    return false;
  end if;

  if v_event.ends_at > now() then
    return false;
  end if;

  select exists (
    select 1
    from public.event_members em
    where em.event_id = p_event_id
      and em.user_id = p_user_id
      and em.status in ('host', 'going', 'waitlist')
  ) into v_attended;

  return v_attended;
end;
$$;


--
-- Name: cancel_connection_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_connection_request(p_connection_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: cancel_connection_sync(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_connection_sync(p_sync_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: cancel_event_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_event_request(p_event_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  update public.event_requests r
    set status = 'cancelled',
        decided_by = null,
        decided_at = null,
        updated_at = now()
  where r.event_id = p_event_id
    and r.requester_id = v_me
    and r.status = 'pending';

  if not found then
    raise exception 'request_not_found_or_not_pending';
  end if;
end;
$$;


--
-- Name: cancel_trip_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_trip_request(p_request_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_row record;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_row
  from public.trip_requests tr
  where tr.id = p_request_id
  limit 1;

  if v_row is null then
    raise exception 'trip_request_not_found';
  end if;

  if v_row.requester_id <> v_me then
    raise exception 'not_authorized';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'trip_request_not_pending';
  end if;

  update public.trip_requests
  set status = 'cancelled',
      updated_at = now()
  where id = p_request_id;

  return v_row.trip_id;
end;
$$;


--
-- Name: complete_connection_sync(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_connection_sync(p_sync_id uuid, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_row record;
  v_other uuid;
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

  if v_row.status <> 'accepted' then
    raise exception 'sync_not_accepted';
  end if;

  if v_row.requester_id <> v_me and v_row.recipient_id <> v_me then
    raise exception 'not_authorized';
  end if;

  update public.connection_syncs
  set status = 'completed',
      completed_at = now(),
      note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note),
      updated_at = now()
  where id = p_sync_id;

  -- Keep backward compatibility with legacy sync completion table.
  update public.syncs
  set completed_at = now(),
      note = nullif(trim(coalesce(p_note, '')), '')
  where connection_id = v_row.connection_id
    and completed_by = v_me;

  if not found then
    insert into public.syncs (connection_id, completed_by, note)
    values (v_row.connection_id, v_me, nullif(trim(coalesce(p_note, '')), ''));
  end if;

  v_other := case when v_row.requester_id = v_me then v_row.recipient_id else v_row.requester_id end;
  perform public.create_notification(
    v_other,
    'sync_completed',
    'Sync marked completed',
    'A sync was marked completed. You can now leave a reference.',
    '/connections/' || v_row.connection_id::text,
    jsonb_build_object('connection_id', v_row.connection_id, 'sync_id', p_sync_id)
  );

  return p_sync_id;
end;
$$;


--
-- Name: connections_after_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.connections_after_write() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  a uuid;
  b uuid;
begin
  a := coalesce(new.requester_id, old.requester_id);
  b := coalesce(new.target_id, old.target_id);

  perform public.recalc_connections_count(a);
  perform public.recalc_connections_count(b);

  return coalesce(new, old);
end;
$$;


--
-- Name: create_connection_request(uuid, text, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_connection_request(p_target_id uuid, p_connect_context text, p_connect_reason uuid, p_connect_reason_role text, p_trip_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return public.create_connection_request_v2(
    p_target_id,
    p_connect_context,
    p_connect_reason::text,
    p_connect_reason_role,
    p_trip_id,
    null
  );
end;
$$;


--
-- Name: create_connection_request(uuid, text, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_connection_request(p_target_id uuid, p_context text, p_connect_reason text, p_connect_reason_role text, p_trip_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return public.create_connection_request_v2(
    p_target_id,
    p_context,
    p_connect_reason,
    p_connect_reason_role,
    p_trip_id,
    p_note
  );
end;
$$;


--
-- Name: create_connection_request_v2(uuid, text, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_connection_request_v2(p_target_id uuid, p_context text, p_connect_reason text, p_connect_reason_role text, p_trip_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_me uuid := auth.uid();
  v_existing uuid;
  v_new_id uuid;
  v_blocked bool := false;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_target_id is null then
    raise exception 'missing_target_id';
  end if;

  if p_target_id = v_me then
    raise exception 'cannot_request_self';
  end if;

  if p_connect_reason is null or trim(p_connect_reason) = '' then
    raise exception 'reason_required';
  end if;

  -- Prefer user_blocks if available.
  if to_regclass('public.user_blocks') is not null then
    execute $sql$
      select exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = $1 and b.blocked_user_id = $2)
           or (b.blocker_id = $2 and b.blocked_user_id = $1)
      )
    $sql$
    into v_blocked
    using v_me, p_target_id;
  else
    -- Fallback to connections block state.
    select exists (
      select 1 from public.connections c
      where ((c.requester_id = v_me and c.target_id = p_target_id)
          or (c.requester_id = p_target_id and c.target_id = v_me))
        and (c.status = 'blocked' or c.blocked_by is not null)
    ) into v_blocked;
  end if;

  if v_blocked then
    raise exception 'blocked';
  end if;

  -- already pending/accepted either direction (fixed precedence)
  select c.id
    into v_existing
  from public.connections c
  where ((c.requester_id = v_me and c.target_id = p_target_id)
      or (c.requester_id = p_target_id and c.target_id = v_me))
    and c.status in ('pending', 'accepted')
  limit 1;

  if v_existing is not null then
    raise exception 'already_pending_or_connected';
  end if;

  insert into public.connections(
    requester_id, target_id, status,
    connect_context, connect_reason, connect_reason_role,
    trip_id, connect_note
  )
  values (
    v_me, p_target_id, 'pending',
    p_context, p_connect_reason, p_connect_reason_role,
    p_trip_id, p_note
  )
  returning id into v_new_id;

  return v_new_id;
end;
$_$;


--
-- Name: create_event(text, text, text, text, text, text, text, text, timestamp with time zone, timestamp with time zone, integer, text, jsonb, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_event(p_title text, p_description text, p_event_type text, p_visibility text, p_city text, p_country text, p_venue_name text, p_venue_address text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_capacity integer DEFAULT NULL::integer, p_cover_url text DEFAULT NULL::text, p_links jsonb DEFAULT '[]'::jsonb, p_status text DEFAULT 'published'::text, p_styles text[] DEFAULT NULL::text[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_visibility text := lower(trim(coalesce(p_visibility, 'public')));
  v_status text := lower(trim(coalesce(p_status, 'published')));
  v_cover_url text := nullif(trim(coalesce(p_cover_url, '')), '');
  v_styles text[] := public.normalize_event_styles(p_styles);
  v_active_count int := 0;
  v_limit int := 3;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if trim(coalesce(p_title, '')) = '' then
    raise exception 'title_required';
  end if;

  if trim(coalesce(p_city, '')) = '' or trim(coalesce(p_country, '')) = '' then
    raise exception 'location_required';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_event_window';
  end if;

  if v_visibility not in ('public', 'private') then
    raise exception 'invalid_visibility';
  end if;

  if v_status not in ('draft', 'published') then
    raise exception 'invalid_status';
  end if;

  if p_capacity is not null and (p_capacity < 1 or p_capacity > 2000) then
    raise exception 'invalid_capacity';
  end if;

  if v_cover_url is not null then
    if v_cover_url !~* '/storage/v1/object/public/avatars/' then
      raise exception 'invalid_cover_url';
    end if;
    if v_cover_url !~* '\\.(jpg|jpeg|png|webp)(\\?.*)?$' then
      raise exception 'invalid_cover_format';
    end if;
  end if;

  if cardinality(v_styles) > 12 then
    raise exception 'too_many_styles';
  end if;

  select public.active_event_limit_for_user(v_me) into v_limit;

  select count(*)::int
    into v_active_count
  from public.events e
  where e.host_user_id = v_me
    and e.status in ('draft', 'published')
    and e.ends_at >= now()
    and coalesce(e.hidden_by_admin, false) = false;

  if v_active_count >= v_limit then
    raise exception 'active_event_limit_reached';
  end if;

  insert into public.events (
    host_user_id,
    title,
    description,
    event_type,
    styles,
    visibility,
    city,
    country,
    venue_name,
    venue_address,
    starts_at,
    ends_at,
    capacity,
    cover_url,
    cover_status,
    links,
    status
  ) values (
    v_me,
    trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''),
    coalesce(nullif(trim(coalesce(p_event_type, '')), ''), 'Social'),
    coalesce(v_styles, '{}'::text[]),
    v_visibility,
    trim(p_city),
    trim(p_country),
    nullif(trim(coalesce(p_venue_name, '')), ''),
    nullif(trim(coalesce(p_venue_address, '')), ''),
    p_starts_at,
    p_ends_at,
    p_capacity,
    v_cover_url,
    case when v_cover_url is null then 'approved' else 'pending' end,
    coalesce(p_links, '[]'::jsonb),
    v_status
  )
  returning id into v_id;

  insert into public.event_members (event_id, user_id, member_role, status)
  values (v_id, v_me, 'host', 'host')
  on conflict (event_id, user_id)
  do update set
    member_role = 'host',
    status = 'host',
    updated_at = now();

  return v_id;
end;
$_$;


--
-- Name: create_event_report(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_event_report(p_event_id uuid, p_reason text, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'report_reason_required';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_event.host_user_id = v_me then
    raise exception 'cannot_report_own_event';
  end if;

  insert into public.event_reports (
    event_id,
    reporter_id,
    reason,
    note,
    status
  )
  values (
    p_event_id,
    v_me,
    trim(p_reason),
    nullif(trim(coalesce(p_note, '')), ''),
    'open'
  )
  returning id into v_id;

  -- Mirror into generic reports table if available, so existing admin queue sees event flags.
  if to_regclass('public.reports') is not null then
    begin
      execute '
        insert into public.reports (
          reporter_id,
          target_user_id,
          context,
          context_id,
          reason,
          note,
          status
        ) values ($1, $2, $3, $4, $5, $6, ''open'')'
      using v_me, v_event.host_user_id, 'event', p_event_id::text, trim(p_reason), nullif(trim(coalesce(p_note, '')), '');
    exception
      when undefined_column then null;
      when undefined_table then null;
    end;
  end if;

  return v_id;
end;
$_$;


--
-- Name: create_notification(uuid, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_notification(p_user_id uuid, p_kind text, p_title text, p_body text DEFAULT NULL::text, p_link_url text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_user_id is null then
    raise exception 'notification_user_required';
  end if;

  if trim(coalesce(p_kind, '')) = '' then
    raise exception 'notification_kind_required';
  end if;

  if trim(coalesce(p_title, '')) = '' then
    raise exception 'notification_title_required';
  end if;

  insert into public.notifications (
    user_id,
    actor_id,
    kind,
    title,
    body,
    link_url,
    metadata
  )
  values (
    p_user_id,
    auth.uid(),
    trim(p_kind),
    trim(p_title),
    nullif(trim(coalesce(p_body, '')), ''),
    nullif(trim(coalesce(p_link_url, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;


--
-- Name: create_reference(uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_reference(p_connection_id uuid, p_recipient_id uuid, p_sentiment text, p_body text, p_context text DEFAULT 'connection'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: create_reference_v2(uuid, text, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_reference_v2(p_connection_id uuid, p_entity_type text, p_entity_id uuid, p_recipient_id uuid, p_sentiment text, p_body text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_connection record;
  v_sync_ok bool := false;
  v_trip_ok bool := false;
  v_event_ok bool := false;
  v_entity_type text := lower(trim(coalesce(p_entity_type, 'connection')));
  v_entity_id uuid := coalesce(p_entity_id, p_connection_id);
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

  if char_length(trim(coalesce(p_body, ''))) < 8 then
    raise exception 'reference_body_too_short';
  end if;

  if v_entity_type not in ('connection', 'sync', 'trip', 'event') then
    raise exception 'invalid_entity_type';
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

  if v_entity_type = 'connection' then
    select exists (
      select 1
      from public.syncs s
      where s.connection_id = p_connection_id
    ) into v_sync_ok;
    if not v_sync_ok then
      raise exception 'references_require_completed_sync';
    end if;
  elsif v_entity_type = 'sync' then
    select exists (
      select 1
      from public.connection_syncs s
      where s.id = v_entity_id
        and s.connection_id = p_connection_id
        and s.status = 'completed'
        and s.completed_at is not null
        and s.completed_at >= now() - interval '15 days'
        and ((s.requester_id = v_me and s.recipient_id = p_recipient_id) or (s.requester_id = p_recipient_id and s.recipient_id = v_me))
    ) into v_sync_ok;
    if not v_sync_ok then
      raise exception 'sync_reference_not_allowed';
    end if;
  elsif v_entity_type = 'trip' then
    select exists (
      select 1
      from public.trip_requests tr
      join public.trips t on t.id = tr.trip_id
      where tr.id = v_entity_id
        and tr.status = 'accepted'
        and t.end_date::date <= current_date
        and t.end_date::date >= current_date - 15
        and ((t.user_id = v_me and tr.requester_id = p_recipient_id) or (t.user_id = p_recipient_id and tr.requester_id = v_me))
    ) into v_trip_ok;
    if not v_trip_ok then
      raise exception 'trip_reference_not_allowed';
    end if;
  elsif v_entity_type = 'event' then
    select exists (
      select 1
      from public.events e
      join public.event_members em_a on em_a.event_id = e.id and em_a.user_id = v_me and em_a.status in ('host', 'going', 'waitlist')
      join public.event_members em_b on em_b.event_id = e.id and em_b.user_id = p_recipient_id and em_b.status in ('host', 'going', 'waitlist')
      where e.id = v_entity_id
        and e.ends_at <= now()
        and e.ends_at >= now() - interval '15 days'
    ) into v_event_ok;
    if not v_event_ok then
      raise exception 'event_reference_not_allowed';
    end if;
  end if;

  insert into public.references (
    connection_id,
    author_id,
    recipient_id,
    context,
    entity_type,
    entity_id,
    sentiment,
    body
  )
  values (
    p_connection_id,
    v_me,
    p_recipient_id,
    v_entity_type,
    v_entity_type,
    v_entity_id,
    p_sentiment,
    trim(p_body)
  )
  returning id into v_id;

  perform public.create_notification(
    p_recipient_id,
    'reference_received',
    'New reference received',
    'You received a new reference.',
    '/members/' || p_recipient_id::text,
    jsonb_build_object('reference_id', v_id, 'entity_type', v_entity_type, 'entity_id', v_entity_id)
  );

  return v_id;
end;
$$;


--
-- Name: create_report(uuid, uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_report(p_connection_id uuid DEFAULT NULL::uuid, p_target_user_id uuid DEFAULT NULL::uuid, p_context text DEFAULT 'connection'::text, p_context_id text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_target uuid;
  v_report_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if to_regclass('public.reports') is null then
    raise exception 'reports_table_missing';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'report_reason_required';
  end if;

  if p_target_user_id is not null then
    v_target := p_target_user_id;
  elsif p_connection_id is not null then
    select case when c.requester_id = v_me then c.target_id else c.requester_id end
      into v_target
    from public.connections c
    where c.id = p_connection_id
      and (c.requester_id = v_me or c.target_id = v_me)
    limit 1;
  else
    raise exception 'missing_target';
  end if;

  if v_target is null then
    raise exception 'target_not_found_or_not_allowed';
  end if;

  if v_target = v_me then
    raise exception 'cannot_report_self';
  end if;

  insert into public.reports (
    reporter_id,
    target_user_id,
    context,
    context_id,
    reason,
    note,
    status
  )
  values (
    v_me,
    v_target,
    coalesce(nullif(trim(p_context), ''), 'connection'),
    coalesce(nullif(trim(p_context_id), ''), p_connection_id::text),
    trim(p_reason),
    nullif(trim(p_note), ''),
    'open'
  )
  returning id into v_report_id;

  return v_report_id;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: trips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    destination_country text NOT NULL,
    destination_city text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    purpose text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    CONSTRAINT trips_destination_city_not_blank CHECK ((length(TRIM(BOTH FROM COALESCE(destination_city, ''::text))) >= 1)),
    CONSTRAINT trips_destination_country_not_blank CHECK ((length(TRIM(BOTH FROM COALESCE(destination_country, ''::text))) >= 2)),
    CONSTRAINT trips_purpose_allowed CHECK ((purpose = ANY (ARRAY['Holiday Trip'::text, 'Dance Festival'::text, 'Social Dancing'::text, 'Training / Workshops'::text]))),
    CONSTRAINT trips_start_before_end CHECK ((start_date <= end_date)),
    CONSTRAINT trips_status_allowed CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: create_trip_checked(text, text, date, date, text, text[], text[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_trip_checked(p_destination_city text, p_destination_country text, p_start_date date, p_end_date date, p_purpose text, p_styles text[], p_looking_for text[], p_note text) RETURNS public.trips
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := auth.uid();
  v_active_count int;
  v_row public.trips;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select count(*) into v_active_count
  from public.trips t
  where t.user_id = v_user
    and t.end_date >= current_date;

  if v_active_count >= 5 then
    raise exception 'You can only have up to 5 active trips.';
  end if;

  insert into public.trips (
    user_id, destination_city, destination_country,
    start_date, end_date, purpose, styles, looking_for, note, status
  )
  values (
    v_user, p_destination_city, p_destination_country,
    p_start_date, p_end_date, p_purpose, coalesce(p_styles,'{}'),
    coalesce(p_looking_for,'{}'), nullif(trim(p_note),''), 'published'
  )
  returning * into v_row;

  return v_row;
end;
$$;


--
-- Name: create_trip_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_trip_request(p_trip_id uuid, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_trip_owner uuid;
  v_trip_status text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select t.user_id, coalesce(t.status, 'active')
    into v_trip_owner, v_trip_status
  from public.trips t
  where t.id = p_trip_id
  limit 1;

  if v_trip_owner is null then
    raise exception 'trip_not_found';
  end if;

  if v_trip_owner = v_me then
    raise exception 'cannot_request_own_trip';
  end if;

  if v_trip_status <> 'active' then
    raise exception 'trip_not_active';
  end if;

  insert into public.trip_requests (trip_id, requester_id, note, status, decided_by, decided_at)
  values (p_trip_id, v_me, nullif(trim(coalesce(p_note, '')), ''), 'pending', null, null)
  on conflict (trip_id, requester_id)
  do update set
    note = excluded.note,
    status = 'pending',
    decided_by = null,
    decided_at = null,
    updated_at = now()
  returning id into v_id;

  if v_trip_owner <> v_me then
    perform public.create_notification(
      v_trip_owner,
      'trip_request_received',
      'New trip request',
      'You received a new request for your trip.',
      '/trips/' || p_trip_id::text,
      jsonb_build_object('trip_id', p_trip_id, 'requester_id', v_me)
    );
  end if;

  return v_id;
end;
$$;


--
-- Name: decline_connection_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decline_connection_request(p_connection_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: enforce_connection_request_limits(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_connection_request_limits() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_day_count int;
  v_hour_count int;
  v_recent_declined int;
  v_existing_active int;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if current_setting('app.seed_mode', true) = 'on' then
    return new;
  end if;

  if new.status is distinct from 'pending' then
    return new;
  end if;

  if new.requester_id is null or new.target_id is null then
    raise exception 'requester_id/target_id required';
  end if;

  if new.requester_id = new.target_id then
    raise exception 'cannot_request_self';
  end if;

  -- Existing pending/accepted in either direction is not allowed.
  select count(*) into v_existing_active
  from public.connections c
  where ((c.requester_id = new.requester_id and c.target_id = new.target_id)
      or (c.requester_id = new.target_id and c.target_id = new.requester_id))
    and c.status in ('pending', 'accepted');

  if v_existing_active > 0 then
    raise exception 'already_pending_or_connected';
  end if;

  -- 20/day + 5/hour
  select count(*) into v_day_count
  from public.connections c
  where c.requester_id = new.requester_id
    and c.created_at >= now() - interval '24 hours';

  if v_day_count >= 20 then
    raise exception 'rate_limit_daily';
  end if;

  select count(*) into v_hour_count
  from public.connections c
  where c.requester_id = new.requester_id
    and c.created_at >= now() - interval '1 hour';

  if v_hour_count >= 5 then
    raise exception 'rate_limit_hourly';
  end if;

  -- 30-day cooldown after decline (same requester -> same target)
  select count(*) into v_recent_declined
  from public.connections c
  where c.requester_id = new.requester_id
    and c.target_id = new.target_id
    and c.status = 'declined'
    and c.created_at >= now() - interval '30 days';

  if v_recent_declined > 0 then
    raise exception 're_request_not_allowed_30_days';
  end if;

  return new;
end;
$$;


--
-- Name: enforce_event_join_guardrails(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_event_join_guardrails(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_email_confirmed_at timestamptz;
  v_created_at timestamptz;
  v_join_count int := 0;
begin
  if p_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select u.email_confirmed_at, u.created_at
    into v_email_confirmed_at, v_created_at
  from auth.users u
  where u.id = p_user_id
  limit 1;

  if v_email_confirmed_at is null then
    raise exception 'email_verification_required_for_join';
  end if;

  if v_created_at is not null and v_created_at >= now() - interval '24 hours' then
    select count(*)::int
      into v_join_count
    from public.event_members em
    where em.user_id = p_user_id
      and em.status in ('host', 'going', 'waitlist')
      and em.created_at >= now() - interval '24 hours';

    if v_join_count >= 3 then
      raise exception 'new_account_join_limit_reached';
    end if;
  end if;
end;
$$;


--
-- Name: enforce_max_4_active_trips(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_max_4_active_trips() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  active_count int;
begin
  -- count trips for the user that haven't ended yet
  select count(*)
  into active_count
  from public.trips t
  where t.user_id = new.user_id
    and t.end_date >= current_date
    -- exclude the same row if it's an UPDATE
    and (tg_op <> 'UPDATE' or t.id <> new.id);

  if active_count >= 4 then
    raise exception 'Max 4 active trips allowed per user';
  end if;

  return new;
end;
$$;


--
-- Name: enforce_max_4_total_trips(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_max_4_total_trips() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  total_count int;
begin
  select count(*)
    into total_count
  from public.trips t
  where t.user_id = new.user_id;

  if total_count >= 4 then
    raise exception 'Max 4 trips allowed per user';
  end if;

  return new;
end;
$$;


--
-- Name: enforce_max_5_active_trips(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_max_5_active_trips() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  active_count int;
begin
  if tg_op not in ('INSERT', 'UPDATE') then
    return new;
  end if;

  -- Active = trip end_date has not passed.
  select count(*)
    into active_count
  from public.trips t
  where t.user_id = new.user_id
    and t.end_date >= current_date
    and (tg_op <> 'UPDATE' or t.id <> new.id);

  if active_count >= 5 then
    raise exception 'Max 5 active trips allowed per user';
  end if;

  return new;
end;
$$;


--
-- Name: enforce_max_5_connections_per_day(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_max_5_connections_per_day() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_count int;
begin
  -- Allow seeds/migrations to bypass the limit explicitly
  if current_setting('app.seed_mode', true) = 'on' then
    return new;
  end if;

  -- Existing logic: max 5 per day (keep your current behavior)
  select count(*)
    into v_count
  from public.connections c
  where c.requester_id = new.requester_id
    and c.created_at::date = now()::date;

  if v_count >= 5 then
    raise exception 'Daily connection limit reached (5)';
  end if;

  return new;
end;
$$;


--
-- Name: enforce_reference_immutability(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_reference_immutability() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if old.created_at < now() - interval '15 days' then
    raise exception 'references_immutable_after_15_days';
  end if;
  return coalesce(new, old);
end;
$$;


--
-- Name: enforce_trip_create_rate_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_trip_create_rate_limit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  today_count int;
begin
  select count(*)
  into today_count
  from public.trips t
  where t.user_id = new.user_id
    and t.created_at >= date_trunc('day', now());

  if today_count >= 2 then
    raise exception 'Trip creation rate limit reached (2 per day)';
  end if;

  return new;
end;
$$;


--
-- Name: enforce_trips_daily_rate_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_trips_daily_rate_limit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  today_count int;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  select count(*)
    into today_count
  from public.trips t
  where t.user_id = new.user_id
    and t.created_at >= date_trunc('day', now());

  if today_count >= 6 then
    raise exception 'Daily trip creation limit reached (6/day)'
      using errcode = '42901';
  end if;

  return new;
end;
$$;


--
-- Name: event_has_capacity(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_has_capacity(p_event_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with target as (
    select e.id, e.capacity
    from public.events e
    where e.id = p_event_id
  ), current_count as (
    select count(*)::int as going_count
    from public.event_members em
    where em.event_id = p_event_id
      and em.status in ('host', 'going')
  )
  select
    case
      when t.capacity is null then true
      else c.going_count < t.capacity
    end
  from target t
  cross join current_count c;
$$;


--
-- Name: event_host_user_id(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_host_user_id(p_event_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    select e.host_user_id
    from public.events e
    where e.id = p_event_id
    limit 1;
  $$;


--
-- Name: event_is_host(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_is_host(p_event_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select exists(
    select 1
    from public.events e
    where e.id = p_event_id
      and e.host_user_id = p_user_id
  );
$$;


--
-- Name: get_connect_reasons_for_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_connect_reasons_for_user(target_user_id uuid) RETURNS TABLE(id text, label text, role text, sort_order integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select cr.id, cr.label, cr.role, cr.sort_order
  from public.connect_reasons cr
  join public.profiles p
    on p.user_id = target_user_id
  where cr.active = true
    and cr.context = 'member'
    and cr.role = any (p.roles)
  order by cr.role, cr.sort_order;
$$;


--
-- Name: get_distinct_profile_interests(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_distinct_profile_interests() RETURNS TABLE(value text)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select distinct trim(x) as value
  from public.profiles p
  cross join lateral unnest(coalesce(p.interests, '{}'::text[])) as x
  where trim(x) <> ''
  order by value;
$$;


--
-- Name: get_event_feedback_summary(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_event_feedback_summary(p_event_id uuid) RETURNS TABLE(total_count integer, avg_quality numeric, happened_yes integer, happened_no integer)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    count(*)::int as total_count,
    round(avg(quality)::numeric, 2) as avg_quality,
    sum(case when happened_as_described then 1 else 0 end)::int as happened_yes,
    sum(case when happened_as_described then 0 else 1 end)::int as happened_no
  from public.event_feedback ef
  where ef.event_id = p_event_id
    and (
      ef.visibility = 'public'
      or ef.author_id = auth.uid()
      or public.is_app_admin(auth.uid())
      or exists (
        select 1 from public.events e where e.id = ef.event_id and e.host_user_id = auth.uid()
      )
    );
$$;


--
-- Name: get_public_event_lite(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_event_lite(p_event_id uuid) RETURNS TABLE(id uuid, host_user_id uuid, title text, description text, event_type text, styles text[], visibility text, city text, country text, venue_name text, venue_address text, starts_at timestamp with time zone, ends_at timestamp with time zone, capacity integer, cover_url text, cover_status text, cover_reviewed_by uuid, cover_reviewed_at timestamp with time zone, cover_review_note text, hidden_by_admin boolean, hidden_reason text, links jsonb, status text, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    e.id,
    e.host_user_id,
    e.title,
    e.description,
    e.event_type,
    coalesce(e.styles, '{}'::text[]) as styles,
    e.visibility,
    e.city,
    e.country,
    e.venue_name,
    null::text as venue_address,
    e.starts_at,
    e.ends_at,
    e.capacity,
    case
      when coalesce(e.cover_status, 'pending') = 'approved' then e.cover_url
      when e.cover_url is null then null
      else null
    end as cover_url,
    coalesce(e.cover_status, 'pending') as cover_status,
    e.cover_reviewed_by,
    e.cover_reviewed_at,
    e.cover_review_note,
    coalesce(e.hidden_by_admin, false) as hidden_by_admin,
    e.hidden_reason,
    '[]'::jsonb as links,
    e.status,
    e.created_at,
    e.updated_at
  from public.events e
  where e.id = p_event_id
    and e.status = 'published'
    and e.visibility = 'public'
    and coalesce(e.hidden_by_admin, false) = false
  limit 1;
$$;


--
-- Name: is_app_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_app_admin(p_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $_$
declare
  v_is_admin bool := false;
begin
  if p_user_id is null then
    return false;
  end if;

  if to_regclass('public.admins') is null then
    return false;
  end if;

  begin
    execute 'select exists (select 1 from public.admins a where a.user_id = $1)' into v_is_admin using p_user_id;
  exception
    when undefined_column then
      v_is_admin := false;
  end;

  return coalesce(v_is_admin, false);
end;
$_$;


--
-- Name: is_organizer_verified(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_organizer_verified(p_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $_$
declare
  v_verified boolean := false;
  v_profile_verified boolean := false;
begin
  if p_user_id is null then
    return false;
  end if;

  if to_regclass('public.profiles') is null then
    return false;
  end if;

  begin
    execute 'select coalesce(organizer_verified, false) from public.profiles where user_id = $1 limit 1'
      into v_verified
      using p_user_id;
  exception
    when undefined_column then
      v_verified := false;
  end;

  if v_verified then
    return true;
  end if;

  begin
    execute 'select coalesce(verified, false) from public.profiles where user_id = $1 limit 1'
      into v_profile_verified
      using p_user_id;
  exception
    when undefined_column then
      v_profile_verified := false;
  end;

  return coalesce(v_profile_verified, false);
end;
$_$;


--
-- Name: join_event_guarded(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_event_guarded(p_event_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  perform public.enforce_event_join_guardrails(v_me);

  select public.join_public_event(p_event_id) into v_status;
  return v_status;
end;
$$;


--
-- Name: join_public_event(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_public_event(p_event_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_existing public.event_members;
  v_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if coalesce(v_event.hidden_by_admin, false) then
    raise exception 'event_hidden';
  end if;

  if v_event.visibility <> 'public' then
    raise exception 'private_event_requires_request';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open';
  end if;

  if v_event.host_user_id = v_me then
    return 'host';
  end if;

  select *
    into v_existing
  from public.event_members em
  where em.event_id = p_event_id
    and em.user_id = v_me
  limit 1;

  if v_existing is not null and v_existing.status in ('going', 'host', 'waitlist') then
    return v_existing.status;
  end if;

  if public.event_has_capacity(p_event_id) then
    v_status := 'going';
  else
    v_status := 'waitlist';
  end if;

  insert into public.event_members (event_id, user_id, member_role, status)
  values (p_event_id, v_me, 'guest', v_status)
  on conflict (event_id, user_id)
  do update set
    status = excluded.status,
    member_role = 'guest',
    updated_at = now();

  return v_status;
end;
$$;


--
-- Name: leave_event(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.leave_event(p_event_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_host uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select e.host_user_id into v_host
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_host is null then
    raise exception 'event_not_found';
  end if;

  if v_host = v_me then
    raise exception 'host_cannot_leave_own_event';
  end if;

  update public.event_members em
    set status = 'left',
        updated_at = now()
  where em.event_id = p_event_id
    and em.user_id = v_me
    and em.status in ('going', 'waitlist');

  if not found then
    raise exception 'membership_not_found';
  end if;
end;
$$;


--
-- Name: list_public_events_lite(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_public_events_lite(p_limit integer DEFAULT 300) RETURNS TABLE(id uuid, host_user_id uuid, title text, description text, event_type text, styles text[], visibility text, city text, country text, venue_name text, venue_address text, starts_at timestamp with time zone, ends_at timestamp with time zone, capacity integer, cover_url text, cover_status text, cover_reviewed_by uuid, cover_reviewed_at timestamp with time zone, cover_review_note text, hidden_by_admin boolean, hidden_reason text, links jsonb, status text, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    e.id,
    e.host_user_id,
    e.title,
    e.description,
    e.event_type,
    coalesce(e.styles, '{}'::text[]) as styles,
    e.visibility,
    e.city,
    e.country,
    e.venue_name,
    null::text as venue_address,
    e.starts_at,
    e.ends_at,
    e.capacity,
    case
      when coalesce(e.cover_status, 'pending') = 'approved' then e.cover_url
      when e.cover_url is null then null
      else null
    end as cover_url,
    coalesce(e.cover_status, 'pending') as cover_status,
    e.cover_reviewed_by,
    e.cover_reviewed_at,
    e.cover_review_note,
    coalesce(e.hidden_by_admin, false) as hidden_by_admin,
    e.hidden_reason,
    '[]'::jsonb as links,
    e.status,
    e.created_at,
    e.updated_at
  from public.events e
  where e.status = 'published'
    and e.visibility = 'public'
    and coalesce(e.hidden_by_admin, false) = false
  order by e.starts_at asc
  limit greatest(1, least(coalesce(p_limit, 300), 500));
$$;


--
-- Name: mark_sync_completed(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_sync_completed(p_connection_id uuid, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: moderate_event(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.moderate_event(p_event_id uuid, p_action text, p_note text DEFAULT NULL::text, p_hidden_reason text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_hidden_reason text := nullif(trim(coalesce(p_hidden_reason, '')), '');
  v_log_id uuid;
  v_after_status text;
  v_after_cover_status text;
  v_after_hidden bool;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if not public.is_app_admin(v_me) then
    raise exception 'not_authorized';
  end if;

  if v_action not in ('approve_cover', 'reject_cover', 'hide', 'unhide', 'cancel', 'publish') then
    raise exception 'invalid_action';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_action = 'approve_cover' then
    if nullif(trim(coalesce(v_event.cover_url, '')), '') is null then
      raise exception 'event_cover_missing';
    end if;

    update public.events
      set cover_status = 'approved',
          cover_reviewed_by = v_me,
          cover_reviewed_at = now(),
          cover_review_note = v_note,
          updated_at = now()
    where id = p_event_id;
  elsif v_action = 'reject_cover' then
    if nullif(trim(coalesce(v_event.cover_url, '')), '') is null then
      raise exception 'event_cover_missing';
    end if;

    update public.events
      set cover_status = 'rejected',
          cover_reviewed_by = v_me,
          cover_reviewed_at = now(),
          cover_review_note = coalesce(v_note, 'Cover rejected by moderation.'),
          updated_at = now()
    where id = p_event_id;
  elsif v_action = 'hide' then
    update public.events
      set hidden_by_admin = true,
          hidden_reason = coalesce(v_hidden_reason, v_note, 'Hidden by moderation'),
          hidden_by = v_me,
          hidden_at = now(),
          updated_at = now()
    where id = p_event_id;
  elsif v_action = 'unhide' then
    update public.events
      set hidden_by_admin = false,
          hidden_reason = null,
          hidden_by = null,
          hidden_at = null,
          updated_at = now()
    where id = p_event_id;
  elsif v_action = 'cancel' then
    update public.events
      set status = 'cancelled',
          updated_at = now()
    where id = p_event_id;
  elsif v_action = 'publish' then
    update public.events
      set status = 'published',
          updated_at = now()
    where id = p_event_id;
  end if;

  select status, cover_status, hidden_by_admin
    into v_after_status, v_after_cover_status, v_after_hidden
  from public.events
  where id = p_event_id;

  if to_regclass('public.moderation_logs') is not null then
    insert into public.moderation_logs (
      report_id,
      actor_id,
      target_user_id,
      action,
      reason,
      note,
      metadata
    )
    values (
      null,
      v_me,
      v_event.host_user_id,
      'event_' || v_action,
      v_hidden_reason,
      v_note,
      jsonb_build_object(
        'event_id', v_event.id,
        'event_title', v_event.title,
        'from_status', v_event.status,
        'to_status', v_after_status,
        'from_cover_status', coalesce(v_event.cover_status, 'pending'),
        'to_cover_status', coalesce(v_after_cover_status, 'pending'),
        'from_hidden', coalesce(v_event.hidden_by_admin, false),
        'to_hidden', coalesce(v_after_hidden, false),
        'visibility', v_event.visibility
      )
    )
    returning id into v_log_id;
  else
    v_log_id := null;
  end if;

  return v_log_id;
end;
$$;


--
-- Name: moderate_report(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.moderate_report(p_report_id uuid, p_action text, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_me uuid := auth.uid();
  v_report record;
  v_log_id uuid;
  v_next_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if not public.is_app_admin(v_me) then
    raise exception 'not_authorized';
  end if;

  if to_regclass('public.reports') is null then
    raise exception 'reports_table_missing';
  end if;

  if p_action not in ('resolve', 'dismiss', 'reopen') then
    raise exception 'invalid_action';
  end if;

  select r.*
    into v_report
  from public.reports r
  where r.id = p_report_id
  limit 1;

  if v_report is null then
    raise exception 'report_not_found';
  end if;

  v_next_status :=
    case p_action
      when 'resolve' then 'resolved'
      when 'dismiss' then 'dismissed'
      when 'reopen' then 'open'
      else 'open'
    end;

  execute 'update public.reports set status = $1 where id = $2'
    using v_next_status, p_report_id;

  insert into public.moderation_logs (
    report_id,
    actor_id,
    target_user_id,
    action,
    note,
    metadata
  )
  values (
    p_report_id,
    v_me,
    (to_jsonb(v_report)->>'target_user_id')::uuid,
    p_action,
    nullif(trim(p_note), ''),
    jsonb_build_object('from_status', coalesce(to_jsonb(v_report)->>'status', ''))
  )
  returning id into v_log_id;

  return v_log_id;
end;
$_$;


--
-- Name: normalize_event_styles(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_event_styles(p_styles text[]) RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select coalesce(
    array(
      select distinct lower(trim(s))
      from unnest(coalesce(p_styles, '{}'::text[])) as s
      where trim(s) <> ''
      order by 1
    ),
    '{}'::text[]
  );
$$;


--
-- Name: prevent_core_trip_changes_when_requested(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_core_trip_changes_when_requested() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  -- Only check if core fields changed
  if (new.destination_city is distinct from old.destination_city)
     or (new.destination_country is distinct from old.destination_country)
     or (new.start_date is distinct from old.start_date)
     or (new.end_date is distinct from old.end_date)
  then
    if exists (
      select 1
      from public.trip_requests r
      where r.trip_id = old.id
        and r.status in ('pending','accepted')
      limit 1
    ) then
      raise exception 'Trip destination/dates are locked once requests exist. Close and create a new trip.';
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: propose_connection_sync(uuid, text, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.propose_connection_sync(p_connection_id uuid, p_sync_type text, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_conn record;
  v_recipient uuid;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_sync_type not in ('training', 'social_dancing', 'workshop') then
    raise exception 'invalid_sync_type';
  end if;

  select c.*
    into v_conn
  from public.connections c
  where c.id = p_connection_id
    and c.status = 'accepted'
    and c.blocked_by is null
    and (c.requester_id = v_me or c.target_id = v_me)
  limit 1;

  if v_conn is null then
    raise exception 'connection_not_eligible';
  end if;

  v_recipient := case when v_conn.requester_id = v_me then v_conn.target_id else v_conn.requester_id end;

  insert into public.connection_syncs (
    connection_id,
    requester_id,
    recipient_id,
    sync_type,
    scheduled_at,
    note,
    status
  )
  values (
    p_connection_id,
    v_me,
    v_recipient,
    p_sync_type,
    p_scheduled_at,
    nullif(trim(coalesce(p_note, '')), ''),
    'pending'
  )
  returning id into v_id;

  perform public.create_notification(
    v_recipient,
    'sync_proposed',
    'New sync proposal',
    'You received a new sync proposal.',
    '/connections/' || p_connection_id::text,
    jsonb_build_object('connection_id', p_connection_id, 'sync_id', v_id, 'sync_type', p_sync_type)
  );

  return v_id;
end;
$$;


--
-- Name: recalc_connections_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalc_connections_count(p_user uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  update public.profiles p
  set connections_count = (
    select count(*)
    from public.connections c
    where c.status = 'accepted'
      and (c.requester_id = p_user or c.target_id = p_user)
  )
  where p.user_id = p_user;
end;
$$;


--
-- Name: references_guardrails(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.references_guardrails() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
declare
  v_ref_created_at timestamptz;
  v_connection_id uuid;
  v_has_syncs bool;
  v_sync_ok bool;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_ref_created_at := nullif(coalesce(to_jsonb(old)->>'created_at', ''), '')::timestamptz;
    if v_ref_created_at is not null and v_ref_created_at < now() - interval '15 days' then
      raise exception 'references_immutable_after_15_days';
    end if;
    return coalesce(new, old);
  end if;

  -- INSERT checks
  if tg_op = 'INSERT' then
    v_connection_id := nullif(coalesce(to_jsonb(new)->>'connection_id', ''), '')::uuid;
    if v_connection_id is null then
      raise exception 'reference_connection_required';
    end if;

    v_has_syncs := to_regclass('public.syncs') is not null;
    v_sync_ok := false;

    if v_has_syncs then
      begin
        -- Accept either explicit completion timestamp or completed status.
        execute $sql$
          select exists (
            select 1
            from public.syncs s
            where s.connection_id = $1
              and (
                (to_jsonb(s)->>'completed_at') is not null
                or coalesce(to_jsonb(s)->>'status', '') = 'completed'
              )
          )
        $sql$
        into v_sync_ok
        using v_connection_id;
      exception
        when undefined_column then
          v_sync_ok := false;
      end;
    end if;

    -- Fallback: at minimum require accepted/unblocked connection.
    if not v_sync_ok then
      select exists (
        select 1
        from public.connections c
        where c.id = v_connection_id
          and c.status = 'accepted'
          and c.blocked_by is null
      ) into v_sync_ok;
    end if;

    if not v_sync_ok then
      raise exception 'references_require_completed_sync';
    end if;
  end if;

  return new;
end;
$_$;


--
-- Name: reply_reference_receiver(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reply_reference_receiver(p_reference_id uuid, p_reply_text text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: request_private_event_access(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_private_event_access(p_event_id uuid, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_existing_member public.event_members;
  v_req_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if coalesce(v_event.hidden_by_admin, false) then
    raise exception 'event_hidden';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open';
  end if;

  if v_event.visibility <> 'private' then
    raise exception 'event_is_public';
  end if;

  if v_event.host_user_id = v_me then
    raise exception 'host_cannot_request_own_event';
  end if;

  select *
    into v_existing_member
  from public.event_members em
  where em.event_id = p_event_id
    and em.user_id = v_me
    and em.status in ('host', 'going', 'waitlist')
  limit 1;

  if v_existing_member is not null then
    raise exception 'already_joined_or_waitlisted';
  end if;

  insert into public.event_requests (event_id, requester_id, note, status)
  values (p_event_id, v_me, nullif(trim(coalesce(p_note, '')), ''), 'pending')
  on conflict (event_id, requester_id)
  do update set
    note = excluded.note,
    status = 'pending',
    decided_by = null,
    decided_at = null,
    updated_at = now()
  returning id into v_req_id;

  return v_req_id;
end;
$$;


--
-- Name: respond_connection_sync(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.respond_connection_sync(p_sync_id uuid, p_action text, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_row record;
  v_next_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_action not in ('accept', 'decline') then
    raise exception 'invalid_action';
  end if;

  select *
    into v_row
  from public.connection_syncs s
  where s.id = p_sync_id
  limit 1;

  if v_row is null then
    raise exception 'sync_not_found';
  end if;

  if v_row.recipient_id <> v_me then
    raise exception 'not_authorized';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'sync_not_pending';
  end if;

  v_next_status := case when p_action = 'accept' then 'accepted' else 'declined' end;

  update public.connection_syncs
  set status = v_next_status,
      note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note),
      updated_at = now()
  where id = p_sync_id;

  perform public.create_notification(
    v_row.requester_id,
    case when p_action = 'accept' then 'sync_accepted' else 'sync_declined' end,
    case when p_action = 'accept' then 'Sync accepted' else 'Sync declined' end,
    null,
    '/connections/' || v_row.connection_id::text,
    jsonb_build_object('connection_id', v_row.connection_id, 'sync_id', p_sync_id)
  );

  return p_sync_id;
end;
$$;


--
-- Name: respond_event_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.respond_event_request(p_request_id uuid, p_action text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_request public.event_requests;
  v_event public.events;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_member_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if v_action not in ('accept', 'decline') then
    raise exception 'invalid_action';
  end if;

  select *
    into v_request
  from public.event_requests r
  where r.id = p_request_id
  limit 1;

  if v_request is null then
    raise exception 'request_not_found';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = v_request.event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_event.host_user_id <> v_me then
    raise exception 'not_authorized';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  if coalesce(v_event.hidden_by_admin, false) then
    raise exception 'event_hidden';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open';
  end if;

  if v_action = 'accept' then
    if public.event_has_capacity(v_event.id) then
      v_member_status := 'going';
    else
      v_member_status := 'waitlist';
    end if;

    insert into public.event_members (event_id, user_id, member_role, status)
    values (v_event.id, v_request.requester_id, 'guest', v_member_status)
    on conflict (event_id, user_id)
    do update set
      member_role = 'guest',
      status = excluded.status,
      updated_at = now();

    update public.event_requests
      set status = 'accepted',
          decided_by = v_me,
          decided_at = now(),
          updated_at = now()
    where id = p_request_id;
  else
    update public.event_requests
      set status = 'declined',
          decided_by = v_me,
          decided_at = now(),
          updated_at = now()
    where id = p_request_id;
  end if;

  return v_event.id;
end;
$$;


--
-- Name: respond_event_request_by_id(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.respond_event_request_by_id(p_event_id uuid, p_requester_id uuid, p_action text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_request_id uuid;
begin
  select r.id
    into v_request_id
  from public.event_requests r
  where r.event_id = p_event_id
    and r.requester_id = p_requester_id
  limit 1;

  if v_request_id is null then
    raise exception 'request_not_found';
  end if;

  return public.respond_event_request(v_request_id, p_action);
end;
$$;


--
-- Name: respond_trip_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.respond_trip_request(p_request_id uuid, p_action text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_row record;
  v_thread_id uuid;
  v_next_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_action not in ('accept', 'decline') then
    raise exception 'invalid_action';
  end if;

  select tr.*, t.user_id as owner_id
    into v_row
  from public.trip_requests tr
  join public.trips t on t.id = tr.trip_id
  where tr.id = p_request_id
  limit 1;

  if v_row is null then
    raise exception 'trip_request_not_found';
  end if;

  if v_row.owner_id <> v_me then
    raise exception 'not_authorized';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'trip_request_not_pending';
  end if;

  v_next_status := case when p_action = 'accept' then 'accepted' else 'declined' end;

  update public.trip_requests
  set status = v_next_status,
      decided_by = v_me,
      decided_at = now(),
      updated_at = now()
  where id = p_request_id;

  if p_action = 'accept' then
    insert into public.threads (thread_type, trip_id, created_by, last_message_at)
    values ('trip', v_row.trip_id, v_me, now())
    on conflict (trip_id) do update set updated_at = now()
    returning id into v_thread_id;

    if v_thread_id is null then
      select id into v_thread_id from public.threads where trip_id = v_row.trip_id limit 1;
    end if;

    if v_thread_id is not null then
      insert into public.thread_participants (thread_id, user_id, role)
      values
        (v_thread_id, v_row.owner_id, 'owner'),
        (v_thread_id, v_row.requester_id, 'member')
      on conflict (thread_id, user_id) do nothing;
    end if;
  end if;

  perform public.create_notification(
    v_row.requester_id,
    case when p_action = 'accept' then 'trip_request_accepted' else 'trip_request_declined' end,
    case when p_action = 'accept' then 'Trip request accepted' else 'Trip request declined' end,
    null,
    '/trips/' || v_row.trip_id::text,
    jsonb_build_object('trip_id', v_row.trip_id, 'request_id', p_request_id)
  );

  return v_row.trip_id;
end;
$$;


--
-- Name: send_message(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_message(p_connection_id uuid, p_body text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: set_event_feedback_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_event_feedback_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: set_event_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_event_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: set_reference_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_reference_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: set_updated_at_ts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at_ts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: set_verified_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_verified_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.verified = true and old.verified = false then
    new.verified_at := now();
  end if;

  if new.verified = false then
    new.verified_at := null;
    new.verified_by := null;
  end if;

  return new;
end;
$$;


--
-- Name: submit_event_feedback(uuid, boolean, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_event_feedback(p_event_id uuid, p_happened_as_described boolean, p_quality integer, p_note text DEFAULT NULL::text, p_visibility text DEFAULT 'private'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_visibility text := lower(trim(coalesce(p_visibility, 'private')));
  v_existing_created_at timestamptz;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_quality is null or p_quality < 1 or p_quality > 5 then
    raise exception 'invalid_quality';
  end if;

  if v_visibility not in ('private', 'public') then
    raise exception 'invalid_visibility';
  end if;

  if not public.can_submit_event_feedback(p_event_id, v_me) then
    raise exception 'event_feedback_not_allowed';
  end if;

  if length(trim(coalesce(p_note, ''))) > 1000 then
    raise exception 'feedback_note_too_long';
  end if;

  select ef.created_at
    into v_existing_created_at
  from public.event_feedback ef
  where ef.event_id = p_event_id
    and ef.author_id = v_me
  limit 1;

  if v_existing_created_at is not null and v_existing_created_at < now() - interval '15 days' then
    raise exception 'feedback_locked_after_15_days';
  end if;

  insert into public.event_feedback (
    event_id,
    author_id,
    happened_as_described,
    quality,
    note,
    visibility
  )
  values (
    p_event_id,
    v_me,
    p_happened_as_described,
    p_quality,
    nullif(trim(coalesce(p_note, '')), ''),
    v_visibility
  )
  on conflict (event_id, author_id)
  do update set
    happened_as_described = excluded.happened_as_described,
    quality = excluded.quality,
    note = excluded.note,
    visibility = excluded.visibility,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;


--
-- Name: sync_has_other_style(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_has_other_style() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.has_other_style :=
    exists (
      select 1
      from jsonb_object_keys(coalesce(new.dance_skills, '{}'::jsonb)) k(key)
      where k.key not in ('Bachata','Salsa','Kizomba','Zouk')
    );
  return new;
end;
$$;


--
-- Name: unblock_connection(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unblock_connection(p_connection_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: undo_decline_connection_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.undo_decline_connection_request(p_connection_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

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


--
-- Name: update_event(uuid, text, text, text, text[], text, text, text, text, text, timestamp with time zone, timestamp with time zone, integer, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_event(p_event_id uuid, p_title text, p_description text, p_event_type text, p_styles text[] DEFAULT NULL::text[], p_visibility text DEFAULT 'public'::text, p_city text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_venue_name text DEFAULT NULL::text, p_venue_address text DEFAULT NULL::text, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_capacity integer DEFAULT NULL::integer, p_cover_url text DEFAULT NULL::text, p_links jsonb DEFAULT '[]'::jsonb, p_status text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_visibility text;
  v_status text;
  v_cover_url text;
  v_styles text[];
  v_edit_count int := 0;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_event.host_user_id <> v_me then
    raise exception 'not_authorized';
  end if;

  select count(*)::int
    into v_edit_count
  from public.event_edit_logs l
  where l.editor_id = v_me
    and l.created_at >= now() - interval '1 day';

  if v_edit_count >= 5 then
    raise exception 'edit_rate_limit_daily';
  end if;

  v_visibility := lower(trim(coalesce(p_visibility, v_event.visibility)));
  if v_visibility not in ('public', 'private') then
    raise exception 'invalid_visibility';
  end if;

  v_status := lower(trim(coalesce(p_status, v_event.status)));
  if v_status not in ('draft', 'published', 'cancelled') then
    raise exception 'invalid_status';
  end if;

  v_cover_url := nullif(trim(coalesce(p_cover_url, v_event.cover_url, '')), '');
  if v_cover_url is not null then
    if v_cover_url !~* '/storage/v1/object/public/avatars/' then
      raise exception 'invalid_cover_url';
    end if;
    if v_cover_url !~* '\\.(jpg|jpeg|png|webp)(\\?.*)?$' then
      raise exception 'invalid_cover_format';
    end if;
  end if;

  if p_starts_at is null and p_ends_at is null then
    null;
  elsif p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_event_window';
  end if;

  if p_capacity is not null and (p_capacity < 1 or p_capacity > 2000) then
    raise exception 'invalid_capacity';
  end if;

  v_styles := public.normalize_event_styles(coalesce(p_styles, v_event.styles));
  if cardinality(v_styles) > 12 then
    raise exception 'too_many_styles';
  end if;

  update public.events
  set title = trim(coalesce(p_title, v_event.title)),
      description = nullif(trim(coalesce(p_description, v_event.description, '')), ''),
      event_type = coalesce(nullif(trim(coalesce(p_event_type, v_event.event_type)), ''), 'Social'),
      styles = coalesce(v_styles, '{}'::text[]),
      visibility = v_visibility,
      city = trim(coalesce(p_city, v_event.city)),
      country = trim(coalesce(p_country, v_event.country)),
      venue_name = nullif(trim(coalesce(p_venue_name, v_event.venue_name, '')), ''),
      venue_address = nullif(trim(coalesce(p_venue_address, v_event.venue_address, '')), ''),
      starts_at = coalesce(p_starts_at, v_event.starts_at),
      ends_at = coalesce(p_ends_at, v_event.ends_at),
      capacity = p_capacity,
      cover_url = v_cover_url,
      cover_status = case
        when v_cover_url is null then 'approved'
        when v_cover_url is distinct from v_event.cover_url then 'pending'
        else v_event.cover_status
      end,
      cover_reviewed_by = case when v_cover_url is distinct from v_event.cover_url then null else v_event.cover_reviewed_by end,
      cover_reviewed_at = case when v_cover_url is distinct from v_event.cover_url then null else v_event.cover_reviewed_at end,
      cover_review_note = case when v_cover_url is distinct from v_event.cover_url then null else v_event.cover_review_note end,
      links = coalesce(p_links, '[]'::jsonb),
      status = v_status,
      updated_at = now()
  where id = p_event_id;

  insert into public.event_edit_logs (event_id, editor_id)
  values (p_event_id, v_me);

  return p_event_id;
end;
$_$;


--
-- Name: update_reference_author(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_reference_author(p_reference_id uuid, p_sentiment text, p_body text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    and r.created_at >= now() - interval '15 days';

  if not found then
    raise exception 'reference_update_not_allowed';
  end if;

  return p_reference_id;
end;
$$;


--
-- Name: update_thread_last_message_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_thread_last_message_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  update public.threads
  set last_message_at = new.created_at,
      updated_at = now()
  where id = new.thread_id;

  return new;
end;
$$;


--
-- Name: admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admins (
    user_id uuid NOT NULL
);


--
-- Name: connect_reasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connect_reasons (
    id text NOT NULL,
    role text NOT NULL,
    label text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    context text DEFAULT 'member'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT connect_reasons_context_check CHECK ((context = ANY (ARRAY['member'::text, 'trip'::text]))),
    CONSTRAINT connect_reasons_role_check CHECK ((role = ANY (ARRAY['Social Dancer / Student'::text, 'Organizer'::text, 'Studio Owner'::text, 'Promoter'::text, 'DJ'::text, 'Artist'::text, 'Teacher'::text])))
);

ALTER TABLE ONLY public.connect_reasons FORCE ROW LEVEL SECURITY;


--
-- Name: connection_syncs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connection_syncs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connection_id uuid NOT NULL,
    requester_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    sync_type text NOT NULL,
    scheduled_at timestamp with time zone,
    note text,
    status text DEFAULT 'pending'::text NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT connection_syncs_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text, 'completed'::text]))),
    CONSTRAINT connection_syncs_type_chk CHECK ((sync_type = ANY (ARRAY['training'::text, 'social_dancing'::text, 'workshop'::text])))
);


--
-- Name: connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    requester_id uuid NOT NULL,
    target_id uuid NOT NULL,
    status public.connection_status DEFAULT 'pending'::public.connection_status NOT NULL,
    blocked_by uuid,
    connect_context text DEFAULT 'member'::text,
    connect_reason text,
    connect_reason_role text,
    trip_id uuid,
    connect_note text,
    block_reason text,
    CONSTRAINT connections_connect_context_check CHECK ((connect_context = ANY (ARRAY['member'::text, 'traveller'::text]))),
    CONSTRAINT connections_not_self CHECK ((requester_id <> target_id))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    display_name text NOT NULL,
    city text NOT NULL,
    country text,
    dance_styles text[] DEFAULT '{}'::text[] NOT NULL,
    level text,
    instagram_handle text,
    bio text,
    avatar_url text DEFAULT 'https://i.pravatar.cc/300'::text,
    nationality text,
    roles text[] DEFAULT '{}'::text[] NOT NULL,
    languages text[] DEFAULT '{}'::text[] NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    verified_by uuid,
    verified_label text,
    dance_skills jsonb DEFAULT '{}'::jsonb NOT NULL,
    connections_count integer DEFAULT 0 NOT NULL,
    interests text[] DEFAULT '{}'::text[],
    availability text[] DEFAULT '{}'::text[],
    whatsapp_handle text,
    youtube_url text,
    avatar_path text,
    avatar_status text DEFAULT 'pending'::text,
    is_admin boolean DEFAULT false,
    is_test boolean DEFAULT false NOT NULL,
    auth_user_id uuid,
    has_other_style boolean DEFAULT false NOT NULL,
    last_seen_at timestamp with time zone,
    organizer_verified boolean DEFAULT false NOT NULL,
    organizer_verified_at timestamp with time zone,
    organizer_verified_by uuid,
    CONSTRAINT profiles_avatar_not_blank CHECK ((length(TRIM(BOTH FROM COALESCE(avatar_url, ''::text))) >= 10)),
    CONSTRAINT profiles_avatar_status_check CHECK ((avatar_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT profiles_dance_skills_min_1 CHECK (((dance_skills IS NOT NULL) AND (jsonb_typeof(dance_skills) = 'object'::text) AND jsonb_path_exists(dance_skills, '$.*'::jsonpath))),
    CONSTRAINT profiles_dance_styles_min_1 CHECK (((dance_skills IS NOT NULL) AND (jsonb_typeof(dance_skills) = 'object'::text) AND (dance_skills <> '{}'::jsonb)))
);


--
-- Name: connections_count_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.connections_count_summary WITH (security_invoker='true') AS
 SELECT p.user_id,
    COALESCE(count(*) FILTER (WHERE (c.status = 'accepted'::public.connection_status)), (0)::bigint) AS connections_count
   FROM (public.profiles p
     LEFT JOIN public.connections c ON (((c.requester_id = p.user_id) OR (c.target_id = p.user_id))))
  GROUP BY p.user_id;


--
-- Name: demo_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demo_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    display_name text NOT NULL,
    city text NOT NULL,
    country text NOT NULL,
    roles text[] DEFAULT '{}'::text[] NOT NULL,
    languages text[] DEFAULT '{}'::text[] NOT NULL,
    interests text[] DEFAULT '{}'::text[] NOT NULL,
    availability text[] DEFAULT '{}'::text[] NOT NULL,
    avatar_url text,
    verified boolean DEFAULT false NOT NULL,
    dance_skills jsonb DEFAULT '{}'::jsonb NOT NULL,
    has_other_style boolean DEFAULT false NOT NULL,
    is_test boolean DEFAULT true NOT NULL,
    CONSTRAINT demo_profiles_dance_skills_min_1 CHECK (((dance_skills IS NOT NULL) AND (jsonb_typeof(dance_skills) = 'object'::text) AND jsonb_path_exists(dance_skills, '$.*'::jsonpath)))
);


--
-- Name: event_edit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_edit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    editor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: event_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    author_id uuid NOT NULL,
    happened_as_described boolean NOT NULL,
    quality smallint NOT NULL,
    note text,
    visibility text DEFAULT 'private'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_feedback_quality_chk CHECK (((quality >= 1) AND (quality <= 5))),
    CONSTRAINT event_feedback_visibility_chk CHECK ((visibility = ANY (ARRAY['private'::text, 'public'::text])))
);


--
-- Name: event_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    user_id uuid NOT NULL,
    member_role text DEFAULT 'guest'::text NOT NULL,
    status text DEFAULT 'going'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_members_status_chk CHECK ((status = ANY (ARRAY['host'::text, 'going'::text, 'waitlist'::text, 'left'::text])))
);


--
-- Name: event_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    reason text NOT NULL,
    note text,
    status text DEFAULT 'open'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_reports_status_chk CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'dismissed'::text])))
);


--
-- Name: event_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    requester_id uuid NOT NULL,
    note text,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_requests_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text])))
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    host_user_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    event_type text DEFAULT 'Social'::text NOT NULL,
    visibility text DEFAULT 'public'::text NOT NULL,
    city text NOT NULL,
    country text NOT NULL,
    venue_name text,
    venue_address text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    capacity integer,
    cover_url text,
    links jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'published'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cover_status text DEFAULT 'pending'::text,
    cover_reviewed_by uuid,
    cover_reviewed_at timestamp with time zone,
    cover_review_note text,
    hidden_by_admin boolean DEFAULT false NOT NULL,
    hidden_reason text,
    hidden_by uuid,
    hidden_at timestamp with time zone,
    styles text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT events_capacity_chk CHECK (((capacity IS NULL) OR ((capacity >= 1) AND (capacity <= 2000)))),
    CONSTRAINT events_cover_status_chk CHECK ((cover_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT events_status_chk CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'cancelled'::text]))),
    CONSTRAINT events_time_chk CHECK ((ends_at > starts_at)),
    CONSTRAINT events_visibility_chk CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text])))
);


--
-- Name: member_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_references (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    to_user_id uuid NOT NULL,
    from_user_id uuid NOT NULL,
    origin text NOT NULL,
    origin_id uuid,
    sentiment text DEFAULT 'positive'::text NOT NULL,
    note text,
    deleted_at timestamp with time zone,
    reply_note text,
    replied_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT member_references_deleted_requires_actor CHECK (((deleted_at IS NULL) OR (deleted_by IS NOT NULL))),
    CONSTRAINT member_references_no_self_ref CHECK ((from_user_id <> to_user_id)),
    CONSTRAINT member_references_note_len CHECK (((note IS NULL) OR ((char_length(btrim(note)) >= 20) AND (char_length(btrim(note)) <= 500)))),
    CONSTRAINT member_references_origin_check CHECK ((origin = ANY (ARRAY['member'::text, 'trip'::text, 'event'::text]))),
    CONSTRAINT member_references_reply_note_len CHECK (((reply_note IS NULL) OR ((char_length(btrim(reply_note)) >= 1) AND (char_length(btrim(reply_note)) <= 300)))),
    CONSTRAINT member_references_reply_requires_text CHECK (((replied_at IS NULL) OR (reply_note IS NOT NULL))),
    CONSTRAINT member_references_sentiment_check CHECK ((sentiment = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text])))
);


--
-- Name: member_syncs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_syncs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    from_user_id uuid NOT NULL,
    to_user_id uuid NOT NULL,
    origin text NOT NULL,
    origin_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    accepted_at timestamp with time zone,
    note text,
    CONSTRAINT member_syncs_origin_check CHECK ((origin = ANY (ARRAY['member'::text, 'trip'::text, 'event'::text]))),
    CONSTRAINT member_syncs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'cancelled'::text])))
);


--
-- Name: message_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_limits (
    user_id uuid NOT NULL,
    day date NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.message_limits FORCE ROW LEVEL SECURITY;


--
-- Name: message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id text NOT NULL,
    thread_kind text NOT NULL,
    thread_id uuid NOT NULL,
    reactor_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_reactions_emoji_len_chk CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 16))),
    CONSTRAINT message_reactions_thread_kind_chk CHECK ((thread_kind = ANY (ARRAY['connection'::text, 'trip'::text])))
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connection_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: moderation_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid,
    actor_id uuid NOT NULL,
    target_user_id uuid,
    action text NOT NULL,
    reason text,
    note text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    entity_id uuid,
    read_at timestamp with time zone,
    actor_id uuid,
    kind text,
    title text,
    body text,
    link_url text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_read boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.notifications FORCE ROW LEVEL SECURITY;


--
-- Name: photo_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photo_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    avatar_url text NOT NULL,
    reason text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    decision text
);


--
-- Name: profile_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_badges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    badge_type text NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."references" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sync_id uuid,
    author_id uuid NOT NULL,
    target_id uuid,
    rating text NOT NULL,
    feedback text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    connection_id uuid,
    recipient_id uuid,
    context text DEFAULT 'connection'::text,
    sentiment text,
    body text,
    entity_type text DEFAULT 'connection'::text,
    entity_id uuid,
    reply_text text,
    replied_by uuid,
    replied_at timestamp with time zone,
    edit_count integer DEFAULT 0 NOT NULL,
    last_edited_at timestamp with time zone,
    connection_request_id uuid,
    from_user_id uuid,
    source_id uuid,
    to_user_id uuid,
    content text,
    CONSTRAINT references_rating_check CHECK (((rating IS NULL) OR (lower(rating) = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text, '1'::text, '2'::text, '3'::text, '4'::text, '5'::text]))))
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reporter_id uuid NOT NULL,
    reported_user_id uuid NOT NULL,
    reason text NOT NULL,
    details text,
    status text DEFAULT 'open'::text NOT NULL,
    target_user_id uuid NOT NULL,
    context text NOT NULL,
    context_id uuid,
    note text,
    CONSTRAINT reports_context_check CHECK ((context = ANY (ARRAY['profile'::text, 'connection'::text, 'trip'::text, 'message'::text, 'reference'::text]))),
    CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'reviewing'::text, 'closed'::text])))
);


--
-- Name: syncs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.syncs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connection_id uuid NOT NULL,
    trip_id uuid,
    initiator_id uuid NOT NULL,
    type text NOT NULL,
    status text NOT NULL,
    scheduled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    completed_by uuid,
    completed_at timestamp with time zone DEFAULT now(),
    note text,
    CONSTRAINT syncs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text]))),
    CONSTRAINT syncs_type_check CHECK ((type = ANY (ARRAY['Training'::text, 'Social Dancing'::text, 'Practice'::text])))
);


--
-- Name: thread_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT thread_messages_body_check CHECK (((char_length(TRIM(BOTH FROM body)) >= 1) AND (char_length(TRIM(BOTH FROM body)) <= 1000)))
);


--
-- Name: thread_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    last_read_at timestamp with time zone,
    archived_at timestamp with time zone,
    muted_until timestamp with time zone,
    pinned_at timestamp with time zone
);


--
-- Name: threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_type text NOT NULL,
    connection_id uuid,
    trip_id uuid,
    event_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone
);


--
-- Name: trip_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trip_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_id uuid NOT NULL,
    requester_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reason text NOT NULL,
    note text,
    proposed_time text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trip_requests_status_allowed CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text]))),
    CONSTRAINT trip_requests_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.trip_requests FORCE ROW LEVEL SECURITY;


--
-- Name: user_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    blocker_id uuid NOT NULL,
    blocked_user_id uuid NOT NULL,
    reason text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reporter_id uuid NOT NULL,
    reported_user_id uuid NOT NULL,
    connection_id uuid,
    trip_id uuid,
    category text NOT NULL,
    reason text NOT NULL,
    note text,
    status text DEFAULT 'new'::text NOT NULL,
    handled_by uuid,
    handled_at timestamp with time zone
);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (user_id);


--
-- Name: connect_reasons connect_reasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connect_reasons
    ADD CONSTRAINT connect_reasons_pkey PRIMARY KEY (id);


--
-- Name: connection_syncs connection_syncs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connection_syncs
    ADD CONSTRAINT connection_syncs_pkey PRIMARY KEY (id);


--
-- Name: connections connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_pkey PRIMARY KEY (id);


--
-- Name: connections connections_unique_pair; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_unique_pair UNIQUE (requester_id, target_id);


--
-- Name: demo_profiles demo_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_profiles
    ADD CONSTRAINT demo_profiles_pkey PRIMARY KEY (id);


--
-- Name: event_edit_logs event_edit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_edit_logs
    ADD CONSTRAINT event_edit_logs_pkey PRIMARY KEY (id);


--
-- Name: event_feedback event_feedback_event_id_author_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_feedback
    ADD CONSTRAINT event_feedback_event_id_author_id_key UNIQUE (event_id, author_id);


--
-- Name: event_feedback event_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_feedback
    ADD CONSTRAINT event_feedback_pkey PRIMARY KEY (id);


--
-- Name: event_members event_members_event_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_members
    ADD CONSTRAINT event_members_event_id_user_id_key UNIQUE (event_id, user_id);


--
-- Name: event_members event_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_members
    ADD CONSTRAINT event_members_pkey PRIMARY KEY (id);


--
-- Name: event_reports event_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_reports
    ADD CONSTRAINT event_reports_pkey PRIMARY KEY (id);


--
-- Name: event_requests event_requests_event_id_requester_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_requests
    ADD CONSTRAINT event_requests_event_id_requester_id_key UNIQUE (event_id, requester_id);


--
-- Name: event_requests event_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_requests
    ADD CONSTRAINT event_requests_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: member_references member_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_references
    ADD CONSTRAINT member_references_pkey PRIMARY KEY (id);


--
-- Name: member_syncs member_syncs_no_dupe; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_syncs
    ADD CONSTRAINT member_syncs_no_dupe UNIQUE (from_user_id, to_user_id, origin, origin_id);


--
-- Name: member_syncs member_syncs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_syncs
    ADD CONSTRAINT member_syncs_pkey PRIMARY KEY (id);


--
-- Name: message_limits message_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_limits
    ADD CONSTRAINT message_limits_pkey PRIMARY KEY (user_id, day);


--
-- Name: message_reactions message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: moderation_logs moderation_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_logs
    ADD CONSTRAINT moderation_logs_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: photo_flags photo_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_flags
    ADD CONSTRAINT photo_flags_pkey PRIMARY KEY (id);


--
-- Name: profile_badges profile_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_badges
    ADD CONSTRAINT profile_badges_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_avatar_required; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_avatar_required CHECK (((avatar_url IS NOT NULL) AND (btrim(avatar_url) <> ''::text))) NOT VALID;


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);


--
-- Name: profiles profiles_roles_min_1; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_roles_min_1 CHECK (((roles IS NOT NULL) AND (array_length(roles, 1) >= 1))) NOT VALID;


--
-- Name: references references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: syncs syncs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.syncs
    ADD CONSTRAINT syncs_pkey PRIMARY KEY (id);


--
-- Name: thread_messages thread_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_messages
    ADD CONSTRAINT thread_messages_pkey PRIMARY KEY (id);


--
-- Name: thread_participants thread_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_participants
    ADD CONSTRAINT thread_participants_pkey PRIMARY KEY (id);


--
-- Name: thread_participants thread_participants_thread_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_participants
    ADD CONSTRAINT thread_participants_thread_id_user_id_key UNIQUE (thread_id, user_id);


--
-- Name: threads threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_pkey PRIMARY KEY (id);


--
-- Name: threads threads_type_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.threads
    ADD CONSTRAINT threads_type_chk CHECK ((thread_type = ANY (ARRAY['connection'::text, 'trip'::text]))) NOT VALID;


--
-- Name: trip_requests trip_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_pkey PRIMARY KEY (id);


--
-- Name: trips trips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_pkey PRIMARY KEY (id);


--
-- Name: user_blocks user_blocks_blocker_id_blocked_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_blocked_user_id_key UNIQUE (blocker_id, blocked_user_id);


--
-- Name: user_blocks user_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (id);


--
-- Name: user_reports user_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_reports
    ADD CONSTRAINT user_reports_pkey PRIMARY KEY (id);


--
-- Name: connect_reasons_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connect_reasons_active_idx ON public.connect_reasons USING btree (active);


--
-- Name: connect_reasons_context_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connect_reasons_context_idx ON public.connect_reasons USING btree (context);


--
-- Name: connect_reasons_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connect_reasons_role_idx ON public.connect_reasons USING btree (role);


--
-- Name: connections_blocked_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connections_blocked_by_idx ON public.connections USING btree (blocked_by);


--
-- Name: connections_context_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connections_context_idx ON public.connections USING btree (connect_context);


--
-- Name: connections_pair_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connections_pair_idx ON public.connections USING btree (requester_id, target_id);


--
-- Name: connections_requester_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connections_requester_idx ON public.connections USING btree (requester_id);


--
-- Name: connections_requester_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connections_requester_status_idx ON public.connections USING btree (requester_id, status, created_at DESC);


--
-- Name: connections_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connections_status_idx ON public.connections USING btree (status);


--
-- Name: connections_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connections_target_idx ON public.connections USING btree (target_id);


--
-- Name: connections_target_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connections_target_status_idx ON public.connections USING btree (target_id, status, created_at DESC);


--
-- Name: connections_trip_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connections_trip_id_idx ON public.connections USING btree (trip_id);


--
-- Name: connections_unique_pending_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX connections_unique_pending_pair ON public.connections USING btree (requester_id, target_id) WHERE (status = 'pending'::public.connection_status);


--
-- Name: demo_profiles_availability_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX demo_profiles_availability_gin ON public.demo_profiles USING gin (availability);


--
-- Name: demo_profiles_city_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX demo_profiles_city_idx ON public.demo_profiles USING btree (city);


--
-- Name: demo_profiles_country_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX demo_profiles_country_idx ON public.demo_profiles USING btree (country);


--
-- Name: demo_profiles_dance_skills_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX demo_profiles_dance_skills_gin ON public.demo_profiles USING gin (dance_skills jsonb_path_ops);


--
-- Name: demo_profiles_interests_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX demo_profiles_interests_gin ON public.demo_profiles USING gin (interests);


--
-- Name: demo_profiles_languages_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX demo_profiles_languages_gin ON public.demo_profiles USING gin (languages);


--
-- Name: demo_profiles_roles_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX demo_profiles_roles_gin ON public.demo_profiles USING gin (roles);


--
-- Name: idx_connection_syncs_connection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_connection_syncs_connection ON public.connection_syncs USING btree (connection_id, created_at DESC);


--
-- Name: idx_connection_syncs_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_connection_syncs_recipient ON public.connection_syncs USING btree (recipient_id, status, created_at DESC);


--
-- Name: idx_connection_syncs_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_connection_syncs_requester ON public.connection_syncs USING btree (requester_id, status, created_at DESC);


--
-- Name: idx_event_edit_logs_editor_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_edit_logs_editor_created ON public.event_edit_logs USING btree (editor_id, created_at DESC);


--
-- Name: idx_event_edit_logs_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_edit_logs_event ON public.event_edit_logs USING btree (event_id);


--
-- Name: idx_event_feedback_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_feedback_author ON public.event_feedback USING btree (author_id);


--
-- Name: idx_event_feedback_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_feedback_created ON public.event_feedback USING btree (created_at DESC);


--
-- Name: idx_event_feedback_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_feedback_event ON public.event_feedback USING btree (event_id);


--
-- Name: idx_event_members_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_members_event ON public.event_members USING btree (event_id);


--
-- Name: idx_event_members_event_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_members_event_status ON public.event_members USING btree (event_id, status);


--
-- Name: idx_event_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_members_user ON public.event_members USING btree (user_id);


--
-- Name: idx_event_reports_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_reports_event ON public.event_reports USING btree (event_id);


--
-- Name: idx_event_reports_reporter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_reports_reporter ON public.event_reports USING btree (reporter_id);


--
-- Name: idx_event_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_reports_status ON public.event_reports USING btree (status);


--
-- Name: idx_event_requests_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_requests_event ON public.event_requests USING btree (event_id);


--
-- Name: idx_event_requests_event_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_requests_event_status ON public.event_requests USING btree (event_id, status);


--
-- Name: idx_event_requests_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_requests_requester ON public.event_requests USING btree (requester_id);


--
-- Name: idx_events_city_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_city_country ON public.events USING btree (city, country);


--
-- Name: idx_events_city_starts_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_city_starts_at ON public.events USING btree (city, starts_at);


--
-- Name: idx_events_host; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_host ON public.events USING btree (host_user_id);


--
-- Name: idx_events_styles_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_styles_gin ON public.events USING gin (styles);


--
-- Name: idx_events_type_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_type_status ON public.events USING btree (event_type, status);


--
-- Name: idx_events_visibility_status_starts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_visibility_status_starts ON public.events USING btree (visibility, status, starts_at DESC);


--
-- Name: idx_message_reactions_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_reactions_message ON public.message_reactions USING btree (message_id, created_at DESC);


--
-- Name: idx_message_reactions_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_reactions_thread ON public.message_reactions USING btree (thread_kind, thread_id, created_at DESC);


--
-- Name: idx_moderation_logs_actor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_moderation_logs_actor_id ON public.moderation_logs USING btree (actor_id);


--
-- Name: idx_moderation_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_moderation_logs_created_at ON public.moderation_logs USING btree (created_at DESC);


--
-- Name: idx_moderation_logs_report_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_moderation_logs_report_id ON public.moderation_logs USING btree (report_id);


--
-- Name: idx_notifications_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, is_read, created_at DESC);


--
-- Name: idx_profiles_organizer_verified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_organizer_verified ON public.profiles USING btree (organizer_verified);


--
-- Name: idx_references_author_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_author_id ON public."references" USING btree (author_id);


--
-- Name: idx_references_connection_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_connection_id ON public."references" USING btree (connection_id);


--
-- Name: idx_references_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_created_at ON public."references" USING btree (created_at DESC);


--
-- Name: idx_references_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_entity ON public."references" USING btree (entity_type, entity_id);


--
-- Name: idx_references_recipient_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_recipient_id ON public."references" USING btree (recipient_id);


--
-- Name: idx_reports_reporter_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_reporter_created_at ON public.reports USING btree (reporter_id, created_at DESC);


--
-- Name: idx_reports_target_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_target_created_at ON public.reports USING btree (target_user_id, created_at DESC);


--
-- Name: idx_syncs_completed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_syncs_completed_by ON public.syncs USING btree (completed_by);


--
-- Name: idx_syncs_connection_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_syncs_connection_id ON public.syncs USING btree (connection_id);


--
-- Name: idx_thread_messages_sender_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_messages_sender_created ON public.thread_messages USING btree (sender_id, created_at DESC);


--
-- Name: idx_thread_messages_thread_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_messages_thread_created ON public.thread_messages USING btree (thread_id, created_at);


--
-- Name: idx_thread_participants_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_participants_thread ON public.thread_participants USING btree (thread_id, user_id);


--
-- Name: idx_thread_participants_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_participants_user ON public.thread_participants USING btree (user_id, thread_id);


--
-- Name: idx_thread_participants_user_archived; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_participants_user_archived ON public.thread_participants USING btree (user_id, archived_at);


--
-- Name: idx_thread_participants_user_muted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_participants_user_muted ON public.thread_participants USING btree (user_id, muted_until);


--
-- Name: idx_thread_participants_user_pinned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_participants_user_pinned ON public.thread_participants USING btree (user_id, pinned_at);


--
-- Name: idx_threads_last_message_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_threads_last_message_at ON public.threads USING btree (last_message_at DESC NULLS LAST, created_at DESC);


--
-- Name: idx_trip_requests_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trip_requests_requester ON public.trip_requests USING btree (requester_id, status, created_at DESC);


--
-- Name: idx_trip_requests_trip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trip_requests_trip ON public.trip_requests USING btree (trip_id, status, created_at DESC);


--
-- Name: member_references_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_references_created_at_idx ON public.member_references USING btree (created_at);


--
-- Name: member_references_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_references_deleted_at_idx ON public.member_references USING btree (deleted_at);


--
-- Name: member_references_origin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_references_origin_idx ON public.member_references USING btree (origin);


--
-- Name: member_references_to_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_references_to_user_id_idx ON public.member_references USING btree (to_user_id);


--
-- Name: member_syncs_from_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_syncs_from_user_id_idx ON public.member_syncs USING btree (from_user_id);


--
-- Name: member_syncs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_syncs_status_idx ON public.member_syncs USING btree (status);


--
-- Name: member_syncs_to_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_syncs_to_user_id_idx ON public.member_syncs USING btree (to_user_id);


--
-- Name: notifications_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_unread_idx ON public.notifications USING btree (user_id) WHERE (read_at IS NULL);


--
-- Name: notifications_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_id_idx ON public.notifications USING btree (user_id);


--
-- Name: photo_flags_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX photo_flags_created_idx ON public.photo_flags USING btree (created_at);


--
-- Name: photo_flags_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX photo_flags_status_idx ON public.photo_flags USING btree (status);


--
-- Name: photo_flags_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX photo_flags_user_id_idx ON public.photo_flags USING btree (user_id);


--
-- Name: profile_badges_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_badges_user_id_idx ON public.profile_badges USING btree (user_id);


--
-- Name: profiles_city_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_city_idx ON public.profiles USING btree (city);


--
-- Name: profiles_has_other_style_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_has_other_style_idx ON public.profiles USING btree (has_other_style);


--
-- Name: reports_reported_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_reported_idx ON public.reports USING btree (reported_user_id);


--
-- Name: reports_reported_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_reported_status_idx ON public.reports USING btree (reported_user_id, status);


--
-- Name: reports_reporter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_reporter_idx ON public.reports USING btree (reporter_id);


--
-- Name: reports_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_status_created_idx ON public.reports USING btree (status, created_at);


--
-- Name: trip_requests_requester_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trip_requests_requester_idx ON public.trip_requests USING btree (requester_id);


--
-- Name: trip_requests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trip_requests_status_idx ON public.trip_requests USING btree (status);


--
-- Name: trip_requests_trip_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trip_requests_trip_idx ON public.trip_requests USING btree (trip_id);


--
-- Name: trip_requests_unique_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX trip_requests_unique_pending ON public.trip_requests USING btree (trip_id, requester_id) WHERE (status = ANY (ARRAY['pending'::text, 'accepted'::text]));


--
-- Name: trips_dates_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trips_dates_idx ON public.trips USING btree (start_date, end_date);


--
-- Name: trips_destination_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trips_destination_idx ON public.trips USING btree (destination_country, destination_city);


--
-- Name: trips_no_duplicate_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX trips_no_duplicate_per_user ON public.trips USING btree (user_id, destination_country, destination_city, start_date, end_date);


--
-- Name: trips_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trips_status_idx ON public.trips USING btree (status);


--
-- Name: trips_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trips_user_id_idx ON public.trips USING btree (user_id);


--
-- Name: user_reports_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_reports_created_idx ON public.user_reports USING btree (created_at DESC);


--
-- Name: user_reports_reported_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_reports_reported_idx ON public.user_reports USING btree (reported_user_id);


--
-- Name: user_reports_reporter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_reports_reporter_idx ON public.user_reports USING btree (reporter_id);


--
-- Name: ux_event_reports_open_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_event_reports_open_unique ON public.event_reports USING btree (event_id, reporter_id) WHERE (status = 'open'::text);


--
-- Name: ux_message_reactions_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_message_reactions_unique ON public.message_reactions USING btree (thread_kind, thread_id, message_id, reactor_id, emoji);


--
-- Name: ux_references_entity_author; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_references_entity_author ON public."references" USING btree (entity_type, entity_id, author_id) WHERE ((entity_type IS NOT NULL) AND (entity_id IS NOT NULL));


--
-- Name: ux_syncs_connection_completed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_syncs_connection_completed_by ON public.syncs USING btree (connection_id, completed_by) WHERE (completed_by IS NOT NULL);


--
-- Name: ux_threads_connection; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_threads_connection ON public.threads USING btree (connection_id) WHERE (connection_id IS NOT NULL);


--
-- Name: ux_threads_trip; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_threads_trip ON public.threads USING btree (trip_id) WHERE (trip_id IS NOT NULL);


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: connection_syncs trg_connection_syncs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_connection_syncs_set_updated_at BEFORE UPDATE ON public.connection_syncs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: connections trg_connections_after_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_connections_after_write AFTER INSERT OR DELETE OR UPDATE ON public.connections FOR EACH ROW EXECUTE FUNCTION public.connections_after_write();


--
-- Name: connections trg_connections_enforce_limits; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_connections_enforce_limits BEFORE INSERT ON public.connections FOR EACH ROW EXECUTE FUNCTION public.enforce_connection_request_limits();


--
-- Name: demo_profiles trg_demo_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_demo_profiles_updated_at BEFORE UPDATE ON public.demo_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: trips trg_enforce_trip_create_rate_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_trip_create_rate_limit BEFORE INSERT ON public.trips FOR EACH ROW EXECUTE FUNCTION public.enforce_trip_create_rate_limit();


--
-- Name: event_feedback trg_event_feedback_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_event_feedback_set_updated_at BEFORE UPDATE ON public.event_feedback FOR EACH ROW EXECUTE FUNCTION public.set_event_feedback_updated_at();


--
-- Name: event_members trg_event_members_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_event_members_set_updated_at BEFORE UPDATE ON public.event_members FOR EACH ROW EXECUTE FUNCTION public.set_event_updated_at();


--
-- Name: event_requests trg_event_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_event_requests_set_updated_at BEFORE UPDATE ON public.event_requests FOR EACH ROW EXECUTE FUNCTION public.set_event_updated_at();


--
-- Name: events trg_events_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_events_set_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.set_event_updated_at();


--
-- Name: profiles trg_profiles_sync_has_other_style; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_sync_has_other_style BEFORE INSERT OR UPDATE OF dance_skills ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_has_other_style();


--
-- Name: references trg_references_guardrails; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_references_guardrails BEFORE INSERT OR DELETE OR UPDATE ON public."references" FOR EACH ROW EXECUTE FUNCTION public.references_guardrails();


--
-- Name: references trg_references_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_references_immutable BEFORE DELETE OR UPDATE ON public."references" FOR EACH ROW EXECUTE FUNCTION public.enforce_reference_immutability();


--
-- Name: references trg_references_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_references_set_updated_at BEFORE UPDATE ON public."references" FOR EACH ROW EXECUTE FUNCTION public.set_reference_updated_at();


--
-- Name: profiles trg_set_verified_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_verified_fields BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_verified_fields();


--
-- Name: thread_messages trg_thread_messages_daily_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_thread_messages_daily_limit BEFORE INSERT ON public.thread_messages FOR EACH ROW EXECUTE FUNCTION public.bump_thread_message_daily_limit();


--
-- Name: thread_messages trg_thread_messages_touch_thread; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_thread_messages_touch_thread AFTER INSERT ON public.thread_messages FOR EACH ROW EXECUTE FUNCTION public.update_thread_last_message_at();


--
-- Name: threads trg_threads_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_threads_set_updated_at BEFORE UPDATE ON public.threads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: trips trg_trip_lock_core_when_requested; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trip_lock_core_when_requested BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.prevent_core_trip_changes_when_requested();


--
-- Name: trip_requests trg_trip_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trip_requests_set_updated_at BEFORE UPDATE ON public.trip_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: trips trg_trips_daily_rate_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trips_daily_rate_limit BEFORE INSERT ON public.trips FOR EACH ROW EXECUTE FUNCTION public.enforce_trips_daily_rate_limit();


--
-- Name: trips trg_trips_enforce_max_5_active; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trips_enforce_max_5_active BEFORE INSERT OR UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.enforce_max_5_active_trips();


--
-- Name: admins admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: connection_syncs connection_syncs_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connection_syncs
    ADD CONSTRAINT connection_syncs_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: connections connections_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: connections connections_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_target_id_fkey FOREIGN KEY (target_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: connections connections_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE SET NULL;


--
-- Name: event_edit_logs event_edit_logs_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_edit_logs
    ADD CONSTRAINT event_edit_logs_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_feedback event_feedback_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_feedback
    ADD CONSTRAINT event_feedback_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_members event_members_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_members
    ADD CONSTRAINT event_members_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_reports event_reports_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_reports
    ADD CONSTRAINT event_reports_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_requests event_requests_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_requests
    ADD CONSTRAINT event_requests_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: member_references member_references_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_references
    ADD CONSTRAINT member_references_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: member_references member_references_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_references
    ADD CONSTRAINT member_references_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: member_syncs member_syncs_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_syncs
    ADD CONSTRAINT member_syncs_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: member_syncs member_syncs_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_syncs
    ADD CONSTRAINT member_syncs_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: message_limits message_limits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_limits
    ADD CONSTRAINT message_limits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: messages messages_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: moderation_logs moderation_logs_report_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_logs
    ADD CONSTRAINT moderation_logs_report_fk FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: photo_flags photo_flags_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_flags
    ADD CONSTRAINT photo_flags_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: profile_badges profile_badges_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_badges
    ADD CONSTRAINT profile_badges_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: profile_badges profile_badges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_badges
    ADD CONSTRAINT profile_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: references references_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id);


--
-- Name: references references_connection_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_connection_fk FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: references references_sync_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_sync_id_fkey FOREIGN KEY (sync_id) REFERENCES public.syncs(id) ON DELETE CASCADE;


--
-- Name: references references_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_target_id_fkey FOREIGN KEY (target_id) REFERENCES auth.users(id);


--
-- Name: reports reports_reported_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reports reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reports reports_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES auth.users(id);


--
-- Name: syncs syncs_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.syncs
    ADD CONSTRAINT syncs_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: syncs syncs_initiator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.syncs
    ADD CONSTRAINT syncs_initiator_id_fkey FOREIGN KEY (initiator_id) REFERENCES auth.users(id);


--
-- Name: syncs syncs_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.syncs
    ADD CONSTRAINT syncs_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id);


--
-- Name: thread_messages thread_messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_messages
    ADD CONSTRAINT thread_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: thread_participants thread_participants_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_participants
    ADD CONSTRAINT thread_participants_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: threads threads_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: threads threads_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: threads threads_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;


--
-- Name: trip_requests trip_requests_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: trip_requests trip_requests_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;


--
-- Name: trips trips_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: user_blocks user_blocks_blocked_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocked_user_id_fkey FOREIGN KEY (blocked_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_blocks user_blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_reports user_reports_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_reports
    ADD CONSTRAINT user_reports_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE SET NULL;


--
-- Name: user_reports user_reports_reported_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_reports
    ADD CONSTRAINT user_reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_reports user_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_reports
    ADD CONSTRAINT user_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_reports user_reports_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_reports
    ADD CONSTRAINT user_reports_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE SET NULL;


--
-- Name: photo_flags Admins can read flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read flags" ON public.photo_flags FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid()))));


--
-- Name: photo_flags Admins can update flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update flags" ON public.photo_flags FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid()))));


--
-- Name: reports Admins read all reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read all reports" ON public.reports FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid()))));


--
-- Name: photo_flags Admins read photo flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read photo flags" ON public.photo_flags FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid()))));


--
-- Name: photo_flags Admins update photo flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update photo flags" ON public.photo_flags FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid()))));


--
-- Name: reports Admins update reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update reports" ON public.reports FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid()))));


--
-- Name: trips Trips: owner can delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Trips: owner can delete" ON public.trips FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: trips Trips: owner can insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Trips: owner can insert" ON public.trips FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: trips Trips: owner can read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Trips: owner can read" ON public.trips FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: trips Trips: owner can update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Trips: owner can update" ON public.trips FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: trips Trips: public read for discover; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Trips: public read for discover" ON public.trips FOR SELECT USING (true);


--
-- Name: reports Users create report; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users create report" ON public.reports FOR INSERT WITH CHECK ((auth.uid() = reporter_id));


--
-- Name: reports Users read own reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own reports" ON public.reports FOR SELECT USING ((auth.uid() = reporter_id));


--
-- Name: admins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

--
-- Name: admins admins can read admins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins can read admins" ON public.admins FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: profiles admins can read profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins can read profiles" ON public.profiles FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid()))));


--
-- Name: profiles admins can update verification; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins can update verification" ON public.profiles FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid()))));


--
-- Name: profiles admins can verify profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins can verify profiles" ON public.profiles FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid()))));


--
-- Name: user_blocks blocks_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY blocks_delete_own ON public.user_blocks FOR DELETE USING ((blocker_id = auth.uid()));


--
-- Name: user_blocks blocks_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY blocks_insert_own ON public.user_blocks FOR INSERT WITH CHECK ((blocker_id = auth.uid()));


--
-- Name: user_blocks blocks_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY blocks_read_own ON public.user_blocks FOR SELECT USING ((blocker_id = auth.uid()));


--
-- Name: connect_reasons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connect_reasons ENABLE ROW LEVEL SECURITY;

--
-- Name: connect_reasons connect_reasons_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connect_reasons_admin_write ON public.connect_reasons TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.is_admin = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.is_admin = true)))));


--
-- Name: connect_reasons connect_reasons_read_authed; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connect_reasons_read_authed ON public.connect_reasons FOR SELECT TO authenticated USING (true);


--
-- Name: connection_syncs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connection_syncs ENABLE ROW LEVEL SECURITY;

--
-- Name: connection_syncs connection_syncs_insert_requester; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connection_syncs_insert_requester ON public.connection_syncs FOR INSERT TO authenticated WITH CHECK ((requester_id = auth.uid()));


--
-- Name: connection_syncs connection_syncs_select_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connection_syncs_select_participants ON public.connection_syncs FOR SELECT TO authenticated USING (((requester_id = auth.uid()) OR (recipient_id = auth.uid())));


--
-- Name: connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

--
-- Name: connections connections_insert_request; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connections_insert_request ON public.connections FOR INSERT TO authenticated WITH CHECK ((auth.uid() = requester_id));


--
-- Name: connections connections_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connections_read_own ON public.connections FOR SELECT TO authenticated USING (((auth.uid() = requester_id) OR (auth.uid() = target_id)));


--
-- Name: connections connections_requester_can_cancel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connections_requester_can_cancel ON public.connections FOR UPDATE USING (((auth.uid() = requester_id) AND (status = 'pending'::public.connection_status))) WITH CHECK (((auth.uid() = requester_id) AND (status = 'cancelled'::public.connection_status)));


--
-- Name: connections connections_requester_can_delete_pending; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connections_requester_can_delete_pending ON public.connections FOR DELETE USING (((auth.uid() = requester_id) AND (status = 'pending'::public.connection_status)));


--
-- Name: connections connections_target_can_respond; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connections_target_can_respond ON public.connections FOR UPDATE USING (((auth.uid() = target_id) AND (status = 'pending'::public.connection_status))) WITH CHECK (((auth.uid() = target_id) AND (status = ANY (ARRAY['accepted'::public.connection_status, 'declined'::public.connection_status]))));


--
-- Name: connections connections_update_by_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connections_update_by_participants ON public.connections FOR UPDATE USING (((auth.uid() = requester_id) OR (auth.uid() = target_id))) WITH CHECK (((auth.uid() = requester_id) OR (auth.uid() = target_id)));


--
-- Name: demo_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.demo_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: demo_profiles demo_profiles_read_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY demo_profiles_read_authenticated ON public.demo_profiles FOR SELECT TO authenticated USING (true);


--
-- Name: event_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: event_feedback event_feedback_insert_author; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_feedback_insert_author ON public.event_feedback FOR INSERT TO authenticated WITH CHECK ((author_id = auth.uid()));


--
-- Name: event_feedback event_feedback_select_visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_feedback_select_visible ON public.event_feedback FOR SELECT TO authenticated USING (((author_id = auth.uid()) OR public.is_app_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_feedback.event_id) AND (e.host_user_id = auth.uid()))))));


--
-- Name: event_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_members ENABLE ROW LEVEL SECURITY;

--
-- Name: event_members event_members_select_visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_members_select_visible ON public.event_members FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (public.event_host_user_id(event_id) = auth.uid()) OR public.is_app_admin(auth.uid())));


--
-- Name: event_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: event_reports event_reports_insert_reporter; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_reports_insert_reporter ON public.event_reports FOR INSERT TO authenticated WITH CHECK ((reporter_id = auth.uid()));


--
-- Name: event_reports event_reports_select_parties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_reports_select_parties ON public.event_reports FOR SELECT TO authenticated USING (((reporter_id = auth.uid()) OR public.is_app_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_reports.event_id) AND (e.host_user_id = auth.uid()))))));


--
-- Name: event_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: event_requests event_requests_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_requests_insert_owner ON public.event_requests FOR INSERT TO authenticated WITH CHECK (((requester_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_requests.event_id) AND (e.status = 'published'::text) AND (e.visibility = 'private'::text) AND (COALESCE(e.hidden_by_admin, false) = false) AND (e.host_user_id <> auth.uid()))))));


--
-- Name: event_requests event_requests_select_parties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_requests_select_parties ON public.event_requests FOR SELECT TO authenticated USING (((requester_id = auth.uid()) OR (public.event_host_user_id(event_id) = auth.uid()) OR public.is_app_admin(auth.uid())));


--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: events events_delete_host; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_delete_host ON public.events FOR DELETE TO authenticated USING ((host_user_id = auth.uid()));


--
-- Name: events events_insert_host; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_insert_host ON public.events FOR INSERT TO authenticated WITH CHECK ((host_user_id = auth.uid()));


--
-- Name: events events_select_visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_select_visible ON public.events FOR SELECT TO authenticated USING (((host_user_id = auth.uid()) OR public.is_app_admin(auth.uid()) OR ((status = 'published'::text) AND (visibility = 'public'::text) AND (COALESCE(hidden_by_admin, false) = false)) OR ((status = 'published'::text) AND (visibility = 'private'::text) AND (COALESCE(hidden_by_admin, false) = false) AND (EXISTS ( SELECT 1
   FROM public.event_members em
  WHERE ((em.event_id = events.id) AND (em.user_id = auth.uid()) AND (em.status = ANY (ARRAY['host'::text, 'going'::text, 'waitlist'::text])))))) OR ((status = 'published'::text) AND (visibility = 'private'::text) AND (COALESCE(hidden_by_admin, false) = false) AND (EXISTS ( SELECT 1
   FROM public.event_requests er
  WHERE ((er.event_id = events.id) AND (er.requester_id = auth.uid()) AND (er.status = 'accepted'::text)))))));


--
-- Name: events events_update_host; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_update_host ON public.events FOR UPDATE TO authenticated USING ((host_user_id = auth.uid())) WITH CHECK ((host_user_id = auth.uid()));


--
-- Name: member_references; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_references ENABLE ROW LEVEL SECURITY;

--
-- Name: member_references member_references_insert_as_author; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_references_insert_as_author ON public.member_references FOR INSERT TO authenticated WITH CHECK (((from_user_id = auth.uid()) AND (deleted_at IS NULL) AND (deleted_by IS NULL)));


--
-- Name: member_references member_references_insert_gated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_references_insert_gated ON public.member_references FOR INSERT TO authenticated WITH CHECK (((from_user_id = auth.uid()) AND (to_user_id <> auth.uid()) AND (deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.member_syncs s
  WHERE ((s.status = 'accepted'::text) AND (((s.from_user_id = s.from_user_id) AND (s.to_user_id = s.to_user_id)) OR ((s.from_user_id = s.to_user_id) AND (s.to_user_id = s.from_user_id))) AND (s.origin = s.origin) AND (NOT (s.origin_id IS DISTINCT FROM s.origin_id)))))));


--
-- Name: member_references member_references_read_all_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_references_read_all_authenticated ON public.member_references FOR SELECT TO authenticated USING (true);


--
-- Name: member_references member_references_read_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_references_read_auth ON public.member_references FOR SELECT TO authenticated USING ((deleted_at IS NULL));


--
-- Name: member_references member_references_update_author_or_receiver; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_references_update_author_or_receiver ON public.member_references FOR UPDATE TO authenticated USING (((from_user_id = auth.uid()) OR (to_user_id = auth.uid()))) WITH CHECK (((from_user_id = auth.uid()) OR (to_user_id = auth.uid())));


--
-- Name: member_syncs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_syncs ENABLE ROW LEVEL SECURITY;

--
-- Name: member_syncs member_syncs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_syncs_insert ON public.member_syncs FOR INSERT TO authenticated WITH CHECK (((from_user_id = auth.uid()) AND (to_user_id <> auth.uid())));


--
-- Name: member_syncs member_syncs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_syncs_read ON public.member_syncs FOR SELECT TO authenticated USING (((status = 'accepted'::text) OR (from_user_id = auth.uid()) OR (to_user_id = auth.uid())));


--
-- Name: member_syncs member_syncs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_syncs_update ON public.member_syncs FOR UPDATE TO authenticated USING (((from_user_id = auth.uid()) OR (to_user_id = auth.uid()))) WITH CHECK (((from_user_id = auth.uid()) OR (to_user_id = auth.uid())));


--
-- Name: message_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: message_limits message_limits_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_limits_read_own ON public.message_limits FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: message_limits message_limits_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_limits_select_own ON public.message_limits FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: message_limits message_limits_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_limits_update_own ON public.message_limits FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: message_limits message_limits_upsert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_limits_upsert_own ON public.message_limits FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: message_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: message_reactions message_reactions_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_reactions_delete_owner ON public.message_reactions FOR DELETE TO authenticated USING ((reactor_id = auth.uid()));


--
-- Name: message_reactions message_reactions_insert_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_reactions_insert_participant ON public.message_reactions FOR INSERT TO authenticated WITH CHECK (((reactor_id = auth.uid()) AND (((thread_kind = 'connection'::text) AND (EXISTS ( SELECT 1
   FROM public.connections c
  WHERE ((c.id = message_reactions.thread_id) AND (c.status = 'accepted'::public.connection_status) AND (c.blocked_by IS NULL) AND ((c.requester_id = auth.uid()) OR (c.target_id = auth.uid())))))) OR ((thread_kind = 'trip'::text) AND (EXISTS ( SELECT 1
   FROM (public.thread_participants tp
     JOIN public.threads t ON ((t.id = tp.thread_id)))
  WHERE ((t.id = message_reactions.thread_id) AND (t.thread_type = 'trip'::text) AND (tp.user_id = auth.uid()))))))));


--
-- Name: message_reactions message_reactions_select_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_reactions_select_participant ON public.message_reactions FOR SELECT TO authenticated USING ((((thread_kind = 'connection'::text) AND (EXISTS ( SELECT 1
   FROM public.connections c
  WHERE ((c.id = message_reactions.thread_id) AND (c.status = 'accepted'::public.connection_status) AND (c.blocked_by IS NULL) AND ((c.requester_id = auth.uid()) OR (c.target_id = auth.uid())))))) OR ((thread_kind = 'trip'::text) AND (EXISTS ( SELECT 1
   FROM (public.thread_participants tp
     JOIN public.threads t ON ((t.id = tp.thread_id)))
  WHERE ((t.id = message_reactions.thread_id) AND (t.thread_type = 'trip'::text) AND (tp.user_id = auth.uid())))))));


--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_delete_sender; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_delete_sender ON public.messages FOR DELETE TO authenticated USING (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.connections c
  WHERE ((c.id = messages.connection_id) AND ((c.requester_id = auth.uid()) OR (c.target_id = auth.uid())))))));


--
-- Name: messages messages_insert_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_insert_participants ON public.messages FOR INSERT WITH CHECK (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.connections c
  WHERE ((c.id = messages.connection_id) AND ((c.requester_id = auth.uid()) OR (c.target_id = auth.uid())) AND (c.blocked_by IS NULL))))));


--
-- Name: messages messages_select_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_select_participants ON public.messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.connections c
  WHERE ((c.id = messages.connection_id) AND ((c.requester_id = auth.uid()) OR (c.target_id = auth.uid())) AND (c.blocked_by IS NULL)))));


--
-- Name: moderation_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.moderation_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: moderation_logs moderation_logs_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY moderation_logs_select_admin ON public.moderation_logs FOR SELECT TO authenticated USING (public.is_app_admin(auth.uid()));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_delete_own ON public.notifications FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: notifications notifications_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_insert_own ON public.notifications FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: notifications notifications_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_read_own ON public.notifications FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: notifications notifications_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: notifications notifications_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: photo_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.photo_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: profile_badges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profile_badges ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: profiles profiles_read_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_read_authenticated ON public.profiles FOR SELECT TO authenticated USING (true);


--
-- Name: profiles profiles_read_public_non_test; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_read_public_non_test ON public.profiles FOR SELECT USING (((COALESCE(is_test, false) = false) OR (auth.uid() = user_id) OR (COALESCE(is_admin, false) = true)));


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: profile_badges read badges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read badges" ON public.profile_badges FOR SELECT TO authenticated, anon USING (true);


--
-- Name: references; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."references" ENABLE ROW LEVEL SECURITY;

--
-- Name: references references_insert_author; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY references_insert_author ON public."references" FOR INSERT TO authenticated WITH CHECK ((author_id = auth.uid()));


--
-- Name: references references_select_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY references_select_participants ON public."references" FOR SELECT TO authenticated USING (((author_id = auth.uid()) OR (recipient_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.connections c
  WHERE ((c.id = "references".connection_id) AND ((c.requester_id = auth.uid()) OR (c.target_id = auth.uid())))))));


--
-- Name: reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

--
-- Name: reports reports_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_insert_own ON public.reports FOR INSERT TO authenticated WITH CHECK ((auth.uid() = reporter_id));


--
-- Name: user_reports reports_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_insert_own ON public.user_reports FOR INSERT WITH CHECK ((reporter_id = auth.uid()));


--
-- Name: reports reports_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_read_own ON public.reports FOR SELECT TO authenticated USING ((auth.uid() = reporter_id));


--
-- Name: user_reports reports_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_read_own ON public.user_reports FOR SELECT USING ((reporter_id = auth.uid()));


--
-- Name: syncs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.syncs ENABLE ROW LEVEL SECURITY;

--
-- Name: syncs syncs_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY syncs_insert_owner ON public.syncs FOR INSERT TO authenticated WITH CHECK ((completed_by = auth.uid()));


--
-- Name: syncs syncs_select_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY syncs_select_participants ON public.syncs FOR SELECT TO authenticated USING (((completed_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.connections c
  WHERE ((c.id = syncs.connection_id) AND ((c.requester_id = auth.uid()) OR (c.target_id = auth.uid())))))));


--
-- Name: thread_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.thread_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: thread_messages thread_messages_delete_sender; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_messages_delete_sender ON public.thread_messages FOR DELETE TO authenticated USING (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.thread_participants tp
  WHERE ((tp.thread_id = thread_messages.thread_id) AND (tp.user_id = auth.uid()))))));


--
-- Name: thread_messages thread_messages_insert_sender_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_messages_insert_sender_participant ON public.thread_messages FOR INSERT TO authenticated WITH CHECK (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.thread_participants tp
  WHERE ((tp.thread_id = thread_messages.thread_id) AND (tp.user_id = auth.uid()))))));


--
-- Name: thread_messages thread_messages_select_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_messages_select_participants ON public.thread_messages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.thread_participants tp
  WHERE ((tp.thread_id = thread_messages.thread_id) AND (tp.user_id = auth.uid())))));


--
-- Name: thread_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.thread_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: thread_participants thread_participants_insert_self_or_creator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_participants_insert_self_or_creator ON public.thread_participants FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.threads t
  WHERE ((t.id = thread_participants.thread_id) AND (t.created_by = auth.uid()))))));


--
-- Name: thread_participants thread_participants_select_thread_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_participants_select_thread_members ON public.thread_participants FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.thread_participants tp
  WHERE ((tp.thread_id = thread_participants.thread_id) AND (tp.user_id = auth.uid()))))));


--
-- Name: thread_participants thread_participants_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_participants_update_self ON public.thread_participants FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;

--
-- Name: threads threads_insert_creator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY threads_insert_creator ON public.threads FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));


--
-- Name: threads threads_select_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY threads_select_participant ON public.threads FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.thread_participants tp
  WHERE ((tp.thread_id = threads.id) AND (tp.user_id = auth.uid())))));


--
-- Name: threads threads_update_creator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY threads_update_creator ON public.threads FOR UPDATE TO authenticated USING ((created_by = auth.uid())) WITH CHECK ((created_by = auth.uid()));


--
-- Name: trip_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trip_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: trip_requests trip_requests_delete_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trip_requests_delete_participants ON public.trip_requests FOR DELETE TO authenticated USING (((requester_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.trips t
  WHERE ((t.id = trip_requests.trip_id) AND (t.user_id = auth.uid()))))));


--
-- Name: trip_requests trip_requests_insert_requester; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trip_requests_insert_requester ON public.trip_requests FOR INSERT TO authenticated WITH CHECK ((requester_id = auth.uid()));


--
-- Name: trip_requests trip_requests_read_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trip_requests_read_participants ON public.trip_requests FOR SELECT TO authenticated USING (((requester_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.trips t
  WHERE ((t.id = trip_requests.trip_id) AND (t.user_id = auth.uid()))))));


--
-- Name: trip_requests trip_requests_select_parties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trip_requests_select_parties ON public.trip_requests FOR SELECT TO authenticated USING (((requester_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.trips t
  WHERE ((t.id = trip_requests.trip_id) AND (t.user_id = auth.uid()))))));


--
-- Name: trip_requests trip_requests_update_trip_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trip_requests_update_trip_owner ON public.trip_requests FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.trips t
  WHERE ((t.id = trip_requests.trip_id) AND (t.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.trips t
  WHERE ((t.id = trip_requests.trip_id) AND (t.user_id = auth.uid())))));


--
-- Name: trips; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

--
-- Name: trips trips_read_non_test_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trips_read_non_test_owner ON public.trips FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = trips.user_id) AND (COALESCE(p.is_test, false) = false)))) OR (user_id = auth.uid())));


--
-- Name: user_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: user_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: user_reports user_reports_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_reports_insert_own ON public.user_reports FOR INSERT WITH CHECK ((auth.uid() = reporter_id));


--
-- Name: user_reports user_reports_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_reports_read_own ON public.user_reports FOR SELECT USING ((auth.uid() = reporter_id));


--
-- PostgreSQL database dump complete
--

\unrestrict 99pdRLY6xqsR8K9nf7PWA8lVgVizawBJWfUBwniQyNPlMlyY3wTRbc9OjgURfcS

