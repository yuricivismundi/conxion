-- ConXion Unified Inbox: request contexts + 1:1 pair thread reuse
-- Date: 2026-03-09
-- Safe to re-run.

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- Threads: extend model for direct/event contexts
-- =========================================================

alter table public.threads add column if not exists event_id uuid;
alter table public.threads add column if not exists direct_user_low uuid;
alter table public.threads add column if not exists direct_user_high uuid;

do $$
begin
  if to_regclass('public.events') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'threads_event_fk'
         and conrelid = 'public.threads'::regclass
     ) then
    alter table public.threads
      add constraint threads_event_fk
      foreign key (event_id) references public.events(id) on delete cascade;
  end if;
end $$;

alter table public.threads drop constraint if exists threads_type_chk;
alter table public.threads
  add constraint threads_type_chk
  check (thread_type in ('connection', 'trip', 'direct', 'event')) not valid;

create unique index if not exists ux_threads_direct_pair
  on public.threads(direct_user_low, direct_user_high)
  where thread_type = 'direct'
    and direct_user_low is not null
    and direct_user_high is not null;

create unique index if not exists ux_threads_event
  on public.threads(event_id)
  where thread_type = 'event'
    and event_id is not null;

-- =========================================================
-- Thread messages: system/request metadata
-- =========================================================

alter table public.thread_messages add column if not exists message_type text not null default 'text';
alter table public.thread_messages add column if not exists context_tag text;
alter table public.thread_messages add column if not exists status_tag text;
alter table public.thread_messages add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'thread_messages_message_type_chk'
      and conrelid = 'public.thread_messages'::regclass
  ) then
    alter table public.thread_messages
      add constraint thread_messages_message_type_chk
      check (message_type in ('text', 'system', 'request'));
  end if;
end $$;

-- =========================================================
-- Thread contexts (pinned request cards + history)
-- =========================================================

create table if not exists public.thread_contexts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  source_table text not null,
  source_id uuid not null,
  context_tag text not null,
  status_tag text not null,
  title text,
  city text,
  start_date date,
  end_date date,
  requester_id uuid,
  recipient_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  is_pinned boolean not null default true,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_table, source_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'thread_contexts_context_tag_chk'
      and conrelid = 'public.thread_contexts'::regclass
  ) then
    alter table public.thread_contexts
      add constraint thread_contexts_context_tag_chk
      check (context_tag in ('connection_request', 'hosting_request', 'trip_join_request', 'event_chat', 'regular_chat'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'thread_contexts_status_tag_chk'
      and conrelid = 'public.thread_contexts'::regclass
  ) then
    alter table public.thread_contexts
      add constraint thread_contexts_status_tag_chk
      check (status_tag in ('pending', 'accepted', 'declined', 'cancelled', 'active'));
  end if;
end $$;

create index if not exists idx_thread_contexts_thread_updated
  on public.thread_contexts(thread_id, updated_at desc);
create index if not exists idx_thread_contexts_thread_pending
  on public.thread_contexts(thread_id, status_tag, is_pinned);
create index if not exists idx_thread_contexts_requester
  on public.thread_contexts(requester_id, updated_at desc);
create index if not exists idx_thread_contexts_recipient
  on public.thread_contexts(recipient_id, updated_at desc);

drop trigger if exists trg_thread_contexts_set_updated_at on public.thread_contexts;
create trigger trg_thread_contexts_set_updated_at
before update on public.thread_contexts
for each row execute function public.set_updated_at_ts();

alter table public.thread_contexts enable row level security;

drop policy if exists thread_contexts_select_participants on public.thread_contexts;
create policy thread_contexts_select_participants
on public.thread_contexts for select
to authenticated
using (
  exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = thread_contexts.thread_id
      and tp.user_id = auth.uid()
  )
);

drop policy if exists thread_contexts_insert_none on public.thread_contexts;
create policy thread_contexts_insert_none
on public.thread_contexts for insert
to authenticated
with check (false);

