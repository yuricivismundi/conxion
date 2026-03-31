-- ConXion events: refresh sample upcoming events
-- Date: 2026-03-13
--
-- Purpose:
-- - Ensure there are visible upcoming public events in /events
-- - Refresh dates relative to now, so samples never expire
-- - Safe to rerun

begin;

do $$
declare
  v_hosts uuid[];
  v_h1 uuid;
  v_h2 uuid;
  v_h3 uuid;

  v_id uuid;
begin
  if to_regclass('public.events') is null or to_regclass('public.profiles') is null then
    raise notice 'events/profiles tables missing; skipping refresh seed.';
    return;
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
    raise notice 'no profiles found; skipping refresh seed.';
    return;
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
end $$;

commit;

