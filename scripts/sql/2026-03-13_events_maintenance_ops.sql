-- ConXion events maintenance operations
-- Date: 2026-03-13
--
-- Adds:
-- 1) public.cx_seed_upcoming_public_events()         -- idempotent sample reseed helper
-- 2) public.cx_events_health_snapshot()              -- feed health counters
-- 3) public.cx_run_events_maintenance(...)           -- archive/prune + optional reseed
--
-- Prerequisite:
-- - scripts/sql/2026-03-12_events_archive_retention.sql

begin;

create or replace function public.cx_seed_upcoming_public_events()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

revoke all on function public.cx_seed_upcoming_public_events() from public;
grant execute on function public.cx_seed_upcoming_public_events() to service_role;

create or replace function public.cx_events_health_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

revoke all on function public.cx_events_health_snapshot() from public;
grant execute on function public.cx_events_health_snapshot() to service_role;

create or replace function public.cx_run_events_maintenance(
  p_archive_after_days integer default 0,
  p_delete_after_days integer default 30,
  p_keep_archive_days integer default 30,
  p_batch integer default 1000,
  p_seed_if_empty boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

revoke all on function public.cx_run_events_maintenance(integer, integer, integer, integer, boolean) from public;
grant execute on function public.cx_run_events_maintenance(integer, integer, integer, integer, boolean) to service_role;

commit;

create or replace function public.cx_schedule_events_maintenance_daily(
  p_hour integer default 3,
  p_minute integer default 15
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

revoke all on function public.cx_schedule_events_maintenance_daily(integer, integer) from public;
grant execute on function public.cx_schedule_events_maintenance_daily(integer, integer) to service_role;
