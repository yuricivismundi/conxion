-- Seed: 5 sample accepted hosting/trip requests for @yuri.bucio1
-- Each creates:
--   1. A fake host/guest profile (sample user)
--   2. A connection between them and yuri
--   3. A connection thread
--   4. A thread_context row (hosting_request, accepted)
--   5. A trip + trip_request (accepted)
--   6. A thread linked to the trip
--   7. A request_chat_entitlement (active or scheduled)
--
-- Safe to rerun: uses a seed tag to delete prior rows first.

begin;

do $$
declare
  v_yuri_id       uuid;
  v_instance_id   uuid;
  v_pw_hash       text;
  v_seed          text := 'hosting_seed_yuri_v1';

  -- per-sample vars
  v_guest_id      uuid;
  v_conn_id       uuid;
  v_thread_id     uuid;
  v_req_id        uuid;

  -- sample data arrays
  v_names         text[]   := ARRAY['Sofia Reyes','Marco Bellini','Aisha Ndiaye','Carlos Vega','Nina Hartmann'];
  v_emails        text[]   := ARRAY[
    'sofia.reyes@sample.conxion.test',
    'marco.bellini@sample.conxion.test',
    'aisha.ndiaye@sample.conxion.test',
    'carlos.vega@sample.conxion.test',
    'nina.hartmann@sample.conxion.test'
  ];
  v_cities        text[]   := ARRAY['Madrid','Rome','Dakar','Buenos Aires','Berlin'];
  v_countries     text[]   := ARRAY['Spain','Italy','Senegal','Argentina','Germany'];
  -- avatar_url left out of INSERT to satisfy profiles_avatar_not_blank constraint

  -- trip date ranges (start_date, end_date) — mix of future + past
  v_starts        date[]   := ARRAY[
    CURRENT_DATE + 30,   -- future: scheduled window
    CURRENT_DATE + 5,    -- near: opens immediately
    CURRENT_DATE - 10,   -- past: expired
    CURRENT_DATE + 60,   -- future: scheduled window
    CURRENT_DATE + 3     -- near: opens immediately
  ];
  v_ends          date[]   := ARRAY[
    CURRENT_DATE + 33,
    CURRENT_DATE + 8,
    CURRENT_DATE - 7,
    CURRENT_DATE + 65,
    CURRENT_DATE + 5
  ];

  v_notes         text[]   := ARRAY[
    'Coming for the salsa festival! Would love a quiet room.',
    'Festival trip — arriving Wednesday evening.',
    'Just passed — great stay!',
    'Planning to attend the bachata congress.',
    'Quick visit, 2 nights only.'
  ];

  v_i             int;
  v_opens_at      timestamptz;
  v_expires_at    timestamptz;