drop policy if exists thread_contexts_update_none on public.thread_contexts;
create policy thread_contexts_update_none
on public.thread_contexts for update
to authenticated
using (false)
with check (false);

drop policy if exists thread_contexts_delete_none on public.thread_contexts;
create policy thread_contexts_delete_none
on public.thread_contexts for delete
to authenticated
using (false);

-- =========================================================
-- Helper functions
-- =========================================================

create or replace function public.cx_ensure_pair_thread(
  p_user_a uuid,
  p_user_b uuid,
  p_actor uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_low uuid;
  v_high uuid;
  v_thread_id uuid;
  v_conn_thread_id uuid;
begin
  if p_user_a is null or p_user_b is null or p_user_a = p_user_b then
    raise exception 'invalid_pair';
  end if;

  v_low := least(p_user_a, p_user_b);
  v_high := greatest(p_user_a, p_user_b);

  select t.id
    into v_conn_thread_id
  from public.threads t
  join public.connections c on c.id = t.connection_id
  where t.thread_type = 'connection'
    and (
      (c.requester_id = v_low and c.target_id = v_high)
      or (c.requester_id = v_high and c.target_id = v_low)
    )
  order by case when c.status = 'accepted' then 0 else 1 end, c.created_at desc
  limit 1;

  if v_conn_thread_id is not null then
    v_thread_id := v_conn_thread_id;
  else
    -- Avoid ON CONFLICT inference issues with partial indexes by locking pair key.
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
  end if;

  insert into public.thread_participants (thread_id, user_id, role)
  values
    (v_thread_id, v_low, 'member'),
    (v_thread_id, v_high, 'member')
  on conflict (thread_id, user_id) do nothing;

  return v_thread_id;
end;
$function$;

grant execute on function public.cx_ensure_pair_thread(uuid, uuid, uuid) to authenticated;

create or replace function public.cx_ensure_event_thread(
  p_event_id uuid,
  p_actor uuid default auth.uid(),
  p_requester uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

grant execute on function public.cx_ensure_event_thread(uuid, uuid, uuid) to authenticated;

create or replace function public.cx_emit_thread_event(
  p_thread_id uuid,
  p_sender_id uuid,
  p_body text,
  p_message_type text default 'system',
  p_context_tag text default null,
  p_status_tag text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

grant execute on function public.cx_emit_thread_event(uuid, uuid, text, text, text, text, jsonb) to authenticated;

create or replace function public.cx_upsert_thread_context(
  p_thread_id uuid,
  p_source_table text,
  p_source_id uuid,
  p_context_tag text,
  p_status_tag text,
  p_title text default null,
  p_city text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_requester_id uuid default null,
  p_recipient_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
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
  if p_context_tag not in ('connection_request', 'hosting_request', 'trip_join_request', 'event_chat', 'regular_chat') then
    raise exception 'invalid_context_tag';
  end if;
  if v_status not in ('pending', 'accepted', 'declined', 'cancelled', 'active') then
    raise exception 'invalid_status_tag';
  end if;

  insert into public.thread_contexts (
    thread_id,
    source_table,
    source_id,
    context_tag,
    status_tag,
    title,
    city,
    start_date,
    end_date,
    requester_id,
    recipient_id,
    metadata,
    is_pinned,
    resolved_at
  )
  values (
    p_thread_id,
    trim(p_source_table),
    p_source_id,
    p_context_tag,
    v_status,
    nullif(trim(coalesce(p_title, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    p_start_date,
    p_end_date,
    p_requester_id,
    p_recipient_id,
    coalesce(p_metadata, '{}'::jsonb),
    v_status = 'pending',
    case when v_status = 'pending' then null else now() end
  )
  on conflict (source_table, source_id)
  do update set
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
    resolved_at = case when excluded.status_tag = 'pending' then null else now() end,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$function$;

grant execute on function public.cx_upsert_thread_context(uuid, text, uuid, text, text, text, text, date, date, uuid, uuid, jsonb) to authenticated;

-- =========================================================
-- Request sync triggers
-- =========================================================

create or replace function public.cx_sync_connections_to_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_thread_id uuid;
  v_status text;
  v_body text;
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

  if tg_op = 'INSERT' then
    v_body := 'Connection request sent.';
  elsif tg_op = 'DELETE' then
    v_body := 'Connection request cancelled.';
  elsif coalesce(old.status::text, '') is distinct from coalesce(new.status::text, '') then
    v_body := case lower(trim(coalesce(new.status::text, '')))
      when 'accepted' then 'Connection request accepted.'
      when 'declined' then 'Connection request declined.'
      when 'cancelled' then 'Connection request cancelled.'
      when 'blocked' then 'Connection was blocked.'
      else 'Connection request updated.'
    end;
  else
    return null;
  end if;

  perform public.cx_emit_thread_event(
    p_thread_id => v_thread_id,
    p_sender_id => v_actor,
    p_body => v_body,
    p_message_type => 'request',
    p_context_tag => 'connection_request',
    p_status_tag => case when v_status in ('pending', 'accepted', 'declined', 'cancelled') then v_status else 'active' end,
    p_metadata => jsonb_build_object('connection_id', v_source_id)
  );

  return null;
end;
$function$;

drop trigger if exists trg_connections_unified_thread_ins_upd on public.connections;
create trigger trg_connections_unified_thread_ins_upd
after insert or update on public.connections
for each row execute function public.cx_sync_connections_to_thread();

drop trigger if exists trg_connections_unified_thread_del on public.connections;
create trigger trg_connections_unified_thread_del
after delete on public.connections
for each row execute function public.cx_sync_connections_to_thread();

create or replace function public.cx_sync_trip_requests_to_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_trip_owner uuid;
  v_city text;
  v_country text;
  v_thread_id uuid;
  v_status text;
  v_actor uuid;
  v_body text;
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
    p_metadata => jsonb_build_object('trip_id', new.trip_id, 'request_id', new.id)
  );

  if tg_op = 'INSERT' then
    v_body := 'Trip join request sent.';
  elsif coalesce(old.status::text, '') is distinct from coalesce(new.status::text, '') then
    v_body := case v_status
      when 'accepted' then 'Trip join request accepted.'
      when 'declined' then 'Trip join request declined.'
      when 'cancelled' then 'Trip join request cancelled.'
      else 'Trip join request updated.'
    end;
  else
    return null;
  end if;

  perform public.cx_emit_thread_event(
    p_thread_id => v_thread_id,
    p_sender_id => v_actor,
    p_body => v_body,
    p_message_type => 'request',
    p_context_tag => 'trip_join_request',
    p_status_tag => case when v_status in ('pending', 'accepted', 'declined', 'cancelled') then v_status else 'active' end,
    p_metadata => jsonb_build_object('trip_id', new.trip_id, 'request_id', new.id)
  );

  return null;
end;
$function$;

drop trigger if exists trg_trip_requests_unified_thread on public.trip_requests;
create trigger trg_trip_requests_unified_thread
after insert or update on public.trip_requests
for each row execute function public.cx_sync_trip_requests_to_thread();

create or replace function public.cx_sync_hosting_requests_to_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_thread_id uuid;
  v_status text;
  v_actor uuid;
  v_body text;
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
    p_metadata => jsonb_build_object(
      'hosting_request_id', new.id,
      'request_type', new.request_type,
      'trip_id', new.trip_id,
      'travellers_count', new.travellers_count,
      'max_travellers_allowed', new.max_travellers_allowed
    )
  );

  if tg_op = 'INSERT' then
    v_body := case when new.request_type = 'offer_to_host' then 'Host offer sent.' else 'Hosting request sent.' end;
  elsif coalesce(old.status::text, '') is distinct from coalesce(new.status::text, '') then
    v_body := case v_status
      when 'accepted' then 'Hosting request accepted.'
      when 'declined' then 'Hosting request declined.'
      when 'cancelled' then 'Hosting request cancelled.'
      else 'Hosting request updated.'
    end;
  else
    return null;
  end if;

  perform public.cx_emit_thread_event(
    p_thread_id => v_thread_id,
    p_sender_id => v_actor,
    p_body => v_body,
    p_message_type => 'request',
    p_context_tag => 'hosting_request',
    p_status_tag => case when v_status in ('pending', 'accepted', 'declined', 'cancelled') then v_status else 'active' end,
    p_metadata => jsonb_build_object('hosting_request_id', new.id, 'request_type', new.request_type)
  );

  return null;
end;
$function$;

do $$
begin
  if to_regclass('public.hosting_requests') is not null then
    execute 'drop trigger if exists trg_hosting_requests_unified_thread on public.hosting_requests';
    execute 'create trigger trg_hosting_requests_unified_thread after insert or update on public.hosting_requests for each row execute function public.cx_sync_hosting_requests_to_thread()';
  end if;
end $$;

create or replace function public.cx_sync_event_requests_to_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_owner uuid;
  v_title text;
  v_city text;
  v_start timestamptz;
  v_thread_id uuid;
  v_status text;
  v_actor uuid;
  v_body text;
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

  if tg_op = 'INSERT' then
    v_body := 'Event access request sent.';
  elsif coalesce(old.status::text, '') is distinct from coalesce(new.status::text, '') then
    v_body := case v_status
      when 'accepted' then 'Event access request accepted.'
      when 'declined' then 'Event access request declined.'
      when 'cancelled' then 'Event access request cancelled.'
      else 'Event request updated.'
    end;
  else
    return null;
  end if;

  perform public.cx_emit_thread_event(
    p_thread_id => v_thread_id,
    p_sender_id => v_actor,
    p_body => v_body,
    p_message_type => 'request',
    p_context_tag => 'event_chat',
    p_status_tag => case when v_status in ('pending', 'accepted', 'declined', 'cancelled') then v_status else 'active' end,
    p_metadata => jsonb_build_object('event_id', new.event_id, 'event_request_id', new.id)
  );

  return null;
end;
$function$;

do $$
begin
  if to_regclass('public.event_requests') is not null then
    execute 'drop trigger if exists trg_event_requests_unified_thread on public.event_requests';
    execute 'create trigger trg_event_requests_unified_thread after insert or update on public.event_requests for each row execute function public.cx_sync_event_requests_to_thread()';
  end if;
end $$;

-- =========================================================
-- Backfill existing request rows into unified thread contexts
-- =========================================================

do $$
declare
  r record;
  v_thread_id uuid;
begin
  -- connections
  for r in
    select c.id, c.requester_id, c.target_id, c.status, c.connect_context, c.trip_id
    from public.connections c
  loop
    v_thread_id := public.cx_ensure_pair_thread(r.requester_id, r.target_id, coalesce(r.requester_id, r.target_id));
    perform public.cx_upsert_thread_context(
      p_thread_id => v_thread_id,
      p_source_table => 'connections',
      p_source_id => r.id,
      p_context_tag => 'connection_request',
      p_status_tag => case when lower(trim(coalesce(r.status::text, ''))) in ('pending', 'accepted', 'declined', 'cancelled') then lower(trim(coalesce(r.status::text, ''))) else 'active' end,
      p_title => 'Connection request',
      p_city => null,
      p_start_date => null,
      p_end_date => null,
      p_requester_id => r.requester_id,
      p_recipient_id => r.target_id,
      p_metadata => jsonb_build_object('connection_id', r.id, 'connect_context', r.connect_context, 'trip_id', r.trip_id)
    );
  end loop;

  -- trip requests
  for r in
    select tr.id, tr.trip_id, tr.requester_id, tr.status, t.user_id as owner_id, t.destination_city, t.destination_country
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
  loop
    v_thread_id := public.cx_ensure_pair_thread(r.requester_id, r.owner_id, coalesce(r.requester_id, r.owner_id));
    perform public.cx_upsert_thread_context(
      p_thread_id => v_thread_id,
      p_source_table => 'trip_requests',
      p_source_id => r.id,
      p_context_tag => 'trip_join_request',
      p_status_tag => case when lower(trim(coalesce(r.status::text, ''))) in ('pending', 'accepted', 'declined', 'cancelled') then lower(trim(coalesce(r.status::text, ''))) else 'active' end,
      p_title => 'Trip join request',
      p_city => concat_ws(', ', nullif(trim(coalesce(r.destination_city, '')), ''), nullif(trim(coalesce(r.destination_country, '')), '')),
      p_start_date => null,
      p_end_date => null,
      p_requester_id => r.requester_id,
      p_recipient_id => r.owner_id,
      p_metadata => jsonb_build_object('trip_id', r.trip_id, 'request_id', r.id)
    );
  end loop;

  if to_regclass('public.hosting_requests') is not null then
    for r in
      select hr.id, hr.sender_user_id, hr.recipient_user_id, hr.status, hr.request_type, hr.trip_id, hr.arrival_date, hr.departure_date, hr.travellers_count, hr.max_travellers_allowed
      from public.hosting_requests hr
    loop
      v_thread_id := public.cx_ensure_pair_thread(r.sender_user_id, r.recipient_user_id, coalesce(r.sender_user_id, r.recipient_user_id));
      perform public.cx_upsert_thread_context(
        p_thread_id => v_thread_id,
        p_source_table => 'hosting_requests',
        p_source_id => r.id,
        p_context_tag => 'hosting_request',
        p_status_tag => case when lower(trim(coalesce(r.status::text, ''))) in ('pending', 'accepted', 'declined', 'cancelled') then lower(trim(coalesce(r.status::text, ''))) else 'active' end,
        p_title => case when r.request_type = 'offer_to_host' then 'Offer to host' else 'Hosting request' end,
        p_city => null,
        p_start_date => r.arrival_date,
        p_end_date => r.departure_date,
        p_requester_id => r.sender_user_id,
        p_recipient_id => r.recipient_user_id,
        p_metadata => jsonb_build_object(
          'hosting_request_id', r.id,
          'request_type', r.request_type,
          'trip_id', r.trip_id,
          'travellers_count', r.travellers_count,
          'max_travellers_allowed', r.max_travellers_allowed
        )
      );
    end loop;
  end if;

  if to_regclass('public.event_requests') is not null and to_regclass('public.events') is not null then
    for r in
      select
        er.id,
        er.event_id,
        er.requester_id,
        er.status,
        coalesce(
          (to_jsonb(e) ->> 'user_id')::uuid,
          (to_jsonb(e) ->> 'host_user_id')::uuid,
          (to_jsonb(e) ->> 'created_by')::uuid
        ) as owner_id,
        e.title,
        e.city,
        e.starts_at
      from public.event_requests er
      join public.events e on e.id = er.event_id
    loop
      if r.owner_id is null then
        continue;
      end if;
      v_thread_id := public.cx_ensure_event_thread(r.event_id, coalesce(r.requester_id, r.owner_id), r.requester_id);
      perform public.cx_upsert_thread_context(
        p_thread_id => v_thread_id,
        p_source_table => 'event_requests',
        p_source_id => r.id,
        p_context_tag => 'event_chat',
        p_status_tag => case when lower(trim(coalesce(r.status::text, ''))) in ('pending', 'accepted', 'declined', 'cancelled') then lower(trim(coalesce(r.status::text, ''))) else 'active' end,
        p_title => coalesce(r.title, 'Event chat'),
        p_city => nullif(trim(coalesce(r.city, '')), ''),
        p_start_date => case when r.starts_at is null then null else r.starts_at::date end,
        p_end_date => null,
        p_requester_id => r.requester_id,
        p_recipient_id => r.owner_id,
        p_metadata => jsonb_build_object('event_id', r.event_id, 'event_request_id', r.id)
      );
    end loop;
  end if;
end $$;

commit;
