--
-- PostgreSQL database dump
--

\restrict 42rWU1Zoiav2HhgVqyppJHMYJJADHeD5ZJ0zgpoZ2Pk1wHjueAO8lZOiUwvjJ3F

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

CREATE SCHEMA public;


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
-- Name: dance_move_difficulty; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.dance_move_difficulty AS ENUM (
    'easy',
    'medium',
    'hard'
);


--
-- Name: dance_move_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.dance_move_type AS ENUM (
    'footwork',
    'partnerwork',
    'turn-pattern',
    'styling',
    'musicality',
    'other'
);


--
-- Name: accept_connection_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_connection_request(p_connection_id uuid) RETURNS void
    LANGUAGE plpgsql
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
-- Name: active_group_slot_usage_count(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.active_group_slot_usage_count(p_user_id uuid, p_exclude_group_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with active_groups as (
    select g.id
    from public.groups g
    where g.status = 'active'
      and (p_exclude_group_id is null or g.id <> p_exclude_group_id)
      and (
        g.host_user_id = p_user_id
        or exists (
          select 1
          from public.group_members gm
          where gm.group_id = g.id
            and gm.user_id = p_user_id
        )
      )
  )
  select count(distinct id)::integer
  from active_groups;
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
-- Name: archive_and_prune_past_events(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.archive_and_prune_past_events(p_archive_after_days integer DEFAULT 0, p_delete_after_days integer DEFAULT 30, p_batch integer DEFAULT 1000) RETURNS TABLE(archived_count integer, deleted_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_archive_count integer := 0;
  v_delete_count integer := 0;
  v_archive_after interval;
  v_delete_after interval;
begin
  if coalesce(p_archive_after_days, 0) < 0 then
    raise exception 'invalid_archive_after_days';
  end if;

  if coalesce(p_delete_after_days, 30) < 1 then
    raise exception 'invalid_delete_after_days';
  end if;

  if p_delete_after_days < p_archive_after_days then
    raise exception 'delete_window_must_be_greater_or_equal_to_archive_window';
  end if;

  v_archive_after := make_interval(days => p_archive_after_days);
  v_delete_after := make_interval(days => p_delete_after_days);

  with archive_candidates as (
    select e.*
    from public.events e
    where e.ends_at < (now() - v_archive_after)
    order by e.ends_at asc
    limit greatest(1, least(coalesce(p_batch, 1000), 5000))
  ),
  archived as (
    insert into public.events_archive (event_id, ended_at, source_event)
    select c.id, c.ends_at, to_jsonb(c)
    from archive_candidates c
    on conflict (event_id) do nothing
    returning event_id
  )
  select count(*)::integer into v_archive_count
  from archived;

  with delete_candidates as (
    select e.id
    from public.events e
    where e.ends_at < (now() - v_delete_after)
      and exists (
        select 1
        from public.events_archive a
        where a.event_id = e.id
      )
    order by e.ends_at asc
    limit greatest(1, least(coalesce(p_batch, 1000), 5000))
  ),
  deleted as (
    delete from public.events e
    using delete_candidates d
    where e.id = d.id
    returning e.id
  )
  select count(*)::integer into v_delete_count
  from deleted;

  return query
  select v_archive_count, v_delete_count;
end;
$$;


--
-- Name: block_connection(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_connection(p_connection_id uuid DEFAULT NULL::uuid, p_target_user_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql
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
    LANGUAGE plpgsql
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
    LANGUAGE plpgsql
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
    LANGUAGE plpgsql
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
-- Name: cancel_hosting_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_hosting_request(p_request_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_row public.hosting_requests%rowtype;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_row
  from public.hosting_requests hr
  where hr.id = p_request_id
    and hr.sender_user_id = v_me
  limit 1;

  if v_row.id is null then
    raise exception 'hosting_request_not_found';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'hosting_request_not_pending';
  end if;

  update public.hosting_requests
  set status = 'cancelled',
      decided_by = v_me,
      decided_at = now(),
      updated_at = now()
  where id = v_row.id;

  if to_regprocedure('public.create_notification(uuid,text,text,text,text,jsonb)') is not null then
    perform public.create_notification(
      v_row.recipient_user_id,
      'hosting_request_cancelled',
      'Hosting request cancelled',
      'A pending hosting request was cancelled.',
      '/trips/hosting',
      jsonb_build_object('hosting_request_id', v_row.id, 'status', 'cancelled')
    );
  end if;

  return v_row.id;
end;
$$;


--
-- Name: cancel_trip_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_trip_request(p_request_id uuid) RETURNS uuid
    LANGUAGE plpgsql
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
-- Name: count_accepted_trip_matches_month(uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.count_accepted_trip_matches_month(p_user uuid, p_window_start timestamp with time zone DEFAULT date_trunc('month'::text, now()), p_window_end timestamp with time zone DEFAULT (date_trunc('month'::text, now()) + '1 mon'::interval)) RETURNS integer
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
declare
  v_has_decided_at boolean := false;
  v_count int := 0;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_requests'
      and column_name = 'decided_at'
  )
    into v_has_decided_at;

  if v_has_decided_at then
    select count(*)
      into v_count
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and coalesce((to_jsonb(tr) ->> 'decided_at')::timestamptz, tr.created_at) >= p_window_start
      and coalesce((to_jsonb(tr) ->> 'decided_at')::timestamptz, tr.created_at) < p_window_end
      and (tr.requester_id = p_user or t.user_id = p_user);
  else
    select count(*)
      into v_count
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and tr.created_at >= p_window_start
      and tr.created_at < p_window_end
      and (tr.requester_id = p_user or t.user_id = p_user);
  end if;

  return v_count;
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
-- Name: create_event(text, text, text, text, text, text, text, text, text, text, timestamp with time zone, timestamp with time zone, integer, text, jsonb, text, text[], boolean, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_event(p_title text, p_description text, p_event_type text, p_visibility text, p_event_access_type text, p_chat_mode text, p_city text, p_country text, p_venue_name text, p_venue_address text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_capacity integer DEFAULT NULL::integer, p_cover_url text DEFAULT NULL::text, p_links jsonb DEFAULT '[]'::jsonb, p_status text DEFAULT 'published'::text, p_styles text[] DEFAULT NULL::text[], p_show_guest_list boolean DEFAULT true, p_guests_can_invite boolean DEFAULT false, p_approve_messages boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me          uuid    := auth.uid();
  v_id          uuid;
  v_access_type text    := lower(trim(coalesce(p_event_access_type,
                             case when lower(trim(coalesce(p_visibility, 'public'))) = 'private'
                                  then 'request' else 'public' end)));
  v_chat_mode   text;
  v_visibility  text;
  v_status      text    := lower(trim(coalesce(p_status, 'published')));
  v_cover_url   text    := nullif(trim(coalesce(p_cover_url, '')), '');
  v_styles      text[]  := public.normalize_event_styles(p_styles);
  v_active_count int    := 0;
  v_limit        int    := 3;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if trim(coalesce(p_title, '')) = '' then
    raise exception 'title_required';
  end if;

  if v_access_type <> 'private_group'
     and (trim(coalesce(p_city, '')) = '' or trim(coalesce(p_country, '')) = '') then
    raise exception 'location_required';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_event_window';
  end if;

  if v_access_type not in ('public', 'request', 'private_group') then
    raise exception 'invalid_event_access_type';
  end if;

  v_visibility := public.event_legacy_visibility_for_access(v_access_type);
  v_chat_mode  := public.event_chat_mode_for_access(v_access_type, p_chat_mode);

  if v_status not in ('draft', 'published') then
    raise exception 'invalid_status';
  end if;

  if v_access_type = 'private_group' then
    if coalesce(p_capacity, 25) > 25 then
      raise exception 'private_group_member_limit_reached';
    end if;
  elsif p_capacity is not null and (p_capacity < 1 or p_capacity > 2000) then
    raise exception 'invalid_capacity';
  end if;

  if v_cover_url is not null then
    if v_cover_url !~* '/storage/v1/(object/public|render/image/public)/avatars/' then
      raise exception 'invalid_cover_url';
    end if;
  end if;

  if cardinality(v_styles) > 12 then
    raise exception 'too_many_styles';
  end if;

  if v_status = 'published' and v_access_type = 'private_group' then
    if public.private_group_monthly_usage_count(v_me) >= public.private_group_limit_for_user(v_me) then
      raise exception 'private_group_monthly_limit_reached';
    end if;
  elsif v_status = 'published' then
    select public.active_event_limit_for_user(v_me) into v_limit;

    select count(*)::int
      into v_active_count
    from public.events e
    where e.host_user_id = v_me
      and e.status = 'published'
      and e.ends_at >= now()
      and coalesce(e.hidden_by_admin, false) = false
      and coalesce(e.event_access_type, 'public') <> 'private_group';

    if v_active_count >= v_limit then
      raise exception 'active_event_limit_reached';
    end if;
  end if;

  if v_status = 'draft' and v_access_type = 'private_group' then
    select count(*)::int
      into v_active_count
    from public.events e
    where e.host_user_id = v_me
      and e.status = 'draft'
      and e.event_access_type = 'private_group'
      and coalesce(e.hidden_by_admin, false) = false;

    if v_active_count >= 2 then
      raise exception 'private_group_draft_limit_reached';
    end if;
  end if;

  insert into public.events (
    host_user_id,
    title,
    description,
    event_type,
    styles,
    visibility,
    event_access_type,
    chat_mode,
    max_members,
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
    status,
    show_guest_list,
    guests_can_invite,
    approve_messages
  ) values (
    v_me,
    trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''),
    coalesce(nullif(trim(coalesce(p_event_type, '')), ''), 'Social'),
    coalesce(v_styles, '{}'::text[]),
    v_visibility,
    v_access_type,
    v_chat_mode,
    case when v_access_type = 'private_group' then 25 else null end,
    trim(p_city),
    trim(p_country),
    nullif(trim(coalesce(p_venue_name, '')), ''),
    nullif(trim(coalesce(p_venue_address, '')), ''),
    p_starts_at,
    p_ends_at,
    case when v_access_type = 'private_group' then null else p_capacity end,
    v_cover_url,
    case when v_cover_url is null then 'approved' else 'pending' end,
    coalesce(p_links, '[]'::jsonb),
    v_status,
    coalesce(p_show_guest_list, true),
    coalesce(p_guests_can_invite, false),
    coalesce(p_approve_messages, false)
  )
  returning id into v_id;

  insert into public.event_members (event_id, user_id, member_role, status)
  values (v_id, v_me, 'host', 'host')
  on conflict (event_id, user_id)
  do update set
    member_role = 'host',
    status      = 'host',
    updated_at  = now();

  perform public.cx_ensure_event_thread(v_id, v_me, null);

  return v_id;
end;
$$;


--
-- Name: create_event_report(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_event_report(p_event_id uuid, p_reason text, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
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
-- Name: create_event_series(text, text, text, text, text, text, text, text, text, text, jsonb, integer, text, jsonb, text, text[], boolean, boolean, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_event_series(p_title text, p_description text, p_event_type text, p_visibility text, p_event_access_type text, p_chat_mode text, p_city text, p_country text, p_venue_name text, p_venue_address text, p_occurrences jsonb, p_capacity integer DEFAULT NULL::integer, p_cover_url text DEFAULT NULL::text, p_links jsonb DEFAULT '[]'::jsonb, p_status text DEFAULT 'published'::text, p_styles text[] DEFAULT NULL::text[], p_show_guest_list boolean DEFAULT true, p_guests_can_invite boolean DEFAULT false, p_approve_messages boolean DEFAULT false, p_recurrence_kind text DEFAULT 'custom'::text, p_timezone text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_occurrence jsonb;
  v_series_id uuid;
  v_event_id uuid;
  v_event_ids uuid[] := '{}'::uuid[];
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_position integer := 0;
  v_kind text := lower(trim(coalesce(p_recurrence_kind, 'custom')));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if jsonb_typeof(coalesce(p_occurrences, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_occurrences';
  end if;

  if jsonb_array_length(coalesce(p_occurrences, '[]'::jsonb)) < 2 then
    raise exception 'series_occurrence_count_invalid';
  end if;

  if jsonb_array_length(p_occurrences) > 12 then
    raise exception 'series_occurrence_count_invalid';
  end if;

  if v_kind not in ('biweekly', 'monthly', 'custom') then
    raise exception 'invalid_recurrence_kind';
  end if;

  insert into public.event_series (
    host_user_id,
    recurrence_kind,
    timezone,
    metadata
  )
  values (
    v_me,
    v_kind,
    nullif(trim(coalesce(p_timezone, '')), ''),
    jsonb_build_object(
      'title', trim(coalesce(p_title, '')),
      'occurrenceCount', jsonb_array_length(p_occurrences)
    )
  )
  returning id into v_series_id;

  for v_occurrence in
    select value
    from jsonb_array_elements(p_occurrences)
  loop
    v_starts_at := nullif(trim(coalesce(v_occurrence ->> 'startsAt', '')), '')::timestamptz;
    v_ends_at := nullif(trim(coalesce(v_occurrence ->> 'endsAt', '')), '')::timestamptz;

    v_event_id := public.create_event(
      p_title,
      p_description,
      p_event_type,
      p_visibility,
      p_event_access_type,
      p_chat_mode,
      p_city,
      p_country,
      p_venue_name,
      p_venue_address,
      v_starts_at,
      v_ends_at,
      p_capacity,
      p_cover_url,
      p_links,
      p_status,
      p_styles,
      p_show_guest_list,
      p_guests_can_invite,
      p_approve_messages
    );

    v_position := v_position + 1;
    update public.events
       set event_series_id = v_series_id,
           series_position = v_position
     where id = v_event_id;

    v_event_ids := array_append(v_event_ids, v_event_id);
  end loop;

  update public.event_series
     set metadata = coalesce(metadata, '{}'::jsonb)
       || jsonb_build_object(
         'eventIds', to_jsonb(v_event_ids),
         'occurrenceCount', coalesce(array_length(v_event_ids, 1), 0)
       )
   where id = v_series_id;

  return jsonb_build_object(
    'series_id', v_series_id,
    'primary_event_id', v_event_ids[1],
    'event_ids', to_jsonb(v_event_ids),
    'occurrence_count', coalesce(array_length(v_event_ids, 1), 0)
  );
end;
$$;


--
-- Name: create_hosting_request(uuid, text, uuid, date, date, boolean, boolean, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_hosting_request(p_recipient_user_id uuid, p_request_type text, p_trip_id uuid DEFAULT NULL::uuid, p_arrival_date date DEFAULT NULL::date, p_departure_date date DEFAULT NULL::date, p_arrival_flexible boolean DEFAULT false, p_departure_flexible boolean DEFAULT false, p_travellers_count integer DEFAULT 1, p_max_travellers_allowed integer DEFAULT NULL::integer, p_message text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_message text := nullif(trim(coalesce(p_message, '')), '');
  v_request_type text := lower(trim(coalesce(p_request_type, '')));
  v_existing uuid;
  v_trip_owner uuid;
  v_trip_status text;
  v_zero uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_rec_can_host boolean := false;
  v_rec_hosting_status text := null;
  v_rec_max_guests integer := null;
  v_me_can_host boolean := false;
  v_me_hosting_status text := null;
  v_me_max_guests integer := null;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_recipient_user_id is null then
    raise exception 'recipient_required';
  end if;

  if p_recipient_user_id = v_me then
    raise exception 'cannot_request_self';
  end if;

  if v_request_type not in ('request_hosting', 'offer_to_host') then
    raise exception 'invalid_request_type';
  end if;

  -- Arrival date is always required
  if p_arrival_date is null then
    raise exception 'arrival_date_required';
  end if;

  -- Departure: must have a date OR flexible flag
  if p_departure_date is null and not coalesce(p_departure_flexible, false) then
    raise exception 'departure_date_or_flexible_required';
  end if;

  if p_arrival_date < current_date then
    raise exception 'arrival_must_be_today_or_future';
  end if;

  if p_departure_date is not null then
    if p_departure_date < p_arrival_date then
      raise exception 'invalid_date_range';
    end if;

    if (p_departure_date - p_arrival_date) > 90 then
      raise exception 'date_range_too_long';
    end if;
  end if;

  if p_travellers_count is null or p_travellers_count < 1 or p_travellers_count > 20 then
    raise exception 'travellers_count_invalid';
  end if;

  if p_max_travellers_allowed is not null and (p_max_travellers_allowed < 1 or p_max_travellers_allowed > 20) then
    raise exception 'max_travellers_allowed_invalid';
  end if;

  if v_message is not null then
    if char_length(v_message) > 500 then
      raise exception 'message_too_long';
    end if;
    if v_message ~* '(https?://|www\.)' then
      raise exception 'links_not_allowed';
    end if;
    if v_message ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' then
      raise exception 'emails_not_allowed';
    end if;
    if v_message ~* '[@#][A-Za-z0-9_]+' then
      raise exception 'handles_not_allowed';
    end if;
    if v_message ~* '(\+?\d[\d\s().-]{7,}\d)' then
      raise exception 'phone_numbers_not_allowed';
    end if;
  end if;

  select p.can_host, coalesce(lower(trim(p.hosting_status)), 'inactive'), p.max_guests
    into v_rec_can_host, v_rec_hosting_status, v_rec_max_guests
  from public.profiles p
  where p.user_id = p_recipient_user_id
  limit 1;

  if v_request_type = 'request_hosting' then
    if coalesce(v_rec_can_host, false) is not true then
      raise exception 'recipient_not_hosting';
    end if;

    if coalesce(v_rec_hosting_status, 'inactive') not in ('available', 'active', 'open', 'on') then
      raise exception 'recipient_hosting_unavailable';
    end if;

    if v_rec_max_guests is not null and p_travellers_count > v_rec_max_guests then
      raise exception 'exceeds_recipient_capacity';
    end if;
  end if;

  select p.can_host, coalesce(lower(trim(p.hosting_status)), 'inactive'), p.max_guests
    into v_me_can_host, v_me_hosting_status, v_me_max_guests
  from public.profiles p
  where p.user_id = v_me
  limit 1;

  if v_request_type = 'offer_to_host' then
    if coalesce(v_me_can_host, false) is not true then
      raise exception 'sender_not_hosting';
    end if;
  end if;

  -- Check for existing pending request between these two users for the same type
  select id into v_existing
  from public.hosting_requests
  where (
    (sender_user_id = v_me and recipient_user_id = p_recipient_user_id)
    or (sender_user_id = p_recipient_user_id and recipient_user_id = v_me)
  )
  and request_type = v_request_type
  and status = 'pending'
  limit 1;

  if v_existing is not null then
    raise exception 'pending_request_exists';
  end if;

  insert into public.hosting_requests (
    sender_user_id,
    recipient_user_id,
    request_type,
    trip_id,
    arrival_date,
    departure_date,
    arrival_flexible,
    departure_flexible,
    travellers_count,
    max_travellers_allowed,
    message,
    status
  ) values (
    v_me,
    p_recipient_user_id,
    v_request_type,
    nullif(p_trip_id, v_zero),
    p_arrival_date,
    p_departure_date,
    coalesce(p_arrival_flexible, false),
    coalesce(p_departure_flexible, false),
    p_travellers_count,
    p_max_travellers_allowed,
    v_message,
    'pending'
  )
  returning id into v_id;

  return v_id;
end;
$$;


--
-- Name: create_notification(uuid, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_notification(p_user_id uuid, p_kind text, p_title text, p_body text DEFAULT NULL::text, p_link_url text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  if p_user_id is null then
    raise exception 'notification_user_id_required';
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
    type,
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
    LANGUAGE plpgsql
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
        and s.completed_at >= now() - interval '10 days'
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
        and t.end_date::date >= current_date - 10
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
        and e.ends_at >= now() - interval '10 days'
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
    body,
    public_after_at
  )
  values (
    p_connection_id,
    v_me,
    p_recipient_id,
    v_entity_type,
    v_entity_type,
    v_entity_id,
    p_sentiment,
    trim(p_body),
    now() + interval '10 days'
  )
  returning id into v_id;

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
  v_context_id uuid := null;
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

  if p_context_id is not null and trim(p_context_id) <> '' then
    begin
      v_context_id := trim(p_context_id)::uuid;
    exception
      when invalid_text_representation then
        v_context_id := null;
    end;
  elsif p_connection_id is not null then
    v_context_id := p_connection_id;
  end if;

  insert into public.reports (
    reporter_id,
    reported_user_id,
    target_user_id,
    context,
    context_id,
    reason,
    details,
    note,
    status
  )
  values (
    v_me,
    v_target,
    v_target,
    coalesce(nullif(trim(p_context), ''), 'connection'),
    v_context_id,
    trim(p_reason),
    nullif(trim(p_note), ''),
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
    CONSTRAINT trips_purpose_allowed CHECK (((purpose IS NULL) OR (purpose = ANY (ARRAY['Dance trip / Holiday'::text, 'Training & Classes'::text, 'Festival / Event'::text])))),
    CONSTRAINT trips_start_before_end CHECK ((start_date <= end_date)),
    CONSTRAINT trips_status_allowed CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: create_trip_checked(text, text, date, date, text, text[], text[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_trip_checked(p_destination_city text, p_destination_country text, p_start_date date, p_end_date date, p_purpose text, p_styles text[], p_looking_for text[], p_note text) RETURNS public.trips
    LANGUAGE plpgsql
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
-- Name: cx_activity_reference_context(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_activity_reference_context(p_activity_type text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select public.cx_normalize_activity_type(p_activity_type);
$$;


--
-- Name: cx_activity_type_label(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_activity_type_label(p_activity_type text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case public.cx_normalize_activity_type(p_activity_type)
    when 'practice' then 'Practice'
    when 'private_class' then 'Private Class'
    when 'social_dance' then 'Social Dance'
    when 'event_festival' then 'Event / Festival'
    when 'travelling' then 'Travelling'
    when 'request_hosting' then 'Request Hosting'
    when 'offer_hosting' then 'Offer Hosting'
    else 'Collaborate'
  end;
$$;


--
-- Name: cx_activity_uses_date_range(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_activity_uses_date_range(p_activity_type text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select public.cx_normalize_activity_type(p_activity_type) in (
    'event_festival',
    'travelling',
    'request_hosting',
    'offer_hosting'
  );
$$;


--
-- Name: cx_can_select_thread_message(uuid, uuid, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_can_select_thread_message(p_thread_id uuid, p_sender_id uuid, p_message_type text, p_context_tag text, p_status_tag text, p_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_thread_type text;
  v_host_user_id uuid;
begin
  if p_user_id is null then
    return false;
  end if;

  if public.is_app_admin(p_user_id) then
    return true;
  end if;

  if not exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = p_user_id
  ) then
    return false;
  end if;

  if coalesce(lower(trim(p_status_tag)), 'active') <> 'pending' then
    return true;
  end if;

  if coalesce(lower(trim(p_message_type)), 'text') <> 'text' then
    return true;
  end if;

  if coalesce(lower(trim(p_context_tag)), 'event_chat') <> 'event_chat' then
    return true;
  end if;

  select t.thread_type, e.host_user_id
    into v_thread_type, v_host_user_id
  from public.threads t
  left join public.events e on e.id = t.event_id
  where t.id = p_thread_id
  limit 1;

  if v_thread_type <> 'event' then
    return true;
  end if;

  return p_user_id = p_sender_id or p_user_id = v_host_user_id;
end;
$$;


--
-- Name: cx_can_use_profile_username(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_can_use_profile_username(p_user_id uuid, p_username text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_username text := public.cx_normalize_profile_username(p_username);
begin
  if v_username is null then
    return false;
  end if;

  if p_user_id is not null and exists (
    select 1
    from public.profiles p
    where p.user_id = p_user_id
      and lower(coalesce(p.username, '')) = v_username
  ) then
    return true;
  end if;

  return not exists (
      select 1
      from public.profiles p
      where lower(coalesce(p.username, '')) = v_username
        and (p_user_id is null or p.user_id <> p_user_id)
    )
    and not exists (
      select 1
      from public.profile_username_history h
      where lower(h.username) = v_username
    );
end;
$$;


--
-- Name: cx_cancel_request_chat_entitlement(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_cancel_request_chat_entitlement(p_source_type text, p_source_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.request_chat_entitlements
  set status = 'cancelled', updated_at = now()
  where source_type = p_source_type
    and source_id = p_source_id
    and status in ('scheduled', 'active');
end;
$$;


--
-- Name: cx_check_group_create_allowed(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_check_group_create_allowed(p_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return public.cx_check_group_slot_allowed(p_user_id, null);
end;
$$;


--
-- Name: cx_check_group_message_allowed(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_check_group_message_allowed(p_group_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_plan            text;
  v_is_owner        boolean;
  v_user_daily_max  int;
  v_group_daily_max int;
  v_chat_mode       text;
begin
  select coalesce(plan, 'starter') into v_plan
  from public.profiles
  where user_id = p_user_id;

  select chat_mode, (host_user_id = p_user_id) into v_chat_mode, v_is_owner
  from public.groups
  where id = p_group_id;

  if v_chat_mode = 'broadcast' and not v_is_owner then
    raise exception 'broadcast_only_owner';
  end if;

  if v_plan = 'pro' then
    v_user_daily_max  := 100;
    v_group_daily_max := 500;
  else
    v_user_daily_max  := 50;
    v_group_daily_max := 200;
  end if;

  if public.cx_group_user_messages_today(p_group_id, p_user_id) >= v_user_daily_max then
    raise exception 'group_user_daily_limit_reached';
  end if;

  if public.cx_group_messages_today(p_group_id) >= v_group_daily_max then
    raise exception 'group_daily_limit_reached';
  end if;

  return true;
end;
$$;


--
-- Name: cx_check_group_slot_allowed(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_check_group_slot_allowed(p_user_id uuid, p_exclude_group_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer := 0;
  v_limit integer := 0;
begin
  if p_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select public.active_group_slot_usage_count(p_user_id, p_exclude_group_id) into v_count;
  select public.group_slot_limit_for_user(p_user_id) into v_limit;

  if v_limit is not null and v_count >= v_limit then
    raise exception 'group_slot_limit_reached';
  end if;

  return true;
end;
$$;


--
-- Name: cx_count_user_active_threads(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_count_user_active_threads(p_user_id uuid) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select count(*)::integer
  from public.thread_participants tp
  where tp.user_id = p_user_id
    and coalesce(tp.messaging_state, 'inactive') = 'active'
    and tp.archived_at is null
    and (tp.activation_cycle_end is null or tp.activation_cycle_end > now())
$$;


--
-- Name: cx_emit_thread_event(uuid, uuid, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_emit_thread_event(p_thread_id uuid, p_sender_id uuid, p_body text, p_message_type text DEFAULT 'system'::text, p_context_tag text DEFAULT NULL::text, p_status_tag text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
  v_body text := left(trim(coalesce(p_body, '')), 1000);
begin
  if p_thread_id is null or p_sender_id is null then
    raise exception 'thread_or_sender_required';
  end if;
  if v_body = '' then
    v_body := 'Thread activity updated.';
  end if;

  insert into public.thread_messages (
    thread_id,
    sender_id,
    body,
    message_type,
    context_tag,
    status_tag,
    metadata
  )
  values (
    p_thread_id,
    p_sender_id,
    v_body,
    case when p_message_type in ('text', 'system', 'request') then p_message_type else 'system' end,
    p_context_tag,
    p_status_tag,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;


--
-- Name: cx_enforce_thread_text_unlock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_enforce_thread_text_unlock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if coalesce(new.message_type, 'text') <> 'text' then
    return new;
  end if;

  if not public.cx_thread_chat_unlocked(new.thread_id, auth.uid()) then
    raise exception 'chat_locked_until_accepted_request';
  end if;

  return new;
end;
$$;


--
-- Name: cx_ensure_event_thread(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_ensure_event_thread(p_event_id uuid, p_actor uuid DEFAULT auth.uid(), p_requester uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_thread_id uuid;
  v_owner uuid;
begin
  if p_event_id is null then
    raise exception 'event_required';
  end if;

  if to_regclass('public.events') is null then
    raise exception 'events_table_missing';
  end if;

  select coalesce(
           (to_jsonb(e) ->> 'user_id')::uuid,
           (to_jsonb(e) ->> 'host_user_id')::uuid,
           (to_jsonb(e) ->> 'created_by')::uuid
         )
    into v_owner
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_owner is null then
    raise exception 'event_not_found';
  end if;

  -- Avoid ON CONFLICT inference issues with partial indexes by locking event key.
  perform pg_advisory_xact_lock(hashtext('cx_event:' || p_event_id::text)::bigint);

  select t.id
    into v_thread_id
  from public.threads t
  where t.thread_type = 'event'
    and t.event_id = p_event_id
  order by t.created_at asc
  limit 1;

  if v_thread_id is null then
    insert into public.threads (thread_type, event_id, created_by, last_message_at)
    values ('event', p_event_id, coalesce(p_actor, v_owner), now())
    returning id into v_thread_id;
  end if;

  insert into public.thread_participants (thread_id, user_id, role)
  values (v_thread_id, v_owner, 'owner')
  on conflict (thread_id, user_id) do nothing;

  if p_requester is not null then
    insert into public.thread_participants (thread_id, user_id, role)
    values (v_thread_id, p_requester, 'member')
    on conflict (thread_id, user_id) do nothing;
  end if;

  if p_actor is not null then
    insert into public.thread_participants (thread_id, user_id, role)
    values (v_thread_id, p_actor, 'member')
    on conflict (thread_id, user_id) do nothing;
  end if;

  return v_thread_id;
end;
$$;


--
-- Name: cx_ensure_group_thread(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_ensure_group_thread(p_group_id uuid, p_actor uuid DEFAULT auth.uid()) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_thread_id uuid;
  v_owner     uuid;
begin
  if p_group_id is null then
    raise exception 'group_required';
  end if;

  select host_user_id into v_owner from public.groups where id = p_group_id limit 1;
  if v_owner is null then
    raise exception 'group_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext('cx_group:' || p_group_id::text)::bigint);

  select id into v_thread_id
  from public.threads
  where thread_type = 'group' and group_id = p_group_id
  order by created_at asc
  limit 1;

  if v_thread_id is null then
    insert into public.threads (thread_type, group_id, created_by, last_message_at)
    values ('group', p_group_id, coalesce(p_actor, v_owner), now())
    returning id into v_thread_id;
  end if;

  -- Add ALL current group members as participants
  insert into public.thread_participants (thread_id, user_id, role)
  select
    v_thread_id,
    gm.user_id,
    case when gm.user_id = v_owner then 'owner' else 'member' end
  from public.group_members gm
  where gm.group_id = p_group_id
  on conflict (thread_id, user_id) do nothing;

  return v_thread_id;
end;
$$;


--
-- Name: cx_ensure_pair_thread(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_ensure_pair_thread(p_user_a uuid, p_user_b uuid, p_actor uuid DEFAULT auth.uid()) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_low uuid;
  v_high uuid;
  v_thread_id uuid;
begin
  if p_user_a is null or p_user_b is null or p_user_a = p_user_b then
    raise exception 'invalid_pair';
  end if;

  v_low := least(p_user_a, p_user_b);
  v_high := greatest(p_user_a, p_user_b);

  -- Pair-level lock prevents duplicate direct threads under race conditions.
  perform pg_advisory_xact_lock(hashtext('cx_pair:' || v_low::text || ':' || v_high::text)::bigint);

  select t.id
    into v_thread_id
  from public.threads t
  where t.thread_type = 'direct'
    and t.direct_user_low = v_low
    and t.direct_user_high = v_high
  order by t.created_at asc
  limit 1;

  if v_thread_id is null then
    insert into public.threads (
      thread_type,
      direct_user_low,
      direct_user_high,
      created_by,
      last_message_at
    )
    values (
      'direct',
      v_low,
      v_high,
      coalesce(p_actor, v_low),
      now()
    )
    returning id into v_thread_id;
  end if;

  insert into public.thread_participants (thread_id, user_id, role)
  values
    (v_thread_id, v_low, 'member'),
    (v_thread_id, v_high, 'member')
  on conflict (thread_id, user_id) do nothing;

  return v_thread_id;
end;
$$;


--
-- Name: user_messaging_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_messaging_cycles (
    user_id uuid NOT NULL,
    cycle_start date NOT NULL,
    cycle_end date NOT NULL,
    plan text NOT NULL,
    monthly_activation_limit integer NOT NULL,
    monthly_activations_used integer DEFAULT 0 NOT NULL,
    concurrent_active_limit integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_messaging_cycles_plan_chk CHECK ((plan = ANY (ARRAY['free'::text, 'premium'::text])))
);


--
-- Name: cx_ensure_user_messaging_cycle(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_ensure_user_messaging_cycle(p_user_id uuid, p_at timestamp with time zone DEFAULT now()) RETURNS public.user_messaging_cycles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cycle_start date;
  v_cycle_end date;
  v_plan text := 'free';
  v_monthly_limit integer := 10;
  v_concurrent_limit integer := 10;
  v_row public.user_messaging_cycles%rowtype;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;

  select cycle_start, cycle_end
    into v_cycle_start, v_cycle_end
  from public.cx_messaging_cycle_bounds(p_at);

  select
    coalesce(plan, 'free'),
    case
      when coalesce(plan, 'free') = 'premium' then coalesce(monthly_activation_limit, 1000000)
      else coalesce(monthly_activation_limit, 10)
    end,
    case
      when coalesce(plan, 'free') = 'premium' then coalesce(concurrent_active_limit, 1000000)
      else coalesce(concurrent_active_limit, 10)
    end
  into v_plan, v_monthly_limit, v_concurrent_limit
  from public.user_messaging_plans
  where user_id = p_user_id
  limit 1;

  v_plan := coalesce(v_plan, 'free');
  v_monthly_limit := coalesce(v_monthly_limit, case when v_plan = 'premium' then 1000000 else 10 end);
  v_concurrent_limit := coalesce(v_concurrent_limit, case when v_plan = 'premium' then 1000000 else 10 end);

  insert into public.user_messaging_cycles (
    user_id,
    cycle_start,
    cycle_end,
    plan,
    monthly_activation_limit,
    concurrent_active_limit
  )
  values (
    p_user_id,
    v_cycle_start,
    v_cycle_end,
    v_plan,
    v_monthly_limit,
    v_concurrent_limit
  )
  on conflict (user_id, cycle_start)
  do update set
    cycle_end = excluded.cycle_end,
    plan = excluded.plan,
    monthly_activation_limit = excluded.monthly_activation_limit,
    concurrent_active_limit = excluded.concurrent_active_limit,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;


--
-- Name: cx_event_thread_can_post(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_event_thread_can_post(p_thread_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case
    when not exists (
      select 1 from public.threads t where t.id = p_thread_id and t.thread_type = 'event'
    ) then true
    when public.is_app_admin(p_user_id) then true
    when exists (
      select 1
      from public.threads t
      join public.events e on e.id = t.event_id
      where t.id = p_thread_id
        and e.host_user_id = p_user_id
    ) then true
    when exists (
      select 1
      from public.threads t
      join public.events e on e.id = t.event_id
      join public.event_members em on em.event_id = e.id and em.user_id = p_user_id
      where t.id = p_thread_id
        and coalesce(e.chat_mode, 'broadcast') = 'discussion'
        and em.status in ('host', 'going', 'waitlist')
    ) then true
    else false
  end
$$;


--
-- Name: cx_events_health_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_events_health_snapshot() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_upcoming integer := 0;
  v_upcoming_public_visible integer := 0;
  v_past integer := 0;
  v_archived integer := 0;
begin
  if to_regclass('public.events') is not null then
    select count(*)::integer
      into v_upcoming
    from public.events e
    where e.status = 'published'
      and e.ends_at >= now();

    select count(*)::integer
      into v_upcoming_public_visible
    from public.events e
    where e.status = 'published'
      and e.visibility = 'public'
      and coalesce(e.hidden_by_admin, false) = false
      and e.ends_at >= now();

    select count(*)::integer
      into v_past
    from public.events e
    where e.status = 'published'
      and e.ends_at < now();
  end if;

  if to_regclass('public.events_archive') is not null then
    select count(*)::integer into v_archived from public.events_archive;
  end if;

  return jsonb_build_object(
    'upcoming_total', v_upcoming,
    'upcoming_public_visible', v_upcoming_public_visible,
    'past_total', v_past,
    'archived_total', v_archived,
    'generated_at', now()
  );
end;
$$;


--
-- Name: cx_get_thread_entitlement(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_get_thread_entitlement(p_thread_id uuid, p_user_id uuid) RETURNS TABLE(id uuid, source_type text, source_id uuid, opens_at timestamp with time zone, expires_at timestamp with time zone, effective_status text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    e.id,
    e.source_type,
    e.source_id,
    e.opens_at,
    e.expires_at,
    public.cx_rce_current_status(e.opens_at, e.expires_at, e.status) as effective_status
  from public.request_chat_entitlements e
  where e.thread_id = p_thread_id
    and (e.requester_user_id = p_user_id or e.responder_user_id = p_user_id)
    and e.status != 'cancelled'
  order by e.opens_at desc
  limit 1;
$$;


--
-- Name: cx_group_messages_today(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_group_messages_today(p_group_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(count(*)::int, 0)
  from public.thread_messages tm
  join public.threads t on t.id = tm.thread_id
  where t.group_id = p_group_id
    and t.thread_type = 'group'
    and tm.created_at >= date_trunc('day', now() at time zone 'utc');
$$;


--
-- Name: cx_group_user_messages_today(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_group_user_messages_today(p_group_id uuid, p_user_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(count(*)::int, 0)
  from public.thread_messages tm
  join public.threads t on t.id = tm.thread_id
  where t.group_id = p_group_id
    and t.thread_type = 'group'
    and tm.sender_id = p_user_id
    and tm.created_at >= date_trunc('day', now() at time zone 'utc');
$$;


--
-- Name: cx_guard_event_thread_message_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_guard_event_thread_message_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_event_id uuid;
  v_event_host uuid;
  v_requires_approval boolean := false;
  v_is_member boolean := false;
begin
  select e.id, e.host_user_id, coalesce(e.approve_messages, false)
    into v_event_id, v_event_host, v_requires_approval
  from public.threads t
  join public.events e on e.id = t.event_id
  where t.id = new.thread_id
    and t.thread_type = 'event'
  limit 1;

  if v_event_id is null then
    return new;
  end if;

  select exists (
    select 1
    from public.event_members em
    where em.event_id = v_event_id
      and em.user_id = new.sender_id
      and em.status in ('host', 'going', 'waitlist')
  )
  into v_is_member;

  if not public.cx_event_thread_can_post(new.thread_id, new.sender_id) then
    if not v_is_member then
      raise exception 'event_thread_member_required';
    end if;
    raise exception 'event_thread_broadcast_only';
  end if;

  new.context_tag := coalesce(nullif(trim(coalesce(new.context_tag, '')), ''), 'event_chat');

  if coalesce(new.message_type, 'text') <> 'text' then
    new.status_tag := coalesce(nullif(trim(coalesce(new.status_tag, '')), ''), 'active');
    return new;
  end if;

  if public.is_app_admin(new.sender_id) or new.sender_id = v_event_host then
    new.status_tag := coalesce(nullif(trim(coalesce(new.status_tag, '')), ''), 'active');
    return new;
  end if;

  if exists (
    select 1
    from public.thread_messages tm
    where tm.thread_id = new.thread_id
      and tm.sender_id = new.sender_id
      and coalesce(tm.message_type, 'text') = 'text'
      and coalesce(tm.context_tag, 'event_chat') = 'event_chat'
  ) then
    raise exception 'event_guest_message_limit_reached';
  end if;

  new.status_tag := case
    when v_requires_approval then 'pending'
    else coalesce(nullif(trim(coalesce(new.status_tag, '')), ''), 'active')
  end;
  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'eventMessageApproval', v_requires_approval,
      'eventMessageLimit', 'one_per_guest'
    );

  return new;
end;
$$;


--
-- Name: cx_hosting_space_type_label(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_hosting_space_type_label(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case public.cx_normalize_hosting_space_type(p_value)
    when 'not_specified' then 'Not specified'
    when 'shared_room' then 'Spare room'
    when 'private_room' then 'Private space'
    when 'sofa' then 'Couch / sofa'
    when 'floor_space' then 'Floor space'
    when 'mixed' then 'Depends on dates'
    else nullif(trim(coalesce(p_value, '')), '')
  end
$$;


--
-- Name: cx_is_reserved_profile_username(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_is_reserved_profile_username(raw_value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select public.cx_normalize_profile_username(raw_value) = any (
    array[
      'about', 'account', 'account-settings', 'admin', 'api', 'app', 'auth', 'billing',
      'blog', 'careers', 'complete', 'connections', 'console', 'conxion', 'conxionapp',
      'control-center', 'cookie-settings', 'dashboard', 'discover', 'edit', 'event',
      'events', 'explore', 'feed', 'help', 'host', 'hosting', 'inbox', 'login', 'logout',
      'me', 'member', 'members', 'message', 'messages', 'network', 'notifications',
      'official', 'onboarding', 'photo-guide', 'pricing', 'privacy', 'profile', 'profiles',
      'references', 'requests', 'root', 'safety', 'safety-center', 'search', 'settings',
      'shop', 'signin', 'signup', 'subscribe', 'subscription', 'subscriptions', 'support',
      'system', 'team', 'teacher', 'teachers', 'terms', 'travel', 'trips', 'u', 'users',
      'verification', 'verify'
    ]::text[]
  );
$$;


--
-- Name: cx_is_thread_participant(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_is_thread_participant(p_thread_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = p_user_id
  );
$$;


--
-- Name: cx_log_thread_status(uuid, uuid, uuid, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_log_thread_status(p_thread_id uuid, p_participant_user_id uuid, p_actor_user_id uuid, p_context_type text, p_event_type text, p_from_status text DEFAULT NULL::text, p_to_status text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
begin
  if p_thread_id is null then
    raise exception 'thread_required';
  end if;
  if trim(coalesce(p_context_type, '')) = '' then
    raise exception 'context_type_required';
  end if;
  if trim(coalesce(p_event_type, '')) = '' then
    raise exception 'event_type_required';
  end if;

  insert into public.thread_status_history (
    thread_id,
    participant_user_id,
    actor_user_id,
    context_type,
    event_type,
    from_status,
    to_status,
    metadata
  )
  values (
    p_thread_id,
    p_participant_user_id,
    p_actor_user_id,
    trim(p_context_type),
    trim(p_event_type),
    nullif(trim(coalesce(p_from_status, '')), ''),
    nullif(trim(coalesce(p_to_status, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;


--
-- Name: cx_mark_reference_request_completed(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_mark_reference_request_completed(p_reference_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_rows int := 0;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_reference_id is null then
    return 0;
  end if;

  update public.reference_requests rr
  set
    status = 'completed',
    completed_reference_id = ref.id,
    updated_at = now()
  from public.references ref
  where ref.id = p_reference_id
    and rr.user_id = v_me
    and rr.status = 'pending'
    and coalesce(ref.author_user_id, ref.author_id, ref.from_user_id) = v_me
    and coalesce(ref.recipient_user_id, ref.recipient_id, ref.to_user_id, ref.target_id) = rr.peer_user_id
    and coalesce(ref.source_id, ref.entity_id, ref.sync_id) = rr.source_id
    and coalesce(ref.context_tag, rr.context_tag) = rr.context_tag;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;


--
-- Name: cx_messaging_cycle_bounds(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_messaging_cycle_bounds(p_at timestamp with time zone DEFAULT now()) RETURNS TABLE(cycle_start date, cycle_end date)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select
    date_trunc('month', p_at)::date as cycle_start,
    (date_trunc('month', p_at) + interval '1 month - 1 day')::date as cycle_end
$$;


--
-- Name: cx_normalize_activity_type(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_normalize_activity_type(p_activity_type text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case lower(trim(coalesce(p_activity_type, '')))
    when 'practice' then 'practice'
    when 'practice_sync' then 'practice'
    when 'private_class' then 'private_class'
    when 'private class' then 'private_class'
    when 'private lesson' then 'private_class'
    when 'private_lesson' then 'private_class'
    when 'privateclass' then 'private_class'
    when 'social' then 'social_dance'
    when 'social_dance' then 'social_dance'
    when 'social_dancing' then 'social_dance'
    when 'socialdance' then 'social_dance'
    when 'event' then 'event_festival'
    when 'events' then 'event_festival'
    when 'festival' then 'event_festival'
    when 'congress' then 'event_festival'
    when 'workshop' then 'event_festival'
    when 'competition' then 'event_festival'
    when 'contest' then 'event_festival'
    when 'event_festival' then 'event_festival'
    when 'trip' then 'travelling'
    when 'travel' then 'travelling'
    when 'traveling' then 'travelling'
    when 'travelling' then 'travelling'
    when 'travel_trip' then 'travelling'
    when 'travel_together' then 'travelling'
    when 'request_hosting' then 'request_hosting'
    when 'stay_as_guest' then 'request_hosting'
    when 'guest' then 'request_hosting'
    when 'stay' then 'request_hosting'
    when 'offer_hosting' then 'offer_hosting'
    when 'offer_to_host' then 'offer_hosting'
    when 'hosting' then 'offer_hosting'
    when 'host' then 'offer_hosting'
    when 'group_class' then 'practice'
    when 'group lesson' then 'practice'
    when 'group_lesson' then 'practice'
    when 'groupclass' then 'practice'
    when 'collaboration' then 'collaborate'
    when 'collaborate' then 'collaborate'
    when 'content' then 'collaborate'
    when 'video' then 'collaborate'
    when 'content/video' then 'collaborate'
    when 'content_video' then 'collaborate'
    else 'collaborate'
  end;
$$;


--
-- Name: cx_normalize_hosting_space_type(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_normalize_hosting_space_type(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case lower(trim(coalesce(p_value, '')))
    when '' then null
    when 'not_specified' then 'not_specified'
    when 'not specified' then 'not_specified'
    when 'shared_room' then 'shared_room'
    when 'shared room' then 'shared_room'
    when 'spare_room' then 'shared_room'
    when 'spare room' then 'shared_room'
    when 'private_room' then 'private_room'
    when 'private room' then 'private_room'
    when 'private_space' then 'private_room'
    when 'private space' then 'private_room'
    when 'sofa' then 'sofa'
    when 'couch' then 'sofa'
    when 'couch / sofa' then 'sofa'
    when 'couch/sofa' then 'sofa'
    when 'floor_space' then 'floor_space'
    when 'floor space' then 'floor_space'
    when 'mixed' then 'mixed'
    when 'depends on dates' then 'mixed'
    else null
  end
$$;


--
-- Name: cx_normalize_profile_username(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_normalize_profile_username(raw_value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select nullif(lower(btrim(coalesce(raw_value, ''))), '');
$$;


--
-- Name: cx_normalize_travel_intent_reason(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_normalize_travel_intent_reason(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case
    when p_value is null or trim(p_value) = '' then null
    when lower(trim(p_value)) in (
      'dance_trip_holiday',
      'dance trip / holiday',
      'dance trip',
      'holiday',
      'holiday trip',
      'holiday_trip',
      'social_dancing',
      'social dancing',
      'social_dance',
      'social'
    ) then 'dance_trip_holiday'
    when lower(trim(p_value)) in (
      'training_classes',
      'training & classes',
      'training and classes',
      'training / classes',
      'training / workshops',
      'training',
      'workshop',
      'workshops',
      'class',
      'classes',
      'private_class',
      'private class',
      'private_lesson',
      'private lesson',
      'practice'
    ) then 'training_classes'
    when lower(trim(p_value)) in (
      'festival_event',
      'festival / event',
      'festival / events',
      'festival',
      'event',
      'events',
      'event_festival',
      'travel_events',
      'travel & events',
      'travel and events',
      'travel',
      'travelling',
      'traveling',
      'trip',
      'trip join request',
      'collaborate',
      'collaboration',
      'request_hosting'
    ) then 'festival_event'
    else null
  end
$$;


--
-- Name: cx_normalize_trip_join_reason(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_normalize_trip_join_reason(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select public.cx_normalize_travel_intent_reason(p_value)
$$;


--
-- Name: cx_profile_request_response_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_profile_request_response_stats(p_profile_user_id uuid) RETURNS TABLE(total_requests bigint, responded_requests bigint, pending_requests bigint, response_rate integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with stats as (
    select
      count(*) filter (where c.status in ('pending', 'accepted', 'declined')) as total_requests,
      count(*) filter (where c.status in ('accepted', 'declined')) as responded_requests,
      count(*) filter (where c.status = 'pending') as pending_requests
    from public.connections c
    where c.target_id = p_profile_user_id
      and c.blocked_by is null
      and c.status in ('pending', 'accepted', 'declined')
  )
  select
    stats.total_requests,
    stats.responded_requests,
    stats.pending_requests,
    case
      when stats.total_requests > 0
        then round((stats.responded_requests::numeric / stats.total_requests::numeric) * 100)::integer
      else 0
    end as response_rate
  from stats;
$$;


--
-- Name: FUNCTION cx_profile_request_response_stats(p_profile_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.cx_profile_request_response_stats(p_profile_user_id uuid) IS 'Returns response-rate aggregates for incoming profile connection requests. Pending requests count in the denominator, accepted and declined count as responded, and cancelled or deleted requests are excluded.';


--
-- Name: cx_profiles_apply_username(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_profiles_apply_username() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_previous_username text :=
    case
      when tg_op = 'UPDATE' then public.cx_normalize_profile_username(old.username)
      else null
    end;
  v_next_change_at timestamptz;
begin
  if new.username is null or btrim(new.username) = '' then
    new.username := public.cx_resolve_profile_username(new.user_id, new.display_name, null);
  else
    new.username := public.cx_normalize_profile_username(new.username);
  end if;

  if new.username is null or char_length(new.username) < 3 or char_length(new.username) > 20 then
    raise exception using errcode = '22023', message = 'Username must be between 3 and 20 characters.';
  end if;

  if new.username !~ '^[a-z0-9._]{3,20}$' or new.username ~ '(^[._]|[._]$|\.\.)' then
    raise exception using errcode = '22023', message = 'Use only letters, numbers, dots, or underscores.';
  end if;

  if public.cx_is_reserved_profile_username(new.username) then
    raise exception using errcode = '22023', message = 'This username is reserved.';
  end if;

  if tg_op = 'UPDATE' and v_previous_username is distinct from new.username then
    v_next_change_at := coalesce(old.username_updated_at, old.username_changed_at) + interval '30 days';
    if coalesce(old.username_updated_at, old.username_changed_at) is not null and v_next_change_at > now() then
      raise exception using errcode = '22023', message = 'You can change your username once every 30 days.';
    end if;
  end if;

  if not public.cx_can_use_profile_username(new.user_id, new.username) then
    raise exception using errcode = '23505', message = 'This username is already taken.';
  end if;

  if tg_op = 'INSERT' then
    new.username_updated_at := coalesce(new.username_updated_at, now());
    new.username_changed_at := coalesce(new.username_changed_at, new.username_updated_at, now());
    return new;
  end if;

  if v_previous_username is distinct from new.username then
    new.username_updated_at := now();
    new.username_changed_at := new.username_updated_at;
  else
    new.username_updated_at := coalesce(old.username_updated_at, old.username_changed_at, new.username_updated_at, now());
    new.username_changed_at := coalesce(old.username_changed_at, old.username_updated_at, new.username_updated_at);
  end if;

  return new;
end;
$_$;


--
-- Name: cx_profiles_sync_username_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_profiles_sync_username_history() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_now timestamptz := coalesce(new.username_updated_at, now());
begin
  if tg_op = 'INSERT' then
    insert into public.profile_username_history (user_id, username, active_from, active_until)
    select new.user_id, new.username, v_now, null
    where not exists (
      select 1
      from public.profile_username_history h
      where lower(h.username) = lower(new.username)
    );
    return null;
  end if;

  if lower(coalesce(old.username, '')) is distinct from lower(coalesce(new.username, '')) then
    update public.profile_username_history
    set active_until = coalesce(active_until, v_now)
    where user_id = new.user_id
      and active_until is null;

    insert into public.profile_username_history (user_id, username, active_from, active_until)
    values (new.user_id, new.username, v_now, null);
  end if;

  return null;
end;
$$;


--
-- Name: cx_rce_current_status(timestamp with time zone, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_rce_current_status(p_opens_at timestamp with time zone, p_expires_at timestamp with time zone, p_status text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case
    when p_status = 'cancelled' then 'cancelled'
    when now() < p_opens_at    then 'scheduled'
    when now() > p_expires_at  then 'expired'
    else 'active'
  end;
$$;


--
-- Name: cx_reference_author_id(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_reference_author_id(p_author_id uuid, p_from_user_id uuid, p_source_id uuid) RETURNS uuid
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select coalesce(p_author_id, p_from_user_id, p_source_id);
$$;


--
-- Name: cx_reference_context_key(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_reference_context_key(p_context_tag text, p_context text, p_entity_type text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select lower(trim(coalesce(nullif(p_context_tag, ''), nullif(p_context, ''), nullif(p_entity_type, ''), 'connection')));
$$;


--
-- Name: cx_reference_cooldown_days(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_reference_cooldown_days(p_context text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case lower(trim(coalesce(p_context, '')))
    when 'practice' then 120
    when 'social_dance' then 120
    when 'private_class' then 90
    else null
  end
$$;


--
-- Name: cx_reference_family(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_reference_family(p_category text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case trim(coalesce(p_category, ''))
    when 'Practice' then 'practice_social'
    when 'Social Dance' then 'practice_social'
    when 'Classes' then 'teaching'
    when 'Travelling' then 'hosting_trip'
    when 'Request Hosting' then 'hosting_trip'
    when 'Offer Hosting' then 'hosting_trip'
    else 'event_collab'
  end
$$;


--
-- Name: cx_reference_prompt_allowed(uuid, uuid, text, text, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_reference_prompt_allowed(p_user_id uuid, p_peer_user_id uuid, p_context_tag text, p_source_table text, p_source_id uuid, p_due_at timestamp with time zone DEFAULT now()) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_category text := public.cx_reference_public_category(p_context_tag);
  v_family text := public.cx_reference_family(v_category);
  v_cooldown_days int := public.cx_reference_cooldown_days(p_context_tag);
  v_source_type text := public.cx_reference_source_type(p_context_tag, p_source_table);
begin
  if p_user_id is null or p_peer_user_id is null or p_source_id is null then
    return false;
  end if;

  if v_cooldown_days is null then
    if exists (
      select 1
      from public.references ref
      where coalesce(ref.author_user_id, ref.author_id, ref.from_user_id) = p_user_id
        and coalesce(ref.recipient_user_id, ref.recipient_id, ref.to_user_id, ref.target_id) = p_peer_user_id
        and coalesce(ref.source_type, public.cx_reference_source_type(coalesce(ref.context_tag, ref.entity_type, ref.context, 'collaborate'), null)) = v_source_type
        and coalesce(ref.source_id, ref.entity_id, ref.sync_id) = p_source_id
    ) then
      return false;
    end if;
    return true;
  end if;

  if exists (
    select 1
    from public.reference_requests rr
    where rr.user_id = p_user_id
      and rr.peer_user_id = p_peer_user_id
      and rr.status = 'pending'
      and public.cx_reference_family(public.cx_reference_public_category(rr.context_tag)) = v_family
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.references ref
    where coalesce(ref.author_user_id, ref.author_id, ref.from_user_id) = p_user_id
      and coalesce(ref.recipient_user_id, ref.recipient_id, ref.to_user_id, ref.target_id) = p_peer_user_id
      and coalesce(ref.reference_family, public.cx_reference_family(coalesce(ref.public_category, public.cx_reference_public_category(coalesce(ref.context_tag, ref.entity_type, ref.context, 'collaborate'))))) = v_family
      and ref.created_at + make_interval(days => v_cooldown_days) > now()
  ) then
    return false;
  end if;

  return true;
end;
$$;


--
-- Name: cx_reference_public_category(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_reference_public_category(p_context text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case lower(trim(coalesce(p_context, '')))
    when 'practice' then 'Practice'
    when 'social_dance' then 'Social Dance'
    when 'event_festival' then 'Event / Festival'
    when 'travelling' then 'Travelling'
    when 'request_hosting' then 'Request Hosting'
    when 'offer_hosting' then 'Offer Hosting'
    when 'private_class' then 'Classes'
    else 'Collaborate'
  end
$$;


--
-- Name: cx_reference_recipient_id(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_reference_recipient_id(p_recipient_id uuid, p_to_user_id uuid, p_target_id uuid) RETURNS uuid
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select coalesce(p_recipient_id, p_to_user_id, p_target_id);
$$;


--
-- Name: cx_reference_source_type(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_reference_source_type(p_context text, p_source_table text DEFAULT NULL::text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case
    when lower(trim(coalesce(p_source_table, ''))) = 'trip_requests' or lower(trim(coalesce(p_context, ''))) = 'travelling' then 'travel_activity'
    when lower(trim(coalesce(p_source_table, ''))) = 'hosting_requests'
      or lower(trim(coalesce(p_context, ''))) in ('request_hosting', 'offer_hosting') then 'hosting_stay'
    when lower(trim(coalesce(p_source_table, ''))) = 'events'
      or lower(trim(coalesce(p_context, ''))) = 'event_festival' then 'event_participation'
    when lower(trim(coalesce(p_context, ''))) = 'practice' then 'practice_activity'
    when lower(trim(coalesce(p_context, ''))) = 'social_dance' then 'social_dance_activity'
    when lower(trim(coalesce(p_context, ''))) = 'private_class' then 'class_activity'
    when lower(trim(coalesce(p_context, ''))) = 'collaborate' then 'collaboration_activity'
    else 'legacy'
  end
$$;


--
-- Name: cx_references_reveal_mutual(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_references_reveal_mutual() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_author uuid := public.cx_reference_author_id(new.author_id, new.from_user_id, new.source_id);
  v_recipient uuid := public.cx_reference_recipient_id(new.recipient_id, new.to_user_id, new.target_id);
  v_context_key text := public.cx_reference_context_key(new.context_tag, new.context, new.entity_type);
begin
  if v_author is null or v_recipient is null then
    return new;
  end if;

  if exists (
    select 1
    from public.references ref
    where ref.id <> new.id
      and public.cx_reference_author_id(ref.author_id, ref.from_user_id, ref.source_id) = v_recipient
      and public.cx_reference_recipient_id(ref.recipient_id, ref.to_user_id, ref.target_id) = v_author
      and public.cx_reference_context_key(ref.context_tag, ref.context, ref.entity_type) = v_context_key
  ) then
    update public.references ref
    set public_after_at = now()
    where ref.id = new.id
       or (
         public.cx_reference_author_id(ref.author_id, ref.from_user_id, ref.source_id) = v_recipient
         and public.cx_reference_recipient_id(ref.recipient_id, ref.to_user_id, ref.target_id) = v_author
         and public.cx_reference_context_key(ref.context_tag, ref.context, ref.entity_type) = v_context_key
       );
  end if;

  return new;
end;
$$;


--
-- Name: cx_refresh_member_interaction_counters(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_refresh_member_interaction_counters(p_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_now timestamptz := now();
begin
  if p_user_id is null then
    delete from public.member_interaction_counters;
    delete from public.pair_interaction_counters;
  else
    delete from public.member_interaction_counters where user_id = p_user_id;
    delete from public.pair_interaction_counters where user_a_id = p_user_id or user_b_id = p_user_id;
  end if;

  drop table if exists pg_temp.cx_counter_interactions;

  create temporary table cx_counter_interactions on commit drop as
  select *
  from (
    select a.requester_id as user_id,
           a.recipient_id as peer_user_id,
           case lower(trim(coalesce(a.activity_type, 'collaborate')))
             when 'practice' then 'practice_count'
             when 'social_dance' then 'social_dance_count'
             when 'event_festival' then 'event_festival_count'
             when 'travelling' then 'travelling_count'
             when 'request_hosting' then 'request_hosting_count'
             when 'offer_hosting' then 'offer_hosting_count'
             when 'private_class' then 'classes_count'
             else 'collaborate_count'
           end as counter_type
    from public.activities a
    where a.status = 'completed'
      and (p_user_id is null or a.requester_id = p_user_id or a.recipient_id = p_user_id)

    union all

    select a.recipient_id as user_id,
           a.requester_id as peer_user_id,
           case lower(trim(coalesce(a.activity_type, 'collaborate')))
             when 'practice' then 'practice_count'
             when 'social_dance' then 'social_dance_count'
             when 'event_festival' then 'event_festival_count'
             when 'travelling' then 'travelling_count'
             when 'request_hosting' then 'request_hosting_count'
             when 'offer_hosting' then 'offer_hosting_count'
             when 'private_class' then 'classes_count'
             else 'collaborate_count'
           end as counter_type
    from public.activities a
    where a.status = 'completed'
      and (p_user_id is null or a.requester_id = p_user_id or a.recipient_id = p_user_id)

    union all

    select s.requester_id as user_id,
           s.recipient_id as peer_user_id,
           case lower(trim(coalesce(s.sync_type, 'training')))
             when 'social_dancing' then 'social_dance_count'
             when 'private_class' then 'classes_count'
             when 'workshop' then 'classes_count'
             else 'practice_count'
           end as counter_type
    from public.connection_syncs s
    where s.status = 'completed'
      and (p_user_id is null or s.requester_id = p_user_id or s.recipient_id = p_user_id)

    union all

    select s.recipient_id as user_id,
           s.requester_id as peer_user_id,
           case lower(trim(coalesce(s.sync_type, 'training')))
             when 'social_dancing' then 'social_dance_count'
             when 'private_class' then 'classes_count'
             when 'workshop' then 'classes_count'
             else 'practice_count'
           end as counter_type
    from public.connection_syncs s
    where s.status = 'completed'
      and (p_user_id is null or s.requester_id = p_user_id or s.recipient_id = p_user_id)

    union all

    select tr.requester_id as user_id,
           t.user_id as peer_user_id,
           'travelling_count' as counter_type
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and t.end_date is not null
      and t.end_date <= current_date
      and (p_user_id is null or tr.requester_id = p_user_id or t.user_id = p_user_id)

    union all

    select t.user_id as user_id,
           tr.requester_id as peer_user_id,
           'travelling_count' as counter_type
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and t.end_date is not null
      and t.end_date <= current_date
      and (p_user_id is null or tr.requester_id = p_user_id or t.user_id = p_user_id)

    union all

    select case
             when hr.request_type = 'request_hosting' then hr.recipient_user_id
             when hr.request_type = 'offer_to_host' then hr.sender_user_id
             else hr.recipient_user_id
           end as user_id,
           case
             when hr.request_type = 'request_hosting' then hr.sender_user_id
             when hr.request_type = 'offer_to_host' then hr.recipient_user_id
             else hr.sender_user_id
           end as peer_user_id,
           'offer_hosting_count' as counter_type
    from public.hosting_requests hr
    where hr.status = 'accepted'
      and hr.departure_date is not null
      and hr.departure_date <= current_date
      and (p_user_id is null or hr.sender_user_id = p_user_id or hr.recipient_user_id = p_user_id)

    union all

    select case
             when hr.request_type = 'request_hosting' then hr.sender_user_id
             when hr.request_type = 'offer_to_host' then hr.recipient_user_id
             else hr.sender_user_id
           end as user_id,
           case
             when hr.request_type = 'request_hosting' then hr.recipient_user_id
             when hr.request_type = 'offer_to_host' then hr.sender_user_id
             else hr.recipient_user_id
           end as peer_user_id,
           'request_hosting_count' as counter_type
    from public.hosting_requests hr
    where hr.status = 'accepted'
      and hr.departure_date is not null
      and hr.departure_date <= current_date
      and (p_user_id is null or hr.sender_user_id = p_user_id or hr.recipient_user_id = p_user_id)

    union all

    select em.user_id as user_id,
           e.host_user_id as peer_user_id,
           'event_festival_count' as counter_type
    from public.event_members em
    join public.events e on e.id = em.event_id
    where em.status in ('host', 'going', 'waitlist')
      and e.ends_at is not null
      and e.ends_at <= now()
      and (p_user_id is null or em.user_id = p_user_id or e.host_user_id = p_user_id)
  ) all_interactions
  where user_id is not null;

  with member_counts as (
    select i.user_id, i.counter_type, count(*)::int as count
    from pg_temp.cx_counter_interactions i
    join public.profiles p on p.user_id = i.user_id
    group by i.user_id, i.counter_type
  )
  insert into public.member_interaction_counters (user_id, counter_type, count, updated_at)
  select user_id, counter_type, count, v_now
  from member_counts
  on conflict (user_id, counter_type)
  do update set count = excluded.count, updated_at = excluded.updated_at;

  with pair_counts as (
    select
      least(i.user_id, i.peer_user_id) as user_a_id,
      greatest(i.user_id, i.peer_user_id) as user_b_id,
      case
        when i.counter_type in ('request_hosting_count', 'offer_hosting_count') then 'hosting_count'
        else i.counter_type
      end as counter_type,
      count(*)::int as count
    from pg_temp.cx_counter_interactions i
    join public.profiles p_user on p_user.user_id = i.user_id
    join public.profiles p_peer on p_peer.user_id = i.peer_user_id
    where i.peer_user_id is not null
      and i.user_id <> i.peer_user_id
    group by least(i.user_id, i.peer_user_id), greatest(i.user_id, i.peer_user_id),
      case
        when i.counter_type in ('request_hosting_count', 'offer_hosting_count') then 'hosting_count'
        else i.counter_type
      end
  )
  insert into public.pair_interaction_counters (user_a_id, user_b_id, counter_type, count, updated_at)
  select user_a_id, user_b_id, counter_type, count, v_now
  from pair_counts
  on conflict (user_a_id, user_b_id, counter_type)
  do update set count = excluded.count, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'user_id', p_user_id);
end;
$$;


--
-- Name: cx_resolve_profile_username(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_resolve_profile_username(p_user_id uuid, p_display_name text, p_requested_username text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_base text;
  v_candidate text;
  v_suffix integer := 0;
  v_fallback_suffix text := left(replace(coalesce(p_user_id::text, gen_random_uuid()::text), '-', ''), 6);
begin
  v_base := public.cx_username_base_from_text(coalesce(nullif(btrim(p_requested_username), ''), p_display_name, 'member'));

  if v_base is null or char_length(v_base) < 3 then
    v_base := 'member';
  end if;

  loop
    if v_suffix = 0 then
      v_candidate := v_base;
    else
      v_candidate := left(v_base, greatest(3, 20 - char_length(v_suffix::text))) || v_suffix::text;
    end if;

    if char_length(v_candidate) < 3 then
      v_candidate := left('member' || v_fallback_suffix, 20);
    end if;

    exit when public.cx_is_reserved_profile_username(v_candidate) is not true
      and public.cx_can_use_profile_username(p_user_id, v_candidate);

    v_suffix := v_suffix + 1;
  end loop;

  return v_candidate;
end;
$$;


--
-- Name: cx_run_events_maintenance(integer, integer, integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_run_events_maintenance(p_archive_after_days integer DEFAULT 0, p_delete_after_days integer DEFAULT 30, p_keep_archive_days integer DEFAULT 30, p_batch integer DEFAULT 1000, p_seed_if_empty boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_archived integer := 0;
  v_deleted integer := 0;
  v_pruned integer := 0;
  v_seeded integer := 0;
  v_visible_upcoming integer := 0;
  v_health jsonb := '{}'::jsonb;
begin
  if to_regprocedure('public.archive_and_prune_past_events(integer, integer, integer)') is not null then
    select r.archived_count, r.deleted_count
      into v_archived, v_deleted
    from public.archive_and_prune_past_events(p_archive_after_days, p_delete_after_days, p_batch) r
    limit 1;
  end if;

  if to_regprocedure('public.prune_events_archive(integer, integer)') is not null then
    select public.prune_events_archive(p_keep_archive_days, p_batch) into v_pruned;
  end if;

  if to_regclass('public.events') is not null then
    select count(*)::integer
      into v_visible_upcoming
    from public.events e
    where e.status = 'published'
      and e.visibility = 'public'
      and coalesce(e.hidden_by_admin, false) = false
      and e.ends_at >= now();
  end if;

  if coalesce(p_seed_if_empty, false) and v_visible_upcoming = 0 then
    if to_regprocedure('public.cx_seed_upcoming_public_events()') is not null then
      select public.cx_seed_upcoming_public_events() into v_seeded;
    end if;
  end if;

  if to_regprocedure('public.cx_events_health_snapshot()') is not null then
    select public.cx_events_health_snapshot() into v_health;
  end if;

  return jsonb_build_object(
    'archived_count', coalesce(v_archived, 0),
    'deleted_count', coalesce(v_deleted, 0),
    'pruned_archive_count', coalesce(v_pruned, 0),
    'seeded_count', coalesce(v_seeded, 0),
    'health', coalesce(v_health, '{}'::jsonb),
    'ran_at', now()
  );
end;
$$;


--
-- Name: cx_run_messaging_housekeeping(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_run_messaging_housekeeping(p_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_expired_pending_count integer := 0;
  v_expired_active_count integer := 0;
  v_archived_count integer := 0;
  v_now timestamptz := now();
  v_row record;
  v_participant_id uuid;
begin
  for v_row in
    update public.thread_contexts tc
       set status_tag = 'expired',
           is_pinned = false,
           resolved_at = v_now,
           updated_at = v_now,
           metadata = coalesce(tc.metadata, '{}'::jsonb) || jsonb_build_object('expired_at', v_now)
     where tc.status_tag = 'pending'
       and coalesce(tc.created_at, tc.updated_at, v_now) <= v_now - interval '14 days'
       and (
         p_user_id is null
         or tc.requester_id = p_user_id
         or tc.recipient_id = p_user_id
       )
    returning tc.thread_id, tc.id, tc.context_tag, tc.requester_id, tc.recipient_id
  loop
    v_expired_pending_count := v_expired_pending_count + 1;

    for v_participant_id in
      select distinct u.participant_id
      from (
        select v_row.requester_id as participant_id
        union all
        select v_row.recipient_id as participant_id
      ) as u
      where u.participant_id is not null
    loop
      perform public.cx_log_thread_status(
        p_thread_id => v_row.thread_id,
        p_participant_user_id => v_participant_id,
        p_actor_user_id => null,
        p_context_type => v_row.context_tag,
        p_event_type => 'request_expired',
        p_from_status => 'pending',
        p_to_status => 'expired',
        p_metadata => jsonb_build_object('thread_context_id', v_row.id)
      );
    end loop;
  end loop;

  for v_row in
    update public.thread_participants tp
       set messaging_state = 'inactive',
           state_changed_at = v_now
     where coalesce(tp.messaging_state, 'inactive') = 'active'
       and tp.archived_at is null
       and tp.activation_cycle_end is not null
       and tp.activation_cycle_end <= v_now
       and (p_user_id is null or tp.user_id = p_user_id)
    returning tp.thread_id, tp.user_id
  loop
    v_expired_active_count := v_expired_active_count + 1;
    perform public.cx_log_thread_status(
      p_thread_id => v_row.thread_id,
      p_participant_user_id => v_row.user_id,
      p_actor_user_id => null,
      p_context_type => 'messaging',
      p_event_type => 'activation_window_expired',
      p_from_status => 'active',
      p_to_status => 'inactive',
      p_metadata => jsonb_build_object('reason', 'one_month_window_elapsed')
    );
  end loop;

  for v_row in
    update public.thread_participants tp
       set messaging_state = 'archived',
           archived_at = coalesce(tp.archived_at, v_now),
           state_changed_at = v_now
      from public.threads t
     where tp.thread_id = t.id
       and coalesce(tp.messaging_state, 'inactive') = 'active'
       and coalesce(t.last_message_at, t.updated_at, t.created_at, v_now) <= v_now - interval '45 days'
       and (p_user_id is null or tp.user_id = p_user_id)
    returning tp.thread_id, tp.user_id
  loop
    v_archived_count := v_archived_count + 1;
    perform public.cx_log_thread_status(
      p_thread_id => v_row.thread_id,
      p_participant_user_id => v_row.user_id,
      p_actor_user_id => null,
      p_context_type => 'messaging',
      p_event_type => 'auto_archived',
      p_from_status => 'active',
      p_to_status => 'archived',
      p_metadata => jsonb_build_object('reason', '45_days_inactive')
    );
  end loop;

  return jsonb_build_object(
    'expiredPending', v_expired_pending_count,
    'expiredActive', v_expired_active_count,
    'archivedThreads', v_archived_count
  );
end;
$$;


--
-- Name: cx_schedule_events_maintenance_daily(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_schedule_events_maintenance_daily(p_hour integer DEFAULT 3, p_minute integer DEFAULT 15) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_hour integer := greatest(0, least(coalesce(p_hour, 3), 23));
  v_min integer := greatest(0, least(coalesce(p_minute, 15), 59));
  v_expr text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return 'pg_cron_not_installed';
  end if;

  v_expr := format('%s %s * * *', v_min, v_hour);

  begin
    execute $$select cron.unschedule('cx_events_maintenance_daily')$$;
  exception
    when others then
      null;
  end;

  execute format(
    $$select cron.schedule('cx_events_maintenance_daily', %L, %L)$$,
    v_expr,
    'select public.cx_run_events_maintenance(0, 30, 30, 1000, true);'
  );

  return format('scheduled:%s', v_expr);
exception
  when others then
    return format('schedule_failed:%s', sqlerrm);
end;
$_$;


--
-- Name: cx_seed_upcoming_public_events(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_seed_upcoming_public_events() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_hosts uuid[];
  v_h1 uuid;
  v_h2 uuid;
  v_h3 uuid;
  v_id uuid;
  v_seeded integer := 0;
begin
  if to_regclass('public.events') is null or to_regclass('public.profiles') is null then
    return 0;
  end if;

  select array_agg(p.user_id)
    into v_hosts
  from (
    select user_id
    from public.profiles
    order by updated_at desc nulls last, created_at desc nulls last, user_id
    limit 3
  ) p;

  if coalesce(array_length(v_hosts, 1), 0) = 0 then
    return 0;
  end if;

  v_h1 := v_hosts[1];
  v_h2 := coalesce(v_hosts[2], v_hosts[1]);
  v_h3 := coalesce(v_hosts[3], v_hosts[1]);

  -- 1) Barcelona Bachata Social
  select e.id into v_id
  from public.events e
  where e.title = 'Barcelona Bachata Social'
  order by e.updated_at desc
  limit 1;

  if v_id is null then
    insert into public.events (
      host_user_id, title, description, event_type, styles, visibility, city, country,
      venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
    )
    values (
      v_h1,
      'Barcelona Bachata Social',
      'Friday bachata social with warm-up class and DJ set.',
      'Social',
      array['bachata'],
      'public',
      'Barcelona',
      'Spain',
      'El Born Dance Hall',
      'Carrer de la Princesa 12',
      now() + interval '2 days',
      now() + interval '2 days 4 hours',
      180,
      null,
      'approved',
      '[]'::jsonb,
      'published'
    )
    returning id into v_id;
  else
    update public.events
    set host_user_id = v_h1,
        event_type = 'Social',
        styles = array['bachata'],
        visibility = 'public',
        city = 'Barcelona',
        country = 'Spain',
        venue_name = 'El Born Dance Hall',
        venue_address = 'Carrer de la Princesa 12',
        starts_at = now() + interval '2 days',
        ends_at = now() + interval '2 days 4 hours',
        status = 'published',
        updated_at = now()
    where id = v_id;
  end if;
  v_seeded := v_seeded + 1;

  -- 2) Lisbon Kizomba Lab
  select e.id into v_id
  from public.events e
  where e.title = 'Lisbon Kizomba Lab'
  order by e.updated_at desc
  limit 1;

  if v_id is null then
    insert into public.events (
      host_user_id, title, description, event_type, styles, visibility, city, country,
      venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
    )
    values (
      v_h2,
      'Lisbon Kizomba Lab',
      'Technique-focused kizomba workshop followed by guided practice.',
      'Workshop',
      array['kizomba'],
      'public',
      'Lisbon',
      'Portugal',
      'Flow Studio',
      'Rua do Carmo 31',
      now() + interval '5 days',
      now() + interval '5 days 3 hours',
      90,
      null,
      'approved',
      '[]'::jsonb,
      'published'
    )
    returning id into v_id;
  else
    update public.events
    set host_user_id = v_h2,
        event_type = 'Workshop',
        styles = array['kizomba'],
        visibility = 'public',
        city = 'Lisbon',
        country = 'Portugal',
        venue_name = 'Flow Studio',
        venue_address = 'Rua do Carmo 31',
        starts_at = now() + interval '5 days',
        ends_at = now() + interval '5 days 3 hours',
        status = 'published',
        updated_at = now()
    where id = v_id;
  end if;
  v_seeded := v_seeded + 1;

  -- 3) Paris Salsa Rooftop
  select e.id into v_id
  from public.events e
  where e.title = 'Paris Salsa Rooftop'
  order by e.updated_at desc
  limit 1;

  if v_id is null then
    insert into public.events (
      host_user_id, title, description, event_type, styles, visibility, city, country,
      venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
    )
    values (
      v_h3,
      'Paris Salsa Rooftop',
      'Open-air salsa social with guest DJs and mini performance show.',
      'Social',
      array['salsa'],
      'public',
      'Paris',
      'France',
      'Skyline Terrace',
      'Rue Oberkampf 88',
      now() + interval '8 days',
      now() + interval '8 days 5 hours',
      160,
      null,
      'approved',
      '[]'::jsonb,
      'published'
    )
    returning id into v_id;
  else
    update public.events
    set host_user_id = v_h3,
        event_type = 'Social',
        styles = array['salsa'],
        visibility = 'public',
        city = 'Paris',
        country = 'France',
        venue_name = 'Skyline Terrace',
        venue_address = 'Rue Oberkampf 88',
        starts_at = now() + interval '8 days',
        ends_at = now() + interval '8 days 5 hours',
        status = 'published',
        updated_at = now()
    where id = v_id;
  end if;
  v_seeded := v_seeded + 1;

  -- 4) Berlin Urban Dance Meetup
  select e.id into v_id
  from public.events e
  where e.title = 'Berlin Urban Dance Meetup'
  order by e.updated_at desc
  limit 1;

  if v_id is null then
    insert into public.events (
      host_user_id, title, description, event_type, styles, visibility, city, country,
      venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
    )
    values (
      v_h1,
      'Berlin Urban Dance Meetup',
      'Community meetup for dancers to connect, exchange, and plan local sessions.',
      'Community',
      array['bachata','salsa','kizomba'],
      'public',
      'Berlin',
      'Germany',
      'Neon District Hall',
      'Torstrasse 79',
      now() + interval '12 days',
      now() + interval '12 days 3 hours',
      140,
      null,
      'approved',
      '[]'::jsonb,
      'published'
    )
    returning id into v_id;
  else
    update public.events
    set host_user_id = v_h1,
        event_type = 'Community',
        styles = array['bachata','salsa','kizomba'],
        visibility = 'public',
        city = 'Berlin',
        country = 'Germany',
        venue_name = 'Neon District Hall',
        venue_address = 'Torstrasse 79',
        starts_at = now() + interval '12 days',
        ends_at = now() + interval '12 days 3 hours',
        status = 'published',
        updated_at = now()
    where id = v_id;
  end if;
  v_seeded := v_seeded + 1;

  -- 5) Madrid Bachata Weekend
  select e.id into v_id
  from public.events e
  where e.title = 'Madrid Bachata Weekend'
  order by e.updated_at desc
  limit 1;

  if v_id is null then
    insert into public.events (
      host_user_id, title, description, event_type, styles, visibility, city, country,
      venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
    )
    values (
      v_h2,
      'Madrid Bachata Weekend',
      'Two-day bachata weekend with classes, socials, and community showcase.',
      'Festival',
      array['bachata'],
      'public',
      'Madrid',
      'Spain',
      'Casa Ritmo',
      'Gran Via 120',
      now() + interval '16 days',
      now() + interval '17 days 6 hours',
      260,
      null,
      'approved',
      '[]'::jsonb,
      'published'
    )
    returning id into v_id;
  else
    update public.events
    set host_user_id = v_h2,
        event_type = 'Festival',
        styles = array['bachata'],
        visibility = 'public',
        city = 'Madrid',
        country = 'Spain',
        venue_name = 'Casa Ritmo',
        venue_address = 'Gran Via 120',
        starts_at = now() + interval '16 days',
        ends_at = now() + interval '17 days 6 hours',
        status = 'published',
        updated_at = now()
    where id = v_id;
  end if;
  v_seeded := v_seeded + 1;

  return v_seeded;
end;
$$;


--
-- Name: cx_send_inbox_message(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_send_inbox_message(p_thread_id uuid DEFAULT NULL::uuid, p_connection_id uuid DEFAULT NULL::uuid, p_body text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := auth.uid();
  v_clean_body text := trim(coalesce(p_body, ''));
  v_thread public.threads%rowtype;
  v_connection public.connections%rowtype;
  v_tracking_thread_id uuid;
  v_cycle public.user_messaging_cycles%rowtype;
  v_tp public.thread_participants%rowtype;
  v_current_active integer := 0;
  v_needs_activation boolean := false;
  v_activation_reused boolean := false;
  v_activated boolean := false;
  v_unlocked boolean := false;
  v_message_thread_id uuid;
  v_peer_id uuid;
  v_now timestamptz := now();
  v_has_live_activation boolean := false;
  v_previous_state text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_thread_id is null and p_connection_id is null then
    raise exception 'thread_or_connection_required';
  end if;
  if length(v_clean_body) < 1 or length(v_clean_body) > 1000 then
    raise exception 'Message length invalid';
  end if;

  if p_thread_id is not null then
    select *
      into v_thread
    from public.threads
    where id = p_thread_id
    limit 1;

    if not found then
      raise exception 'thread_not_found';
    end if;

    if not exists (
      select 1
      from public.thread_participants tp
      where tp.thread_id = v_thread.id
        and tp.user_id = v_user
    ) then
      raise exception 'no_permission_for_thread';
    end if;
  end if;

  if p_connection_id is not null then
    select *
      into v_connection
    from public.connections
    where id = p_connection_id
      and (requester_id = v_user or target_id = v_user)
    limit 1;

    if not found then
      raise exception 'no_permission_for_connection';
    end if;
  elsif v_thread.connection_id is not null then
    select *
      into v_connection
    from public.connections
    where id = v_thread.connection_id
      and (requester_id = v_user or target_id = v_user)
    limit 1;
  elsif v_thread.id is not null then
    select c.*
      into v_connection
    from public.thread_contexts tc
    join public.connections c on c.id = tc.source_id
    where tc.thread_id = v_thread.id
      and tc.source_table = 'connections'
      and (c.requester_id = v_user or c.target_id = v_user)
    order by tc.updated_at desc
    limit 1;
  end if;

  if v_connection.id is not null and (coalesce(v_connection.status::text, '') <> 'accepted' or v_connection.blocked_by is not null) then
    raise exception 'thread_not_accepted';
  end if;

  if v_thread.id is not null then
    v_tracking_thread_id := v_thread.id;
  elsif v_connection.id is not null then
    select tc.thread_id
      into v_tracking_thread_id
    from public.thread_contexts tc
    where tc.source_table = 'connections'
      and tc.source_id = v_connection.id
    order by tc.updated_at desc
    limit 1;

    if v_tracking_thread_id is null then
      v_tracking_thread_id := public.cx_ensure_pair_thread(v_connection.requester_id, v_connection.target_id, v_user);
      perform public.cx_upsert_thread_context(
        p_thread_id => v_tracking_thread_id,
        p_source_table => 'connections',
        p_source_id => v_connection.id,
        p_context_tag => 'connection_request',
        p_status_tag => case when lower(trim(coalesce(v_connection.status::text, 'accepted'))) in ('pending', 'accepted', 'declined', 'cancelled') then lower(trim(coalesce(v_connection.status::text, 'accepted'))) else 'accepted' end,
        p_title => 'Connection request',
        p_requester_id => v_connection.requester_id,
        p_recipient_id => v_connection.target_id,
        p_metadata => '{}'::jsonb
      );
    end if;
  end if;

  if v_tracking_thread_id is null then
    raise exception 'thread_not_found';
  end if;

  if v_connection.id is not null then
    v_peer_id := case when v_connection.requester_id = v_user then v_connection.target_id else v_connection.requester_id end;
    insert into public.thread_participants (thread_id, user_id, role)
    values
      (v_tracking_thread_id, v_user, 'member'),
      (v_tracking_thread_id, v_peer_id, 'member')
    on conflict (thread_id, user_id) do nothing;
  end if;

  select *
    into v_tp
  from public.thread_participants
  where thread_id = v_tracking_thread_id
    and user_id = v_user
  limit 1;

  if not found then
    raise exception 'no_permission_for_thread';
  end if;

  v_previous_state := coalesce(v_tp.messaging_state, 'inactive');

  if v_connection.id is not null then
    v_unlocked := true;
  else
    v_unlocked := public.cx_thread_message_unlocked(v_tracking_thread_id, v_user);
  end if;

  if not v_unlocked then
    raise exception 'thread_not_accepted';
  end if;

  v_cycle := public.cx_ensure_user_messaging_cycle(v_user, v_now);
  v_current_active := public.cx_count_user_active_threads(v_user);
  v_has_live_activation := case
    when v_tp.activation_cycle_end is not null then v_tp.activation_cycle_end > v_now
    else coalesce(v_tp.activation_cycle_start is not null or v_tp.activated_at is not null, false)
  end;
  v_needs_activation := not v_has_live_activation;
  v_activation_reused := not v_needs_activation;

  if coalesce(v_tp.messaging_state, 'inactive') <> 'active' or v_tp.archived_at is not null or v_needs_activation then
    if v_current_active >= v_cycle.concurrent_active_limit then
      raise exception 'concurrent_active_limit_reached';
    end if;
  end if;

  if v_needs_activation then
    if v_cycle.monthly_activations_used >= v_cycle.monthly_activation_limit then
      raise exception 'monthly_activation_limit_reached';
    end if;

    update public.user_messaging_cycles
       set monthly_activations_used = monthly_activations_used + 1,
           updated_at = v_now
     where user_id = v_user
       and cycle_start = v_cycle.cycle_start
    returning * into v_cycle;

    v_activated := true;
  end if;

  update public.thread_participants
     set messaging_state = 'active',
         archived_at = null,
         activated_at = case when v_needs_activation then v_now else coalesce(activated_at, v_now) end,
         activation_cycle_start = case when v_needs_activation then v_now else coalesce(activation_cycle_start, activated_at, v_now) end,
         activation_cycle_end = case when v_needs_activation then v_now + interval '1 month' else activation_cycle_end end,
         state_changed_at = v_now,
         last_read_at = v_now
   where thread_id = v_tracking_thread_id
     and user_id = v_user
  returning * into v_tp;

  if v_previous_state is distinct from 'active' or v_needs_activation then
    perform public.cx_log_thread_status(
      p_thread_id => v_tracking_thread_id,
      p_participant_user_id => v_user,
      p_actor_user_id => v_user,
      p_context_type => 'messaging',
      p_event_type => case when v_needs_activation then 'thread_activated' else 'thread_reactivated' end,
      p_from_status => v_previous_state,
      p_to_status => 'active',
      p_metadata => jsonb_build_object(
        'activationConsumed', v_needs_activation,
        'activationStart', coalesce(v_tp.activation_cycle_start, v_tp.activated_at),
        'activationEnd', v_tp.activation_cycle_end
      )
    );
  end if;

  if p_thread_id is null and v_connection.id is not null then
    perform public.send_message(v_connection.id, v_clean_body);
    update public.threads
       set last_message_at = v_now,
           updated_at = v_now
     where id = v_tracking_thread_id;
    v_message_thread_id := v_tracking_thread_id;
  else
    insert into public.thread_messages (thread_id, sender_id, body)
    values (v_tracking_thread_id, v_user, v_clean_body)
    returning thread_id into v_message_thread_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'threadId', v_tracking_thread_id,
    'messageThreadId', v_message_thread_id,
    'activated', v_activated,
    'activationReused', v_activation_reused,
    'messagingState', 'active',
    'activatedAt', v_tp.activated_at,
    'activationStart', coalesce(v_tp.activation_cycle_start, v_tp.activated_at),
    'activationEnd', v_tp.activation_cycle_end,
    'plan', v_cycle.plan,
    'cycleStart', v_cycle.cycle_start,
    'cycleEnd', v_cycle.cycle_end,
    'monthlyLimit', v_cycle.monthly_activation_limit,
    'monthlyUsed', v_cycle.monthly_activations_used,
    'activeLimit', v_cycle.concurrent_active_limit,
    'activeCount', public.cx_count_user_active_threads(v_user)
  );
end;
$$;


--
-- Name: cx_send_service_inquiry_followup(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_send_service_inquiry_followup(p_inquiry_id uuid, p_body text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := auth.uid();
  v_clean_body text := regexp_replace(trim(coalesce(p_body, '')), '[\r\n]+', ' ', 'g');
  v_inquiry public.service_inquiries%rowtype;
  v_thread public.service_inquiry_threads%rowtype;
  v_message_id uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_inquiry_id is null then
    raise exception 'inquiry_required';
  end if;
  if length(v_clean_body) < 1 or length(v_clean_body) > 220 then
    raise exception 'followup_length_invalid';
  end if;

  select *
    into v_inquiry
  from public.service_inquiries
  where id = p_inquiry_id
  limit 1;

  if not found then
    raise exception 'inquiry_not_found';
  end if;
  if v_inquiry.requester_id <> v_user then
    raise exception 'no_permission_for_inquiry';
  end if;
  if coalesce(v_inquiry.status, 'pending') <> 'accepted' then
    raise exception 'inquiry_not_ready_for_followup';
  end if;

  select *
    into v_thread
  from public.service_inquiry_threads
  where inquiry_id = p_inquiry_id
  limit 1;

  if not found then
    raise exception 'inquiry_thread_missing';
  end if;
  if coalesce(v_thread.requester_followup_used, false) then
    raise exception 'followup_already_used';
  end if;
  if not exists (
    select 1
    from public.thread_contexts tc
    where tc.thread_id = v_thread.thread_id
      and tc.source_table = 'service_inquiries'
      and tc.source_id = p_inquiry_id
      and tc.context_tag = 'service_inquiry'
      and tc.status_tag = 'info_shared'
  ) then
    raise exception 'inquiry_not_ready_for_followup';
  end if;

  insert into public.thread_messages (
    thread_id,
    sender_id,
    body,
    message_type,
    context_tag,
    status_tag,
    metadata
  )
  values (
    v_thread.thread_id,
    v_user,
    v_clean_body,
    'text',
    'service_inquiry',
    'inquiry_followup_pending',
    jsonb_build_object(
      'service_inquiry_id', p_inquiry_id,
      'free_followup', true
    )
  )
  returning id into v_message_id;

  update public.service_inquiry_threads
     set requester_followup_used = true,
         shared_block_ids = coalesce(shared_block_ids, '[]'::jsonb)
   where inquiry_id = p_inquiry_id;

  update public.thread_contexts
     set status_tag = 'inquiry_followup_pending',
         is_pinned = false,
         resolved_at = now(),
         updated_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'requester_followup_used', true,
           'followup_sent_at', now()
         )
   where source_table = 'service_inquiries'
     and source_id = p_inquiry_id;

  perform public.cx_log_thread_status(
    p_thread_id => v_thread.thread_id,
    p_participant_user_id => v_inquiry.recipient_id,
    p_actor_user_id => v_user,
    p_context_type => 'service_inquiry',
    p_event_type => 'requester_followup_sent',
    p_from_status => 'info_shared',
    p_to_status => 'inquiry_followup_pending',
    p_metadata => jsonb_build_object(
      'inquiry_id', p_inquiry_id,
      'message_id', v_message_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'threadId', v_thread.thread_id,
    'messageId', v_message_id,
    'statusTag', 'inquiry_followup_pending'
  );
end;
$$;


--
-- Name: cx_set_thread_messaging_state(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_set_thread_messaging_state(p_thread_id uuid, p_next_state text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := auth.uid();
  v_tp public.thread_participants%rowtype;
  v_next text := lower(trim(coalesce(p_next_state, '')));
  v_cycle public.user_messaging_cycles%rowtype;
  v_current_active integer := 0;
  v_needs_activation boolean := false;
  v_has_live_activation boolean := false;
  v_unlocked boolean := false;
  v_now timestamptz := now();
  v_previous_state text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_thread_id is null then
    raise exception 'thread_required';
  end if;
  if v_next not in ('active', 'inactive', 'archived') then
    raise exception 'invalid_messaging_state';
  end if;

  select *
    into v_tp
  from public.thread_participants
  where thread_id = p_thread_id
    and user_id = v_user
  limit 1;

  if not found then
    raise exception 'no_permission_for_thread';
  end if;

  v_previous_state := coalesce(v_tp.messaging_state, 'inactive');

  if v_next = 'active' then
    v_unlocked := public.cx_thread_message_unlocked(p_thread_id, v_user);
    if not v_unlocked then
      raise exception 'thread_not_accepted';
    end if;

    v_cycle := public.cx_ensure_user_messaging_cycle(v_user, v_now);
    v_current_active := public.cx_count_user_active_threads(v_user);
    v_has_live_activation := case
      when v_tp.activation_cycle_end is not null then v_tp.activation_cycle_end > v_now
      else coalesce(v_tp.activation_cycle_start is not null or v_tp.activated_at is not null, false)
    end;
    v_needs_activation := not v_has_live_activation;

    if coalesce(v_tp.messaging_state, 'inactive') <> 'active' or v_tp.archived_at is not null or v_needs_activation then
      if v_current_active >= v_cycle.concurrent_active_limit then
        raise exception 'concurrent_active_limit_reached';
      end if;
    end if;

    if v_needs_activation then
      if v_cycle.monthly_activations_used >= v_cycle.monthly_activation_limit then
        raise exception 'monthly_activation_limit_reached';
      end if;

      update public.user_messaging_cycles
         set monthly_activations_used = monthly_activations_used + 1,
             updated_at = v_now
       where user_id = v_user
         and cycle_start = v_cycle.cycle_start
      returning * into v_cycle;
    end if;

    update public.thread_participants
       set messaging_state = 'active',
           archived_at = null,
           activated_at = case when v_needs_activation then v_now else coalesce(activated_at, v_now) end,
           activation_cycle_start = case when v_needs_activation then v_now else coalesce(activation_cycle_start, activated_at, v_now) end,
           activation_cycle_end = case when v_needs_activation then v_now + interval '1 month' else activation_cycle_end end,
           state_changed_at = v_now,
           last_read_at = v_now
     where thread_id = p_thread_id
       and user_id = v_user
    returning * into v_tp;

    if v_previous_state is distinct from 'active' or v_needs_activation then
      perform public.cx_log_thread_status(
        p_thread_id => p_thread_id,
        p_participant_user_id => v_user,
        p_actor_user_id => v_user,
        p_context_type => 'messaging',
        p_event_type => case when v_needs_activation then 'thread_activated' else 'thread_reactivated' end,
        p_from_status => v_previous_state,
        p_to_status => 'active',
        p_metadata => jsonb_build_object(
          'activationConsumed', v_needs_activation,
          'activationStart', coalesce(v_tp.activation_cycle_start, v_tp.activated_at),
          'activationEnd', v_tp.activation_cycle_end
        )
      );
    end if;
  else
    update public.thread_participants
       set messaging_state = v_next,
           archived_at = case when v_next = 'archived' then v_now else null end,
           state_changed_at = v_now
     where thread_id = p_thread_id
       and user_id = v_user
    returning * into v_tp;

    perform public.cx_log_thread_status(
      p_thread_id => p_thread_id,
      p_participant_user_id => v_user,
      p_actor_user_id => v_user,
      p_context_type => 'messaging',
      p_event_type => case when v_next = 'archived' then 'manual_archive' else 'manual_unarchive' end,
      p_from_status => v_previous_state,
      p_to_status => v_next,
      p_metadata => '{}'::jsonb
    );

    v_cycle := public.cx_ensure_user_messaging_cycle(v_user, v_now);
  end if;

  return jsonb_build_object(
    'ok', true,
    'threadId', p_thread_id,
    'messagingState', v_next,
    'activatedAt', v_tp.activated_at,
    'activationStart', coalesce(v_tp.activation_cycle_start, v_tp.activated_at),
    'activationEnd', v_tp.activation_cycle_end,
    'plan', v_cycle.plan,
    'cycleStart', v_cycle.cycle_start,
    'cycleEnd', v_cycle.cycle_end,
    'monthlyLimit', v_cycle.monthly_activation_limit,
    'monthlyUsed', v_cycle.monthly_activations_used,
    'activeLimit', v_cycle.concurrent_active_limit,
    'activeCount', public.cx_count_user_active_threads(v_user)
  );
end;
$$;


--
-- Name: cx_sync_activities(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_sync_activities() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_completed_count int := 0;
  v_prompt_count int := 0;
  v_context_tag text;
  v_conn_id uuid;
  v_due_at timestamptz;
  v_remind_after timestamptz;
  v_expires_at timestamptz;
  r record;
  v_inserted int := 0;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  for r in
    update public.activities a
    set status = 'completed',
        completed_at = coalesce(a.completed_at, now()),
        resolved_at = coalesce(a.resolved_at, now()),
        updated_at = now()
    where a.status = 'accepted'
      and (a.requester_id = v_me or a.recipient_id = v_me)
      and (
        case
          when coalesce(a.end_at, a.start_at) is not null then coalesce(a.end_at, a.start_at) + interval '24 hours'
          when a.accepted_at is not null then a.accepted_at + interval '24 hours'
          else null
        end
      ) <= now()
    returning a.*
  loop
    v_completed_count := v_completed_count + 1;

    perform public.cx_upsert_thread_context(
      p_thread_id => r.thread_id,
      p_source_table => 'activities',
      p_source_id => r.id,
      p_context_tag => 'activity',
      p_status_tag => 'completed',
      p_title => coalesce(nullif(trim(coalesce(r.title, '')), ''), public.cx_activity_type_label(r.activity_type)),
      p_city => null,
      p_start_date => case when r.start_at is null then null else (r.start_at at time zone 'UTC')::date end,
      p_end_date => case when r.end_at is null then null else (r.end_at at time zone 'UTC')::date end,
      p_requester_id => r.requester_id,
      p_recipient_id => r.recipient_id,
      p_metadata => coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
        'activity_type', r.activity_type,
        'activity_id', r.id,
        'title', coalesce(nullif(trim(coalesce(r.title, '')), ''), public.cx_activity_type_label(r.activity_type))
      )
    );

    v_context_tag := public.cx_activity_reference_context(r.activity_type);
    v_due_at := coalesce(r.completed_at, now());
    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '10 days';

    select c.id into v_conn_id
    from public.connections c
    where coalesce(c.status::text, '') = 'accepted'
      and c.blocked_by is null
      and (
        (c.requester_id = r.requester_id and c.target_id = r.recipient_id)
        or (c.requester_id = r.recipient_id and c.target_id = r.requester_id)
      )
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    if public.cx_reference_prompt_allowed(r.requester_id, r.recipient_id, v_context_tag, 'activities', r.id, v_due_at) then
      insert into public.reference_requests (
        user_id, peer_user_id, context_tag, source_table, source_id, connection_id, due_at, remind_after, expires_at, status
      )
      values (
        r.requester_id, r.recipient_id, v_context_tag, 'activities', r.id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending'
      )
      on conflict (user_id, source_table, source_id, context_tag) do nothing;
      get diagnostics v_inserted = row_count;
      v_prompt_count := v_prompt_count + v_inserted;
    end if;

    if public.cx_reference_prompt_allowed(r.recipient_id, r.requester_id, v_context_tag, 'activities', r.id, v_due_at) then
      insert into public.reference_requests (
        user_id, peer_user_id, context_tag, source_table, source_id, connection_id, due_at, remind_after, expires_at, status
      )
      values (
        r.recipient_id, r.requester_id, v_context_tag, 'activities', r.id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending'
      )
      on conflict (user_id, source_table, source_id, context_tag) do nothing;
      get diagnostics v_inserted = row_count;
      v_prompt_count := v_prompt_count + v_inserted;
    end if;
  end loop;

  perform public.cx_refresh_member_interaction_counters(v_me);

  return jsonb_build_object('completed', v_completed_count, 'reference_prompts_created', v_prompt_count);
end;
$$;


--
-- Name: cx_sync_connections_to_thread(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_sync_connections_to_thread() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_thread_id uuid;
  v_status text;
  v_source_id uuid;
  v_requester uuid;
  v_recipient uuid;
  v_actor uuid;
begin
  if tg_op = 'DELETE' then
    v_source_id := old.id;
    v_requester := old.requester_id;
    v_recipient := old.target_id;
    v_status := 'cancelled';
    v_actor := coalesce(auth.uid(), old.requester_id);
  else
    v_source_id := new.id;
    v_requester := new.requester_id;
    v_recipient := new.target_id;
    v_status := lower(trim(coalesce(new.status::text, 'pending')));
    v_actor := coalesce(auth.uid(), case when v_status = 'pending' then new.requester_id else new.target_id end);
  end if;

  v_thread_id := public.cx_ensure_pair_thread(v_requester, v_recipient, v_actor);

  perform public.cx_upsert_thread_context(
    p_thread_id => v_thread_id,
    p_source_table => 'connections',
    p_source_id => v_source_id,
    p_context_tag => 'connection_request',
    p_status_tag => case when v_status in ('pending', 'accepted', 'declined', 'cancelled') then v_status else 'active' end,
    p_title => 'Connection request',
    p_city => null,
    p_start_date => null,
    p_end_date => null,
    p_requester_id => v_requester,
    p_recipient_id => v_recipient,
    p_metadata => jsonb_build_object(
      'connection_id', v_source_id,
      'connect_context', case when tg_op = 'DELETE' then old.connect_context else new.connect_context end,
      'trip_id', case when tg_op = 'DELETE' then old.trip_id else new.trip_id end
    )
  );

  return null;
end;
$$;


--
-- Name: cx_sync_event_members_to_thread(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_sync_event_members_to_thread() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_thread_id uuid;
  v_status text;
  v_actor uuid;
begin
  v_status := lower(trim(coalesce(new.status::text, '')));

  if v_status in ('host', 'going', 'waitlist') then
    v_actor := coalesce(auth.uid(), new.user_id);
    v_thread_id := public.cx_ensure_event_thread(new.event_id, v_actor, new.user_id);

    insert into public.thread_participants (thread_id, user_id, role)
    values (
      v_thread_id,
      new.user_id,
      case when new.status = 'host' or new.member_role = 'host' then 'owner' else 'member' end
    )
    on conflict (thread_id, user_id) do update
      set role = excluded.role;
  else
    select t.id
      into v_thread_id
    from public.threads t
    where t.thread_type = 'event'
      and t.event_id = new.event_id
    order by t.created_at asc
    limit 1;

    if v_thread_id is not null then
      delete from public.thread_participants tp
      where tp.thread_id = v_thread_id
        and tp.user_id = new.user_id
        and not exists (
          select 1
          from public.events e
          where e.id = new.event_id
            and e.host_user_id = new.user_id
        );
    end if;
  end if;

  return null;
end;
$$;


--
-- Name: cx_sync_event_requests_to_thread(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_sync_event_requests_to_thread() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_owner uuid;
  v_title text;
  v_city text;
  v_start timestamptz;
  v_thread_id uuid;
  v_status text;
  v_actor uuid;
begin
  if to_regclass('public.events') is null then
    return null;
  end if;

  select
    coalesce(
      (to_jsonb(e) ->> 'user_id')::uuid,
      (to_jsonb(e) ->> 'host_user_id')::uuid,
      (to_jsonb(e) ->> 'created_by')::uuid
    ),
    e.title,
    e.city,
    e.starts_at
    into v_owner, v_title, v_city, v_start
  from public.events e
  where e.id = new.event_id
  limit 1;

  if v_owner is null then
    return null;
  end if;

  v_status := lower(trim(coalesce(new.status::text, 'pending')));
  v_actor := coalesce(auth.uid(), case when v_status = 'pending' then new.requester_id else v_owner end);
  v_thread_id := public.cx_ensure_event_thread(new.event_id, v_actor, new.requester_id);

  perform public.cx_upsert_thread_context(
    p_thread_id => v_thread_id,
    p_source_table => 'event_requests',
    p_source_id => new.id,
    p_context_tag => 'event_chat',
    p_status_tag => case when v_status in ('pending', 'accepted', 'declined', 'cancelled') then v_status else 'active' end,
    p_title => coalesce(v_title, 'Event chat'),
    p_city => nullif(trim(coalesce(v_city, '')), ''),
    p_start_date => case when v_start is null then null else v_start::date end,
    p_end_date => null,
    p_requester_id => new.requester_id,
    p_recipient_id => v_owner,
    p_metadata => jsonb_build_object('event_id', new.event_id, 'event_request_id', new.id)
  );

  return null;
end;
$$;


--
-- Name: cx_sync_hosting_requests_to_thread(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_sync_hosting_requests_to_thread() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_thread_id uuid;
  v_status text;
  v_actor uuid;
begin
  v_status := lower(trim(coalesce(new.status::text, 'pending')));
  v_actor := coalesce(auth.uid(), case when v_status = 'pending' then new.sender_user_id else new.recipient_user_id end);
  v_thread_id := public.cx_ensure_pair_thread(new.sender_user_id, new.recipient_user_id, v_actor);

  perform public.cx_upsert_thread_context(
    p_thread_id => v_thread_id,
    p_source_table => 'hosting_requests',
    p_source_id => new.id,
    p_context_tag => 'hosting_request',
    p_status_tag => case when v_status in ('pending', 'accepted', 'declined', 'cancelled') then v_status else 'active' end,
    p_title => case when new.request_type = 'offer_to_host' then 'Offer to host' else 'Hosting request' end,
    p_city => null,
    p_start_date => new.arrival_date,
    p_end_date => new.departure_date,
    p_requester_id => new.sender_user_id,
    p_recipient_id => new.recipient_user_id,
    p_metadata => jsonb_strip_nulls(
      jsonb_build_object(
        'hosting_request_id', new.id,
        'request_type', new.request_type,
        'trip_id', new.trip_id,
        'travellers_count', new.travellers_count,
        'max_travellers_allowed', new.max_travellers_allowed,
        'reason', coalesce(
          case
            when new.request_type = 'request_hosting' then public.cx_normalize_travel_intent_reason(new.reason)
            when new.request_type = 'offer_to_host' then public.cx_normalize_hosting_space_type(new.reason)
            else nullif(trim(coalesce(new.reason, '')), '')
          end,
          nullif(trim(coalesce(new.reason, '')), '')
        ),
        'reason_label', case
          when new.request_type = 'request_hosting' then public.cx_travel_intent_reason_label(new.reason)
          when new.request_type = 'offer_to_host' then public.cx_hosting_space_type_label(new.reason)
          else nullif(trim(coalesce(new.reason, '')), '')
        end,
        'message', nullif(trim(coalesce(new.message, '')), '')
      )
    )
  );

  return null;
end;
$$;


--
-- Name: cx_sync_reference_requests(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_sync_reference_requests() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_created int := 0;
  v_completed int := 0;
  v_expired int := 0;
  v_reminded int := 0;
  v_conn_id uuid;
  v_due_at timestamptz;
  v_remind_after timestamptz;
  v_expires_at timestamptz;
  v_peer_id uuid;
  v_context_tag text;
  v_inserted int := 0;
  v_row record;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  for v_row in
    select
      tr.id as source_id,
      tr.requester_id,
      t.user_id as owner_id,
      t.end_date
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and t.end_date is not null
      and t.end_date <= current_date
      and (tr.requester_id = v_me or t.user_id = v_me)
  loop
    v_peer_id := case when v_row.requester_id = v_me then v_row.owner_id else v_row.requester_id end;
    if v_peer_id is null or v_peer_id = v_me then
      continue;
    end if;

    v_due_at := (v_row.end_date::timestamptz + interval '24 hours');
    if v_due_at > now() then
      continue;
    end if;

    if not public.cx_reference_prompt_allowed(v_me, v_peer_id, 'travelling', 'trip_requests', v_row.source_id, v_due_at) then
      continue;
    end if;

    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '10 days';
    v_context_tag := 'travelling';

    select c.id into v_conn_id
    from public.connections c
    where coalesce(c.status::text, '') = 'accepted'
      and c.blocked_by is null
      and (
        (c.requester_id = v_me and c.target_id = v_peer_id)
        or (c.requester_id = v_peer_id and c.target_id = v_me)
      )
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    insert into public.reference_requests (
      user_id, peer_user_id, context_tag, source_table, source_id, connection_id, due_at, remind_after, expires_at, status
    )
    values (
      v_me, v_peer_id, v_context_tag, 'trip_requests', v_row.source_id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending'
    )
    on conflict (user_id, source_table, source_id, context_tag) do nothing;

    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end loop;

  for v_row in
    select
      hr.id as source_id,
      hr.sender_user_id,
      hr.recipient_user_id,
      hr.request_type,
      hr.departure_date
    from public.hosting_requests hr
    where hr.status = 'accepted'
      and hr.departure_date is not null
      and hr.departure_date <= current_date
      and (hr.sender_user_id = v_me or hr.recipient_user_id = v_me)
  loop
    v_peer_id := case when v_row.sender_user_id = v_me then v_row.recipient_user_id else v_row.sender_user_id end;
    if v_peer_id is null or v_peer_id = v_me then
      continue;
    end if;

    if (v_row.request_type = 'request_hosting' and v_row.recipient_user_id = v_me)
       or (v_row.request_type = 'offer_to_host' and v_row.sender_user_id = v_me) then
      v_context_tag := 'offer_hosting';
    else
      v_context_tag := 'request_hosting';
    end if;

    v_due_at := (v_row.departure_date::timestamptz + interval '24 hours');
    if v_due_at > now() then
      continue;
    end if;

    if not public.cx_reference_prompt_allowed(v_me, v_peer_id, v_context_tag, 'hosting_requests', v_row.source_id, v_due_at) then
      continue;
    end if;

    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '10 days';

    select c.id into v_conn_id
    from public.connections c
    where coalesce(c.status::text, '') = 'accepted'
      and c.blocked_by is null
      and (
        (c.requester_id = v_me and c.target_id = v_peer_id)
        or (c.requester_id = v_peer_id and c.target_id = v_me)
      )
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    insert into public.reference_requests (
      user_id, peer_user_id, context_tag, source_table, source_id, connection_id, due_at, remind_after, expires_at, status
    )
    values (
      v_me, v_peer_id, v_context_tag, 'hosting_requests', v_row.source_id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending'
    )
    on conflict (user_id, source_table, source_id, context_tag) do nothing;

    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end loop;

  update public.reference_requests rr
  set
    status = 'completed',
    completed_reference_id = ref.id,
    updated_at = now()
  from public.references ref
  where rr.user_id = v_me
    and rr.status = 'pending'
    and coalesce(ref.author_user_id, ref.author_id, ref.from_user_id) = v_me
    and coalesce(ref.recipient_user_id, ref.recipient_id, ref.to_user_id, ref.target_id) = rr.peer_user_id
    and coalesce(ref.source_id, ref.entity_id, ref.sync_id) = rr.source_id
    and coalesce(ref.context_tag, rr.context_tag) = rr.context_tag;
  get diagnostics v_completed = row_count;

  update public.reference_requests rr
  set status = 'dismissed', updated_at = now()
  where rr.user_id = v_me
    and rr.status = 'pending'
    and public.cx_reference_cooldown_days(rr.context_tag) is not null
    and exists (
      select 1
      from public.references ref
      where coalesce(ref.author_user_id, ref.author_id, ref.from_user_id) = v_me
        and coalesce(ref.recipient_user_id, ref.recipient_id, ref.to_user_id, ref.target_id) = rr.peer_user_id
        and coalesce(ref.reference_family, public.cx_reference_family(coalesce(ref.public_category, public.cx_reference_public_category(coalesce(ref.context_tag, ref.entity_type, ref.context, 'collaborate'))))) =
          public.cx_reference_family(public.cx_reference_public_category(rr.context_tag))
        and ref.created_at + make_interval(days => public.cx_reference_cooldown_days(rr.context_tag)) > now()
    );

  update public.reference_requests rr
  set status = 'expired', updated_at = now()
  where rr.user_id = v_me
    and rr.status = 'pending'
    and now() > rr.expires_at;
  get diagnostics v_expired = row_count;

  if to_regclass('public.notifications') is not null then
    for v_row in
      select rr.id, rr.peer_user_id, rr.context_tag, rr.source_table, rr.source_id, rr.reminder_count
      from public.reference_requests rr
      where rr.user_id = v_me
        and rr.status = 'pending'
        and now() >= rr.remind_after
        and now() <= rr.expires_at
        and (rr.last_reminded_at is null or rr.last_reminded_at <= now() - interval '2 days')
    loop
      insert into public.notifications (user_id, actor_id, kind, title, body, link_url, metadata)
      values (
        v_me,
        v_row.peer_user_id,
        'reference_reminder',
        'Reference reminder',
        'Leave a quick reference for your recent interaction.',
        '/references',
        jsonb_build_object(
          'context_tag', v_row.context_tag,
          'source_table', v_row.source_table,
          'source_id', v_row.source_id,
          'prompt_id', v_row.id
        )
      );

      update public.reference_requests
      set reminder_count = coalesce(reminder_count, 0) + 1,
          last_reminded_at = now(),
          updated_at = now()
      where id = v_row.id;

      v_reminded := v_reminded + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'created', v_created, 'completed', v_completed, 'expired', v_expired, 'reminded', v_reminded);
end;
$$;


--
-- Name: cx_sync_trip_requests_to_thread(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_sync_trip_requests_to_thread() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_trip_owner uuid;
  v_city text;
  v_country text;
  v_thread_id uuid;
  v_status text;
  v_actor uuid;
begin
  select t.user_id, t.destination_city, t.destination_country
    into v_trip_owner, v_city, v_country
  from public.trips t
  where t.id = new.trip_id
  limit 1;

  if v_trip_owner is null then
    return null;
  end if;

  v_status := lower(trim(coalesce(new.status::text, 'pending')));
  v_actor := coalesce(auth.uid(), case when v_status = 'pending' then new.requester_id else v_trip_owner end);
  v_thread_id := public.cx_ensure_pair_thread(new.requester_id, v_trip_owner, v_actor);

  perform public.cx_upsert_thread_context(
    p_thread_id => v_thread_id,
    p_source_table => 'trip_requests',
    p_source_id => new.id,
    p_context_tag => 'trip_join_request',
    p_status_tag => case when v_status in ('pending', 'accepted', 'declined', 'cancelled') then v_status else 'active' end,
    p_title => 'Trip join request',
    p_city => concat_ws(', ', nullif(trim(coalesce(v_city, '')), ''), nullif(trim(coalesce(v_country, '')), '')),
    p_start_date => null,
    p_end_date => null,
    p_requester_id => new.requester_id,
    p_recipient_id => v_trip_owner,
    p_metadata => jsonb_strip_nulls(
      jsonb_build_object(
        'trip_id', new.trip_id,
        'request_id', new.id,
        'trip_join_reason', public.cx_normalize_travel_intent_reason(new.reason),
        'trip_join_reason_label', public.cx_travel_intent_reason_label(new.reason),
        'reason', coalesce(public.cx_normalize_travel_intent_reason(new.reason), nullif(trim(coalesce(new.reason, '')), '')),
        'note', nullif(trim(coalesce(new.note, '')), '')
      )
    )
  );

  return null;
end;
$$;


--
-- Name: cx_sync_user_messaging_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_sync_user_messaging_state() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := auth.uid();
  v_cycle public.user_messaging_cycles%rowtype;
  v_active_count integer := 0;
  v_pending_count integer := 0;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  perform public.cx_run_messaging_housekeeping(v_user);
  v_cycle := public.cx_ensure_user_messaging_cycle(v_user, now());
  v_active_count := public.cx_count_user_active_threads(v_user);

  select count(*)::integer
    into v_pending_count
  from (
    select distinct tc.thread_id
    from public.thread_contexts tc
    where (tc.requester_id = v_user or tc.recipient_id = v_user)
      and tc.status_tag = 'pending'
      and not exists (
        select 1
        from public.thread_contexts tc2
        where tc2.thread_id = tc.thread_id
          and tc2.context_tag in ('connection_request', 'trip_join_request', 'hosting_request', 'event_chat', 'activity', 'service_inquiry')
          and tc2.status_tag in ('accepted', 'active', 'completed')
      )
  ) q;

  return jsonb_build_object(
    'plan', v_cycle.plan,
    'cycleStart', v_cycle.cycle_start,
    'cycleEnd', v_cycle.cycle_end,
    'monthlyLimit', v_cycle.monthly_activation_limit,
    'monthlyUsed', v_cycle.monthly_activations_used,
    'activeLimit', v_cycle.concurrent_active_limit,
    'activeCount', v_active_count,
    'pendingCount', v_pending_count
  );
end;
$$;


--
-- Name: cx_thread_chat_unlocked(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_thread_chat_unlocked(p_thread_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.cx_thread_message_unlocked(p_thread_id, p_user_id)
$$;


--
-- Name: cx_thread_message_unlocked(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_thread_message_unlocked(p_thread_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with participant as (
    select exists (
      select 1
      from public.thread_participants tp
      where tp.thread_id = p_thread_id
        and tp.user_id = p_user_id
    ) as ok
  ),
  event_thread_access as (
    select exists (
      select 1
      from public.threads t
      join public.events e on e.id = t.event_id
      join public.event_members em on em.event_id = e.id and em.user_id = p_user_id
      where t.id = p_thread_id
        and t.thread_type = 'event'
        and e.status = 'published'
        and coalesce(e.hidden_by_admin, false) = false
        and em.status in ('host', 'going', 'waitlist')
    ) as ok
  ),
  service_inquiry_state as (
    select
      exists (
        select 1
        from public.thread_contexts tc
        where tc.thread_id = p_thread_id
          and tc.context_tag = 'service_inquiry'
      ) as has_service_inquiry,
      exists (
        select 1
        from public.thread_contexts tc
        where tc.thread_id = p_thread_id
          and tc.context_tag = 'service_inquiry'
          and tc.status_tag = 'active'
      ) as service_active,
      exists (
        select 1
        from public.thread_contexts tc
        join public.service_inquiry_threads sit
          on sit.thread_id = tc.thread_id
         and tc.source_table = 'service_inquiries'
         and tc.source_id = sit.inquiry_id
        join public.service_inquiries si on si.id = sit.inquiry_id
        where tc.thread_id = p_thread_id
          and tc.context_tag = 'service_inquiry'
          and tc.status_tag = 'info_shared'
          and si.requester_id = p_user_id
          and sit.requester_followup_used = false
      ) as requester_free_followup
  ),
  unlock_sources as (
    select
      exists (
        select 1
        from public.thread_contexts tc
        where tc.thread_id = p_thread_id
          and tc.context_tag in ('connection_request', 'trip_join_request', 'hosting_request', 'event_chat', 'activity')
          and tc.status_tag in ('accepted', 'active', 'completed')
      ) as has_non_service_unlock_context,
      exists (
        select 1
        from public.threads t
        join public.connections c on c.id = t.connection_id
        where t.id = p_thread_id
          and (c.requester_id = p_user_id or c.target_id = p_user_id)
          and c.status = 'accepted'
          and c.blocked_by is null
      ) as has_accepted_thread_connection,
      exists (
        select 1
        from public.thread_contexts tc
        join public.connections c
          on tc.source_table = 'connections'
         and tc.source_id = c.id
        where tc.thread_id = p_thread_id
          and (c.requester_id = p_user_id or c.target_id = p_user_id)
          and c.status = 'accepted'
          and c.blocked_by is null
      ) as has_accepted_context_connection,
      exists (
        select 1
        from public.thread_messages tm
        where tm.thread_id = p_thread_id
          and coalesce(tm.message_type, 'text') = 'text'
      ) as has_text_history,
      exists (
        select 1
        from public.thread_contexts tc
        join public.connections c
          on tc.source_table = 'connections'
         and tc.source_id = c.id
        where tc.thread_id = p_thread_id
          and (c.status = 'blocked' or c.blocked_by is not null)
      ) as has_blocked_connection
  )
  select
    (select ok from participant)
    and not (select has_blocked_connection from unlock_sources)
    and (
      (select ok from event_thread_access)
      or (select service_active from service_inquiry_state)
      or (select requester_free_followup from service_inquiry_state)
      or (select has_non_service_unlock_context from unlock_sources)
      or (select has_accepted_thread_connection from unlock_sources)
      or (select has_accepted_context_connection from unlock_sources)
      or (
        not (select has_service_inquiry from service_inquiry_state)
        and (select has_text_history from unlock_sources)
      )
    )
$$;


--
-- Name: cx_travel_intent_reason_label(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_travel_intent_reason_label(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case public.cx_normalize_travel_intent_reason(p_value)
    when 'dance_trip_holiday' then 'Dance trip / Holiday'
    when 'training_classes' then 'Training & Classes'
    when 'festival_event' then 'Festival / Event'
    else coalesce(nullif(trim(p_value), ''), 'Festival / Event')
  end
$$;


--
-- Name: cx_trip_join_reason_label(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_trip_join_reason_label(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select public.cx_travel_intent_reason_label(p_value)
$$;


--
-- Name: cx_upsert_request_chat_entitlement(uuid, text, uuid, uuid, uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_upsert_request_chat_entitlement(p_thread_id uuid, p_source_type text, p_source_id uuid, p_requester_user_id uuid, p_responder_user_id uuid, p_opens_at timestamp with time zone, p_expires_at timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id     uuid;
  v_status text;
begin
  v_status := public.cx_rce_current_status(p_opens_at, p_expires_at, 'scheduled');

  insert into public.request_chat_entitlements (
    thread_id, source_type, source_id,
    requester_user_id, responder_user_id,
    status, opens_at, expires_at
  ) values (
    p_thread_id, p_source_type, p_source_id,
    p_requester_user_id, p_responder_user_id,
    v_status, p_opens_at, p_expires_at
  )
  on conflict (source_type, source_id) do update set
    thread_id         = excluded.thread_id,
    opens_at          = excluded.opens_at,
    expires_at        = excluded.expires_at,
    status            = public.cx_rce_current_status(excluded.opens_at, excluded.expires_at,
                          case when request_chat_entitlements.status = 'cancelled' then 'cancelled' else 'scheduled' end),
    updated_at        = now()
  returning id into v_id;

  return v_id;
end;
$$;


--
-- Name: cx_upsert_thread_context(uuid, text, uuid, text, text, text, text, date, date, uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_upsert_thread_context(p_thread_id uuid, p_source_table text, p_source_id uuid, p_context_tag text, p_status_tag text, p_title text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_requester_id uuid DEFAULT NULL::uuid, p_recipient_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
  v_status text := lower(trim(coalesce(p_status_tag, 'pending')));
begin
  if p_thread_id is null or p_source_id is null then
    raise exception 'thread_or_source_required';
  end if;
  if p_source_table is null or trim(p_source_table) = '' then
    raise exception 'source_table_required';
  end if;
  if p_context_tag not in (
    'connection_request', 'hosting_request', 'trip_join_request',
    'event_chat', 'regular_chat', 'activity',
    'service_inquiry', 'teacher_booking'
  ) then
    raise exception 'invalid_context_tag';
  end if;
  if v_status not in ('pending', 'accepted', 'declined', 'cancelled', 'active', 'completed', 'expired') then
    raise exception 'invalid_status_tag';
  end if;

  insert into public.thread_contexts (
    thread_id, source_table, source_id, context_tag, status_tag,
    title, city, start_date, end_date,
    requester_id, recipient_id, metadata,
    is_pinned, resolved_at
  )
  values (
    p_thread_id, trim(p_source_table), p_source_id, p_context_tag, v_status,
    p_title, p_city, p_start_date, p_end_date,
    p_requester_id, p_recipient_id, coalesce(p_metadata, '{}'::jsonb),
    v_status = 'pending',
    case when v_status in ('accepted', 'declined', 'cancelled', 'completed') then now() else null end
  )
  on conflict (source_table, source_id) do update set
    thread_id = excluded.thread_id,
    context_tag = excluded.context_tag,
    status_tag = excluded.status_tag,
    title = excluded.title,
    city = excluded.city,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    requester_id = excluded.requester_id,
    recipient_id = excluded.recipient_id,
    metadata = excluded.metadata,
    is_pinned = excluded.is_pinned,
    resolved_at = excluded.resolved_at,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;


--
-- Name: cx_username_base_from_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cx_username_base_from_text(raw_value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select nullif(
    trim(
      both '._' from left(
        trim(both '._' from regexp_replace(regexp_replace(lower(coalesce(raw_value, '')), '[^a-z0-9]+', '.', 'g'), '\.{2,}', '.', 'g')),
        20
      )
    ),
    ''
  );
$$;


--
-- Name: decline_connection_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decline_connection_request(p_connection_id uuid) RETURNS void
    LANGUAGE plpgsql
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
-- Name: enforce_dance_contacts_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_dance_contacts_limit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
begin
  if tg_op = 'INSERT' then
    select count(*) into v_count from public.dance_contacts where user_id = new.user_id;
    if v_count >= 100 then
      raise exception using
        errcode = 'check_violation',
        message = 'contact_limit_exceeded: max 100 contacts per user';
    end if;
  elsif tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    select count(*) into v_count from public.dance_contacts where user_id = new.user_id;
    if v_count >= 100 then
      raise exception using
        errcode = 'check_violation',
        message = 'contact_limit_exceeded: max 100 contacts per user';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: enforce_dance_goals_active_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_dance_goals_active_limit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_active_count integer;
begin
  if new.status = 'active' then
    select count(*)
      into v_active_count
    from public.dance_goals_user g
    where g.user_id = new.user_id
      and g.status = 'active'
      and g.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if v_active_count >= 3 then
      raise exception 'Maximum 3 active goals allowed per user.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: enforce_dance_moves_user_limits(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_dance_moves_user_limits() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_total integer;
  v_practicing integer;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'user_id_cannot_be_changed';
  end if;

  select count(*)
  into v_total
  from public.dance_moves_user m
  where m.user_id = new.user_id
    and (tg_op <> 'UPDATE' or m.id <> new.id);

  if v_total >= 200 then
    raise exception 'max_moves_per_user_exceeded';
  end if;

  if new.status = 'practicing' then
    select count(*)
    into v_practicing
    from public.dance_moves_user m
    where m.user_id = new.user_id
      and m.status = 'practicing'
      and (tg_op <> 'UPDATE' or m.id <> new.id);

    if v_practicing >= 20 then
      raise exception 'max_practicing_moves_exceeded';
    end if;
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
-- Name: enforce_trip_plan_active_limits(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_trip_plan_active_limits() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  active_count int;
  v_limits record;
begin
  if tg_op not in ('INSERT', 'UPDATE') then
    return new;
  end if;

  if coalesce(new.status, 'active') = 'inactive' or new.end_date < current_date then
    return new;
  end if;

  select * into v_limits
  from public.trip_plan_limits(new.user_id);

  select count(*)
    into active_count
  from public.trips t
  where t.user_id = new.user_id
    and t.end_date >= current_date
    and coalesce(t.status, 'active') <> 'inactive'
    and (tg_op <> 'UPDATE' or t.id <> new.id);

  if active_count >= coalesce(v_limits.max_active_trips, 1) then
    raise exception 'active_trip_limit_reached';
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
-- Name: event_chat_mode_for_access(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_chat_mode_for_access(p_access text, p_chat_mode text DEFAULT NULL::text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case
    when lower(trim(coalesce(p_access, 'public'))) = 'private_group'
      then case
        when lower(trim(coalesce(p_chat_mode, ''))) in ('broadcast', 'discussion') then lower(trim(p_chat_mode))
        else 'discussion'
      end
    else case
      when lower(trim(coalesce(p_chat_mode, ''))) = 'discussion' then 'discussion'
      else 'broadcast'
    end
  end
$$;


--
-- Name: event_has_capacity(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_has_capacity(p_event_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_limit integer;
  v_current integer;
begin
  select coalesce(e.max_members, e.capacity)
    into v_limit
  from public.events e
  where e.id = p_event_id;

  if v_limit is null then
    return true;
  end if;

  select count(*)::integer
    into v_current
  from public.event_members em
  where em.event_id = p_event_id
    and em.status in ('host', 'going');

  return v_current < v_limit;
end;
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
-- Name: event_legacy_visibility_for_access(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_legacy_visibility_for_access(p_access text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case
    when lower(trim(coalesce(p_access, 'public'))) = 'private_group' then 'private'
    else 'public'
  end
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

CREATE FUNCTION public.get_public_event_lite(p_event_id uuid) RETURNS TABLE(id uuid, host_user_id uuid, title text, description text, event_type text, styles text[], visibility text, event_access_type text, chat_mode text, max_members integer, city text, country text, venue_name text, venue_address text, starts_at timestamp with time zone, ends_at timestamp with time zone, capacity integer, cover_url text, cover_status text, cover_reviewed_by uuid, cover_reviewed_at timestamp with time zone, cover_review_note text, hidden_by_admin boolean, hidden_reason text, links jsonb, status text, invite_token text, created_at timestamp with time zone, updated_at timestamp with time zone)
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
    e.event_access_type,
    e.chat_mode,
    e.max_members,
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
    null::text as invite_token,
    e.created_at,
    e.updated_at
  from public.events e
  where e.id = p_event_id
    and e.status = 'published'
    and e.event_access_type in ('public', 'request', 'private_group')
    and coalesce(e.hidden_by_admin, false) = false
  limit 1;
$$;


--
-- Name: group_slot_limit_for_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.group_slot_limit_for_user(p_user_id uuid) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_pro_status text := null;
begin
  if public.is_app_admin(p_user_id) then
    return 500;
  end if;

  select lower(trim(coalesce(u.raw_user_meta_data ->> 'billing_pro_status', '')))
    into v_pro_status
  from auth.users u
  where u.id = p_user_id
  limit 1;

  if coalesce(v_pro_status, '') in ('trialing', 'active', 'past_due') then
    return 25;
  end if;

  return 5;
end;
$$;


--
-- Name: groups_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.groups_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin new.updated_at = now(); return new; end; $$;


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
-- Name: is_group_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_group_member(p_group_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = p_user_id
  );
$$;


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

  if v_event.event_access_type = 'request' then
    raise exception 'request_event_requires_approval';
  end if;

  if v_event.event_access_type not in ('public', 'private_group') then
    raise exception 'event_is_request_only';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open';
  end if;

  if v_event.host_user_id = v_me then
    return 'host';
  end if;

  if v_event.event_access_type = 'private_group' then
    if public.private_group_monthly_usage_count(v_me) >= public.private_group_limit_for_user(v_me) then
      raise exception 'private_group_monthly_limit_reached';
    end if;
    if not public.event_has_capacity(p_event_id) then
      raise exception 'private_group_member_limit_reached';
    end if;
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
    joined_at = now(),
    updated_at = now();

  return v_status;
end;
$$;


--
-- Name: leave_event(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.leave_event(p_event_id uuid) RETURNS void
    LANGUAGE plpgsql
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

CREATE FUNCTION public.list_public_events_lite(p_limit integer DEFAULT 300) RETURNS TABLE(id uuid, host_user_id uuid, title text, description text, event_type text, styles text[], visibility text, event_access_type text, chat_mode text, max_members integer, city text, country text, venue_name text, venue_address text, starts_at timestamp with time zone, ends_at timestamp with time zone, capacity integer, cover_url text, cover_status text, cover_reviewed_by uuid, cover_reviewed_at timestamp with time zone, cover_review_note text, hidden_by_admin boolean, hidden_reason text, links jsonb, status text, invite_token text, created_at timestamp with time zone, updated_at timestamp with time zone)
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
    e.event_access_type,
    e.chat_mode,
    e.max_members,
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
    null::text as invite_token,
    e.created_at,
    e.updated_at
  from public.events e
  where e.status = 'published'
    and e.event_access_type in ('public', 'request')
    and coalesce(e.hidden_by_admin, false) = false
  order by e.starts_at asc
  limit greatest(1, least(coalesce(p_limit, 300), 500));
$$;


--
-- Name: log_dance_move_practice(uuid, smallint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_dance_move_practice(p_move_id uuid, p_confidence_after smallint DEFAULT NULL::smallint, p_quick_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: mark_sync_completed(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_sync_completed(p_connection_id uuid, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
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
-- Name: private_group_limit_for_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.private_group_limit_for_user(p_user_id uuid) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_pro_status text := null;
begin
  if public.is_app_admin(p_user_id) then
    return 500;
  end if;

  select lower(trim(coalesce(u.raw_user_meta_data ->> 'billing_pro_status', '')))
    into v_pro_status
  from auth.users u
  where u.id = p_user_id
  limit 1;

  if coalesce(v_pro_status, '') in ('trialing', 'active', 'past_due') then
    return 25;
  end if;

  return 5;
end;
$$;


--
-- Name: private_group_monthly_usage_count(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.private_group_monthly_usage_count(p_user_id uuid, p_anchor timestamp with time zone DEFAULT now()) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select count(distinct e.id)::integer
  from public.events e
  join public.event_members em on em.event_id = e.id
  where em.user_id = p_user_id
    and em.status in ('host', 'going', 'waitlist')
    and e.event_access_type = 'private_group'
    and e.status = 'published'
    and coalesce(e.hidden_by_admin, false) = false;
$$;


--
-- Name: profile_media_enforce_limits(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profile_media_enforce_limits() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  existing_total integer := 0;
  existing_videos integer := 0;
  existing_photos integer := 0;
  excluded_id uuid := coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
begin
  select
    count(*)::integer,
    count(*) filter (where kind = 'video')::integer,
    count(*) filter (where kind = 'photo')::integer
  into existing_total, existing_videos, existing_photos
  from public.profile_media
  where user_id = new.user_id
    and id <> excluded_id;

  if existing_total >= 5 then
    raise exception 'You can store at most 5 showcase media items per profile.';
  end if;

  if new.kind = 'video' and existing_videos >= 2 then
    raise exception 'You can store at most 2 showcase videos per profile.';
  end if;

  if new.kind = 'photo' and existing_photos >= 3 then
    raise exception 'You can store at most 3 showcase photos per profile.';
  end if;

  if new.is_primary and exists (
    select 1
    from public.profile_media
    where user_id = new.user_id
      and is_primary = true
      and id <> excluded_id
  ) then
    raise exception 'Only one primary showcase item is allowed per profile.';
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
-- Name: prune_events_archive(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_events_archive(p_keep_days integer DEFAULT 30, p_batch integer DEFAULT 1000) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted integer := 0;
begin
  if coalesce(p_keep_days, 30) < 1 then
    raise exception 'invalid_keep_days';
  end if;

  with candidates as (
    select a.event_id
    from public.events_archive a
    where coalesce(a.ended_at, a.archived_at) < (now() - make_interval(days => p_keep_days))
    order by coalesce(a.ended_at, a.archived_at) asc
    limit greatest(1, least(coalesce(p_batch, 1000), 5000))
  ),
  deleted as (
    delete from public.events_archive a
    using candidates c
    where a.event_id = c.event_id
    returning 1
  )
  select count(*)::integer into v_deleted
  from deleted;

  return v_deleted;
end;
$$;


--
-- Name: rce_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rce_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin new.updated_at = now(); return new; end; $$;


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
-- Name: refresh_dance_growth_public_summary(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_dance_growth_public_summary(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_summary record;
begin
  if p_user_id is null then
    return;
  end if;

  with per_user as (
    select
      m.user_id,
      count(*) filter (where m.status = 'planned')::int as planned_count,
      count(*) filter (where m.status = 'practicing')::int as practicing_count,
      count(*) filter (where m.status = 'learned')::int as learned_count,
      coalesce(array_agg(distinct m.style order by m.style), '{}'::text[]) as styles_tracked
    from public.dance_moves_user m
    where m.user_id = p_user_id
    group by m.user_id
  ),
  recent as (
    select
      m.user_id,
      coalesce(
        (
          array_agg(m.name order by coalesce(m.learned_at, m.updated_at, m.created_at) desc)
        )[1:3],
        '{}'::text[]
      ) as recently_learned
    from public.dance_moves_user m
    where m.user_id = p_user_id
      and m.status = 'learned'
    group by m.user_id
  )
  select
    p.user_id,
    p.planned_count,
    p.practicing_count,
    p.learned_count,
    p.styles_tracked,
    coalesce(r.recently_learned, '{}'::text[]) as recently_learned
  into v_summary
  from per_user p
  left join recent r on r.user_id = p.user_id;

  if not found then
    delete from public.dance_growth_public_summary where user_id = p_user_id;
    return;
  end if;

  insert into public.dance_growth_public_summary (
    user_id,
    planned_count,
    practicing_count,
    learned_count,
    styles_tracked,
    recently_learned,
    updated_at
  )
  values (
    v_summary.user_id,
    v_summary.planned_count,
    v_summary.practicing_count,
    v_summary.learned_count,
    v_summary.styles_tracked,
    v_summary.recently_learned,
    now()
  )
  on conflict (user_id) do update
  set planned_count = excluded.planned_count,
      practicing_count = excluded.practicing_count,
      learned_count = excluded.learned_count,
      styles_tracked = excluded.styles_tracked,
      recently_learned = excluded.recently_learned,
      updated_at = excluded.updated_at;
end;
$$;


--
-- Name: reply_reference_receiver(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reply_reference_receiver(p_reference_id uuid, p_reply_text text) RETURNS uuid
    LANGUAGE plpgsql
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

  if v_event.status <> 'published' then
    raise exception 'event_not_open';
  end if;

  if v_event.event_access_type <> 'request' then
    raise exception 'event_is_not_request';
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

  if v_event.event_access_type <> 'request' then
    raise exception 'event_is_not_request';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'request_not_pending';
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
      joined_at = now(),
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
-- Name: respond_hosting_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.respond_hosting_request(p_request_id uuid, p_action text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_row public.hosting_requests%rowtype;
  v_action text := lower(trim(coalesce(p_action, '')));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if v_action not in ('accepted', 'declined') then
    raise exception 'invalid_action';
  end if;

  select *
    into v_row
  from public.hosting_requests hr
  where hr.id = p_request_id
    and hr.recipient_user_id = v_me
  limit 1;

  if v_row.id is null then
    raise exception 'hosting_request_not_found';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'hosting_request_not_pending';
  end if;

  update public.hosting_requests
  set status = v_action,
      decided_by = v_me,
      decided_at = now(),
      updated_at = now()
  where id = v_row.id;

  if to_regprocedure('public.create_notification(uuid,text,text,text,text,jsonb)') is not null then
    perform public.create_notification(
      v_row.sender_user_id,
      'hosting_request_' || v_action,
      case when v_action = 'accepted' then 'Hosting request accepted' else 'Hosting request declined' end,
      case when v_action = 'accepted'
        then 'Your hosting request was accepted.'
        else 'Your hosting request was declined.'
      end,
      '/trips/hosting',
      jsonb_build_object('hosting_request_id', v_row.id, 'status', v_action)
    );
  end if;

  return v_row.id;
end;
$$;


--
-- Name: respond_trip_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.respond_trip_request(p_request_id uuid, p_action text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_me uuid := auth.uid();
  v_row record;
  v_thread_id uuid;
  v_next_status text;
  v_owner_limits record;
  v_requester_limits record;
  v_owner_accepted_count int := 0;
  v_requester_accepted_count int := 0;
  v_month_start timestamptz := date_trunc('month', now());
  v_month_end timestamptz := date_trunc('month', now()) + interval '1 month';
  v_has_decided_by boolean := false;
  v_has_decided_at boolean := false;
  v_has_updated_at boolean := false;
  v_update_sql text := '';
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

  if p_action = 'accept' then
    select * into v_owner_limits
    from public.trip_plan_limits(v_row.owner_id);

    select * into v_requester_limits
    from public.trip_plan_limits(v_row.requester_id);

    select public.count_accepted_trip_matches_month(v_row.owner_id, v_month_start, v_month_end)
      into v_owner_accepted_count;

    select public.count_accepted_trip_matches_month(v_row.requester_id, v_month_start, v_month_end)
      into v_requester_accepted_count;

    if v_owner_accepted_count >= coalesce(v_owner_limits.max_accepted_trips_per_month, 1) then
      raise exception 'owner_trip_accept_limit_reached';
    end if;

    if v_requester_accepted_count >= coalesce(v_requester_limits.max_accepted_trips_per_month, 1) then
      raise exception 'requester_trip_accept_limit_reached';
    end if;
  end if;

  v_next_status := case when p_action = 'accept' then 'accepted' else 'declined' end;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_requests'
      and column_name = 'decided_by'
  )
    into v_has_decided_by;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_requests'
      and column_name = 'decided_at'
  )
    into v_has_decided_at;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_requests'
      and column_name = 'updated_at'
  )
    into v_has_updated_at;

  v_update_sql := 'update public.trip_requests set status = $1';

  if v_has_decided_by then
    v_update_sql := v_update_sql || ', decided_by = $2';
  end if;

  if v_has_decided_at then
    v_update_sql := v_update_sql || ', decided_at = now()';
  end if;

  if v_has_updated_at then
    v_update_sql := v_update_sql || ', updated_at = now()';
  end if;

  v_update_sql := v_update_sql || ' where id = $3';

  execute v_update_sql using v_next_status, v_me, p_request_id;

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
    jsonb_build_object(
      'trip_id', v_row.trip_id,
      'trip_request_id', v_row.id,
      'action', p_action
    )
  );

  return p_request_id;
end;
$_$;


--
-- Name: send_event_invitation(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_event_invitation(p_event_id uuid, p_recipient_id uuid, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_invitation_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_event_id is null then
    raise exception 'event_not_found';
  end if;

  if p_recipient_id is null then
    raise exception 'recipient_required';
  end if;

  if p_recipient_id = v_me then
    raise exception 'cannot_invite_self';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open';
  end if;

  if coalesce(v_event.hidden_by_admin, false) then
    raise exception 'event_hidden';
  end if;

  -- Non-hosts must be an active member (going or waitlist) to invite
  if v_event.host_user_id <> v_me then
    if not exists (
      select 1
      from public.event_members em
      where em.event_id = p_event_id
        and em.user_id = v_me
        and em.status in ('host', 'going', 'waitlist')
    ) then
      raise exception 'invite_requires_event_membership';
    end if;
  end if;

  if not exists (
    select 1
    from public.connections c
    where (
      (c.requester_id = v_me and c.target_id = p_recipient_id)
      or (c.requester_id = p_recipient_id and c.target_id = v_me)
    )
      and c.status = 'accepted'
      and c.blocked_by is null
  ) then
    raise exception 'invite_requires_connection';
  end if;

  if exists (
    select 1
    from public.event_members em
    where em.event_id = p_event_id
      and em.user_id = p_recipient_id
      and em.status in ('host', 'going', 'waitlist')
  ) then
    raise exception 'already_joined_or_waitlisted';
  end if;

  v_invitation_id := gen_random_uuid();

  insert into public.event_invitations
    (id, event_id, inviter_user_id, recipient_user_id, note, created_at, updated_at)
  values
    (v_invitation_id, p_event_id, v_me, p_recipient_id, p_note, now(), now())
  on conflict (event_id, recipient_user_id) do update
    set inviter_user_id = excluded.inviter_user_id,
        note            = excluded.note,
        updated_at      = now()
  returning id into v_invitation_id;

  return v_invitation_id;
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
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: set_event_invitation_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_event_invitation_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: set_event_response(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_event_response(p_event_id uuid, p_response text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_existing public.event_members;
  v_response text := lower(trim(coalesce(p_response, '')));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if v_response not in ('interested', 'not_interested') then
    raise exception 'invalid_response';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
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

  if v_existing is not null and v_existing.status = 'host' then
    return 'host';
  end if;

  insert into public.event_members (event_id, user_id, member_role, status)
  values (p_event_id, v_me, 'guest', v_response)
  on conflict (event_id, user_id)
  do update set
    member_role = 'guest',
    status = excluded.status,
    updated_at = now();

  if v_response = 'not_interested' then
    update public.event_requests
      set status = 'cancelled',
          decided_by = null,
          decided_at = null,
          updated_at = now()
    where event_id = p_event_id
      and requester_id = v_me
      and status = 'pending';
  end if;

  return v_response;
end;
$$;


--
-- Name: set_event_series_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_event_series_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
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
-- Name: set_profile_media_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_profile_media_updated_at() RETURNS trigger
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
    SET search_path TO 'public'
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
    LANGUAGE plpgsql
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
-- Name: sync_dance_growth_public_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_dance_growth_public_summary() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_dance_growth_public_summary(old.user_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_dance_growth_public_summary(new.user_id);
  end if;

  return null;
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
-- Name: teacher_profile_is_active(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.teacher_profile_is_active(p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.teacher_profiles tp
    where tp.user_id = p_user_id
      and tp.teacher_profile_enabled = true
      and tp.is_public = true
      and (
        tp.teacher_profile_trial_ends_at is null
        or tp.teacher_profile_trial_ends_at > now()
        or exists (
          select 1 from public.profiles p
          where p.user_id = tp.user_id
            and p.roles @> array['verified']
        )
      )
  )
$$;


--
-- Name: touch_privacy_requests_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_privacy_requests_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at := now();
  if new.status in ('resolved', 'dismissed') and old.status is distinct from new.status and new.resolved_at is null then
    new.resolved_at := now();
  elsif new.status not in ('resolved', 'dismissed') then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;


--
-- Name: trg_group_member_add_to_thread(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_group_member_add_to_thread() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_thread_id uuid;
  v_owner     uuid;
begin
  select id into v_thread_id
  from public.threads
  where thread_type = 'group' and group_id = new.group_id
  limit 1;

  if v_thread_id is null then
    return new;
  end if;

  select host_user_id into v_owner from public.groups where id = new.group_id limit 1;

  insert into public.thread_participants (thread_id, user_id, role)
  values (
    v_thread_id,
    new.user_id,
    case when new.user_id = v_owner then 'owner' else 'member' end
  )
  on conflict (thread_id, user_id) do nothing;

  return new;
end;
$$;


--
-- Name: trip_plan_limits(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trip_plan_limits(p_user uuid) RETURNS TABLE(max_active_trips integer, max_accepted_trips_per_month integer, plan_label text)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
declare
  v_profile jsonb := '{}'::jsonb;
  v_plan_text text := '';
  v_boolean_text text := 'false';
  v_is_plus boolean := false;
begin
  select coalesce(to_jsonb(p), '{}'::jsonb)
    into v_profile
  from public.profiles p
  where p.user_id = p_user
  limit 1;

  v_plan_text := lower(
    trim(
      coalesce(
        nullif(v_profile ->> 'trip_plan', ''),
        nullif(v_profile ->> 'plan_tier', ''),
        nullif(v_profile ->> 'membership_tier', ''),
        nullif(v_profile ->> 'subscription_tier', ''),
        nullif(v_profile ->> 'billing_tier', ''),
        nullif(v_profile ->> 'plan', ''),
        nullif(v_profile ->> 'tier', ''),
        nullif(v_profile ->> 'account_tier', ''),
        ''
      )
    )
  );

  if v_plan_text in ('plus', 'pro', 'premium', 'paid') then
    v_is_plus := true;
  else
    v_boolean_text := lower(
      trim(
        coalesce(
          nullif(v_profile ->> 'is_plus', ''),
          nullif(v_profile ->> 'plus', ''),
          nullif(v_profile ->> 'has_plus', ''),
          nullif(v_profile ->> 'plus_active', ''),
          nullif(v_profile ->> 'pro_active', ''),
          nullif(v_profile ->> 'premium_active', ''),
          'false'
        )
      )
    );

    v_is_plus := v_boolean_text in ('true', 't', '1', 'yes', 'y', 'on');
  end if;

  if v_is_plus then
    return query select 3, 3, 'plus'::text;
  else
    return query select 1, 1, 'starter'::text;
  end if;
end;
$$;


--
-- Name: unblock_connection(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unblock_connection(p_connection_id uuid) RETURNS void
    LANGUAGE plpgsql
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
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: update_event(uuid, text, text, text, text[], text, text, text, text, text, timestamp with time zone, timestamp with time zone, integer, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_event(p_event_id uuid, p_title text, p_description text, p_event_type text, p_styles text[] DEFAULT NULL::text[], p_visibility text DEFAULT 'public'::text, p_city text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_venue_name text DEFAULT NULL::text, p_venue_address text DEFAULT NULL::text, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_capacity integer DEFAULT NULL::integer, p_cover_url text DEFAULT NULL::text, p_links jsonb DEFAULT '[]'::jsonb, p_status text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
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
-- Name: update_event(uuid, text, text, text, text[], text, text, text, text, text, text, text, timestamp with time zone, timestamp with time zone, integer, text, jsonb, text, boolean, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_event(p_event_id uuid, p_title text, p_description text, p_event_type text, p_styles text[] DEFAULT NULL::text[], p_visibility text DEFAULT 'public'::text, p_event_access_type text DEFAULT NULL::text, p_chat_mode text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_venue_name text DEFAULT NULL::text, p_venue_address text DEFAULT NULL::text, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_capacity integer DEFAULT NULL::integer, p_cover_url text DEFAULT NULL::text, p_links jsonb DEFAULT '[]'::jsonb, p_status text DEFAULT NULL::text, p_show_guest_list boolean DEFAULT NULL::boolean, p_guests_can_invite boolean DEFAULT NULL::boolean, p_approve_messages boolean DEFAULT NULL::boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_access_type text;
  v_chat_mode text;
  v_visibility text;
  v_status text;
  v_cover_url text;
  v_styles text[];
  v_edit_count int := 0;
  v_active_count int := 0;
  v_limit int := 3;
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

  v_access_type := lower(trim(coalesce(
    p_event_access_type,
    v_event.event_access_type,
    case when lower(trim(coalesce(p_visibility, v_event.visibility, 'public'))) = 'private' then 'request' else 'public' end
  )));
  if v_access_type not in ('public', 'request', 'private_group') then
    raise exception 'invalid_event_access_type';
  end if;

  v_visibility := public.event_legacy_visibility_for_access(v_access_type);
  v_chat_mode := public.event_chat_mode_for_access(v_access_type, p_chat_mode);

  v_status := lower(trim(coalesce(p_status, v_event.status)));
  if v_status not in ('draft', 'published', 'cancelled') then
    raise exception 'invalid_status';
  end if;

  v_cover_url := nullif(trim(coalesce(p_cover_url, v_event.cover_url, '')), '');
  if v_cover_url is not null then
    if v_cover_url !~* '/storage/v1/(object/public|render/image/public)/avatars/' then
      raise exception 'invalid_cover_url';
    end if;
  end if;

  if p_starts_at is null and p_ends_at is null then
    null;
  elsif p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_event_window';
  end if;

  if v_access_type = 'private_group' then
    if coalesce(p_capacity, 25) > 25 then
      raise exception 'private_group_member_limit_reached';
    end if;
  elsif p_capacity is not null and (p_capacity < 1 or p_capacity > 2000) then
    raise exception 'invalid_capacity';
  end if;

  v_styles := public.normalize_event_styles(coalesce(p_styles, v_event.styles));
  if cardinality(v_styles) > 12 then
    raise exception 'too_many_styles';
  end if;

  if v_status = 'published'
     and v_access_type = 'private_group'
     and coalesce(v_event.event_access_type, 'public') <> 'private_group' then
    if public.private_group_monthly_usage_count(v_me) >= public.private_group_limit_for_user(v_me) then
      raise exception 'private_group_monthly_limit_reached';
    end if;
  elsif v_status = 'published' and v_event.status <> 'published' and v_access_type <> 'private_group' then
    select public.active_event_limit_for_user(v_me) into v_limit;

    select count(*)::int
      into v_active_count
    from public.events e
    where e.host_user_id = v_me
      and e.id <> p_event_id
      and e.status = 'published'
      and e.ends_at >= now()
      and coalesce(e.hidden_by_admin, false) = false
      and coalesce(e.event_access_type, 'public') <> 'private_group';

    if v_active_count >= v_limit then
      raise exception 'active_event_limit_reached';
    end if;
  end if;

  update public.events
  set title = trim(coalesce(p_title, v_event.title)),
      description = nullif(trim(coalesce(p_description, v_event.description, '')), ''),
      event_type = coalesce(nullif(trim(coalesce(p_event_type, v_event.event_type)), ''), 'Social'),
      styles = coalesce(v_styles, '{}'::text[]),
      visibility = v_visibility,
      event_access_type = v_access_type,
      chat_mode = v_chat_mode,
      max_members = case when v_access_type = 'private_group' then 25 else null end,
      city = trim(coalesce(p_city, v_event.city)),
      country = trim(coalesce(p_country, v_event.country)),
      venue_name = nullif(trim(coalesce(p_venue_name, v_event.venue_name, '')), ''),
      venue_address = nullif(trim(coalesce(p_venue_address, v_event.venue_address, '')), ''),
      starts_at = coalesce(p_starts_at, v_event.starts_at),
      ends_at = coalesce(p_ends_at, v_event.ends_at),
      capacity = case when v_access_type = 'private_group' then null else p_capacity end,
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
      show_guest_list = coalesce(p_show_guest_list, v_event.show_guest_list, true),
      guests_can_invite = coalesce(p_guests_can_invite, v_event.guests_can_invite, false),
      approve_messages = coalesce(p_approve_messages, v_event.approve_messages, false),
      updated_at = now()
  where id = p_event_id;

  insert into public.event_edit_logs (event_id, editor_id)
  values (p_event_id, v_me);

  perform public.cx_ensure_event_thread(p_event_id, v_me, null);

  return p_event_id;
end;
$$;


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
    and r.created_at >= now() - interval '10 days';

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
    SET search_path TO 'public'
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
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    requester_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    activity_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    title text,
    note text,
    start_at timestamp with time zone,
    end_at timestamp with time zone,
    accepted_at timestamp with time zone,
    completed_at timestamp with time zone,
    resolved_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    linked_member_user_id uuid,
    CONSTRAINT activities_activity_type_chk CHECK ((activity_type = ANY (ARRAY['practice'::text, 'private_class'::text, 'social_dance'::text, 'event_festival'::text, 'travelling'::text, 'request_hosting'::text, 'offer_hosting'::text, 'collaborate'::text]))),
    CONSTRAINT activities_check CHECK ((requester_id <> recipient_id)),
    CONSTRAINT activities_date_shape_chk CHECK (((end_at IS NULL) OR public.cx_activity_uses_date_range(activity_type))),
    CONSTRAINT activities_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text, 'completed'::text])))
);


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
    CONSTRAINT connect_reasons_context_check CHECK ((context = ANY (ARRAY['member'::text, 'trip'::text, 'traveller'::text, 'general'::text])))
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
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT connections_connect_context_check CHECK ((connect_context = ANY (ARRAY['member'::text, 'traveller'::text]))),
    CONSTRAINT connections_not_self CHECK ((requester_id <> target_id)),
    CONSTRAINT connections_status_allowed_chk CHECK ((status = ANY (ARRAY['pending'::public.connection_status, 'accepted'::public.connection_status, 'declined'::public.connection_status, 'cancelled'::public.connection_status, 'blocked'::public.connection_status])))
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
    can_host boolean DEFAULT false NOT NULL,
    hosting_status text DEFAULT 'inactive'::text NOT NULL,
    max_guests integer,
    hosting_last_minute_ok boolean DEFAULT false NOT NULL,
    hosting_preferred_guest_gender text DEFAULT 'any'::text NOT NULL,
    hosting_kid_friendly boolean DEFAULT false NOT NULL,
    hosting_pet_friendly boolean DEFAULT false NOT NULL,
    hosting_smoking_allowed boolean DEFAULT false NOT NULL,
    hosting_sleeping_arrangement text DEFAULT 'not_specified'::text NOT NULL,
    hosting_guest_share text,
    hosting_transit_access text,
    is_verified boolean DEFAULT false NOT NULL,
    verification_type text,
    hosting_notes text,
    house_rules text,
    username text NOT NULL,
    username_changed_at timestamp with time zone,
    username_updated_at timestamp with time zone,
    display_role text,
    gender text,
    CONSTRAINT profiles_avatar_not_blank CHECK ((length(TRIM(BOTH FROM COALESCE(avatar_url, ''::text))) >= 10)),
    CONSTRAINT profiles_avatar_status_check CHECK ((avatar_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT profiles_dance_skills_min_1 CHECK (((dance_skills IS NOT NULL) AND (jsonb_typeof(dance_skills) = 'object'::text) AND jsonb_path_exists(dance_skills, '$.*'::jsonpath))),
    CONSTRAINT profiles_dance_styles_min_1 CHECK (((dance_skills IS NOT NULL) AND (jsonb_typeof(dance_skills) = 'object'::text) AND (dance_skills <> '{}'::jsonb))),
    CONSTRAINT profiles_gender_check CHECK (((gender IS NULL) OR (gender = ANY (ARRAY['woman'::text, 'man'::text, 'nonbinary'::text, 'prefer_not_to_say'::text])))),
    CONSTRAINT profiles_hosting_preferred_guest_gender_chk CHECK ((hosting_preferred_guest_gender = ANY (ARRAY['any'::text, 'women'::text, 'men'::text, 'nonbinary'::text]))),
    CONSTRAINT profiles_hosting_sleeping_arrangement_chk CHECK ((hosting_sleeping_arrangement = ANY (ARRAY['not_specified'::text, 'shared_room'::text, 'private_room'::text, 'sofa'::text, 'floor_space'::text, 'mixed'::text]))),
    CONSTRAINT profiles_hosting_status_allowed_chk CHECK ((hosting_status = ANY (ARRAY['inactive'::text, 'available'::text, 'paused'::text, 'active'::text, 'open'::text, 'on'::text]))),
    CONSTRAINT profiles_max_guests_range_chk CHECK (((max_guests IS NULL) OR ((max_guests >= 0) AND (max_guests <= 20)))),
    CONSTRAINT profiles_username_format_chk CHECK (((username ~ '^[a-z0-9._]{3,20}$'::text) AND (username !~ '(^[._]|[._]$|\.\.)'::text))),
    CONSTRAINT profiles_username_reserved_chk CHECK ((public.cx_is_reserved_profile_username(username) IS NOT TRUE)),
    CONSTRAINT profiles_verification_type_allowed_chk CHECK (((verification_type IS NULL) OR (verification_type = 'payment'::text)))
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
-- Name: dance_competitions_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dance_competitions_user (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_name text NOT NULL,
    city text,
    country text,
    style text NOT NULL,
    division text NOT NULL,
    role text DEFAULT 'Leader'::text NOT NULL,
    result text DEFAULT 'Participated'::text NOT NULL,
    year integer NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dance_competitions_division_not_blank_chk CHECK ((char_length(TRIM(BOTH FROM division)) > 0)),
    CONSTRAINT dance_competitions_event_name_not_blank_chk CHECK ((char_length(TRIM(BOTH FROM event_name)) > 0)),
    CONSTRAINT dance_competitions_result_allowed_chk CHECK ((result = ANY (ARRAY['Participated'::text, 'Quarterfinalist'::text, 'Semifinalist'::text, 'Finalist'::text, 'Winner'::text]))),
    CONSTRAINT dance_competitions_role_allowed_chk CHECK ((role = ANY (ARRAY['Leader'::text, 'Follower'::text, 'Switch'::text]))),
    CONSTRAINT dance_competitions_style_not_blank_chk CHECK ((char_length(TRIM(BOTH FROM style)) > 0)),
    CONSTRAINT dance_competitions_year_range_chk CHECK (((year >= 1990) AND (year <= ((EXTRACT(year FROM now()))::integer + 1))))
);


--
-- Name: dance_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dance_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    contact_type text DEFAULT 'external'::text NOT NULL,
    linked_user_id uuid,
    name text NOT NULL,
    role text[] DEFAULT '{}'::text[] NOT NULL,
    city text,
    country text,
    instagram text,
    whatsapp text,
    email text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    meeting_context text,
    is_following boolean DEFAULT false NOT NULL,
    track_activity text[] DEFAULT '{}'::text[] NOT NULL,
    dance_styles text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT dance_contacts_meeting_context_length_chk CHECK (((meeting_context IS NULL) OR (char_length(TRIM(BOTH FROM meeting_context)) <= 160))),
    CONSTRAINT dance_contacts_member_linked_chk CHECK ((((contact_type = 'member'::text) AND (linked_user_id IS NOT NULL)) OR (contact_type = 'external'::text))),
    CONSTRAINT dance_contacts_name_not_blank_chk CHECK (((char_length(TRIM(BOTH FROM name)) > 0) AND (char_length(TRIM(BOTH FROM name)) <= 120))),
    CONSTRAINT dance_contacts_notes_length_chk CHECK (((notes IS NULL) OR (char_length(notes) <= 500))),
    CONSTRAINT dance_contacts_styles_limit_chk CHECK ((COALESCE(array_length(dance_styles, 1), 0) <= 10)),
    CONSTRAINT dance_contacts_tags_limit_chk CHECK ((COALESCE(array_length(tags, 1), 0) <= 10)),
    CONSTRAINT dance_contacts_track_activity_allowed_chk CHECK ((track_activity <@ ARRAY['travel_plans'::text, 'hosting_availability'::text, 'new_references'::text, 'competition_results'::text])),
    CONSTRAINT dance_contacts_track_activity_limit_chk CHECK ((COALESCE(array_length(track_activity, 1), 0) <= 4)),
    CONSTRAINT dance_contacts_type_allowed_chk CHECK ((contact_type = ANY (ARRAY['member'::text, 'external'::text])))
);


--
-- Name: dance_goals_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dance_goals_user (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    target_date date NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    category text,
    CONSTRAINT dance_goals_category_allowed_chk CHECK (((category IS NULL) OR (category = ANY (ARRAY['practice'::text, 'learning'::text, 'social'::text, 'competition'::text, 'event'::text])))),
    CONSTRAINT dance_goals_note_len_chk CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT dance_goals_progress_range_chk CHECK (((progress >= 0) AND (progress <= 100))),
    CONSTRAINT dance_goals_status_allowed_chk CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text]))),
    CONSTRAINT dance_goals_target_within_90_days_chk CHECK ((target_date <= (CURRENT_DATE + 90))),
    CONSTRAINT dance_goals_title_len_chk CHECK ((char_length(title) <= 120)),
    CONSTRAINT dance_goals_title_not_blank_chk CHECK ((char_length(TRIM(BOTH FROM title)) > 0))
);


--
-- Name: dance_growth_public_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dance_growth_public_summary (
    user_id uuid NOT NULL,
    planned_count integer DEFAULT 0 NOT NULL,
    practicing_count integer DEFAULT 0 NOT NULL,
    learned_count integer DEFAULT 0 NOT NULL,
    styles_tracked text[] DEFAULT '{}'::text[] NOT NULL,
    recently_learned text[] DEFAULT '{}'::text[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dance_move_practice_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dance_move_practice_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    move_id uuid NOT NULL,
    user_id uuid NOT NULL,
    confidence_after smallint,
    quick_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dance_move_practice_logs_confidence_chk CHECK (((confidence_after IS NULL) OR ((confidence_after >= 1) AND (confidence_after <= 5)))),
    CONSTRAINT dance_move_practice_logs_note_len_chk CHECK (((quick_note IS NULL) OR (char_length(quick_note) <= 500)))
);


--
-- Name: dance_moves_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dance_moves_catalog (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    style text NOT NULL,
    name text NOT NULL,
    level text,
    is_default boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dance_moves_catalog_name_not_blank_chk CHECK ((char_length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT dance_moves_catalog_style_not_blank_chk CHECK ((char_length(TRIM(BOTH FROM style)) > 0))
);


--
-- Name: dance_moves_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dance_moves_user (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    style text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'planned'::text NOT NULL,
    confidence smallint,
    note text,
    is_public boolean DEFAULT false NOT NULL,
    learned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    difficulty public.dance_move_difficulty DEFAULT 'medium'::public.dance_move_difficulty NOT NULL,
    move_type public.dance_move_type DEFAULT 'other'::public.dance_move_type NOT NULL,
    practice_count integer DEFAULT 0 NOT NULL,
    started_practicing_at timestamp with time zone,
    last_practiced_at timestamp with time zone,
    reference_url text,
    key_cue text,
    common_mistake text,
    fix_tip text,
    CONSTRAINT dance_moves_user_common_mistake_len_chk CHECK (((common_mistake IS NULL) OR (char_length(common_mistake) <= 500))),
    CONSTRAINT dance_moves_user_confidence_chk CHECK (((confidence IS NULL) OR ((confidence >= 1) AND (confidence <= 5)))),
    CONSTRAINT dance_moves_user_fix_tip_len_chk CHECK (((fix_tip IS NULL) OR (char_length(fix_tip) <= 500))),
    CONSTRAINT dance_moves_user_key_cue_len_chk CHECK (((key_cue IS NULL) OR (char_length(key_cue) <= 500))),
    CONSTRAINT dance_moves_user_name_not_blank_chk CHECK ((char_length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT dance_moves_user_note_len_chk CHECK (((note IS NULL) OR (char_length(note) <= 500))),
    CONSTRAINT dance_moves_user_practice_count_chk CHECK ((practice_count >= 0)),
    CONSTRAINT dance_moves_user_reference_url_chk CHECK (((reference_url IS NULL) OR (reference_url ~* '^https?://'::text))),
    CONSTRAINT dance_moves_user_single_style_chk CHECK ((style !~ '[,;/|]'::text)),
    CONSTRAINT dance_moves_user_status_chk CHECK ((status = ANY (ARRAY['planned'::text, 'practicing'::text, 'learned'::text]))),
    CONSTRAINT dance_moves_user_style_not_blank_chk CHECK ((char_length(TRIM(BOTH FROM style)) > 0))
);


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
    display_role text,
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
-- Name: event_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    sender_id uuid,
    recipient_id uuid,
    note text,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    inviter_user_id uuid NOT NULL,
    recipient_user_id uuid NOT NULL,
    CONSTRAINT event_invitations_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text])))
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
    CONSTRAINT event_members_status_chk CHECK ((status = ANY (ARRAY['host'::text, 'interested'::text, 'going'::text, 'waitlist'::text, 'not_interested'::text, 'left'::text])))
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
    linked_member_user_id uuid,
    CONSTRAINT event_requests_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text])))
);


--
-- Name: event_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_series (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    host_user_id uuid NOT NULL,
    recurrence_kind text NOT NULL,
    timezone text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_series_recurrence_kind_chk CHECK ((recurrence_kind = ANY (ARRAY['biweekly'::text, 'monthly'::text, 'custom'::text])))
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
    event_access_type text DEFAULT 'public'::text NOT NULL,
    chat_mode text DEFAULT 'broadcast'::text NOT NULL,
    max_members integer,
    invite_token text DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text),
    show_guest_list boolean DEFAULT true NOT NULL,
    guests_can_invite boolean DEFAULT false NOT NULL,
    approve_messages boolean DEFAULT false NOT NULL,
    event_series_id uuid,
    series_position integer,
    CONSTRAINT events_capacity_chk CHECK (((capacity IS NULL) OR ((capacity >= 1) AND (capacity <= 2000)))),
    CONSTRAINT events_chat_mode_chk CHECK ((chat_mode = ANY (ARRAY['none'::text, 'broadcast'::text, 'discussion'::text]))),
    CONSTRAINT events_cover_status_chk CHECK ((cover_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT events_event_access_type_chk CHECK ((event_access_type = ANY (ARRAY['public'::text, 'request'::text, 'private_group'::text]))),
    CONSTRAINT events_event_type_check CHECK ((event_type = ANY (ARRAY['Social'::text, 'Workshop'::text, 'Festival'::text, 'Masterclass'::text, 'Competition'::text]))),
    CONSTRAINT events_private_group_limit_chk CHECK (((event_access_type <> 'private_group'::text) OR ((COALESCE(max_members, 25) >= 1) AND (COALESCE(max_members, 25) <= 25)))),
    CONSTRAINT events_status_chk CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'cancelled'::text]))),
    CONSTRAINT events_time_chk CHECK ((ends_at > starts_at)),
    CONSTRAINT events_visibility_chk CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text])))
);


--
-- Name: events_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events_archive (
    event_id uuid NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    archived_reason text DEFAULT 'ended_event_retention'::text NOT NULL,
    source_event jsonb NOT NULL
);


--
-- Name: group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT group_members_role_check CHECK ((role = ANY (ARRAY['host'::text, 'member'::text])))
);


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    host_user_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    chat_mode text DEFAULT 'discussion'::text NOT NULL,
    city text,
    country text,
    cover_url text,
    cover_status text DEFAULT 'approved'::text NOT NULL,
    max_members integer DEFAULT 25 NOT NULL,
    invite_token text DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text),
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    event_id uuid,
    CONSTRAINT groups_chat_mode_check CHECK ((chat_mode = ANY (ARRAY['broadcast'::text, 'discussion'::text]))),
    CONSTRAINT groups_cover_status_check CHECK ((cover_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT groups_max_members_check CHECK (((max_members >= 1) AND (max_members <= 25))),
    CONSTRAINT groups_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text]))),
    CONSTRAINT groups_title_check CHECK (((char_length(TRIM(BOTH FROM title)) >= 1) AND (char_length(TRIM(BOTH FROM title)) <= 120)))
);


--
-- Name: hosting_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hosting_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sender_user_id uuid NOT NULL,
    recipient_user_id uuid NOT NULL,
    request_type text DEFAULT 'request_hosting'::text NOT NULL,
    trip_id uuid,
    arrival_date date NOT NULL,
    departure_date date,
    arrival_flexible boolean DEFAULT false NOT NULL,
    departure_flexible boolean DEFAULT false NOT NULL,
    travellers_count integer DEFAULT 1 NOT NULL,
    max_travellers_allowed integer,
    message text,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    linked_member_user_id uuid,
    reason text,
    cancellation_note text,
    CONSTRAINT hosting_requests_date_order_chk CHECK ((departure_date >= arrival_date)),
    CONSTRAINT hosting_requests_max_travellers_range_chk CHECK (((max_travellers_allowed IS NULL) OR ((max_travellers_allowed >= 1) AND (max_travellers_allowed <= 20)))),
    CONSTRAINT hosting_requests_message_security_chk CHECK (((message IS NULL) OR ((char_length(TRIM(BOTH FROM message)) >= 1) AND (char_length(TRIM(BOTH FROM message)) <= 500) AND (TRIM(BOTH FROM message) !~* '(https?://|www\.)'::text) AND (TRIM(BOTH FROM message) !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'::text) AND (TRIM(BOTH FROM message) !~* '[@#][A-Za-z0-9_]+'::text) AND (TRIM(BOTH FROM message) !~* '(\+?\d[\d\s().-]{7,}\d)'::text)))),
    CONSTRAINT hosting_requests_not_self_chk CHECK ((sender_user_id <> recipient_user_id)),
    CONSTRAINT hosting_requests_status_allowed_chk CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text]))),
    CONSTRAINT hosting_requests_travellers_range_chk CHECK (((travellers_count >= 1) AND (travellers_count <= 20))),
    CONSTRAINT hosting_requests_type_allowed_chk CHECK ((request_type = ANY (ARRAY['request_hosting'::text, 'offer_to_host'::text])))
);


--
-- Name: member_interaction_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_interaction_counters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    counter_type text NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
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
    day date DEFAULT CURRENT_DATE NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    date_key date NOT NULL
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
-- Name: pair_interaction_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pair_interaction_counters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_a_id uuid NOT NULL,
    user_b_id uuid NOT NULL,
    counter_type text NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pair_interaction_counters_check CHECK ((user_a_id <> user_b_id))
);


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
-- Name: privacy_request_ticket_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.privacy_request_ticket_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: privacy_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.privacy_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requester_id uuid NOT NULL,
    requester_email text,
    request_type text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    subject text NOT NULL,
    description text NOT NULL,
    scope_tags text[] DEFAULT '{}'::text[] NOT NULL,
    ticket_code text DEFAULT ('PR-'::text || lpad((nextval('public.privacy_request_ticket_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    admin_note text,
    due_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT privacy_requests_description_check CHECK (((char_length(description) >= 30) AND (char_length(description) <= 5000))),
    CONSTRAINT privacy_requests_request_type_check CHECK ((request_type = ANY (ARRAY['access'::text, 'portability'::text, 'erasure'::text, 'rectification'::text, 'objection'::text, 'restriction'::text, 'consent_withdrawal'::text, 'other'::text]))),
    CONSTRAINT privacy_requests_status_check CHECK ((status = ANY (ARRAY['open'::text, 'under_review'::text, 'needs_info'::text, 'resolved'::text, 'dismissed'::text]))),
    CONSTRAINT privacy_requests_subject_check CHECK (((char_length(subject) >= 6) AND (char_length(subject) <= 160)))
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
-- Name: profile_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    provider text NOT NULL,
    status text DEFAULT 'processing'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    stream_uid text,
    playback_url text,
    thumbnail_url text,
    duration_sec integer,
    storage_path text,
    public_url text,
    width integer,
    height integer,
    blurhash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_stream_uid text,
    clip_start_sec integer,
    clip_end_sec integer,
    CONSTRAINT profile_media_clip_window_check CHECK ((((clip_start_sec IS NULL) AND (clip_end_sec IS NULL)) OR ((clip_start_sec IS NOT NULL) AND (clip_end_sec IS NOT NULL) AND (clip_start_sec >= 0) AND (clip_end_sec > clip_start_sec) AND ((clip_end_sec - clip_start_sec) <= 15)))),
    CONSTRAINT profile_media_kind_chk CHECK ((kind = ANY (ARRAY['video'::text, 'photo'::text]))),
    CONSTRAINT profile_media_position_chk CHECK (("position" >= 0)),
    CONSTRAINT profile_media_provider_chk CHECK ((provider = ANY (ARRAY['cloudflare_stream'::text, 'storage'::text]))),
    CONSTRAINT profile_media_provider_matches_kind_chk CHECK ((((kind = 'video'::text) AND (provider = 'cloudflare_stream'::text)) OR ((kind = 'photo'::text) AND (provider = 'storage'::text)))),
    CONSTRAINT profile_media_status_chk CHECK ((status = ANY (ARRAY['processing'::text, 'ready'::text, 'failed'::text])))
);


--
-- Name: profile_username_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_username_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    username text NOT NULL,
    active_from timestamp with time zone DEFAULT now() NOT NULL,
    active_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reference_archives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reference_archives (
    user_id uuid NOT NULL,
    reference_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reference_report_ticket_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reference_report_ticket_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reference_report_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reference_report_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid,
    reference_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    reference_author_id uuid NOT NULL,
    reference_recipient_id uuid NOT NULL,
    context_tag text,
    reference_excerpt text,
    reason text NOT NULL,
    subject text NOT NULL,
    description text NOT NULL,
    reporter_email text,
    profile_link text,
    evidence_links text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ticket_code text DEFAULT ('CX-'::text || lpad((nextval('public.reference_report_ticket_seq'::regclass))::text, 6, '0'::text)) NOT NULL
);


--
-- Name: reference_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reference_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    peer_user_id uuid NOT NULL,
    context_tag text NOT NULL,
    source_table text NOT NULL,
    source_id uuid NOT NULL,
    connection_id uuid,
    due_at timestamp with time zone NOT NULL,
    remind_after timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    completed_reference_id uuid,
    reminder_count integer DEFAULT 0 NOT NULL,
    last_reminded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reference_requests_context_tag_chk CHECK ((context_tag = ANY (ARRAY['practice'::text, 'private_class'::text, 'social_dance'::text, 'event_festival'::text, 'travelling'::text, 'request_hosting'::text, 'offer_hosting'::text, 'collaborate'::text]))),
    CONSTRAINT reference_requests_due_window_chk CHECK (((due_at <= remind_after) AND (remind_after <= expires_at))),
    CONSTRAINT reference_requests_source_table_chk CHECK ((source_table = ANY (ARRAY['trip_requests'::text, 'hosting_requests'::text, 'activities'::text]))),
    CONSTRAINT reference_requests_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'dismissed'::text, 'expired'::text])))
);


--
-- Name: references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."references" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sync_id uuid,
    author_id uuid NOT NULL,
    target_id uuid,
    rating integer NOT NULL,
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
    text text,
    context_tag text,
    public_after_at timestamp with time zone DEFAULT (now() + '10 days'::interval),
    author_user_id uuid,
    recipient_user_id uuid,
    source_type text,
    public_category text,
    reference_family text,
    CONSTRAINT references_context_tag_allowed_chk CHECK ((context_tag = ANY (ARRAY['practice'::text, 'private_class'::text, 'social_dance'::text, 'event_festival'::text, 'travelling'::text, 'request_hosting'::text, 'offer_hosting'::text, 'collaborate'::text]))),
    CONSTRAINT references_rating_range_chk CHECK (((rating IS NULL) OR ((rating >= 1) AND (rating <= 5))))
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
-- Name: request_chat_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_chat_entitlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    source_type text NOT NULL,
    source_id uuid NOT NULL,
    requester_user_id uuid NOT NULL,
    responder_user_id uuid NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    opens_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT request_chat_entitlements_check CHECK ((expires_at > opens_at)),
    CONSTRAINT request_chat_entitlements_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'active'::text, 'expired'::text, 'cancelled'::text])))
);


--
-- Name: service_inquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_inquiries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requester_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    inquiry_kind text NOT NULL,
    requester_type text,
    requester_message text,
    city text,
    requested_dates_text text,
    status text DEFAULT 'pending'::text NOT NULL,
    accepted_at timestamp with time zone,
    declined_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_inquiries_distinct_users_chk CHECK ((requester_id <> recipient_id)),
    CONSTRAINT service_inquiries_kind_chk CHECK ((inquiry_kind = ANY (ARRAY['private_class'::text, 'group_class'::text, 'workshop'::text, 'show'::text, 'organizer_collab'::text, 'other'::text]))),
    CONSTRAINT service_inquiries_kind_nonempty_chk CHECK ((length(btrim(inquiry_kind)) > 0)),
    CONSTRAINT service_inquiries_message_length_chk CHECK (((requester_message IS NULL) OR (char_length(requester_message) <= 220))),
    CONSTRAINT service_inquiries_message_trim_chk CHECK (((requester_message IS NULL) OR (requester_message = btrim(requester_message)))),
    CONSTRAINT service_inquiries_requester_type_chk CHECK (((requester_type IS NULL) OR (requester_type = ANY (ARRAY['individual'::text, 'organizer'::text])))),
    CONSTRAINT service_inquiries_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'expired'::text])))
);


--
-- Name: service_inquiry_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_inquiry_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inquiry_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    shared_block_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    requester_followup_used boolean DEFAULT false NOT NULL,
    teacher_intro_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_inquiry_threads_intro_length_chk CHECK (((teacher_intro_note IS NULL) OR (char_length(teacher_intro_note) <= 220))),
    CONSTRAINT service_inquiry_threads_intro_trim_chk CHECK (((teacher_intro_note IS NULL) OR (teacher_intro_note = btrim(teacher_intro_note)))),
    CONSTRAINT service_inquiry_threads_shared_blocks_chk CHECK ((jsonb_typeof(shared_block_ids) = 'array'::text))
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
-- Name: teacher_class_confirmations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_class_confirmations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_user_id uuid NOT NULL,
    student_user_id uuid NOT NULL,
    teacher_student_id uuid,
    service_type text DEFAULT 'private_class'::text NOT NULL,
    title text DEFAULT 'Private class'::text NOT NULL,
    class_date date NOT NULL,
    start_time time without time zone NOT NULL,
    duration_min integer,
    city text,
    venue_name text,
    studio_included boolean DEFAULT false NOT NULL,
    teacher_note text,
    cancellation_policy_text text,
    status text DEFAULT 'pending_confirmation'::text NOT NULL,
    thread_id uuid,
    confirmed_at timestamp with time zone,
    declined_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT distinct_teacher_student CHECK ((teacher_user_id <> student_user_id)),
    CONSTRAINT teacher_class_confirmations_status_chk CHECK ((status = ANY (ARRAY['pending_confirmation'::text, 'confirmed'::text, 'declined'::text, 'cancelled'::text, 'completed'::text])))
);


--
-- Name: teacher_class_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_class_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_confirmation_id uuid NOT NULL,
    channel text DEFAULT 'email'::text NOT NULL,
    send_at timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reminder_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_class_reminders_channel_chk CHECK ((channel = 'email'::text)),
    CONSTRAINT teacher_class_reminders_reminder_type_chk CHECK ((reminder_type = ANY (ARRAY['confirmation_requested'::text, 'confirmed_24h'::text, 'confirmed_2h'::text]))),
    CONSTRAINT teacher_class_reminders_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: teacher_event_teaching; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_event_teaching (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_name text NOT NULL,
    city text,
    country text,
    start_date date,
    end_date date,
    role text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_event_teaching_event_name_nonempty_chk CHECK ((length(btrim(event_name)) > 0))
);


--
-- Name: teacher_info_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_info_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    short_summary text,
    content_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_info_blocks_content_json_chk CHECK ((jsonb_typeof(content_json) = 'object'::text)),
    CONSTRAINT teacher_info_blocks_kind_chk CHECK ((kind = ANY (ARRAY['private_class'::text, 'group_class'::text, 'workshop'::text, 'show'::text, 'organizer_collab'::text, 'other'::text]))),
    CONSTRAINT teacher_info_blocks_title_chk CHECK ((length(btrim(title)) > 0))
);


--
-- Name: teacher_info_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_info_profiles (
    user_id uuid NOT NULL,
    headline text,
    intro_text text,
    is_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: teacher_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_profiles (
    user_id uuid NOT NULL,
    teacher_profile_enabled boolean DEFAULT false NOT NULL,
    teacher_profile_trial_started_at timestamp with time zone,
    teacher_profile_trial_ends_at timestamp with time zone,
    default_public_view text DEFAULT 'social'::text NOT NULL,
    headline text,
    bio text,
    base_city text,
    base_school text,
    languages text[] DEFAULT '{}'::text[] NOT NULL,
    travel_available boolean DEFAULT false NOT NULL,
    availability_summary text,
    is_public boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    availability_tags text[] DEFAULT '{}'::text[] NOT NULL,
    base_country text,
    base_address text,
    CONSTRAINT teacher_profiles_availability_summary_len_chk CHECK ((char_length(btrim(availability_summary)) <= 300)),
    CONSTRAINT teacher_profiles_base_address_len_chk CHECK (((base_address IS NULL) OR (char_length(btrim(base_address)) <= 240))),
    CONSTRAINT teacher_profiles_bio_len_chk CHECK ((char_length(btrim(bio)) <= 1000)),
    CONSTRAINT teacher_profiles_default_public_view_chk CHECK ((default_public_view = ANY (ARRAY['social'::text, 'teacher'::text]))),
    CONSTRAINT teacher_profiles_headline_len_chk CHECK ((char_length(btrim(headline)) <= 120))
);


--
-- Name: teacher_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_references (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_user_id uuid NOT NULL,
    client_name text NOT NULL,
    client_context text,
    testimonial text NOT NULL,
    rating smallint,
    reference_year smallint,
    is_public boolean DEFAULT true NOT NULL,
    status text DEFAULT 'published'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_references_client_context_check CHECK ((char_length(client_context) <= 80)),
    CONSTRAINT teacher_references_client_name_check CHECK (((char_length(client_name) >= 1) AND (char_length(client_name) <= 80))),
    CONSTRAINT teacher_references_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT teacher_references_reference_year_check CHECK (((reference_year >= 1990) AND (reference_year <= 2030))),
    CONSTRAINT teacher_references_status_check CHECK ((status = ANY (ARRAY['published'::text, 'hidden'::text]))),
    CONSTRAINT teacher_references_testimonial_check CHECK (((char_length(testimonial) >= 10) AND (char_length(testimonial) <= 500)))
);


--
-- Name: teacher_regular_classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_regular_classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    style text,
    level text,
    venue_name text,
    city text,
    weekday integer,
    start_time time without time zone,
    duration_min integer,
    recurrence_text text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    country text,
    CONSTRAINT teacher_regular_classes_duration_chk CHECK ((duration_min > 0)),
    CONSTRAINT teacher_regular_classes_title_nonempty_chk CHECK ((length(btrim(title)) > 0)),
    CONSTRAINT teacher_regular_classes_weekday_chk CHECK (((weekday >= 0) AND (weekday <= 6)))
);


--
-- Name: teacher_session_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_session_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid NOT NULL,
    availability_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_session_availability_time_chk CHECK ((start_time < end_time))
);


--
-- Name: teacher_session_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_session_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid NOT NULL,
    student_id uuid NOT NULL,
    availability_id uuid,
    service_type text DEFAULT 'private_class'::text NOT NULL,
    session_date date NOT NULL,
    session_time time without time zone NOT NULL,
    duration_min integer,
    note text,
    status text DEFAULT 'pending'::text NOT NULL,
    accepted_at timestamp with time zone,
    declined_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_session_bookings_duration_chk CHECK (((duration_min IS NULL) OR (duration_min > 0))),
    CONSTRAINT teacher_session_bookings_not_self_chk CHECK ((teacher_id <> student_id)),
    CONSTRAINT teacher_session_bookings_service_type_chk CHECK ((service_type = 'private_class'::text)),
    CONSTRAINT teacher_session_bookings_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])))
);


--
-- Name: teacher_student_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_student_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_student_id uuid NOT NULL,
    scheduled_at timestamp with time zone,
    completed_at timestamp with time zone,
    session_type text,
    summary_shared text,
    notes_private text,
    exercises text,
    next_focus text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: teacher_students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_students (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_user_id uuid NOT NULL,
    student_user_id uuid,
    display_name text,
    notes_private text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    session_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_students_status_chk CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'archived'::text])))
);


--
-- Name: teacher_weekly_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_weekly_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    service_type text DEFAULT 'private_class'::text NOT NULL,
    weekday integer NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    label text,
    is_available boolean DEFAULT true NOT NULL,
    is_flexible boolean DEFAULT false NOT NULL,
    note text,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_weekly_availability_weekday_chk CHECK (((weekday >= 0) AND (weekday <= 6)))
);


--
-- Name: thread_contexts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_contexts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    source_table text NOT NULL,
    source_id uuid NOT NULL,
    context_tag text NOT NULL,
    status_tag text NOT NULL,
    title text,
    city text,
    start_date date,
    end_date date,
    requester_id uuid,
    recipient_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_pinned boolean DEFAULT true NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
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
    message_type text DEFAULT 'text'::text NOT NULL,
    context_tag text,
    status_tag text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT thread_messages_body_check CHECK (((char_length(TRIM(BOTH FROM body)) >= 1) AND (char_length(TRIM(BOTH FROM body)) <= 1000))),
    CONSTRAINT thread_messages_message_type_chk CHECK ((message_type = ANY (ARRAY['text'::text, 'system'::text, 'request'::text])))
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
    pinned_at timestamp with time zone,
    messaging_state text DEFAULT 'inactive'::text NOT NULL,
    activated_at timestamp with time zone,
    activation_cycle_start timestamp with time zone,
    activation_cycle_end timestamp with time zone,
    state_changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: thread_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    participant_user_id uuid,
    actor_user_id uuid,
    context_type text NOT NULL,
    event_type text NOT NULL,
    from_status text,
    to_status text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
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
    last_message_at timestamp with time zone,
    direct_user_low uuid,
    direct_user_high uuid,
    group_id uuid
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
    linked_member_user_id uuid,
    CONSTRAINT trip_requests_status_allowed CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text])))
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
-- Name: user_messaging_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_messaging_plans (
    user_id uuid NOT NULL,
    plan text DEFAULT 'free'::text NOT NULL,
    monthly_activation_limit integer,
    concurrent_active_limit integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_messaging_plans_plan_chk CHECK ((plan = ANY (ARRAY['free'::text, 'premium'::text])))
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
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


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
-- Name: dance_competitions_user dance_competitions_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_competitions_user
    ADD CONSTRAINT dance_competitions_user_pkey PRIMARY KEY (id);


--
-- Name: dance_contacts dance_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_contacts
    ADD CONSTRAINT dance_contacts_pkey PRIMARY KEY (id);


--
-- Name: dance_goals_user dance_goals_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_goals_user
    ADD CONSTRAINT dance_goals_user_pkey PRIMARY KEY (id);


--
-- Name: dance_growth_public_summary dance_growth_public_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_growth_public_summary
    ADD CONSTRAINT dance_growth_public_summary_pkey PRIMARY KEY (user_id);


--
-- Name: dance_move_practice_logs dance_move_practice_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_move_practice_logs
    ADD CONSTRAINT dance_move_practice_logs_pkey PRIMARY KEY (id);


--
-- Name: dance_moves_catalog dance_moves_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_moves_catalog
    ADD CONSTRAINT dance_moves_catalog_pkey PRIMARY KEY (id);


--
-- Name: dance_moves_user dance_moves_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_moves_user
    ADD CONSTRAINT dance_moves_user_pkey PRIMARY KEY (id);


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
-- Name: event_invitations event_invitations_event_id_sender_id_recipient_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_invitations
    ADD CONSTRAINT event_invitations_event_id_sender_id_recipient_id_key UNIQUE (event_id, sender_id, recipient_id);


--
-- Name: event_invitations event_invitations_event_recipient_user_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_invitations
    ADD CONSTRAINT event_invitations_event_recipient_user_key UNIQUE (event_id, recipient_user_id);


--
-- Name: event_invitations event_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_invitations
    ADD CONSTRAINT event_invitations_pkey PRIMARY KEY (id);


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
-- Name: event_series event_series_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_series
    ADD CONSTRAINT event_series_pkey PRIMARY KEY (id);


--
-- Name: events_archive events_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events_archive
    ADD CONSTRAINT events_archive_pkey PRIMARY KEY (event_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: group_members group_members_group_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_group_id_user_id_key UNIQUE (group_id, user_id);


--
-- Name: group_members group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_pkey PRIMARY KEY (id);


--
-- Name: groups groups_invite_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_invite_token_key UNIQUE (invite_token);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: hosting_requests hosting_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hosting_requests
    ADD CONSTRAINT hosting_requests_pkey PRIMARY KEY (id);


--
-- Name: member_interaction_counters member_interaction_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_interaction_counters
    ADD CONSTRAINT member_interaction_counters_pkey PRIMARY KEY (id);


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
-- Name: pair_interaction_counters pair_interaction_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pair_interaction_counters
    ADD CONSTRAINT pair_interaction_counters_pkey PRIMARY KEY (id);


--
-- Name: photo_flags photo_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_flags
    ADD CONSTRAINT photo_flags_pkey PRIMARY KEY (id);


--
-- Name: privacy_requests privacy_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.privacy_requests
    ADD CONSTRAINT privacy_requests_pkey PRIMARY KEY (id);


--
-- Name: profile_badges profile_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_badges
    ADD CONSTRAINT profile_badges_pkey PRIMARY KEY (id);


--
-- Name: profile_media profile_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_media
    ADD CONSTRAINT profile_media_pkey PRIMARY KEY (id);


--
-- Name: profile_username_history profile_username_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_username_history
    ADD CONSTRAINT profile_username_history_pkey PRIMARY KEY (id);


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
-- Name: reference_archives reference_archives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_archives
    ADD CONSTRAINT reference_archives_pkey PRIMARY KEY (user_id, reference_id);


--
-- Name: reference_report_claims reference_report_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_report_claims
    ADD CONSTRAINT reference_report_claims_pkey PRIMARY KEY (id);


--
-- Name: reference_requests reference_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_requests
    ADD CONSTRAINT reference_requests_pkey PRIMARY KEY (id);


--
-- Name: reference_requests reference_requests_user_id_source_table_source_id_context_t_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_requests
    ADD CONSTRAINT reference_requests_user_id_source_table_source_id_context_t_key UNIQUE (user_id, source_table, source_id, context_tag);


--
-- Name: references references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_pkey PRIMARY KEY (id);


--
-- Name: references references_public_category_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public."references"
    ADD CONSTRAINT references_public_category_chk CHECK ((public_category = ANY (ARRAY['Practice'::text, 'Social Dance'::text, 'Event / Festival'::text, 'Travelling'::text, 'Request Hosting'::text, 'Offer Hosting'::text, 'Collaborate'::text, 'Classes'::text]))) NOT VALID;


--
-- Name: references references_reference_family_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public."references"
    ADD CONSTRAINT references_reference_family_chk CHECK ((reference_family = ANY (ARRAY['practice_social'::text, 'event_collab'::text, 'hosting_trip'::text, 'teaching'::text]))) NOT VALID;


--
-- Name: references references_source_type_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public."references"
    ADD CONSTRAINT references_source_type_chk CHECK ((source_type = ANY (ARRAY['practice_activity'::text, 'social_dance_activity'::text, 'event_participation'::text, 'travel_activity'::text, 'hosting_stay'::text, 'collaboration_activity'::text, 'class_activity'::text, 'legacy'::text]))) NOT VALID;


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: request_chat_entitlements request_chat_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_chat_entitlements
    ADD CONSTRAINT request_chat_entitlements_pkey PRIMARY KEY (id);


--
-- Name: service_inquiries service_inquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_inquiries
    ADD CONSTRAINT service_inquiries_pkey PRIMARY KEY (id);


--
-- Name: service_inquiry_threads service_inquiry_threads_inquiry_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_inquiry_threads
    ADD CONSTRAINT service_inquiry_threads_inquiry_unique UNIQUE (inquiry_id);


--
-- Name: service_inquiry_threads service_inquiry_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_inquiry_threads
    ADD CONSTRAINT service_inquiry_threads_pkey PRIMARY KEY (id);


--
-- Name: syncs syncs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.syncs
    ADD CONSTRAINT syncs_pkey PRIMARY KEY (id);


--
-- Name: teacher_class_confirmations teacher_class_confirmations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_class_confirmations
    ADD CONSTRAINT teacher_class_confirmations_pkey PRIMARY KEY (id);


--
-- Name: teacher_class_reminders teacher_class_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_class_reminders
    ADD CONSTRAINT teacher_class_reminders_pkey PRIMARY KEY (id);


--
-- Name: teacher_event_teaching teacher_event_teaching_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_event_teaching
    ADD CONSTRAINT teacher_event_teaching_pkey PRIMARY KEY (id);


--
-- Name: teacher_info_blocks teacher_info_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_info_blocks
    ADD CONSTRAINT teacher_info_blocks_pkey PRIMARY KEY (id);


--
-- Name: teacher_info_profiles teacher_info_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_info_profiles
    ADD CONSTRAINT teacher_info_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: teacher_profiles teacher_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_profiles
    ADD CONSTRAINT teacher_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: teacher_references teacher_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_references
    ADD CONSTRAINT teacher_references_pkey PRIMARY KEY (id);


--
-- Name: teacher_regular_classes teacher_regular_classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_regular_classes
    ADD CONSTRAINT teacher_regular_classes_pkey PRIMARY KEY (id);


--
-- Name: teacher_session_availability teacher_session_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_session_availability
    ADD CONSTRAINT teacher_session_availability_pkey PRIMARY KEY (id);


--
-- Name: teacher_session_bookings teacher_session_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_session_bookings
    ADD CONSTRAINT teacher_session_bookings_pkey PRIMARY KEY (id);


--
-- Name: teacher_student_sessions teacher_student_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_student_sessions
    ADD CONSTRAINT teacher_student_sessions_pkey PRIMARY KEY (id);


--
-- Name: teacher_students teacher_students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_students
    ADD CONSTRAINT teacher_students_pkey PRIMARY KEY (id);


--
-- Name: teacher_weekly_availability teacher_weekly_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_weekly_availability
    ADD CONSTRAINT teacher_weekly_availability_pkey PRIMARY KEY (id);


--
-- Name: thread_contexts thread_contexts_context_tag_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.thread_contexts
    ADD CONSTRAINT thread_contexts_context_tag_chk CHECK ((context_tag = ANY (ARRAY['connection_request'::text, 'hosting_request'::text, 'trip_join_request'::text, 'event_chat'::text, 'regular_chat'::text, 'activity'::text, 'service_inquiry'::text, 'teacher_booking'::text]))) NOT VALID;


--
-- Name: thread_contexts thread_contexts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_contexts
    ADD CONSTRAINT thread_contexts_pkey PRIMARY KEY (id);


--
-- Name: thread_contexts thread_contexts_source_table_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_contexts
    ADD CONSTRAINT thread_contexts_source_table_source_id_key UNIQUE (source_table, source_id);


--
-- Name: thread_contexts thread_contexts_status_tag_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.thread_contexts
    ADD CONSTRAINT thread_contexts_status_tag_chk CHECK ((status_tag = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text, 'active'::text, 'completed'::text, 'expired'::text, 'info_shared'::text, 'inquiry_followup_pending'::text]))) NOT VALID;


--
-- Name: thread_messages thread_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_messages
    ADD CONSTRAINT thread_messages_pkey PRIMARY KEY (id);


--
-- Name: thread_participants thread_participants_messaging_state_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.thread_participants
    ADD CONSTRAINT thread_participants_messaging_state_chk CHECK ((messaging_state = ANY (ARRAY['inactive'::text, 'active'::text, 'archived'::text]))) NOT VALID;


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
-- Name: thread_status_history thread_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_status_history
    ADD CONSTRAINT thread_status_history_pkey PRIMARY KEY (id);


--
-- Name: threads threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_pkey PRIMARY KEY (id);


--
-- Name: threads threads_type_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.threads
    ADD CONSTRAINT threads_type_chk CHECK ((thread_type = ANY (ARRAY['connection'::text, 'trip'::text, 'direct'::text, 'event'::text, 'group'::text]))) NOT VALID;


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
-- Name: user_messaging_cycles user_messaging_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_messaging_cycles
    ADD CONSTRAINT user_messaging_cycles_pkey PRIMARY KEY (user_id, cycle_start);


--
-- Name: user_messaging_plans user_messaging_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_messaging_plans
    ADD CONSTRAINT user_messaging_plans_pkey PRIMARY KEY (user_id);


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
-- Name: idx_activities_recipient_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_recipient_status ON public.activities USING btree (recipient_id, status, updated_at DESC);


--
-- Name: idx_activities_requester_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_requester_status ON public.activities USING btree (requester_id, status, updated_at DESC);


--
-- Name: idx_activities_thread_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_thread_updated ON public.activities USING btree (thread_id, updated_at DESC);


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
-- Name: idx_dance_competitions_user_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_competitions_user_year ON public.dance_competitions_user USING btree (user_id, year DESC, created_at DESC);


--
-- Name: idx_dance_contacts_role_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_contacts_role_gin ON public.dance_contacts USING gin (role);


--
-- Name: idx_dance_contacts_styles_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_contacts_styles_gin ON public.dance_contacts USING gin (dance_styles);


--
-- Name: idx_dance_contacts_tags_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_contacts_tags_gin ON public.dance_contacts USING gin (tags);


--
-- Name: idx_dance_contacts_track_activity_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_contacts_track_activity_gin ON public.dance_contacts USING gin (track_activity);


--
-- Name: idx_dance_contacts_user_city_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_contacts_user_city_country ON public.dance_contacts USING btree (user_id, lower(COALESCE(city, ''::text)), lower(COALESCE(country, ''::text)));


--
-- Name: idx_dance_contacts_user_following; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_contacts_user_following ON public.dance_contacts USING btree (user_id, is_following, updated_at DESC);


--
-- Name: idx_dance_contacts_user_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_contacts_user_type ON public.dance_contacts USING btree (user_id, contact_type, updated_at DESC);


--
-- Name: idx_dance_contacts_user_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_contacts_user_updated ON public.dance_contacts USING btree (user_id, updated_at DESC);


--
-- Name: idx_dance_goals_user_status_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_goals_user_status_created_at ON public.dance_goals_user USING btree (user_id, status, created_at DESC);


--
-- Name: idx_dance_goals_user_status_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_goals_user_status_updated_at ON public.dance_goals_user USING btree (user_id, status, updated_at DESC);


--
-- Name: idx_dance_move_practice_logs_user_move_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_move_practice_logs_user_move_created ON public.dance_move_practice_logs USING btree (user_id, move_id, created_at DESC);


--
-- Name: idx_dance_moves_user_user_learned_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_moves_user_user_learned_at ON public.dance_moves_user USING btree (user_id, learned_at DESC NULLS LAST, updated_at DESC);


--
-- Name: idx_dance_moves_user_user_practice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_moves_user_user_practice ON public.dance_moves_user USING btree (user_id, practice_count DESC, updated_at DESC);


--
-- Name: idx_dance_moves_user_user_status_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_moves_user_user_status_updated ON public.dance_moves_user USING btree (user_id, status, updated_at DESC);


--
-- Name: idx_dance_moves_user_user_style; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dance_moves_user_user_style ON public.dance_moves_user USING btree (user_id, lower(style));


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
-- Name: idx_event_invitations_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_invitations_event ON public.event_invitations USING btree (event_id);


--
-- Name: idx_event_invitations_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_invitations_recipient ON public.event_invitations USING btree (recipient_id);


--
-- Name: idx_event_invitations_recipient_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_invitations_recipient_status ON public.event_invitations USING btree (recipient_id, status);


--
-- Name: idx_event_invitations_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_invitations_sender ON public.event_invitations USING btree (sender_id);


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
-- Name: idx_event_series_host; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_series_host ON public.event_series USING btree (host_user_id, created_at DESC);


--
-- Name: idx_events_access_status_starts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_access_status_starts ON public.events USING btree (event_access_type, status, starts_at);


--
-- Name: idx_events_archive_archived_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_archive_archived_at ON public.events_archive USING btree (archived_at DESC);


--
-- Name: idx_events_archive_ended_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_archive_ended_at ON public.events_archive USING btree (ended_at DESC);


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
-- Name: idx_events_series_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_series_position ON public.events USING btree (event_series_id, series_position) WHERE (event_series_id IS NOT NULL);


--
-- Name: idx_events_status_ends_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_status_ends_at ON public.events USING btree (status, ends_at DESC);


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
-- Name: idx_group_members_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_members_group ON public.group_members USING btree (group_id);


--
-- Name: idx_group_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_members_user ON public.group_members USING btree (user_id);


--
-- Name: idx_groups_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_event_id ON public.groups USING btree (event_id) WHERE (event_id IS NOT NULL);


--
-- Name: idx_groups_host; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_host ON public.groups USING btree (host_user_id);


--
-- Name: idx_groups_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_status ON public.groups USING btree (status);


--
-- Name: idx_hosting_requests_recipient_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hosting_requests_recipient_status_created ON public.hosting_requests USING btree (recipient_user_id, status, created_at DESC);


--
-- Name: idx_hosting_requests_sender_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hosting_requests_sender_status_created ON public.hosting_requests USING btree (sender_user_id, status, created_at DESC);


--
-- Name: idx_hosting_requests_trip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hosting_requests_trip ON public.hosting_requests USING btree (trip_id, status, created_at DESC);


--
-- Name: idx_member_interaction_counters_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_interaction_counters_user ON public.member_interaction_counters USING btree (user_id, updated_at DESC);


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
-- Name: idx_pair_interaction_counters_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pair_interaction_counters_pair ON public.pair_interaction_counters USING btree (user_a_id, user_b_id, updated_at DESC);


--
-- Name: idx_privacy_requests_requester_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_privacy_requests_requester_created_at ON public.privacy_requests USING btree (requester_id, created_at DESC);


--
-- Name: idx_privacy_requests_status_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_privacy_requests_status_created_at ON public.privacy_requests USING btree (status, created_at DESC);


--
-- Name: idx_profiles_hosts_discover; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_hosts_discover ON public.profiles USING btree (can_host, hosting_status, country, city);


--
-- Name: idx_profiles_organizer_verified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_organizer_verified ON public.profiles USING btree (organizer_verified);


--
-- Name: idx_rce_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rce_expires_at ON public.request_chat_entitlements USING btree (expires_at);


--
-- Name: idx_rce_opens_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rce_opens_at ON public.request_chat_entitlements USING btree (opens_at);


--
-- Name: idx_rce_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rce_requester ON public.request_chat_entitlements USING btree (requester_user_id);


--
-- Name: idx_rce_responder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rce_responder ON public.request_chat_entitlements USING btree (responder_user_id);


--
-- Name: idx_rce_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rce_status ON public.request_chat_entitlements USING btree (status);


--
-- Name: idx_rce_thread_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rce_thread_id ON public.request_chat_entitlements USING btree (thread_id);


--
-- Name: idx_reference_archives_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_archives_user_created ON public.reference_archives USING btree (user_id, created_at DESC);


--
-- Name: idx_reference_report_claims_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_report_claims_created_at ON public.reference_report_claims USING btree (created_at DESC);


--
-- Name: idx_reference_report_claims_reference_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_report_claims_reference_id ON public.reference_report_claims USING btree (reference_id);


--
-- Name: idx_reference_report_claims_report_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_report_claims_report_id ON public.reference_report_claims USING btree (report_id);


--
-- Name: idx_reference_requests_peer_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_requests_peer_status ON public.reference_requests USING btree (peer_user_id, status, due_at DESC);


--
-- Name: idx_reference_requests_pending_pair_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_requests_pending_pair_family ON public.reference_requests USING btree (user_id, peer_user_id, context_tag, status, due_at DESC);


--
-- Name: idx_reference_requests_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_requests_source ON public.reference_requests USING btree (source_table, source_id);


--
-- Name: idx_reference_requests_user_status_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reference_requests_user_status_due ON public.reference_requests USING btree (user_id, status, due_at DESC);


--
-- Name: idx_references_author_family_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_author_family_created ON public."references" USING btree (author_user_id, recipient_user_id, reference_family, created_at DESC);


--
-- Name: idx_references_author_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_author_id ON public."references" USING btree (author_id);


--
-- Name: idx_references_connection_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_connection_id ON public."references" USING btree (connection_id);


--
-- Name: idx_references_context_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_context_tag ON public."references" USING btree (context_tag);


--
-- Name: idx_references_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_created_at ON public."references" USING btree (created_at DESC);


--
-- Name: idx_references_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_entity ON public."references" USING btree (entity_type, entity_id);


--
-- Name: idx_references_from_user_context_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_from_user_context_created ON public."references" USING btree (from_user_id, context_tag, created_at DESC);


--
-- Name: idx_references_public_after_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_public_after_at ON public."references" USING btree (public_after_at DESC);


--
-- Name: idx_references_recipient_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_recipient_created ON public."references" USING btree (recipient_user_id, created_at DESC);


--
-- Name: idx_references_recipient_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_recipient_id ON public."references" USING btree (recipient_id);


--
-- Name: idx_references_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_source ON public."references" USING btree (source_type, source_id);


--
-- Name: idx_references_to_user_context_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_references_to_user_context_created ON public."references" USING btree (to_user_id, context_tag, created_at DESC);


--
-- Name: idx_reports_reporter_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_reporter_created_at ON public.reports USING btree (reporter_id, created_at DESC);


--
-- Name: idx_reports_target_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_target_created_at ON public.reports USING btree (target_user_id, created_at DESC);


--
-- Name: idx_service_inquiries_recipient_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_inquiries_recipient_status_created ON public.service_inquiries USING btree (recipient_id, status, created_at DESC);


--
-- Name: idx_service_inquiries_requester_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_inquiries_requester_created ON public.service_inquiries USING btree (requester_id, created_at DESC);


--
-- Name: idx_service_inquiry_threads_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_inquiry_threads_thread ON public.service_inquiry_threads USING btree (thread_id);


--
-- Name: idx_syncs_completed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_syncs_completed_by ON public.syncs USING btree (completed_by);


--
-- Name: idx_syncs_connection_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_syncs_connection_id ON public.syncs USING btree (connection_id);


--
-- Name: idx_teacher_class_confirmations_student_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_class_confirmations_student_user_id ON public.teacher_class_confirmations USING btree (student_user_id);


--
-- Name: idx_teacher_class_confirmations_teacher_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_class_confirmations_teacher_user_id ON public.teacher_class_confirmations USING btree (teacher_user_id);


--
-- Name: idx_teacher_class_confirmations_thread_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_class_confirmations_thread_id ON public.teacher_class_confirmations USING btree (thread_id);


--
-- Name: idx_teacher_class_reminders_class_confirmation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_class_reminders_class_confirmation_id ON public.teacher_class_reminders USING btree (class_confirmation_id);


--
-- Name: idx_teacher_class_reminders_send_at_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_class_reminders_send_at_status ON public.teacher_class_reminders USING btree (send_at, status);


--
-- Name: idx_teacher_event_teaching_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_event_teaching_user_id ON public.teacher_event_teaching USING btree (user_id);


--
-- Name: idx_teacher_info_blocks_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_info_blocks_user_active ON public.teacher_info_blocks USING btree (user_id, is_active, "position");


--
-- Name: idx_teacher_info_blocks_user_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_info_blocks_user_position ON public.teacher_info_blocks USING btree (user_id, "position", created_at);


--
-- Name: idx_teacher_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_profiles_user_id ON public.teacher_profiles USING btree (user_id);


--
-- Name: idx_teacher_regular_classes_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_regular_classes_user_id ON public.teacher_regular_classes USING btree (user_id);


--
-- Name: idx_teacher_session_availability_teacher_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_session_availability_teacher_date ON public.teacher_session_availability USING btree (teacher_id, availability_date, start_time);


--
-- Name: idx_teacher_session_bookings_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_session_bookings_student ON public.teacher_session_bookings USING btree (student_id, created_at DESC);


--
-- Name: idx_teacher_session_bookings_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_session_bookings_teacher ON public.teacher_session_bookings USING btree (teacher_id, session_date DESC, session_time);


--
-- Name: idx_teacher_student_sessions_teacher_student_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_student_sessions_teacher_student_id ON public.teacher_student_sessions USING btree (teacher_student_id);


--
-- Name: idx_teacher_students_student_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_students_student_user_id ON public.teacher_students USING btree (student_user_id);


--
-- Name: idx_teacher_students_teacher_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_students_teacher_user_id ON public.teacher_students USING btree (teacher_user_id);


--
-- Name: idx_teacher_weekly_availability_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_weekly_availability_user_id ON public.teacher_weekly_availability USING btree (user_id);


--
-- Name: idx_thread_contexts_pending_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_contexts_pending_expiry ON public.thread_contexts USING btree (status_tag, created_at);


--
-- Name: idx_thread_contexts_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_contexts_recipient ON public.thread_contexts USING btree (recipient_id, updated_at DESC);


--
-- Name: idx_thread_contexts_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_contexts_requester ON public.thread_contexts USING btree (requester_id, updated_at DESC);


--
-- Name: idx_thread_contexts_thread_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_contexts_thread_pending ON public.thread_contexts USING btree (thread_id, status_tag, is_pinned);


--
-- Name: idx_thread_contexts_thread_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_contexts_thread_updated ON public.thread_contexts USING btree (thread_id, updated_at DESC);


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
-- Name: idx_thread_participants_user_messaging_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_participants_user_messaging_state ON public.thread_participants USING btree (user_id, messaging_state, archived_at);


--
-- Name: idx_thread_participants_user_muted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_participants_user_muted ON public.thread_participants USING btree (user_id, muted_until);


--
-- Name: idx_thread_participants_user_pinned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_participants_user_pinned ON public.thread_participants USING btree (user_id, pinned_at);


--
-- Name: idx_thread_status_history_thread_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_status_history_thread_created ON public.thread_status_history USING btree (thread_id, created_at DESC);


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
-- Name: idx_user_messaging_cycles_user_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_messaging_cycles_user_start ON public.user_messaging_cycles USING btree (user_id, cycle_start DESC);


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
-- Name: profile_media_primary_per_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profile_media_primary_per_user_idx ON public.profile_media USING btree (user_id) WHERE (is_primary = true);


--
-- Name: profile_media_storage_path_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profile_media_storage_path_uidx ON public.profile_media USING btree (storage_path) WHERE (storage_path IS NOT NULL);


--
-- Name: profile_media_stream_uid_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profile_media_stream_uid_uidx ON public.profile_media USING btree (stream_uid) WHERE (stream_uid IS NOT NULL);


--
-- Name: profile_media_user_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_media_user_position_idx ON public.profile_media USING btree (user_id, "position");


--
-- Name: profile_media_user_source_stream_uid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_media_user_source_stream_uid_idx ON public.profile_media USING btree (user_id, source_stream_uid) WHERE (source_stream_uid IS NOT NULL);


--
-- Name: profile_media_user_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_media_user_status_idx ON public.profile_media USING btree (user_id, status);


--
-- Name: profile_username_history_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_username_history_user_id_idx ON public.profile_username_history USING btree (user_id);


--
-- Name: profile_username_history_username_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profile_username_history_username_unique_idx ON public.profile_username_history USING btree (lower(username));


--
-- Name: profiles_city_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_city_idx ON public.profiles USING btree (city);


--
-- Name: profiles_has_other_style_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_has_other_style_idx ON public.profiles USING btree (has_other_style);


--
-- Name: profiles_username_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_username_unique_idx ON public.profiles USING btree (lower(username));


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
-- Name: teacher_references_teacher_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_references_teacher_idx ON public.teacher_references USING btree (teacher_user_id, sort_order);


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
-- Name: uq_privacy_requests_ticket_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_privacy_requests_ticket_code ON public.privacy_requests USING btree (ticket_code);


--
-- Name: uq_reference_report_claims_reporter_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_reference_report_claims_reporter_reference ON public.reference_report_claims USING btree (reporter_id, reference_id);


--
-- Name: uq_reference_report_claims_ticket_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_reference_report_claims_ticket_code ON public.reference_report_claims USING btree (ticket_code);


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
-- Name: ux_dance_contacts_user_linked; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_dance_contacts_user_linked ON public.dance_contacts USING btree (user_id, linked_user_id);


--
-- Name: ux_dance_moves_catalog_style_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_dance_moves_catalog_style_name ON public.dance_moves_catalog USING btree (lower(style), lower(name));


--
-- Name: ux_event_reports_open_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_event_reports_open_unique ON public.event_reports USING btree (event_id, reporter_id) WHERE (status = 'open'::text);


--
-- Name: ux_events_invite_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_events_invite_token ON public.events USING btree (invite_token) WHERE (invite_token IS NOT NULL);


--
-- Name: ux_hosting_requests_pending_pair_type_trip; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_hosting_requests_pending_pair_type_trip ON public.hosting_requests USING btree (sender_user_id, recipient_user_id, request_type, COALESCE(trip_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (status = 'pending'::text);


--
-- Name: ux_member_interaction_counters_user_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_member_interaction_counters_user_type ON public.member_interaction_counters USING btree (user_id, counter_type);


--
-- Name: ux_message_limits_user_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_message_limits_user_date_key ON public.message_limits USING btree (user_id, date_key);


--
-- Name: ux_message_reactions_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_message_reactions_unique ON public.message_reactions USING btree (thread_kind, thread_id, message_id, reactor_id, emoji);


--
-- Name: ux_pair_interaction_counters_pair_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_pair_interaction_counters_pair_type ON public.pair_interaction_counters USING btree (user_a_id, user_b_id, counter_type);


--
-- Name: ux_rce_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_rce_source ON public.request_chat_entitlements USING btree (source_type, source_id);


--
-- Name: ux_references_author_source_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_references_author_source_once ON public."references" USING btree (author_user_id, recipient_user_id, source_type, source_id) WHERE ((author_user_id IS NOT NULL) AND (recipient_user_id IS NOT NULL) AND (source_type IS NOT NULL) AND (source_id IS NOT NULL));


--
-- Name: ux_references_entity_author; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_references_entity_author ON public."references" USING btree (entity_type, entity_id, author_id) WHERE ((entity_type IS NOT NULL) AND (entity_id IS NOT NULL));


--
-- Name: ux_syncs_connection_completed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_syncs_connection_completed_by ON public.syncs USING btree (connection_id, completed_by) WHERE (completed_by IS NOT NULL);


--
-- Name: ux_teacher_session_availability_teacher_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_teacher_session_availability_teacher_slot ON public.teacher_session_availability USING btree (teacher_id, availability_date, start_time, end_time);


--
-- Name: ux_teacher_session_bookings_one_accepted_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_teacher_session_bookings_one_accepted_slot ON public.teacher_session_bookings USING btree (teacher_id, session_date, session_time) WHERE (status = 'accepted'::text);


--
-- Name: ux_threads_connection; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_threads_connection ON public.threads USING btree (connection_id) WHERE (connection_id IS NOT NULL);


--
-- Name: ux_threads_direct_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_threads_direct_pair ON public.threads USING btree (direct_user_low, direct_user_high) WHERE ((thread_type = 'direct'::text) AND (direct_user_low IS NOT NULL) AND (direct_user_high IS NOT NULL));


--
-- Name: ux_threads_event; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_threads_event ON public.threads USING btree (event_id) WHERE ((thread_type = 'event'::text) AND (event_id IS NOT NULL));


--
-- Name: ux_threads_group; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_threads_group ON public.threads USING btree (group_id) WHERE (group_id IS NOT NULL);


--
-- Name: ux_threads_trip; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_threads_trip ON public.threads USING btree (trip_id) WHERE (trip_id IS NOT NULL);


--
-- Name: profiles cx_profiles_apply_username; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cx_profiles_apply_username BEFORE INSERT OR UPDATE OF username, display_name, username_updated_at ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.cx_profiles_apply_username();


--
-- Name: profiles cx_profiles_sync_username_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cx_profiles_sync_username_history AFTER INSERT OR UPDATE OF username ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.cx_profiles_sync_username_history();


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: request_chat_entitlements rce_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER rce_updated_at BEFORE UPDATE ON public.request_chat_entitlements FOR EACH ROW EXECUTE FUNCTION public.rce_set_updated_at();


--
-- Name: activities trg_activities_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activities_set_updated_at BEFORE UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


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
-- Name: connections trg_connections_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_connections_set_updated_at BEFORE UPDATE ON public.connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: connections trg_connections_unified_thread_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_connections_unified_thread_del AFTER DELETE ON public.connections FOR EACH ROW EXECUTE FUNCTION public.cx_sync_connections_to_thread();


--
-- Name: connections trg_connections_unified_thread_ins_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_connections_unified_thread_ins_upd AFTER INSERT OR UPDATE ON public.connections FOR EACH ROW EXECUTE FUNCTION public.cx_sync_connections_to_thread();


--
-- Name: thread_messages trg_cx_guard_event_thread_message_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cx_guard_event_thread_message_insert BEFORE INSERT ON public.thread_messages FOR EACH ROW EXECUTE FUNCTION public.cx_guard_event_thread_message_insert();


--
-- Name: event_members trg_cx_sync_event_members_to_thread; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cx_sync_event_members_to_thread AFTER INSERT OR UPDATE ON public.event_members FOR EACH ROW EXECUTE FUNCTION public.cx_sync_event_members_to_thread();


--
-- Name: dance_competitions_user trg_dance_competitions_user_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dance_competitions_user_set_updated_at BEFORE UPDATE ON public.dance_competitions_user FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: dance_contacts trg_dance_contacts_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dance_contacts_limit BEFORE INSERT OR UPDATE ON public.dance_contacts FOR EACH ROW EXECUTE FUNCTION public.enforce_dance_contacts_limit();


--
-- Name: dance_contacts trg_dance_contacts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dance_contacts_set_updated_at BEFORE UPDATE ON public.dance_contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: dance_goals_user trg_dance_goals_user_active_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dance_goals_user_active_limit BEFORE INSERT OR UPDATE OF status, user_id ON public.dance_goals_user FOR EACH ROW EXECUTE FUNCTION public.enforce_dance_goals_active_limit();


--
-- Name: dance_goals_user trg_dance_goals_user_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dance_goals_user_set_updated_at BEFORE UPDATE ON public.dance_goals_user FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: dance_moves_user trg_dance_growth_public_summary_sync; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dance_growth_public_summary_sync AFTER INSERT OR DELETE OR UPDATE ON public.dance_moves_user FOR EACH ROW EXECUTE FUNCTION public.sync_dance_growth_public_summary();


--
-- Name: dance_moves_catalog trg_dance_moves_catalog_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dance_moves_catalog_set_updated_at BEFORE UPDATE ON public.dance_moves_catalog FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: dance_moves_user trg_dance_moves_user_limits; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dance_moves_user_limits BEFORE INSERT OR UPDATE OF user_id, status ON public.dance_moves_user FOR EACH ROW EXECUTE FUNCTION public.enforce_dance_moves_user_limits();


--
-- Name: dance_moves_user trg_dance_moves_user_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dance_moves_user_set_updated_at BEFORE UPDATE ON public.dance_moves_user FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


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
-- Name: event_invitations trg_event_invitations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_event_invitations_set_updated_at BEFORE UPDATE ON public.event_invitations FOR EACH ROW EXECUTE FUNCTION public.set_event_invitation_updated_at();


--
-- Name: event_invitations trg_event_invitations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_event_invitations_updated_at BEFORE UPDATE ON public.event_invitations FOR EACH ROW EXECUTE FUNCTION public.set_event_invitation_updated_at();


--
-- Name: event_members trg_event_members_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_event_members_set_updated_at BEFORE UPDATE ON public.event_members FOR EACH ROW EXECUTE FUNCTION public.set_event_updated_at();


--
-- Name: event_requests trg_event_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_event_requests_set_updated_at BEFORE UPDATE ON public.event_requests FOR EACH ROW EXECUTE FUNCTION public.set_event_updated_at();


--
-- Name: event_requests trg_event_requests_unified_thread; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_event_requests_unified_thread AFTER INSERT OR UPDATE ON public.event_requests FOR EACH ROW EXECUTE FUNCTION public.cx_sync_event_requests_to_thread();


--
-- Name: event_series trg_event_series_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_event_series_updated_at BEFORE UPDATE ON public.event_series FOR EACH ROW EXECUTE FUNCTION public.set_event_series_updated_at();


--
-- Name: events trg_events_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_events_set_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.set_event_updated_at();


--
-- Name: group_members trg_group_member_add_to_thread; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_group_member_add_to_thread AFTER INSERT ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.trg_group_member_add_to_thread();


--
-- Name: groups trg_groups_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_groups_updated_at BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.groups_set_updated_at();


--
-- Name: hosting_requests trg_hosting_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hosting_requests_set_updated_at BEFORE UPDATE ON public.hosting_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: hosting_requests trg_hosting_requests_unified_thread; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hosting_requests_unified_thread AFTER INSERT OR UPDATE ON public.hosting_requests FOR EACH ROW EXECUTE FUNCTION public.cx_sync_hosting_requests_to_thread();


--
-- Name: profile_media trg_profile_media_enforce_limits; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profile_media_enforce_limits BEFORE INSERT OR UPDATE ON public.profile_media FOR EACH ROW EXECUTE FUNCTION public.profile_media_enforce_limits();


--
-- Name: profile_media trg_profile_media_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profile_media_set_updated_at BEFORE UPDATE ON public.profile_media FOR EACH ROW EXECUTE FUNCTION public.set_profile_media_updated_at();


--
-- Name: profiles trg_profiles_sync_has_other_style; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_sync_has_other_style BEFORE INSERT OR UPDATE OF dance_skills ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_has_other_style();


--
-- Name: reference_requests trg_reference_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reference_requests_set_updated_at BEFORE UPDATE ON public.reference_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: references trg_references_guardrails; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_references_guardrails BEFORE INSERT OR DELETE OR UPDATE ON public."references" FOR EACH ROW EXECUTE FUNCTION public.references_guardrails();


--
-- Name: references trg_references_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_references_immutable BEFORE DELETE OR UPDATE ON public."references" FOR EACH ROW EXECUTE FUNCTION public.enforce_reference_immutability();


--
-- Name: references trg_references_reveal_mutual; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_references_reveal_mutual AFTER INSERT ON public."references" FOR EACH ROW EXECUTE FUNCTION public.cx_references_reveal_mutual();


--
-- Name: references trg_references_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_references_set_updated_at BEFORE UPDATE ON public."references" FOR EACH ROW EXECUTE FUNCTION public.set_reference_updated_at();


--
-- Name: service_inquiries trg_service_inquiries_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_service_inquiries_set_updated_at BEFORE UPDATE ON public.service_inquiries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: profiles trg_set_verified_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_verified_fields BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_verified_fields();


--
-- Name: teacher_class_confirmations trg_teacher_class_confirmations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teacher_class_confirmations_set_updated_at BEFORE UPDATE ON public.teacher_class_confirmations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: teacher_class_reminders trg_teacher_class_reminders_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teacher_class_reminders_set_updated_at BEFORE UPDATE ON public.teacher_class_reminders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: teacher_event_teaching trg_teacher_event_teaching_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teacher_event_teaching_set_updated_at BEFORE UPDATE ON public.teacher_event_teaching FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: teacher_info_blocks trg_teacher_info_blocks_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teacher_info_blocks_set_updated_at BEFORE UPDATE ON public.teacher_info_blocks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: teacher_info_profiles trg_teacher_info_profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teacher_info_profiles_set_updated_at BEFORE UPDATE ON public.teacher_info_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: teacher_profiles trg_teacher_profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teacher_profiles_set_updated_at BEFORE UPDATE ON public.teacher_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: teacher_regular_classes trg_teacher_regular_classes_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teacher_regular_classes_set_updated_at BEFORE UPDATE ON public.teacher_regular_classes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: teacher_session_availability trg_teacher_session_availability_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teacher_session_availability_set_updated_at BEFORE UPDATE ON public.teacher_session_availability FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: teacher_session_bookings trg_teacher_session_bookings_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teacher_session_bookings_set_updated_at BEFORE UPDATE ON public.teacher_session_bookings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: teacher_student_sessions trg_teacher_student_sessions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teacher_student_sessions_set_updated_at BEFORE UPDATE ON public.teacher_student_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: teacher_students trg_teacher_students_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teacher_students_set_updated_at BEFORE UPDATE ON public.teacher_students FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: teacher_weekly_availability trg_teacher_weekly_availability_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teacher_weekly_availability_set_updated_at BEFORE UPDATE ON public.teacher_weekly_availability FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: thread_contexts trg_thread_contexts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_thread_contexts_set_updated_at BEFORE UPDATE ON public.thread_contexts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: thread_messages trg_thread_messages_chat_unlock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_thread_messages_chat_unlock BEFORE INSERT ON public.thread_messages FOR EACH ROW EXECUTE FUNCTION public.cx_enforce_thread_text_unlock();


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
-- Name: privacy_requests trg_touch_privacy_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_privacy_requests_updated_at BEFORE UPDATE ON public.privacy_requests FOR EACH ROW EXECUTE FUNCTION public.touch_privacy_requests_updated_at();


--
-- Name: trips trg_trip_lock_core_when_requested; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trip_lock_core_when_requested BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.prevent_core_trip_changes_when_requested();


--
-- Name: trip_requests trg_trip_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trip_requests_set_updated_at BEFORE UPDATE ON public.trip_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ts();


--
-- Name: trip_requests trg_trip_requests_unified_thread; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trip_requests_unified_thread AFTER INSERT OR UPDATE ON public.trip_requests FOR EACH ROW EXECUTE FUNCTION public.cx_sync_trip_requests_to_thread();


--
-- Name: trips trg_trips_daily_rate_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trips_daily_rate_limit BEFORE INSERT ON public.trips FOR EACH ROW EXECUTE FUNCTION public.enforce_trips_daily_rate_limit();


--
-- Name: trips trg_trips_enforce_trip_plan_active; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trips_enforce_trip_plan_active BEFORE INSERT OR UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.enforce_trip_plan_active_limits();


--
-- Name: activities activities_linked_member_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_linked_member_user_id_fkey FOREIGN KEY (linked_member_user_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;


--
-- Name: activities activities_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: activities activities_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: activities activities_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


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
-- Name: dance_competitions_user dance_competitions_user_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_competitions_user
    ADD CONSTRAINT dance_competitions_user_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: dance_contacts dance_contacts_linked_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_contacts
    ADD CONSTRAINT dance_contacts_linked_user_fk FOREIGN KEY (linked_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: dance_contacts dance_contacts_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_contacts
    ADD CONSTRAINT dance_contacts_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: dance_goals_user dance_goals_user_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_goals_user
    ADD CONSTRAINT dance_goals_user_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: dance_growth_public_summary dance_growth_public_summary_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_growth_public_summary
    ADD CONSTRAINT dance_growth_public_summary_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: dance_move_practice_logs dance_move_practice_logs_move_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_move_practice_logs
    ADD CONSTRAINT dance_move_practice_logs_move_id_fkey FOREIGN KEY (move_id) REFERENCES public.dance_moves_user(id) ON DELETE CASCADE;


--
-- Name: dance_move_practice_logs dance_move_practice_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_move_practice_logs
    ADD CONSTRAINT dance_move_practice_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: dance_moves_user dance_moves_user_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dance_moves_user
    ADD CONSTRAINT dance_moves_user_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


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
-- Name: event_invitations event_invitations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_invitations
    ADD CONSTRAINT event_invitations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


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
-- Name: event_requests event_requests_linked_member_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_requests
    ADD CONSTRAINT event_requests_linked_member_user_id_fkey FOREIGN KEY (linked_member_user_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;


--
-- Name: events events_event_series_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_event_series_id_fkey FOREIGN KEY (event_series_id) REFERENCES public.event_series(id) ON DELETE SET NULL;


--
-- Name: group_members group_members_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: group_members group_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: groups groups_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;


--
-- Name: groups groups_host_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_host_user_id_fkey FOREIGN KEY (host_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: hosting_requests hosting_requests_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hosting_requests
    ADD CONSTRAINT hosting_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: hosting_requests hosting_requests_linked_member_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hosting_requests
    ADD CONSTRAINT hosting_requests_linked_member_user_id_fkey FOREIGN KEY (linked_member_user_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;


--
-- Name: hosting_requests hosting_requests_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hosting_requests
    ADD CONSTRAINT hosting_requests_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: hosting_requests hosting_requests_sender_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hosting_requests
    ADD CONSTRAINT hosting_requests_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: hosting_requests hosting_requests_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hosting_requests
    ADD CONSTRAINT hosting_requests_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE SET NULL;


--
-- Name: member_interaction_counters member_interaction_counters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_interaction_counters
    ADD CONSTRAINT member_interaction_counters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


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
-- Name: pair_interaction_counters pair_interaction_counters_user_a_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pair_interaction_counters
    ADD CONSTRAINT pair_interaction_counters_user_a_id_fkey FOREIGN KEY (user_a_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: pair_interaction_counters pair_interaction_counters_user_b_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pair_interaction_counters
    ADD CONSTRAINT pair_interaction_counters_user_b_id_fkey FOREIGN KEY (user_b_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: photo_flags photo_flags_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_flags
    ADD CONSTRAINT photo_flags_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: privacy_requests privacy_requests_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.privacy_requests
    ADD CONSTRAINT privacy_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES auth.users(id) ON DELETE CASCADE;


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
-- Name: profile_media profile_media_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_media
    ADD CONSTRAINT profile_media_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: profile_username_history profile_username_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_username_history
    ADD CONSTRAINT profile_username_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


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
-- Name: reference_archives reference_archives_reference_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_archives
    ADD CONSTRAINT reference_archives_reference_id_fkey FOREIGN KEY (reference_id) REFERENCES public."references"(id) ON DELETE CASCADE;


--
-- Name: reference_archives reference_archives_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_archives
    ADD CONSTRAINT reference_archives_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reference_report_claims reference_report_claims_reference_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_report_claims
    ADD CONSTRAINT reference_report_claims_reference_author_id_fkey FOREIGN KEY (reference_author_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reference_report_claims reference_report_claims_reference_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_report_claims
    ADD CONSTRAINT reference_report_claims_reference_id_fkey FOREIGN KEY (reference_id) REFERENCES public."references"(id) ON DELETE CASCADE;


--
-- Name: reference_report_claims reference_report_claims_reference_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_report_claims
    ADD CONSTRAINT reference_report_claims_reference_recipient_id_fkey FOREIGN KEY (reference_recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reference_report_claims reference_report_claims_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_report_claims
    ADD CONSTRAINT reference_report_claims_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE SET NULL;


--
-- Name: reference_report_claims reference_report_claims_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_report_claims
    ADD CONSTRAINT reference_report_claims_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reference_report_claims reference_report_claims_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_report_claims
    ADD CONSTRAINT reference_report_claims_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reference_requests reference_requests_completed_reference_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_requests
    ADD CONSTRAINT reference_requests_completed_reference_id_fkey FOREIGN KEY (completed_reference_id) REFERENCES public."references"(id) ON DELETE SET NULL;


--
-- Name: reference_requests reference_requests_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_requests
    ADD CONSTRAINT reference_requests_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE SET NULL;


--
-- Name: reference_requests reference_requests_peer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_requests
    ADD CONSTRAINT reference_requests_peer_user_id_fkey FOREIGN KEY (peer_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reference_requests reference_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_requests
    ADD CONSTRAINT reference_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: references references_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id);


--
-- Name: references references_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: references references_connection_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_connection_fk FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: references references_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."references"
    ADD CONSTRAINT references_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


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
-- Name: request_chat_entitlements request_chat_entitlements_requester_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_chat_entitlements
    ADD CONSTRAINT request_chat_entitlements_requester_user_id_fkey FOREIGN KEY (requester_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: request_chat_entitlements request_chat_entitlements_responder_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_chat_entitlements
    ADD CONSTRAINT request_chat_entitlements_responder_user_id_fkey FOREIGN KEY (responder_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: request_chat_entitlements request_chat_entitlements_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_chat_entitlements
    ADD CONSTRAINT request_chat_entitlements_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: service_inquiries service_inquiries_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_inquiries
    ADD CONSTRAINT service_inquiries_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: service_inquiries service_inquiries_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_inquiries
    ADD CONSTRAINT service_inquiries_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: service_inquiry_threads service_inquiry_threads_inquiry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_inquiry_threads
    ADD CONSTRAINT service_inquiry_threads_inquiry_id_fkey FOREIGN KEY (inquiry_id) REFERENCES public.service_inquiries(id) ON DELETE CASCADE;


--
-- Name: service_inquiry_threads service_inquiry_threads_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_inquiry_threads
    ADD CONSTRAINT service_inquiry_threads_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


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
-- Name: teacher_class_confirmations teacher_class_confirmations_student_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_class_confirmations
    ADD CONSTRAINT teacher_class_confirmations_student_user_id_fkey FOREIGN KEY (student_user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: teacher_class_confirmations teacher_class_confirmations_teacher_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_class_confirmations
    ADD CONSTRAINT teacher_class_confirmations_teacher_student_id_fkey FOREIGN KEY (teacher_student_id) REFERENCES public.teacher_students(id) ON DELETE SET NULL;


--
-- Name: teacher_class_confirmations teacher_class_confirmations_teacher_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_class_confirmations
    ADD CONSTRAINT teacher_class_confirmations_teacher_user_id_fkey FOREIGN KEY (teacher_user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: teacher_class_confirmations teacher_class_confirmations_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_class_confirmations
    ADD CONSTRAINT teacher_class_confirmations_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE SET NULL;


--
-- Name: teacher_class_reminders teacher_class_reminders_class_confirmation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_class_reminders
    ADD CONSTRAINT teacher_class_reminders_class_confirmation_id_fkey FOREIGN KEY (class_confirmation_id) REFERENCES public.teacher_class_confirmations(id) ON DELETE CASCADE;


--
-- Name: teacher_event_teaching teacher_event_teaching_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_event_teaching
    ADD CONSTRAINT teacher_event_teaching_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: teacher_info_blocks teacher_info_blocks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_info_blocks
    ADD CONSTRAINT teacher_info_blocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: teacher_info_profiles teacher_info_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_info_profiles
    ADD CONSTRAINT teacher_info_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: teacher_profiles teacher_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_profiles
    ADD CONSTRAINT teacher_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: teacher_references teacher_references_teacher_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_references
    ADD CONSTRAINT teacher_references_teacher_user_id_fkey FOREIGN KEY (teacher_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: teacher_regular_classes teacher_regular_classes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_regular_classes
    ADD CONSTRAINT teacher_regular_classes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: teacher_session_availability teacher_session_availability_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_session_availability
    ADD CONSTRAINT teacher_session_availability_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: teacher_session_bookings teacher_session_bookings_availability_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_session_bookings
    ADD CONSTRAINT teacher_session_bookings_availability_id_fkey FOREIGN KEY (availability_id) REFERENCES public.teacher_session_availability(id) ON DELETE SET NULL;


--
-- Name: teacher_session_bookings teacher_session_bookings_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_session_bookings
    ADD CONSTRAINT teacher_session_bookings_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: teacher_session_bookings teacher_session_bookings_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_session_bookings
    ADD CONSTRAINT teacher_session_bookings_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: teacher_student_sessions teacher_student_sessions_teacher_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_student_sessions
    ADD CONSTRAINT teacher_student_sessions_teacher_student_id_fkey FOREIGN KEY (teacher_student_id) REFERENCES public.teacher_students(id) ON DELETE CASCADE;


--
-- Name: teacher_students teacher_students_student_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_students
    ADD CONSTRAINT teacher_students_student_user_id_fkey FOREIGN KEY (student_user_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;


--
-- Name: teacher_students teacher_students_teacher_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_students
    ADD CONSTRAINT teacher_students_teacher_user_id_fkey FOREIGN KEY (teacher_user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: teacher_weekly_availability teacher_weekly_availability_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_weekly_availability
    ADD CONSTRAINT teacher_weekly_availability_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: thread_contexts thread_contexts_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_contexts
    ADD CONSTRAINT thread_contexts_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


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
-- Name: thread_status_history thread_status_history_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_status_history
    ADD CONSTRAINT thread_status_history_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: threads threads_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: threads threads_event_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_event_fk FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: threads threads_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: threads threads_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: threads threads_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;


--
-- Name: trip_requests trip_requests_linked_member_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_linked_member_user_id_fkey FOREIGN KEY (linked_member_user_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;


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
-- Name: event_series Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.event_series FOR SELECT USING (true);


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
-- Name: activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

--
-- Name: activities activities_delete_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activities_delete_none ON public.activities FOR DELETE TO authenticated USING (false);


--
-- Name: activities activities_insert_requester; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activities_insert_requester ON public.activities FOR INSERT TO authenticated WITH CHECK ((requester_id = auth.uid()));


--
-- Name: activities activities_select_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activities_select_participants ON public.activities FOR SELECT TO authenticated USING (((requester_id = auth.uid()) OR (recipient_id = auth.uid())));


--
-- Name: activities activities_update_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activities_update_none ON public.activities FOR UPDATE TO authenticated USING (false) WITH CHECK (false);


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
-- Name: connection_syncs connection_syncs_update_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connection_syncs_update_participant ON public.connection_syncs FOR UPDATE TO authenticated USING (((requester_id = auth.uid()) OR (recipient_id = auth.uid()))) WITH CHECK (((requester_id = auth.uid()) OR (recipient_id = auth.uid())));


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

CREATE POLICY connections_requester_can_cancel ON public.connections FOR UPDATE TO authenticated USING (((auth.uid() = requester_id) AND (status = 'pending'::public.connection_status))) WITH CHECK (((auth.uid() = requester_id) AND (status = 'cancelled'::public.connection_status)));


--
-- Name: connections connections_requester_can_delete_pending; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connections_requester_can_delete_pending ON public.connections FOR DELETE TO authenticated USING (((auth.uid() = requester_id) AND (status = 'pending'::public.connection_status)));


--
-- Name: connections connections_target_can_respond; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connections_target_can_respond ON public.connections FOR UPDATE TO authenticated USING (((auth.uid() = target_id) AND (status = 'pending'::public.connection_status))) WITH CHECK (((auth.uid() = target_id) AND (status = ANY (ARRAY['accepted'::public.connection_status, 'declined'::public.connection_status]))));


--
-- Name: connections connections_update_by_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY connections_update_by_participants ON public.connections FOR UPDATE TO authenticated USING (((auth.uid() = requester_id) OR (auth.uid() = target_id))) WITH CHECK (((auth.uid() = requester_id) OR (auth.uid() = target_id)));


--
-- Name: dance_competitions_user dance_competitions_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_competitions_delete_own ON public.dance_competitions_user FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: dance_competitions_user dance_competitions_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_competitions_insert_own ON public.dance_competitions_user FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: dance_competitions_user dance_competitions_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_competitions_select_own ON public.dance_competitions_user FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: dance_competitions_user dance_competitions_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_competitions_update_own ON public.dance_competitions_user FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: dance_competitions_user; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dance_competitions_user ENABLE ROW LEVEL SECURITY;

--
-- Name: dance_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dance_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: dance_contacts dance_contacts_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_contacts_delete_own ON public.dance_contacts FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: dance_contacts dance_contacts_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_contacts_insert_own ON public.dance_contacts FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: dance_contacts dance_contacts_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_contacts_select_own ON public.dance_contacts FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: dance_contacts dance_contacts_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_contacts_update_own ON public.dance_contacts FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: dance_goals_user dance_goals_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_goals_delete_own ON public.dance_goals_user FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: dance_goals_user dance_goals_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_goals_insert_own ON public.dance_goals_user FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: dance_goals_user dance_goals_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_goals_select_own ON public.dance_goals_user FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: dance_goals_user dance_goals_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_goals_update_own ON public.dance_goals_user FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: dance_goals_user; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dance_goals_user ENABLE ROW LEVEL SECURITY;

--
-- Name: dance_growth_public_summary; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dance_growth_public_summary ENABLE ROW LEVEL SECURITY;

--
-- Name: dance_growth_public_summary dance_growth_public_summary_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_growth_public_summary_select_authenticated ON public.dance_growth_public_summary FOR SELECT TO authenticated USING (true);


--
-- Name: dance_move_practice_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dance_move_practice_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: dance_move_practice_logs dance_move_practice_logs_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_move_practice_logs_delete_own ON public.dance_move_practice_logs FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: dance_move_practice_logs dance_move_practice_logs_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_move_practice_logs_insert_own ON public.dance_move_practice_logs FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: dance_move_practice_logs dance_move_practice_logs_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_move_practice_logs_select_own ON public.dance_move_practice_logs FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: dance_moves_catalog; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dance_moves_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: dance_moves_catalog dance_moves_catalog_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_moves_catalog_select_authenticated ON public.dance_moves_catalog FOR SELECT TO authenticated USING (true);


--
-- Name: dance_moves_user; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dance_moves_user ENABLE ROW LEVEL SECURITY;

--
-- Name: dance_moves_user dance_moves_user_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_moves_user_delete_own ON public.dance_moves_user FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: dance_moves_user dance_moves_user_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_moves_user_insert_own ON public.dance_moves_user FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: dance_moves_user dance_moves_user_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_moves_user_select_own ON public.dance_moves_user FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: dance_moves_user dance_moves_user_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dance_moves_user_update_own ON public.dance_moves_user FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: demo_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.demo_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: demo_profiles demo_profiles_read_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY demo_profiles_read_authenticated ON public.demo_profiles FOR SELECT TO authenticated USING (true);


--
-- Name: event_edit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_edit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: event_edit_logs event_edit_logs_service_role_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_edit_logs_service_role_all ON public.event_edit_logs TO service_role USING (true) WITH CHECK (true);


--
-- Name: event_edit_logs event_edit_logs_user_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_edit_logs_user_select_own ON public.event_edit_logs FOR SELECT TO authenticated USING ((editor_id = auth.uid()));


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
-- Name: event_feedback event_feedback_update_author; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_feedback_update_author ON public.event_feedback FOR UPDATE TO authenticated USING ((author_id = auth.uid())) WITH CHECK ((author_id = auth.uid()));


--
-- Name: event_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: event_invitations event_invitations_delete_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_invitations_delete_none ON public.event_invitations FOR DELETE TO authenticated USING (false);


--
-- Name: event_invitations event_invitations_insert_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_invitations_insert_none ON public.event_invitations FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: event_invitations event_invitations_insert_sender; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_invitations_insert_sender ON public.event_invitations FOR INSERT TO authenticated WITH CHECK ((sender_id = auth.uid()));


--
-- Name: event_invitations event_invitations_select_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_invitations_select_none ON public.event_invitations FOR SELECT TO authenticated USING (false);


--
-- Name: event_invitations event_invitations_select_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_invitations_select_participants ON public.event_invitations FOR SELECT TO authenticated USING (((sender_id = auth.uid()) OR (recipient_id = auth.uid())));


--
-- Name: event_invitations event_invitations_update_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_invitations_update_none ON public.event_invitations FOR UPDATE TO authenticated USING (false) WITH CHECK (false);


--
-- Name: event_invitations event_invitations_update_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_invitations_update_participants ON public.event_invitations FOR UPDATE TO authenticated USING (((sender_id = auth.uid()) OR (recipient_id = auth.uid()))) WITH CHECK (((sender_id = auth.uid()) OR (recipient_id = auth.uid())));


--
-- Name: event_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_members ENABLE ROW LEVEL SECURITY;

--
-- Name: event_members event_members_select_visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_members_select_visible ON public.event_members FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (public.event_host_user_id(event_id) = auth.uid()) OR public.is_app_admin(auth.uid())));


--
-- Name: event_members event_members_update_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_members_update_member ON public.event_members FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


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
  WHERE ((e.id = event_requests.event_id) AND (e.status = 'published'::text) AND (COALESCE(e.hidden_by_admin, false) = false) AND (e.event_access_type = 'request'::text) AND (e.host_user_id <> auth.uid()))))));


--
-- Name: event_requests event_requests_select_parties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_requests_select_parties ON public.event_requests FOR SELECT TO authenticated USING (((requester_id = auth.uid()) OR (public.event_host_user_id(event_id) = auth.uid()) OR public.is_app_admin(auth.uid())));


--
-- Name: event_requests event_requests_update_requester; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_requests_update_requester ON public.event_requests FOR UPDATE TO authenticated USING ((requester_id = auth.uid())) WITH CHECK ((requester_id = auth.uid()));


--
-- Name: event_series; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: events_archive; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events_archive ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY events_select_visible ON public.events FOR SELECT TO authenticated USING ((public.is_app_admin(auth.uid()) OR (host_user_id = auth.uid()) OR ((status = 'published'::text) AND (COALESCE(hidden_by_admin, false) = false) AND (event_access_type = ANY (ARRAY['public'::text, 'request'::text, 'private_group'::text]))) OR (EXISTS ( SELECT 1
   FROM public.event_members em
  WHERE ((em.event_id = events.id) AND (em.user_id = auth.uid()) AND (em.status = ANY (ARRAY['host'::text, 'going'::text, 'waitlist'::text, 'interested'::text])))))));


--
-- Name: events events_update_host; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_update_host ON public.events FOR UPDATE TO authenticated USING ((host_user_id = auth.uid())) WITH CHECK ((host_user_id = auth.uid()));


--
-- Name: group_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

--
-- Name: group_members group_members_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY group_members_delete ON public.group_members FOR DELETE USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.groups g
  WHERE ((g.id = group_members.group_id) AND (g.host_user_id = auth.uid()))))));


--
-- Name: group_members group_members_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY group_members_insert ON public.group_members FOR INSERT WITH CHECK (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.groups g
  WHERE ((g.id = group_members.group_id) AND (g.host_user_id = auth.uid()))))));


--
-- Name: group_members group_members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY group_members_select ON public.group_members FOR SELECT USING (public.is_group_member(group_id, auth.uid()));


--
-- Name: groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

--
-- Name: groups groups_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_delete ON public.groups FOR DELETE USING ((host_user_id = auth.uid()));


--
-- Name: groups groups_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_insert ON public.groups FOR INSERT WITH CHECK ((host_user_id = auth.uid()));


--
-- Name: groups groups_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_select ON public.groups FOR SELECT USING (((host_user_id = auth.uid()) OR public.is_group_member(id, auth.uid())));


--
-- Name: groups groups_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_update ON public.groups FOR UPDATE USING ((host_user_id = auth.uid()));


--
-- Name: hosting_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hosting_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: hosting_requests hosting_requests_delete_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hosting_requests_delete_none ON public.hosting_requests FOR DELETE TO authenticated USING (false);


--
-- Name: hosting_requests hosting_requests_insert_sender; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hosting_requests_insert_sender ON public.hosting_requests FOR INSERT TO authenticated WITH CHECK ((sender_user_id = auth.uid()));


--
-- Name: hosting_requests hosting_requests_select_parties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hosting_requests_select_parties ON public.hosting_requests FOR SELECT TO authenticated USING (((sender_user_id = auth.uid()) OR (recipient_user_id = auth.uid())));


--
-- Name: hosting_requests hosting_requests_update_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hosting_requests_update_none ON public.hosting_requests FOR UPDATE TO authenticated USING (false) WITH CHECK (false);


--
-- Name: member_interaction_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_interaction_counters ENABLE ROW LEVEL SECURITY;

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
-- Name: teacher_references owner_manage_teacher_references; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_manage_teacher_references ON public.teacher_references USING ((auth.uid() = teacher_user_id)) WITH CHECK ((auth.uid() = teacher_user_id));


--
-- Name: pair_interaction_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pair_interaction_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: thread_status_history participants_insert_thread_status_history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_insert_thread_status_history ON public.thread_status_history FOR INSERT WITH CHECK ((actor_user_id = auth.uid()));


--
-- Name: thread_status_history participants_see_thread_status_history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_see_thread_status_history ON public.thread_status_history FOR SELECT USING (((participant_user_id = auth.uid()) OR (actor_user_id = auth.uid())));


--
-- Name: photo_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.photo_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: privacy_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: privacy_requests privacy_requests_insert_requester; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY privacy_requests_insert_requester ON public.privacy_requests FOR INSERT TO authenticated WITH CHECK ((requester_id = auth.uid()));


--
-- Name: privacy_requests privacy_requests_select_requester_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY privacy_requests_select_requester_or_admin ON public.privacy_requests FOR SELECT TO authenticated USING (((requester_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid())))));


--
-- Name: privacy_requests privacy_requests_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY privacy_requests_update_admin ON public.privacy_requests FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = auth.uid()))));


--
-- Name: profile_badges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profile_badges ENABLE ROW LEVEL SECURITY;

--
-- Name: profile_media; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profile_media ENABLE ROW LEVEL SECURITY;

--
-- Name: profile_media profile_media_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profile_media_delete_own ON public.profile_media FOR DELETE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: profile_media profile_media_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profile_media_insert_own ON public.profile_media FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: profile_media profile_media_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profile_media_select_own ON public.profile_media FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: profile_media profile_media_select_ready; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profile_media_select_ready ON public.profile_media FOR SELECT USING ((status = 'ready'::text));


--
-- Name: profile_media profile_media_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profile_media_update_own ON public.profile_media FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: profile_username_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profile_username_history ENABLE ROW LEVEL SECURITY;

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
-- Name: teacher_references public_read_teacher_references; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_teacher_references ON public.teacher_references FOR SELECT USING (((is_public = true) AND (status = 'published'::text)));


--
-- Name: request_chat_entitlements rce_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rce_insert ON public.request_chat_entitlements FOR INSERT WITH CHECK (false);


--
-- Name: request_chat_entitlements rce_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rce_select ON public.request_chat_entitlements FOR SELECT USING (((requester_user_id = auth.uid()) OR (responder_user_id = auth.uid())));


--
-- Name: request_chat_entitlements rce_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rce_update ON public.request_chat_entitlements FOR UPDATE USING (false);


--
-- Name: profile_badges read badges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read badges" ON public.profile_badges FOR SELECT TO authenticated, anon USING (true);


--
-- Name: reference_archives; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reference_archives ENABLE ROW LEVEL SECURITY;

--
-- Name: reference_archives reference_archives_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reference_archives_delete_own ON public.reference_archives FOR DELETE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: reference_archives reference_archives_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reference_archives_insert_own ON public.reference_archives FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: reference_archives reference_archives_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reference_archives_select_own ON public.reference_archives FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: reference_report_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reference_report_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: reference_report_claims reference_report_claims_insert_reporter; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reference_report_claims_insert_reporter ON public.reference_report_claims FOR INSERT TO authenticated WITH CHECK ((reporter_id = auth.uid()));


--
-- Name: reference_report_claims reference_report_claims_select_party_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reference_report_claims_select_party_or_admin ON public.reference_report_claims FOR SELECT TO authenticated USING (((reporter_id = auth.uid()) OR (target_user_id = auth.uid()) OR public.is_app_admin(auth.uid())));


--
-- Name: reference_report_claims reference_report_claims_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reference_report_claims_update_admin ON public.reference_report_claims FOR UPDATE TO authenticated USING (public.is_app_admin(auth.uid())) WITH CHECK (public.is_app_admin(auth.uid()));


--
-- Name: reference_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reference_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: reference_requests reference_requests_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reference_requests_select_own ON public.reference_requests FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: reference_requests reference_requests_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reference_requests_update_own ON public.reference_requests FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: references; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."references" ENABLE ROW LEVEL SECURITY;

--
-- Name: references references_insert_author; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY references_insert_author ON public."references" FOR INSERT TO authenticated WITH CHECK (((COALESCE(author_id, from_user_id) = auth.uid()) AND (COALESCE(recipient_id, to_user_id) IS NOT NULL)));


--
-- Name: references references_select_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY references_select_participants ON public."references" FOR SELECT TO authenticated USING (((public.cx_reference_author_id(author_id, from_user_id, source_id) = auth.uid()) OR (public.cx_reference_recipient_id(recipient_id, to_user_id, target_id) = auth.uid()) OR (COALESCE(public_after_at, created_at, now()) <= now())));


--
-- Name: references references_update_recipient; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY references_update_recipient ON public."references" FOR UPDATE TO authenticated USING ((recipient_id = auth.uid())) WITH CHECK ((recipient_id = auth.uid()));


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
-- Name: request_chat_entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.request_chat_entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: service_inquiries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_inquiries ENABLE ROW LEVEL SECURITY;

--
-- Name: service_inquiries service_inquiries_insert_requester; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_inquiries_insert_requester ON public.service_inquiries FOR INSERT WITH CHECK ((auth.uid() = requester_id));


--
-- Name: service_inquiries service_inquiries_select_recipient; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_inquiries_select_recipient ON public.service_inquiries FOR SELECT USING ((auth.uid() = recipient_id));


--
-- Name: service_inquiries service_inquiries_select_requester; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_inquiries_select_requester ON public.service_inquiries FOR SELECT USING ((auth.uid() = requester_id));


--
-- Name: service_inquiries service_inquiries_update_recipient; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_inquiries_update_recipient ON public.service_inquiries FOR UPDATE USING ((auth.uid() = recipient_id)) WITH CHECK ((auth.uid() = recipient_id));


--
-- Name: service_inquiry_threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_inquiry_threads ENABLE ROW LEVEL SECURITY;

--
-- Name: service_inquiry_threads service_inquiry_threads_select_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_inquiry_threads_select_participants ON public.service_inquiry_threads FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.service_inquiries si
  WHERE ((si.id = service_inquiry_threads.inquiry_id) AND ((si.requester_id = auth.uid()) OR (si.recipient_id = auth.uid()))))));


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
-- Name: syncs syncs_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY syncs_update_owner ON public.syncs FOR UPDATE TO authenticated USING ((completed_by = auth.uid())) WITH CHECK ((completed_by = auth.uid()));


--
-- Name: teacher_class_confirmations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_class_confirmations ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_class_confirmations teacher_class_confirmations_delete_teacher; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_class_confirmations_delete_teacher ON public.teacher_class_confirmations FOR DELETE USING ((auth.uid() = teacher_user_id));


--
-- Name: teacher_class_confirmations teacher_class_confirmations_insert_teacher; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_class_confirmations_insert_teacher ON public.teacher_class_confirmations FOR INSERT WITH CHECK ((auth.uid() = teacher_user_id));


--
-- Name: teacher_class_confirmations teacher_class_confirmations_select_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_class_confirmations_select_participants ON public.teacher_class_confirmations FOR SELECT USING (((auth.uid() = teacher_user_id) OR (auth.uid() = student_user_id)));


--
-- Name: teacher_class_confirmations teacher_class_confirmations_update_teacher; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_class_confirmations_update_teacher ON public.teacher_class_confirmations FOR UPDATE USING ((auth.uid() = teacher_user_id)) WITH CHECK ((auth.uid() = teacher_user_id));


--
-- Name: teacher_class_reminders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_class_reminders ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_class_reminders teacher_class_reminders_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_class_reminders_delete_owner ON public.teacher_class_reminders FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.teacher_class_confirmations tcc
  WHERE ((tcc.id = teacher_class_reminders.class_confirmation_id) AND (tcc.teacher_user_id = auth.uid())))));


--
-- Name: teacher_class_reminders teacher_class_reminders_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_class_reminders_insert_owner ON public.teacher_class_reminders FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.teacher_class_confirmations tcc
  WHERE ((tcc.id = teacher_class_reminders.class_confirmation_id) AND (tcc.teacher_user_id = auth.uid())))));


--
-- Name: teacher_class_reminders teacher_class_reminders_select_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_class_reminders_select_owner ON public.teacher_class_reminders FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.teacher_class_confirmations tcc
  WHERE ((tcc.id = teacher_class_reminders.class_confirmation_id) AND (tcc.teacher_user_id = auth.uid())))));


--
-- Name: teacher_class_reminders teacher_class_reminders_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_class_reminders_update_owner ON public.teacher_class_reminders FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.teacher_class_confirmations tcc
  WHERE ((tcc.id = teacher_class_reminders.class_confirmation_id) AND (tcc.teacher_user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.teacher_class_confirmations tcc
  WHERE ((tcc.id = teacher_class_reminders.class_confirmation_id) AND (tcc.teacher_user_id = auth.uid())))));


--
-- Name: teacher_event_teaching; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_event_teaching ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_event_teaching teacher_event_teaching_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_event_teaching_delete_owner ON public.teacher_event_teaching FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: teacher_event_teaching teacher_event_teaching_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_event_teaching_insert_owner ON public.teacher_event_teaching FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: teacher_event_teaching teacher_event_teaching_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_event_teaching_select ON public.teacher_event_teaching FOR SELECT USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.teacher_profiles tp
  WHERE ((tp.user_id = teacher_event_teaching.user_id) AND (tp.is_public = true))))));


--
-- Name: teacher_event_teaching teacher_event_teaching_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_event_teaching_update_owner ON public.teacher_event_teaching FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: teacher_info_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_info_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_info_blocks teacher_info_blocks_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_info_blocks_delete_owner ON public.teacher_info_blocks FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: teacher_info_blocks teacher_info_blocks_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_info_blocks_insert_owner ON public.teacher_info_blocks FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: teacher_info_blocks teacher_info_blocks_select_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_info_blocks_select_public ON public.teacher_info_blocks FOR SELECT USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.teacher_profiles tp
  WHERE ((tp.user_id = teacher_info_blocks.user_id) AND (tp.is_public = true))))));


--
-- Name: teacher_info_blocks teacher_info_blocks_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_info_blocks_update_owner ON public.teacher_info_blocks FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: teacher_info_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_info_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_info_profiles teacher_info_profiles_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_info_profiles_delete_owner ON public.teacher_info_profiles FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: teacher_info_profiles teacher_info_profiles_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_info_profiles_insert_owner ON public.teacher_info_profiles FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: teacher_info_profiles teacher_info_profiles_select_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_info_profiles_select_public ON public.teacher_info_profiles FOR SELECT USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.teacher_profiles tp
  WHERE ((tp.user_id = teacher_info_profiles.user_id) AND (tp.is_public = true))))));


--
-- Name: teacher_info_profiles teacher_info_profiles_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_info_profiles_update_owner ON public.teacher_info_profiles FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: teacher_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_profiles teacher_profiles_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_profiles_delete_owner ON public.teacher_profiles FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: teacher_profiles teacher_profiles_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_profiles_insert_owner ON public.teacher_profiles FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: teacher_profiles teacher_profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_profiles_select ON public.teacher_profiles FOR SELECT USING (((is_public = true) OR (auth.uid() = user_id)));


--
-- Name: teacher_profiles teacher_profiles_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_profiles_update_owner ON public.teacher_profiles FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: teacher_references; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_references ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_regular_classes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_regular_classes ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_regular_classes teacher_regular_classes_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_regular_classes_delete_owner ON public.teacher_regular_classes FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: teacher_regular_classes teacher_regular_classes_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_regular_classes_insert_owner ON public.teacher_regular_classes FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: teacher_regular_classes teacher_regular_classes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_regular_classes_select ON public.teacher_regular_classes FOR SELECT USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.teacher_profiles tp
  WHERE ((tp.user_id = teacher_regular_classes.user_id) AND (tp.is_public = true))))));


--
-- Name: teacher_regular_classes teacher_regular_classes_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_regular_classes_update_owner ON public.teacher_regular_classes FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: teacher_session_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_session_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_session_availability teacher_session_availability_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_session_availability_delete_owner ON public.teacher_session_availability FOR DELETE USING ((auth.uid() = teacher_id));


--
-- Name: teacher_session_availability teacher_session_availability_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_session_availability_insert_owner ON public.teacher_session_availability FOR INSERT WITH CHECK (((auth.uid() = teacher_id) AND (availability_date >= CURRENT_DATE) AND (availability_date <= (CURRENT_DATE + '3 mons'::interval))));


--
-- Name: teacher_session_availability teacher_session_availability_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_session_availability_select ON public.teacher_session_availability FOR SELECT USING (((auth.uid() = teacher_id) OR (EXISTS ( SELECT 1
   FROM public.teacher_profiles tp
  WHERE ((tp.user_id = teacher_session_availability.teacher_id) AND (tp.is_public = true))))));


--
-- Name: teacher_session_availability teacher_session_availability_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_session_availability_update_owner ON public.teacher_session_availability FOR UPDATE USING ((auth.uid() = teacher_id)) WITH CHECK (((auth.uid() = teacher_id) AND (availability_date >= CURRENT_DATE) AND (availability_date <= (CURRENT_DATE + '3 mons'::interval))));


--
-- Name: teacher_session_bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_session_bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_session_bookings teacher_session_bookings_insert_student; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_session_bookings_insert_student ON public.teacher_session_bookings FOR INSERT WITH CHECK (((auth.uid() = student_id) AND (student_id <> teacher_id) AND (session_date >= CURRENT_DATE) AND (session_date <= (CURRENT_DATE + '3 mons'::interval)) AND (status = 'pending'::text)));


--
-- Name: teacher_session_bookings teacher_session_bookings_select_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_session_bookings_select_owner ON public.teacher_session_bookings FOR SELECT USING (((auth.uid() = teacher_id) OR (auth.uid() = student_id)));


--
-- Name: teacher_session_bookings teacher_session_bookings_update_teacher; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_session_bookings_update_teacher ON public.teacher_session_bookings FOR UPDATE USING ((auth.uid() = teacher_id)) WITH CHECK ((auth.uid() = teacher_id));


--
-- Name: teacher_student_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_student_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_student_sessions teacher_student_sessions_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_student_sessions_delete_owner ON public.teacher_student_sessions FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.teacher_students ts
  WHERE ((ts.id = teacher_student_sessions.teacher_student_id) AND (ts.teacher_user_id = auth.uid())))));


--
-- Name: teacher_student_sessions teacher_student_sessions_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_student_sessions_insert_owner ON public.teacher_student_sessions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.teacher_students ts
  WHERE ((ts.id = teacher_student_sessions.teacher_student_id) AND (ts.teacher_user_id = auth.uid())))));


--
-- Name: teacher_student_sessions teacher_student_sessions_select_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_student_sessions_select_owner ON public.teacher_student_sessions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.teacher_students ts
  WHERE ((ts.id = teacher_student_sessions.teacher_student_id) AND (ts.teacher_user_id = auth.uid())))));


--
-- Name: teacher_student_sessions teacher_student_sessions_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_student_sessions_update_owner ON public.teacher_student_sessions FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.teacher_students ts
  WHERE ((ts.id = teacher_student_sessions.teacher_student_id) AND (ts.teacher_user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.teacher_students ts
  WHERE ((ts.id = teacher_student_sessions.teacher_student_id) AND (ts.teacher_user_id = auth.uid())))));


--
-- Name: teacher_students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_students ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_students teacher_students_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_students_delete_owner ON public.teacher_students FOR DELETE USING ((auth.uid() = teacher_user_id));


--
-- Name: teacher_students teacher_students_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_students_insert_owner ON public.teacher_students FOR INSERT WITH CHECK ((auth.uid() = teacher_user_id));


--
-- Name: teacher_students teacher_students_select_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_students_select_owner ON public.teacher_students FOR SELECT USING ((auth.uid() = teacher_user_id));


--
-- Name: teacher_students teacher_students_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_students_update_owner ON public.teacher_students FOR UPDATE USING ((auth.uid() = teacher_user_id)) WITH CHECK ((auth.uid() = teacher_user_id));


--
-- Name: teacher_weekly_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_weekly_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_weekly_availability teacher_weekly_availability_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_weekly_availability_delete_owner ON public.teacher_weekly_availability FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: teacher_weekly_availability teacher_weekly_availability_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_weekly_availability_insert_owner ON public.teacher_weekly_availability FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: teacher_weekly_availability teacher_weekly_availability_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_weekly_availability_select ON public.teacher_weekly_availability FOR SELECT USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.teacher_profiles tp
  WHERE ((tp.user_id = teacher_weekly_availability.user_id) AND (tp.is_public = true))))));


--
-- Name: teacher_weekly_availability teacher_weekly_availability_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_weekly_availability_update_owner ON public.teacher_weekly_availability FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: thread_contexts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.thread_contexts ENABLE ROW LEVEL SECURITY;

--
-- Name: thread_contexts thread_contexts_delete_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_contexts_delete_none ON public.thread_contexts FOR DELETE TO authenticated USING (false);


--
-- Name: thread_contexts thread_contexts_insert_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_contexts_insert_none ON public.thread_contexts FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: thread_contexts thread_contexts_select_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_contexts_select_participants ON public.thread_contexts FOR SELECT TO authenticated USING (public.cx_is_thread_participant(thread_id, auth.uid()));


--
-- Name: thread_contexts thread_contexts_update_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_contexts_update_none ON public.thread_contexts FOR UPDATE TO authenticated USING (false) WITH CHECK (false);


--
-- Name: thread_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.thread_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: thread_messages thread_messages_delete_sender; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_messages_delete_sender ON public.thread_messages FOR DELETE TO authenticated USING (((sender_id = auth.uid()) AND public.cx_is_thread_participant(thread_id, auth.uid())));


--
-- Name: thread_messages thread_messages_insert_sender_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_messages_insert_sender_participant ON public.thread_messages FOR INSERT TO authenticated WITH CHECK (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.thread_participants tp
  WHERE ((tp.thread_id = thread_messages.thread_id) AND (tp.user_id = auth.uid())))) AND public.cx_event_thread_can_post(thread_id, auth.uid())));


--
-- Name: thread_messages thread_messages_select_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_messages_select_participants ON public.thread_messages FOR SELECT TO authenticated USING (public.cx_can_select_thread_message(thread_id, sender_id, message_type, context_tag, status_tag, auth.uid()));


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

CREATE POLICY thread_participants_select_thread_members ON public.thread_participants FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.cx_is_thread_participant(thread_id, auth.uid())));


--
-- Name: thread_participants thread_participants_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY thread_participants_update_self ON public.thread_participants FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: thread_status_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.thread_status_history ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY threads_select_participant ON public.threads FOR SELECT TO authenticated USING (public.cx_is_thread_participant(id, auth.uid()));


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
-- Name: trip_requests trip_requests_update_requester; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trip_requests_update_requester ON public.trip_requests FOR UPDATE TO authenticated USING ((requester_id = auth.uid())) WITH CHECK ((requester_id = auth.uid()));


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
-- Name: user_messaging_cycles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_messaging_cycles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_messaging_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_messaging_plans ENABLE ROW LEVEL SECURITY;

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
-- Name: user_messaging_cycles users_own_messaging_cycles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_own_messaging_cycles ON public.user_messaging_cycles USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_messaging_plans users_own_messaging_plan; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_own_messaging_plan ON public.user_messaging_plans USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: profile_username_history users_own_username_history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_own_username_history ON public.profile_username_history FOR SELECT USING ((auth.uid() = user_id));


--
-- PostgreSQL database dump complete
--

\unrestrict 42rWU1Zoiav2HhgVqyppJHMYJJADHeD5ZJ0zgpoZ2Pk1wHjueAO8lZOiUwvjJ3F

