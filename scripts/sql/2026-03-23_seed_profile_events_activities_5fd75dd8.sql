begin;

create extension if not exists pgcrypto;

do $$
declare
  v_user uuid := '5fd75dd8-1893-4eb4-a8cc-6f026fd10d02';
  v_peer_a uuid;
  v_peer_b uuid;
  v_conn_a uuid;
  v_conn_b uuid;
  v_event_host uuid;
  v_event_going_a uuid;
  v_event_going_b uuid;
begin
  select p.user_id
    into v_peer_a
  from public.profiles p
  where p.user_id <> v_user
  order by p.created_at nulls last, p.user_id
  limit 1;

  select p.user_id
    into v_peer_b
  from public.profiles p
  where p.user_id <> v_user
    and p.user_id <> v_peer_a
  order by p.created_at nulls last, p.user_id
  limit 1;

  if v_peer_a is null or v_peer_b is null then
    raise notice 'profile seed skipped: not enough peer profiles found';
    return;
  end if;

  select c.id
    into v_conn_a
  from public.connections c
  where (c.requester_id = v_user and c.target_id = v_peer_a)
     or (c.requester_id = v_peer_a and c.target_id = v_user)
  order by case when c.status = 'accepted' then 0 else 1 end, c.updated_at desc nulls last
  limit 1;

  if v_conn_a is null then
    insert into public.connections (
      requester_id,
      target_id,
      status,
      connect_context,
      connect_reason,
      created_at,
      updated_at
    )
    values (
      v_user,
      v_peer_a,
      'accepted',
      'profile_seed',
      'Profile activity seed',
      now() - interval '20 days',
      now() - interval '20 days'
    )
    returning id into v_conn_a;
  else
    update public.connections
    set status = 'accepted',
        updated_at = now()
    where id = v_conn_a;
  end if;

  select c.id
    into v_conn_b
  from public.connections c
  where (c.requester_id = v_user and c.target_id = v_peer_b)
     or (c.requester_id = v_peer_b and c.target_id = v_user)
  order by case when c.status = 'accepted' then 0 else 1 end, c.updated_at desc nulls last
  limit 1;

  if v_conn_b is null then
    insert into public.connections (
      requester_id,
      target_id,
      status,
      connect_context,
      connect_reason,
      created_at,
      updated_at
    )
    values (
      v_user,
      v_peer_b,
      'accepted',
      'profile_seed',
      'Profile activity seed',
      now() - interval '18 days',
      now() - interval '18 days'
    )
    returning id into v_conn_b;
  else
    update public.connections
    set status = 'accepted',
        updated_at = now()
    where id = v_conn_b;
  end if;

  delete from public.connection_syncs
  where note like '[Profile Seed]%'
    and connection_id in (v_conn_a, v_conn_b);

  insert into public.connection_syncs (
    connection_id,
    requester_id,
    recipient_id,
    sync_type,
    scheduled_at,
    note,
    status,
    created_at,
    updated_at
  )
  values
    (
      v_conn_a,
      v_user,
      v_peer_a,
      'training',
      now() - interval '3 days',
      '[Profile Seed] Practiced partner drills and musicality timing together.',
      'accepted',
      now() - interval '4 days',
      now() - interval '3 days'
    ),
    (
      v_conn_b,
      v_peer_b,
      v_user,
      'workshop',
      now() - interval '12 days',
      '[Profile Seed] Joined a workshop session and finalized it after completion.',
      'completed',
      now() - interval '13 days',
      now() - interval '10 days'
    );

  update public.connection_syncs
  set completed_at = now() - interval '10 days'
  where connection_id = v_conn_b
    and note = '[Profile Seed] Joined a workshop session and finalized it after completion.';

  delete from public.event_members
  where event_id in (
    select e.id from public.events e where e.title like '[Profile Seed]%'
  );

  delete from public.events
  where title like '[Profile Seed]%'
    and (host_user_id = v_user or host_user_id in (v_peer_a, v_peer_b));

  insert into public.events (
    host_user_id,
    title,
    description,
    event_type,
    visibility,
    city,
    country,
    venue_name,
    venue_address,
    starts_at,
    ends_at,
    capacity,
    status,
    created_at,
    updated_at
  )
  values (
    v_user,
    '[Profile Seed] Tallinn Bachata Community Night',
    'Hosted showcase event for the profile page event grid.',
    'Social Dance',
    'public',
    'Tallinn',
    'Estonia',
    'Nordic Movement Studio',
    'Rotermanni 8',
    now() - interval '14 days',
    now() - interval '14 days' + interval '4 hours',
    120,
    'published',
    now() - interval '20 days',
    now() - interval '14 days'
  )
  returning id into v_event_host;

  insert into public.events (
    host_user_id,
    title,
    description,
    event_type,
    visibility,
    city,
    country,
    venue_name,
    venue_address,
    starts_at,
    ends_at,
    capacity,
    status,
    created_at,
    updated_at
  )
  values (
    v_peer_a,
    '[Profile Seed] Riga Weekend Social',
    'Attended example event for the profile page.',
    'Social Dance',
    'public',
    'Riga',
    'Latvia',
    'Skyline Dance Loft',
    'Brivibas 44',
    now() - interval '21 days',
    now() - interval '21 days' + interval '3 hours',
    90,
    'published',
    now() - interval '25 days',
    now() - interval '21 days'
  )
  returning id into v_event_going_a;

  insert into public.events (
    host_user_id,
    title,
    description,
    event_type,
    visibility,
    city,
    country,
    venue_name,
    venue_address,
    starts_at,
    ends_at,
    capacity,
    status,
    created_at,
    updated_at
  )
  values (
    v_peer_b,
    '[Profile Seed] Helsinki Workshop Jam',
    'Attended example event for the profile page.',
    'Workshop',
    'public',
    'Helsinki',
    'Finland',
    'Harbor Arts Hall',
    'Market Square 2',
    now() - interval '30 days',
    now() - interval '30 days' + interval '5 hours',
    140,
    'published',
    now() - interval '35 days',
    now() - interval '30 days'
  )
  returning id into v_event_going_b;

  insert into public.event_members (event_id, user_id, member_role, status, joined_at, created_at, updated_at)
  values
    (v_event_going_a, v_user, 'guest', 'going', now() - interval '22 days', now() - interval '22 days', now() - interval '21 days'),
    (v_event_going_b, v_user, 'guest', 'going', now() - interval '31 days', now() - interval '31 days', now() - interval '30 days')
  on conflict (event_id, user_id) do update
  set member_role = excluded.member_role,
      status = excluded.status,
      joined_at = excluded.joined_at,
      updated_at = excluded.updated_at;
end $$;

commit;
