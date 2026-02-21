-- ConXion sample seed: Events MVP
-- Date: 2026-02-14
--
-- Inserts a few sample events using existing profile user_ids.
-- Safe to rerun (idempotent by title + host).

begin;

do $$
declare
  v_hosts uuid[];
  v_host_1 uuid;
  v_host_2 uuid;
  v_host_3 uuid;
  v_event_1 uuid;
  v_event_2 uuid;
  v_event_3 uuid;
begin
  if to_regclass('public.events') is null
     or to_regclass('public.event_members') is null
     or to_regclass('public.profiles') is null then
    raise notice 'events/profile tables missing; skipping event seed.';
    return;
  end if;

  select array_agg(p.user_id)
    into v_hosts
  from (
    select user_id
    from public.profiles
    order by user_id asc
    limit 3
  ) p;

  if coalesce(array_length(v_hosts, 1), 0) = 0 then
    raise notice 'no profiles found; skipping event seed.';
    return;
  end if;

  v_host_1 := v_hosts[1];
  v_host_2 := coalesce(v_hosts[2], v_hosts[1]);
  v_host_3 := coalesce(v_hosts[3], v_hosts[1]);

  select e.id into v_event_1
  from public.events e
  where e.host_user_id = v_host_1
    and e.title = 'ConXion Neon Social Night'
  limit 1;

  if v_event_1 is null then
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
    )
    values (
      v_host_1,
      'ConXion Neon Social Night',
      'Weekly social session focused on connection, musicality, and respectful partner work.',
      'Social',
      array['bachata', 'salsa'],
      'public',
      'New York',
      'USA',
      'The Vault Studio',
      '123 Rhythm Street',
      now() + interval '6 days',
      now() + interval '6 days 5 hours',
      180,
      null,
      'approved',
      jsonb_build_array(
        jsonb_build_object('label','Instagram','url','https://instagram.com','type','instagram'),
        jsonb_build_object('label','Tickets','url','https://example.com/tickets','type','tickets')
      ),
      'published'
    )
    returning id into v_event_1;
  end if;

  select e.id into v_event_2
  from public.events e
  where e.host_user_id = v_host_2
    and e.title = 'Urban Kiz Lab Intensive'
  limit 1;

  if v_event_2 is null then
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
    )
    values (
      v_host_2,
      'Urban Kiz Lab Intensive',
      'Small-group training weekend for technique, timing, and posture refinement.',
      'Workshop',
      array['kizomba'],
      'public',
      'Lisbon',
      'Portugal',
      'Flow Room',
      '8 Avenida Azul',
      now() + interval '13 days',
      now() + interval '13 days 8 hours',
      60,
      null,
      'approved',
      jsonb_build_array(
        jsonb_build_object('label','WhatsApp','url','https://wa.me/10000000000','type','whatsapp')
      ),
      'published'
    )
    returning id into v_event_2;
  end if;

  select e.id into v_event_3
  from public.events e
  where e.host_user_id = v_host_3
    and e.title = 'Host Team Planning Meetup'
  limit 1;

  if v_event_3 is null then
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
    )
    values (
      v_host_3,
      'Host Team Planning Meetup',
      'Private organiser alignment meeting for next month events.',
      'Community',
      array['planning'],
      'private',
      'Barcelona',
      'Spain',
      'ConXion Hub',
      '42 Carrer Central',
      now() + interval '3 days',
      now() + interval '3 days 2 hours',
      20,
      null,
      'approved',
      '[]'::jsonb,
      'published'
    )
    returning id into v_event_3;
  end if;

  insert into public.events (
    host_user_id, title, description, event_type, styles, visibility, city, country,
    venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
  )
  select
    v_host_1, 'Bachata Friday Social', 'Friday night social with warm-up class and open floor.',
    'Social', array['bachata'], 'public', 'Miami', 'USA',
    'Ocean Motion Studio', '220 Ocean Drive, South Beach',
    now() + interval '1 day 20 hours', now() + interval '2 days 1 hour', 160, null, 'approved',
    jsonb_build_array(jsonb_build_object('label','Instagram','url','https://instagram.com','type','instagram')),
    'published'
  where not exists (
    select 1 from public.events e where e.host_user_id = v_host_1 and e.title = 'Bachata Friday Social'
  );

  insert into public.events (
    host_user_id, title, description, event_type, styles, visibility, city, country,
    venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
  )
  select
    v_host_2, 'Salsa Rooftop Session', 'Open-air salsa social with live percussion set.',
    'Social', array['salsa'], 'public', 'Madrid', 'Spain',
    'Azotea Central', '18 Calle Mayor, Sol',
    now() + interval '4 days', now() + interval '4 days 4 hours', 140, null, 'approved',
    '[]'::jsonb, 'published'
  where not exists (
    select 1 from public.events e where e.host_user_id = v_host_2 and e.title = 'Salsa Rooftop Session'
  );

  insert into public.events (
    host_user_id, title, description, event_type, styles, visibility, city, country,
    venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
  )
  select
    v_host_3, 'Kizomba Sunset Practice', 'Connection-focused kizomba practice session before social.',
    'Workshop', array['kizomba'], 'public', 'Lisbon', 'Portugal',
    'Tagus Flow Hall', '11 Rua das Flores, Chiado',
    now() + interval '7 days', now() + interval '7 days 3 hours', 90, null, 'approved',
    jsonb_build_array(jsonb_build_object('label','WhatsApp','url','https://wa.me/10000000000','type','whatsapp')),
    'published'
  where not exists (
    select 1 from public.events e where e.host_user_id = v_host_3 and e.title = 'Kizomba Sunset Practice'
  );

  insert into public.events (
    host_user_id, title, description, event_type, styles, visibility, city, country,
    venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
  )
  select
    v_host_1, 'Zouk Lab Open Class', 'Technique lab and guided social drills for all levels.',
    'Workshop', array['zouk'], 'public', 'Barcelona', 'Spain',
    'Studio Mar', '44 Carrer del Mar, El Born',
    now() + interval '10 days', now() + interval '10 days 2 hours', 70, null, 'approved',
    '[]'::jsonb, 'published'
  where not exists (
    select 1 from public.events e where e.host_user_id = v_host_1 and e.title = 'Zouk Lab Open Class'
  );

  insert into public.events (
    host_user_id, title, description, event_type, styles, visibility, city, country,
    venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
  )
  select
    v_host_2, 'ConXion Community Mixer', 'Host and member mixer night for local dance communities.',
    'Community', array['networking'], 'public', 'Berlin', 'Germany',
    'Neon District Hall', '79 Torstrasse, Mitte',
    now() + interval '12 days', now() + interval '12 days 3 hours', 120, null, 'approved',
    '[]'::jsonb, 'published'
  where not exists (
    select 1 from public.events e where e.host_user_id = v_host_2 and e.title = 'ConXion Community Mixer'
  );

  insert into public.events (
    host_user_id, title, description, event_type, styles, visibility, city, country,
    venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
  )
  select
    v_host_3, 'Afro-Latin Bootcamp Weekend', 'Two-day bootcamp with socials, drills, and coach feedback.',
    'Festival', array['salsa', 'bachata', 'kizomba'], 'public', 'Paris', 'France',
    'La Seine Dance Loft', '9 Quai de la Tournelle, Latin Quarter',
    now() + interval '16 days', now() + interval '16 days 9 hours', 220, null, 'approved',
    jsonb_build_array(jsonb_build_object('label','Tickets','url','https://example.com/bootcamp','type','tickets')),
    'published'
  where not exists (
    select 1 from public.events e where e.host_user_id = v_host_3 and e.title = 'Afro-Latin Bootcamp Weekend'
  );

  insert into public.events (
    host_user_id, title, description, event_type, styles, visibility, city, country,
    venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
  )
  select
    v_host_1, 'Ladies Styling Marathon', 'High-energy styling blocks with performance-focused coaching.',
    'Workshop', array['bachata', 'ladies_styling'], 'public', 'Tallinn', 'Estonia',
    'Kopli Arts Center', '25 Kopli Street, Põhja-Tallinn',
    now() + interval '19 days', now() + interval '19 days 4 hours', 110, null, 'approved',
    '[]'::jsonb, 'published'
  where not exists (
    select 1 from public.events e where e.host_user_id = v_host_1 and e.title = 'Ladies Styling Marathon'
  );

  insert into public.events (
    host_user_id, title, description, event_type, styles, visibility, city, country,
    venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
  )
  select
    v_host_2, 'Urban Social Marathon', 'Late-night urban social with rotating DJ teams and mini-shows.',
    'Social', array['urban_kiz', 'bachata'], 'public', 'Chicago', 'USA',
    'Pulse Warehouse', '300 West Loop Avenue, West Loop',
    now() + interval '22 days', now() + interval '22 days 5 hours', 260, null, 'approved',
    '[]'::jsonb, 'published'
  where not exists (
    select 1 from public.events e where e.host_user_id = v_host_2 and e.title = 'Urban Social Marathon'
  );

  insert into public.events (
    host_user_id, title, description, event_type, styles, visibility, city, country,
    venue_name, venue_address, starts_at, ends_at, capacity, cover_url, cover_status, links, status
  )
  select
    v_host_3, 'Valentine Bachata Flash Social', 'Pop-up social session with short demo and open floor.',
    'Social', array['bachata'], 'public', 'New York', 'USA',
    'Midtown Loft', '47 West 39th Street, Midtown',
    now() - interval '1 hour', now() + interval '3 hours', 120, null, 'approved',
    jsonb_build_array(jsonb_build_object('label','Facebook','url','https://facebook.com','type','facebook')),
    'published'
  where not exists (
    select 1 from public.events e where e.host_user_id = v_host_3 and e.title = 'Valentine Bachata Flash Social'
  );

  if v_event_1 is not null then
    insert into public.event_members (event_id, user_id, member_role, status)
    values
      (v_event_1, v_host_1, 'host', 'host'),
      (v_event_1, v_host_2, 'guest', 'going'),
      (v_event_1, v_host_3, 'guest', 'waitlist')
    on conflict (event_id, user_id)
    do update set
      status = excluded.status,
      member_role = excluded.member_role,
      updated_at = now();
  end if;

  if v_event_2 is not null then
    insert into public.event_members (event_id, user_id, member_role, status)
    values
      (v_event_2, v_host_2, 'host', 'host'),
      (v_event_2, v_host_1, 'guest', 'going')
    on conflict (event_id, user_id)
    do update set
      status = excluded.status,
      member_role = excluded.member_role,
      updated_at = now();
  end if;

  if v_event_3 is not null then
    insert into public.event_members (event_id, user_id, member_role, status)
    values
      (v_event_3, v_host_3, 'host', 'host')
    on conflict (event_id, user_id)
    do update set
      status = excluded.status,
      member_role = excluded.member_role,
      updated_at = now();
  end if;

  insert into public.event_members (event_id, user_id, member_role, status)
  select e.id, e.host_user_id, 'host', 'host'
  from public.events e
  where e.host_user_id in (v_host_1, v_host_2, v_host_3)
    and e.title in (
      'Bachata Friday Social',
      'Salsa Rooftop Session',
      'Kizomba Sunset Practice',
      'Zouk Lab Open Class',
      'ConXion Community Mixer',
      'Afro-Latin Bootcamp Weekend',
      'Ladies Styling Marathon',
      'Urban Social Marathon',
      'Valentine Bachata Flash Social'
    )
  on conflict (event_id, user_id)
  do update set
    status = excluded.status,
    member_role = excluded.member_role,
    updated_at = now();

  insert into public.event_members (event_id, user_id, member_role, status)
  select e.id, v_host_2, 'guest', 'going'
  from public.events e
  where e.host_user_id = v_host_1 and e.title = 'Bachata Friday Social'
  on conflict (event_id, user_id)
  do update set status = excluded.status, member_role = excluded.member_role, updated_at = now();

  insert into public.event_members (event_id, user_id, member_role, status)
  select e.id, v_host_3, 'guest', 'going'
  from public.events e
  where e.host_user_id = v_host_2 and e.title = 'Salsa Rooftop Session'
  on conflict (event_id, user_id)
  do update set status = excluded.status, member_role = excluded.member_role, updated_at = now();

  insert into public.event_members (event_id, user_id, member_role, status)
  select e.id, v_host_1, 'guest', 'going'
  from public.events e
  where e.host_user_id = v_host_3 and e.title = 'Kizomba Sunset Practice'
  on conflict (event_id, user_id)
  do update set status = excluded.status, member_role = excluded.member_role, updated_at = now();

  insert into public.event_members (event_id, user_id, member_role, status)
  select e.id, v_host_3, 'guest', 'waitlist'
  from public.events e
  where e.host_user_id = v_host_1 and e.title = 'Zouk Lab Open Class'
  on conflict (event_id, user_id)
  do update set status = excluded.status, member_role = excluded.member_role, updated_at = now();

  insert into public.event_members (event_id, user_id, member_role, status)
  select e.id, v_host_1, 'guest', 'going'
  from public.events e
  where e.host_user_id = v_host_2 and e.title = 'ConXion Community Mixer'
  on conflict (event_id, user_id)
  do update set status = excluded.status, member_role = excluded.member_role, updated_at = now();

  insert into public.event_members (event_id, user_id, member_role, status)
  select e.id, v_host_2, 'guest', 'going'
  from public.events e
  where e.host_user_id = v_host_3 and e.title = 'Afro-Latin Bootcamp Weekend'
  on conflict (event_id, user_id)
  do update set status = excluded.status, member_role = excluded.member_role, updated_at = now();
end $$;

commit;
