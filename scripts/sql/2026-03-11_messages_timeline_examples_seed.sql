-- ConXion Messaging Timeline Demo Seed
-- Purpose:
--   Seed realistic 1:1 thread timelines so you can inspect:
--   - accepted connection + later trip request
--   - pending hosting request
--   - accepted hosting + declined/cancelled requests + free text chat
--
-- Usage (optional, recommended):
--   set app.me_user_id = 'YOUR_USER_UUID';
--   \i scripts/sql/2026-03-11_messages_timeline_examples_seed.sql
--
-- If app.me_user_id is not set, script picks the most recently updated profile.
-- Safe to re-run: removes only previous demo rows tagged with this seed key.

begin;

create extension if not exists pgcrypto;

do $$
declare
  v_seed text := 'timeline_examples_v1';
  v_me uuid := nullif(current_setting('app.me_user_id', true), '')::uuid;
  v_peers uuid[];
  v_peer_a uuid;
  v_peer_b uuid;
  v_peer_c uuid;
  v_thread_a uuid;
  v_thread_b uuid;
  v_thread_c uuid;
  v_now timestamptz := now();

  v_conn_src uuid := gen_random_uuid();
  v_trip_pending_src uuid := gen_random_uuid();
  v_host_pending_src uuid := gen_random_uuid();
  v_host_accepted_src uuid := gen_random_uuid();
  v_event_declined_src uuid := gen_random_uuid();
  v_trip_cancelled_src uuid := gen_random_uuid();
