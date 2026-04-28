-- Seed: make yuri's connections attend existing published events
-- so the "Events your connections are attending" feature can be tested.
-- Safe to rerun: uses ON CONFLICT DO NOTHING and a seed tag for cleanup.

begin;

do $$
declare
  v_yuri_id   uuid;
  v_conn      record;
  v_event     record;
  v_i         int := 0;
  v_events    uuid[];
  v_conns     uuid[];
begin
  set local session_replication_role = replica;

  -- Lookup yuri
  select user_id into v_yuri_id
  from public.profiles
  where lower(coalesce(username, '')) = 'yuri.bucio1'
  limit 1;

  if v_yuri_id is null then
    raise exception 'User yuri.bucio1 not found in profiles.';
  end if;

  -- Collect up to 6 published events that yuri is NOT already a member of
  select array_agg(id order by starts_at asc)
  into v_events
  from (
    select e.id, e.starts_at
    from public.events e
    where e.status = 'published'
      and e.event_access_type = 'public'
      and not exists (
        select 1 from public.event_members em
        where em.event_id = e.id and em.user_id = v_yuri_id
      )
    order by starts_at asc
    limit 6
  ) sub;

  if v_events is null or array_length(v_events, 1) = 0 then
    raise exception 'No published public events found. Make sure events have been seeded first.';
  end if;

  -- Collect yuri's accepted connections (both directions)
  select array_agg(
    case when c.requester_id = v_yuri_id then c.target_id else c.requester_id end
    order by c.created_at asc
  )
  into v_conns
  from public.connections c
  where c.status = 'accepted'
    and (c.requester_id = v_yuri_id or c.target_id = v_yuri_id);

  if v_conns is null or array_length(v_conns, 1) = 0 then
    raise exception 'No accepted connections found for yuri.bucio1. Run the hosting seed first.';
  end if;

  raise notice 'Found % events and % connections', array_length(v_events,1), array_length(v_conns,1);

  -- Add each connection as 'going' to events in a round-robin pattern
  for v_i in 1..array_length(v_conns, 1) loop
    declare
      v_event_id uuid := v_events[ ((v_i - 1) % array_length(v_events, 1)) + 1 ];
      v_user_id  uuid := v_conns[v_i];
    begin
      insert into public.event_members (
        id, event_id, user_id, member_role, status, joined_at, created_at, updated_at
      ) values (
        gen_random_uuid(),
        v_event_id,
        v_user_id,
        'guest',
        'going',
        now() - (v_i || ' hours')::interval,
        now() - (v_i || ' hours')::interval,
        now() - (v_i || ' hours')::interval
      )
      on conflict (event_id, user_id) do update
        set status = 'going', updated_at = now();

      raise notice 'Added connection % to event %', v_user_id, v_event_id;
    end;
  end loop;

  raise notice 'Done — % connection(s) added to events.', array_length(v_conns, 1);
end;
$$;

commit;
