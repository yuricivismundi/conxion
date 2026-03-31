-- ConXion References Examples Seed
-- Date: 2026-03-17
-- Purpose:
--   Seed realistic unified references in both directions for:
--   - Connection activity
--   - Trip activity
--   - Hosting activity
--
-- Notes:
--   - Safe to re-run (insert-only with duplicate guards).
--   - Uses app.me_user_id when provided; otherwise picks latest profile user.
--   - Does NOT overwrite or delete existing user references.
--   - Does NOT create or update connections (uses existing accepted pairs only).
--   - Writes canonical fields: from_user_id, to_user_id, text, rating, context_tag
--     and also legacy columns for compatibility.
--
-- Optional:
--   set app.me_user_id = 'YOUR_USER_UUID';

begin;

create extension if not exists pgcrypto;

do $$
declare
  v_seed text := '[seed-reference-examples-v1]';
  v_me uuid := nullif(current_setting('app.me_user_id', true), '')::uuid;

  v_peer_connection uuid;
  v_peer_trip uuid;
  v_peer_hosting uuid;

  v_conn_connection uuid;
  v_conn_trip uuid;
  v_conn_hosting uuid;

  v_created_count int := 0;
  v_rows int := 0;

  v_row record;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles table missing';
  end if;

  if to_regclass('public.connections') is null then
    raise exception 'public.connections table missing';
  end if;

  if to_regclass('public.references') is null then
    raise exception 'public.references table missing';
  end if;

  if v_me is null then
    select p.user_id
      into v_me
    from public.profiles p
    where p.user_id is not null
    order by p.updated_at desc nulls last, p.created_at desc nulls last, p.user_id
    limit 1;
  end if;

  if v_me is null then
    raise exception 'No profile user found for seeding references examples';
  end if;

  -- Helper selection: choose peers from existing accepted/unblocked connections
  -- where both directional reference slots are currently free.
  for v_row in
    select p.user_id
    from public.profiles p
    where p.user_id is not null
      and p.user_id <> v_me
    order by p.updated_at desc nulls last, p.created_at desc nulls last, p.user_id
    limit 24
  loop
    -- Find existing accepted connection for this pair.
    select c.id
      into v_conn_connection
    from public.connections c
    where ((c.requester_id = v_me and c.target_id = v_row.user_id)
        or (c.requester_id = v_row.user_id and c.target_id = v_me))
      and coalesce(lower(c.status::text), 'pending') = 'accepted'
      and c.blocked_by is null
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    if v_conn_connection is null then
      continue;
    end if;

    -- Pair must still have free slots both directions under unique(connection_id, author/from, recipient/to).
    if not exists (
      select 1 from public.references r
      where r.connection_id = v_conn_connection
        and (
          (coalesce(r.author_id, r.from_user_id) = v_me and coalesce(r.recipient_id, r.to_user_id) = v_row.user_id)
          or (coalesce(r.author_id, r.from_user_id) = v_row.user_id and coalesce(r.recipient_id, r.to_user_id) = v_me)
        )
    ) then
      if v_peer_connection is null then
        v_peer_connection := v_row.user_id;
        continue;
      end if;
      if v_peer_trip is null then
        v_peer_trip := v_row.user_id;
        continue;
      end if;
      if v_peer_hosting is null then
        v_peer_hosting := v_row.user_id;
        exit;
      end if;
    end if;
  end loop;

  -- Resolve scenario connection ids
  if v_peer_connection is not null then
    select c.id into v_conn_connection
    from public.connections c
    where ((c.requester_id = v_me and c.target_id = v_peer_connection)
        or (c.requester_id = v_peer_connection and c.target_id = v_me))
      and coalesce(lower(c.status::text), 'pending') = 'accepted'
      and c.blocked_by is null
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;
  end if;

  if v_peer_trip is not null then
    select c.id into v_conn_trip
    from public.connections c
    where ((c.requester_id = v_me and c.target_id = v_peer_trip)
        or (c.requester_id = v_peer_trip and c.target_id = v_me))
      and coalesce(lower(c.status::text), 'pending') = 'accepted'
      and c.blocked_by is null
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;
  end if;

  if v_peer_hosting is not null then
    select c.id into v_conn_hosting
    from public.connections c
    where ((c.requester_id = v_me and c.target_id = v_peer_hosting)
        or (c.requester_id = v_peer_hosting and c.target_id = v_me))
      and coalesce(lower(c.status::text), 'pending') = 'accepted'
      and c.blocked_by is null
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;
  end if;

  -- Scenario 1: Connection activity (both directions)
  if v_peer_connection is not null and v_conn_connection is not null then
    insert into public.references (
      connection_id,
      author_id, recipient_id,
      from_user_id, to_user_id,
      context, context_tag, entity_type, entity_id,
      sentiment, rating, body, text,
      created_at, updated_at
    )
    select
      v_conn_connection,
      v_me,
      v_peer_connection,
      v_me,
      v_peer_connection,
      'connection',
      'collaboration',
      'connection',
      v_conn_connection,
      'positive',
      5,
      v_seed || ' Connection: great communication and reliable follow-up after connecting.',
      v_seed || ' Connection: great communication and reliable follow-up after connecting.',
      now() - interval '6 days',
      now() - interval '6 days'
    where not exists (
      select 1 from public.references r
      where r.connection_id = v_conn_connection
        and coalesce(r.author_id, r.from_user_id) = v_me
        and coalesce(r.recipient_id, r.to_user_id) = v_peer_connection
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_created_count := v_created_count + v_rows;

    insert into public.references (
      connection_id,
      author_id, recipient_id,
      from_user_id, to_user_id,
      context, context_tag, entity_type, entity_id,
      sentiment, rating, body, text,
      created_at, updated_at
    )
    select
      v_conn_connection,
      v_peer_connection,
      v_me,
      v_peer_connection,
      v_me,
      'connection',
      'collaboration',
      'connection',
      v_conn_connection,
      'positive',
      5,
      v_seed || ' Connection: easy to coordinate with and respectful throughout the interaction.',
      v_seed || ' Connection: easy to coordinate with and respectful throughout the interaction.',
      now() - interval '5 days',
      now() - interval '5 days'
    where not exists (
      select 1 from public.references r
      where r.connection_id = v_conn_connection
        and coalesce(r.author_id, r.from_user_id) = v_peer_connection
        and coalesce(r.recipient_id, r.to_user_id) = v_me
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_created_count := v_created_count + v_rows;
  end if;

  -- Scenario 2: Trip activity (both directions)
  if v_peer_trip is not null and v_conn_trip is not null then
    insert into public.references (
      connection_id,
      author_id, recipient_id,
      from_user_id, to_user_id,
      context, context_tag, entity_type, entity_id,
      sentiment, rating, body, text,
      created_at, updated_at
    )
    select
      v_conn_trip,
      v_me,
      v_peer_trip,
      v_me,
      v_peer_trip,
      'trip',
      'travel',
      'trip',
      gen_random_uuid(),
      'positive',
      5,
      v_seed || ' Trip: punctual travel coordination, clear updates, and great shared festival planning.',
      v_seed || ' Trip: punctual travel coordination, clear updates, and great shared festival planning.',
      now() - interval '4 days',
      now() - interval '4 days'
    where not exists (
      select 1 from public.references r
      where r.connection_id = v_conn_trip
        and coalesce(r.author_id, r.from_user_id) = v_me
        and coalesce(r.recipient_id, r.to_user_id) = v_peer_trip
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_created_count := v_created_count + v_rows;

    insert into public.references (
      connection_id,
      author_id, recipient_id,
      from_user_id, to_user_id,
      context, context_tag, entity_type, entity_id,
      sentiment, rating, body, text,
      created_at, updated_at
    )
    select
      v_conn_trip,
      v_peer_trip,
      v_me,
      v_peer_trip,
      v_me,
      'trip',
      'travel',
      'trip',
      gen_random_uuid(),
      'positive',
      5,
      v_seed || ' Trip: excellent travel buddy, collaborative planning, and smooth city-to-city logistics.',
      v_seed || ' Trip: excellent travel buddy, collaborative planning, and smooth city-to-city logistics.',
      now() - interval '3 days',
      now() - interval '3 days'
    where not exists (
      select 1 from public.references r
      where r.connection_id = v_conn_trip
        and coalesce(r.author_id, r.from_user_id) = v_peer_trip
        and coalesce(r.recipient_id, r.to_user_id) = v_me
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_created_count := v_created_count + v_rows;
  end if;

  -- Scenario 3: Hosting activity (both directions)
  if v_peer_hosting is not null and v_conn_hosting is not null then
    insert into public.references (
      connection_id,
      author_id, recipient_id,
      from_user_id, to_user_id,
      context, context_tag, entity_type, entity_id,
      sentiment, rating, body, text,
      created_at, updated_at
    )
    select
      v_conn_hosting,
      v_me,
      v_peer_hosting,
      v_me,
      v_peer_hosting,
      'trip',
      'host',
      'trip',
      gen_random_uuid(),
      'positive',
      5,
      v_seed || ' Hosting: welcoming host, clear house expectations, and very supportive during the stay.',
      v_seed || ' Hosting: welcoming host, clear house expectations, and very supportive during the stay.',
      now() - interval '2 days',
      now() - interval '2 days'
    where not exists (
      select 1 from public.references r
      where r.connection_id = v_conn_hosting
        and coalesce(r.author_id, r.from_user_id) = v_me
        and coalesce(r.recipient_id, r.to_user_id) = v_peer_hosting
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_created_count := v_created_count + v_rows;

    insert into public.references (
      connection_id,
      author_id, recipient_id,
      from_user_id, to_user_id,
      context, context_tag, entity_type, entity_id,
      sentiment, rating, body, text,
      created_at, updated_at
    )
    select
      v_conn_hosting,
      v_peer_hosting,
      v_me,
      v_peer_hosting,
      v_me,
      'trip',
      'guest',
      'trip',
      gen_random_uuid(),
      'positive',
      5,
      v_seed || ' Hosting: respectful guest, good communication, and reliable timing during hosting period.',
      v_seed || ' Hosting: respectful guest, good communication, and reliable timing during hosting period.',
      now() - interval '1 day',
      now() - interval '1 day'
    where not exists (
      select 1 from public.references r
      where r.connection_id = v_conn_hosting
        and coalesce(r.author_id, r.from_user_id) = v_peer_hosting
        and coalesce(r.recipient_id, r.to_user_id) = v_me
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_created_count := v_created_count + v_rows;
  end if;

  raise notice 'references examples seed completed for user %, inserted rows: %', v_me, v_created_count;
  raise notice 'scenarios seeded -> connection peer: %, trip peer: %, hosting peer: %', v_peer_connection, v_peer_trip, v_peer_hosting;
end
$$;

commit;
