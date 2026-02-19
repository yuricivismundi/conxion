-- ConXion: Messages/Trip-thread test seed
-- Safe helper for local/dev staging.
-- It only seeds when eligible data exists (accepted connections/trip requests).

begin;

-- ---------------------------------------------------------
-- 1) Seed classic connection messages (messages table)
-- ---------------------------------------------------------
do $$
declare
  v_connection_id uuid;
  v_requester_id uuid;
  v_target_id uuid;
begin
  if to_regclass('public.connections') is null then
    raise notice 'connections table missing; skipping connection message seed';
    return;
  end if;

  if to_regclass('public.messages') is null then
    raise notice 'messages table missing; skipping connection message seed';
    return;
  end if;

  select c.id, c.requester_id, c.target_id
    into v_connection_id, v_requester_id, v_target_id
  from public.connections c
  where c.status = 'accepted'
    and c.blocked_by is null
  order by c.created_at desc nulls last
  limit 1;

  if v_connection_id is null then
    raise notice 'No accepted connections found; skipping connection message seed';
    return;
  end if;

  insert into public.messages (connection_id, sender_id, body, created_at)
  values
    (v_connection_id, v_requester_id, 'Hey! Are we still aligned for this week?', now() - interval '35 minutes'),
    (v_connection_id, v_target_id, 'Yes, confirmed. Let us sync timing later today.', now() - interval '22 minutes'),
    (v_connection_id, v_requester_id, 'Perfect, sending details now.', now() - interval '9 minutes');

  raise notice 'Seeded connection messages for connection %', v_connection_id;
end $$;

-- ---------------------------------------------------------
-- 2) Seed trip thread messages (threads + thread_messages)
--    requires 2026-02-15_threads_trips_syncs_notifications.sql
-- ---------------------------------------------------------
do $$
declare
  r record;
  v_thread_id uuid;
  v_seed_exists boolean;
begin
  if to_regclass('public.trip_requests') is null
     or to_regclass('public.threads') is null
     or to_regclass('public.thread_participants') is null
     or to_regclass('public.thread_messages') is null
  then
    raise notice 'Trip thread tables missing; skipping trip thread seed';
    return;
  end if;

  if not exists (select 1 from public.trip_requests where status = 'accepted') then
    raise notice 'No accepted trip requests found; skipping trip thread seed';
    return;
  end if;

  for r in
    select q.trip_id, q.owner_id, q.requester_id
    from (
      select
        tr.trip_id,
        t.user_id as owner_id,
        tr.requester_id,
        coalesce(tr.decided_at, tr.updated_at, tr.created_at) as rank_at,
        row_number() over (
          partition by tr.trip_id
          order by coalesce(tr.decided_at, tr.updated_at, tr.created_at) desc
        ) as rn
      from public.trip_requests tr
      join public.trips t on t.id = tr.trip_id
      where tr.status = 'accepted'
    ) q
    where q.rn = 1
    order by q.rank_at desc
    limit 3
  loop
    insert into public.threads (thread_type, trip_id, created_by, last_message_at)
    values ('trip', r.trip_id, r.owner_id, now())
    on conflict (trip_id) do update
      set updated_at = now(),
          last_message_at = greatest(public.threads.last_message_at, now())
    returning id into v_thread_id;

    if v_thread_id is null then
      select th.id into v_thread_id
      from public.threads th
      where th.trip_id = r.trip_id
      limit 1;
    end if;

    insert into public.thread_participants (thread_id, user_id, role, joined_at)
    values
      (v_thread_id, r.owner_id, 'owner', now()),
      (v_thread_id, r.requester_id, 'member', now())
    on conflict (thread_id, user_id) do nothing;

    select exists (
      select 1
      from public.thread_messages tm
      where tm.thread_id = v_thread_id
        and tm.body = '[ConXion Seed] Trip thread ready for planning.'
    )
    into v_seed_exists;

    if not v_seed_exists then
      insert into public.thread_messages (thread_id, sender_id, body, created_at)
      values
        (v_thread_id, r.requester_id, '[ConXion Seed] Trip thread ready for planning.', now() - interval '32 minutes'),
        (v_thread_id, r.owner_id, 'Great to have you in. Let us align schedule and arrival time.', now() - interval '22 minutes'),
        (v_thread_id, r.requester_id, 'Perfect. I can arrive around 6:30 PM and share live ETA.', now() - interval '12 minutes'),
        (v_thread_id, r.owner_id, 'Sounds good. I will pin the meetup location in this thread.', now() - interval '4 minutes');
    end if;

    raise notice 'Ensured trip thread seed for trip % / thread %', r.trip_id, v_thread_id;
  end loop;
end $$;

commit;