begin
  if to_regprocedure('public.cx_ensure_pair_thread(uuid,uuid,uuid)') is null then
    raise exception 'cx_ensure_pair_thread(uuid,uuid,uuid) missing. Run scripts/sql/2026-03-09_unified_inbox_request_threads.sql first.';
  end if;
  if to_regprocedure('public.cx_upsert_thread_context(uuid,text,uuid,text,text,text,text,date,date,uuid,uuid,jsonb)') is null then
    raise exception 'cx_upsert_thread_context(...) missing. Run scripts/sql/2026-03-09_unified_inbox_request_threads.sql first.';
  end if;

  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles missing.';
  end if;

  if v_me is null then
    select p.user_id
      into v_me
    from public.profiles p
    where p.user_id is not null
    order by p.updated_at desc nulls last, p.user_id
    limit 1;
  end if;

  if v_me is null then
    raise exception 'No profile user found for seeding.';
  end if;

  -- Seed inserts pass through auth-dependent triggers/policies.
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_me::text, true);

  select array_agg(x.user_id order by x.updated_at desc nulls last, x.user_id)
    into v_peers
  from (
    select p.user_id, p.updated_at
    from public.profiles p
    where p.user_id is not null
      and p.user_id <> v_me
    order by p.updated_at desc nulls last, p.user_id
    limit 3
  ) x;

  if coalesce(array_length(v_peers, 1), 0) < 3 then
    raise exception 'Need at least 4 users in profiles (1 me + 3 peers) for demo seed.';
  end if;

  v_peer_a := v_peers[1];
  v_peer_b := v_peers[2];
  v_peer_c := v_peers[3];

  -- Cleanup previous demo payloads.
  delete from public.thread_messages
  where coalesce(metadata->>'seed', '') = v_seed;

  delete from public.thread_contexts
  where coalesce(metadata->>'seed', '') = v_seed;

  -- ------------------------------------------------------------------
  -- Scenario A: Connection accepted, then later trip request pending
  -- Expected left list: pending chips visible (Trip join request + Pending)
  -- ------------------------------------------------------------------
  v_thread_a := public.cx_ensure_pair_thread(v_me, v_peer_a, v_me);

  perform public.cx_upsert_thread_context(
    p_thread_id => v_thread_a,
    p_source_table => 'seed_connection',
    p_source_id => v_conn_src,
    p_context_tag => 'connection_request',
    p_status_tag => 'accepted',
    p_title => 'Connection request',
    p_city => null,
    p_start_date => null,
    p_end_date => null,
    p_requester_id => v_me,
    p_recipient_id => v_peer_a,
    p_metadata => jsonb_build_object('seed', v_seed, 'scenario', 'accepted_connection_then_trip_pending')
  );

  perform set_config('request.jwt.claim.sub', v_peer_a::text, true);
  insert into public.thread_messages (
    thread_id, sender_id, body, message_type, context_tag, status_tag, metadata, created_at
  )
  values (
    v_thread_a, v_peer_a, 'Connection request accepted.', 'request', 'connection_request', 'accepted',
    jsonb_build_object('seed', v_seed, 'scenario', 'accepted_connection_then_trip_pending', 'stage', 'connection_accepted'),
    v_now - interval '4 days'
  );

  perform public.cx_upsert_thread_context(
    p_thread_id => v_thread_a,
    p_source_table => 'seed_trip',
    p_source_id => v_trip_pending_src,
    p_context_tag => 'trip_join_request',
    p_status_tag => 'pending',
    p_title => 'Trip join request',
    p_city => 'Barcelona, Spain',
    p_start_date => current_date + 12,
    p_end_date => current_date + 15,
    p_requester_id => v_peer_a,
    p_recipient_id => v_me,
    p_metadata => jsonb_build_object('seed', v_seed, 'scenario', 'accepted_connection_then_trip_pending', 'trip_name', 'Barcelona Weekender')
  );

  perform set_config('request.jwt.claim.sub', v_peer_a::text, true);
  insert into public.thread_messages (
    thread_id, sender_id, body, message_type, context_tag, status_tag, metadata, created_at
  )
  values (
    v_thread_a, v_peer_a, 'Trip join request sent.', 'request', 'trip_join_request', 'pending',
    jsonb_build_object('seed', v_seed, 'scenario', 'accepted_connection_then_trip_pending', 'stage', 'trip_pending'),
    v_now - interval '1 day'
  );

  -- ------------------------------------------------------------------
  -- Scenario B: Hosting request still pending
  -- Expected left list: pending chips visible (Hosting request + Pending)
  -- ------------------------------------------------------------------
  v_thread_b := public.cx_ensure_pair_thread(v_me, v_peer_b, v_me);

  perform public.cx_upsert_thread_context(
    p_thread_id => v_thread_b,
    p_source_table => 'seed_hosting',
    p_source_id => v_host_pending_src,
    p_context_tag => 'hosting_request',
    p_status_tag => 'pending',
    p_title => 'Hosting request',
    p_city => 'Lisbon, Portugal',
    p_start_date => current_date + 20,
    p_end_date => current_date + 23,
    p_requester_id => v_peer_b,
    p_recipient_id => v_me,
    p_metadata => jsonb_build_object('seed', v_seed, 'scenario', 'hosting_pending', 'request_type', 'request_hosting')
  );

  perform set_config('request.jwt.claim.sub', v_peer_b::text, true);
  insert into public.thread_messages (
    thread_id, sender_id, body, message_type, context_tag, status_tag, metadata, created_at
  )
  values (
    v_thread_b, v_peer_b, 'Hosting request sent.', 'request', 'hosting_request', 'pending',
    jsonb_build_object('seed', v_seed, 'scenario', 'hosting_pending', 'stage', 'hosting_pending'),
    v_now - interval '7 hours'
  );

  -- ------------------------------------------------------------------
  -- Scenario C: Hosting accepted, event declined, trip cancelled + free text
  -- Expected left list: no request chips (thread remains clean)
  -- ------------------------------------------------------------------
  v_thread_c := public.cx_ensure_pair_thread(v_me, v_peer_c, v_me);

  perform public.cx_upsert_thread_context(
    p_thread_id => v_thread_c,
    p_source_table => 'seed_hosting',
    p_source_id => v_host_accepted_src,
    p_context_tag => 'hosting_request',
    p_status_tag => 'accepted',
    p_title => 'Offer to host',
    p_city => 'Tallinn, Estonia',
    p_start_date => current_date + 6,
    p_end_date => current_date + 8,
    p_requester_id => v_me,
    p_recipient_id => v_peer_c,
    p_metadata => jsonb_build_object('seed', v_seed, 'scenario', 'accepted_hosting_then_history', 'request_type', 'offer_to_host')
  );

  perform set_config('request.jwt.claim.sub', v_peer_c::text, true);
  insert into public.thread_messages (
    thread_id, sender_id, body, message_type, context_tag, status_tag, metadata, created_at
  )
  values (
    v_thread_c, v_peer_c, 'Host offer accepted.', 'request', 'hosting_request', 'accepted',
    jsonb_build_object('seed', v_seed, 'scenario', 'accepted_hosting_then_history', 'stage', 'hosting_accepted'),
    v_now - interval '3 days'
  );

  perform set_config('request.jwt.claim.sub', v_me::text, true);
  insert into public.thread_messages (
    thread_id, sender_id, body, message_type, context_tag, status_tag, metadata, created_at
  )
  values (
    v_thread_c, v_me, 'Great, I will share arrival details in a bit.', 'text', 'regular_chat', 'active',
    jsonb_build_object('seed', v_seed, 'scenario', 'accepted_hosting_then_history', 'stage', 'text_after_accept'),
    v_now - interval '2 days'
  );

  perform public.cx_upsert_thread_context(
    p_thread_id => v_thread_c,
    p_source_table => 'seed_event',
    p_source_id => v_event_declined_src,
    p_context_tag => 'event_chat',
    p_status_tag => 'declined',
    p_title => 'Event access request',
    p_city => 'Riga, Latvia',
    p_start_date => current_date + 30,
    p_end_date => null,
    p_requester_id => v_peer_c,
    p_recipient_id => v_me,
    p_metadata => jsonb_build_object('seed', v_seed, 'scenario', 'accepted_hosting_then_history')
  );

  perform set_config('request.jwt.claim.sub', v_me::text, true);
  insert into public.thread_messages (
    thread_id, sender_id, body, message_type, context_tag, status_tag, metadata, created_at
  )
  values (
    v_thread_c, v_me, 'Event access request declined.', 'request', 'event_chat', 'declined',
    jsonb_build_object('seed', v_seed, 'scenario', 'accepted_hosting_then_history', 'stage', 'event_declined'),
    v_now - interval '22 hours'
  );

  perform public.cx_upsert_thread_context(
    p_thread_id => v_thread_c,
    p_source_table => 'seed_trip',
    p_source_id => v_trip_cancelled_src,
    p_context_tag => 'trip_join_request',
    p_status_tag => 'cancelled',
    p_title => 'Trip join request',
    p_city => 'Warsaw, Poland',
    p_start_date => current_date + 40,
    p_end_date => current_date + 43,
    p_requester_id => v_peer_c,
    p_recipient_id => v_me,
    p_metadata => jsonb_build_object('seed', v_seed, 'scenario', 'accepted_hosting_then_history')
  );

  perform set_config('request.jwt.claim.sub', v_peer_c::text, true);
  insert into public.thread_messages (
    thread_id, sender_id, body, message_type, context_tag, status_tag, metadata, created_at
  )
  values (
    v_thread_c, v_peer_c, 'Trip join request cancelled.', 'request', 'trip_join_request', 'cancelled',
    jsonb_build_object('seed', v_seed, 'scenario', 'accepted_hosting_then_history', 'stage', 'trip_cancelled'),
    v_now - interval '12 hours'
  );

  -- Keep sorting consistent in inbox.
  update public.threads t
  set last_message_at = src.last_message_at
  from (
    select tm.thread_id, max(tm.created_at) as last_message_at
    from public.thread_messages tm
    where tm.thread_id in (v_thread_a, v_thread_b, v_thread_c)
    group by tm.thread_id
  ) src
  where t.id = src.thread_id;

  raise notice 'Seed done for me=% with peers: %, %, %', v_me, v_peer_a, v_peer_b, v_peer_c;
end $$;

commit;