begin

  -- Bypass row-level triggers (plan limits etc.) for seed inserts
  set local session_replication_role = replica;

  -- ── Lookup yuri's user_id ───────────────────────────────────────────────
  select p.user_id into v_yuri_id
  from public.profiles p
  where lower(coalesce(p.username, '')) = 'yuri.bucio1'
  limit 1;

  if v_yuri_id is null then
    raise exception 'User yuri.bucio1 not found in profiles. Make sure the username is set.';
  end if;

  -- ── Inherit instance_id + pw hash for fake auth users ──────────────────
  select u.instance_id, coalesce(u.encrypted_password, '')
  into v_instance_id, v_pw_hash
  from auth.users u
  order by u.created_at asc
  limit 1;

  -- ── Clean up prior seed rows ────────────────────────────────────────────
  delete from public.profiles p
  using auth.users u
  where p.user_id = u.id
    and lower(coalesce(u.email,'')) like '%@sample.conxion.test'
    and coalesce(u.raw_user_meta_data->>'seed','') = v_seed;

  delete from auth.users u
  where lower(coalesce(u.email,'')) like '%@sample.conxion.test'
    and coalesce(u.raw_user_meta_data->>'seed','') = v_seed;

  -- ── Loop over 5 samples ─────────────────────────────────────────────────
  for v_i in 1..5 loop

    -- 1. Create fake guest auth user
    v_guest_id := gen_random_uuid();

    insert into auth.users (
      id, instance_id, aud, role,
      email, encrypted_password,
      email_confirmed_at, confirmation_sent_at,
      raw_user_meta_data,
      created_at, updated_at
    ) values (
      v_guest_id, v_instance_id, 'authenticated', 'authenticated',
      v_emails[v_i], v_pw_hash,
      now(), now(),
      jsonb_build_object('seed', v_seed, 'display_name', v_names[v_i]),
      now(), now()
    );

    -- 2. Create profile (username derived from email local part)
    insert into public.profiles (
      user_id, display_name, city, country,
      roles, languages, dance_styles,
      dance_skills, username,
      created_at, updated_at
    ) values (
      v_guest_id,
      v_names[v_i],
      v_cities[v_i],
      v_countries[v_i],
      ARRAY['social_dancer'],
      ARRAY['English','Spanish'],
      ARRAY['salsa','bachata'],
      jsonb_build_object('salsa', jsonb_build_object('level', 'intermediate', 'verified', false)),
      split_part(v_emails[v_i], '@', 1),
      now(), now()
    ) on conflict (user_id) do nothing;

    -- 3. Create accepted connection (yuri is requester)
    v_conn_id := gen_random_uuid();
    insert into public.connections (
      id, requester_id, target_id, status, created_at, updated_at
    ) values (
      v_conn_id, v_yuri_id, v_guest_id, 'accepted', now() - interval '30 days', now() - interval '29 days'
    ) on conflict do nothing;

    -- 4. Create connection thread
    v_thread_id := gen_random_uuid();
    insert into public.threads (
      id, thread_type, connection_id, created_by, last_message_at, created_at
    ) values (
      v_thread_id, 'connection', v_conn_id, v_yuri_id, now() - interval '1 hour', now() - interval '29 days'
    ) on conflict do nothing;

    -- Thread participants
    insert into public.thread_participants (thread_id, user_id, role)
    values (v_thread_id, v_yuri_id, 'owner')
    on conflict (thread_id, user_id) do nothing;

    insert into public.thread_participants (thread_id, user_id, role)
    values (v_thread_id, v_guest_id, 'member')
    on conflict (thread_id, user_id) do nothing;

    -- 5. Thread context: connection accepted
    perform public.cx_upsert_thread_context(
      p_thread_id    := v_thread_id,
      p_source_table := 'connections',
      p_source_id    := v_conn_id,
      p_context_tag  := 'connection_request',
      p_status_tag   := 'accepted',
      p_title        := 'Connection request',
      p_city         := null,
      p_start_date   := null::date,
      p_end_date     := null::date,
      p_requester_id := v_yuri_id,
      p_recipient_id := v_guest_id,
      p_metadata     := '{}'::jsonb
    );

    -- 6. Hosting request: guest requests to stay with yuri (accepted)
    v_req_id := gen_random_uuid();
    insert into public.hosting_requests (
      id,
      sender_user_id, recipient_user_id,
      request_type,
      arrival_date, departure_date,
      travellers_count,
      message, status,
      decided_by, decided_at,
      created_at, updated_at
    ) values (
      v_req_id,
      v_guest_id, v_yuri_id,
      'request_hosting',
      v_starts[v_i], v_ends[v_i],
      1,
      v_notes[v_i], 'accepted',
      v_yuri_id, now() - interval '14 days',
      now() - interval '15 days', now() - interval '14 days'
    );

    -- 7. Thread context: hosting request accepted
    perform public.cx_upsert_thread_context(
      p_thread_id    := v_thread_id,
      p_source_table := 'hosting_requests',
      p_source_id    := v_req_id,
      p_context_tag  := 'hosting_request',
      p_status_tag   := 'accepted',
      p_title        := 'Hosting request',
      p_city         := v_cities[v_i],
      p_start_date   := v_starts[v_i],
      p_end_date     := v_ends[v_i],
      p_requester_id := v_guest_id,
      p_recipient_id := v_yuri_id,
      p_metadata     := jsonb_build_object(
        'request_id', v_req_id
      )
    );

    -- 9. Entitlement: compute opens_at based on 14-day rule
    if (v_starts[v_i] - CURRENT_DATE) <= 14 then
      v_opens_at := now();
    else
      v_opens_at := (v_starts[v_i] - interval '14 days')::timestamptz;
    end if;
    v_expires_at := (v_ends[v_i]::text || 'T23:59:59Z')::timestamptz;

    -- Guard: opens_at must be < expires_at
    if v_opens_at >= v_expires_at then
      v_opens_at := v_expires_at - interval '1 hour';
    end if;

    perform public.cx_upsert_request_chat_entitlement(
      p_thread_id         := v_thread_id,
      p_source_type       := 'hosting_request',
      p_source_id         := v_req_id,
      p_requester_user_id := v_guest_id,
      p_responder_user_id := v_yuri_id,
      p_opens_at          := v_opens_at,
      p_expires_at        := v_expires_at
    );

  end loop;

  raise notice 'Seeded 5 hosting request threads for user % (yuri.bucio1)', v_yuri_id;
end;
$$;

commit;
