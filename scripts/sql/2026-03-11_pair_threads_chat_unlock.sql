-- ConXion Messaging Refactor: 1:1 pair threads + context-based chat unlock
-- Date: 2026-03-11
-- Safe to re-run.

begin;

create extension if not exists pgcrypto;

alter table public.threads add column if not exists direct_user_low uuid;
alter table public.threads add column if not exists direct_user_high uuid;
create unique index if not exists ux_threads_direct_pair
  on public.threads(direct_user_low, direct_user_high)
  where thread_type = 'direct'
    and direct_user_low is not null
    and direct_user_high is not null;

alter table public.thread_messages add column if not exists message_type text not null default 'text';

-- ------------------------------------------------------------------
-- 1) Always use direct pair thread for 1:1 contexts
-- ------------------------------------------------------------------
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
begin
  if p_user_a is null or p_user_b is null or p_user_a = p_user_b then
    raise exception 'invalid_pair';
  end if;

  v_low := least(p_user_a, p_user_b);
  v_high := greatest(p_user_a, p_user_b);

  -- Pair-level lock prevents duplicate direct threads under race conditions.
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

  insert into public.thread_participants (thread_id, user_id, role)
  values
    (v_thread_id, v_low, 'member'),
    (v_thread_id, v_high, 'member')
  on conflict (thread_id, user_id) do nothing;

  return v_thread_id;
end;
$function$;

grant execute on function public.cx_ensure_pair_thread(uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------------
-- 2) Event request sync also uses pair thread (not event thread) for 1:1
-- ------------------------------------------------------------------
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
  v_thread_id := public.cx_ensure_pair_thread(new.requester_id, v_owner, v_actor);

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

-- ------------------------------------------------------------------
-- 3) Migrate legacy connection threads into direct pair threads
-- ------------------------------------------------------------------
do $$
declare
  r record;
  v_direct_thread_id uuid;
begin
  for r in
    select t.id as thread_id, c.requester_id, c.target_id
    from public.threads t
    join public.connections c on c.id = t.connection_id
    where t.thread_type = 'connection'
  loop
    v_direct_thread_id := public.cx_ensure_pair_thread(r.requester_id, r.target_id, coalesce(r.requester_id, r.target_id));

    if v_direct_thread_id is distinct from r.thread_id then
      update public.thread_contexts
      set thread_id = v_direct_thread_id,
          updated_at = now()
      where thread_id = r.thread_id;

      update public.thread_messages
      set thread_id = v_direct_thread_id
      where thread_id = r.thread_id;

      insert into public.thread_participants (thread_id, user_id, role, joined_at, last_read_at, archived_at, muted_until, pinned_at)
      select
        v_direct_thread_id,
        tp.user_id,
        tp.role,
        coalesce(tp.joined_at, now()),
        tp.last_read_at,
        tp.archived_at,
        tp.muted_until,
        tp.pinned_at
      from public.thread_participants tp
      where tp.thread_id = r.thread_id
      on conflict (thread_id, user_id) do update
      set role = excluded.role,
          last_read_at = coalesce(public.thread_participants.last_read_at, excluded.last_read_at),
          archived_at = coalesce(public.thread_participants.archived_at, excluded.archived_at),
          muted_until = coalesce(public.thread_participants.muted_until, excluded.muted_until),
          pinned_at = coalesce(public.thread_participants.pinned_at, excluded.pinned_at);
    end if;
  end loop;
end $$;

-- Keep old connection/trip rows for compatibility; inbox uses direct pair threads.

-- ------------------------------------------------------------------
-- 4) Move existing event request contexts to pair threads
-- ------------------------------------------------------------------
do $$
declare
  r record;
  v_direct_thread_id uuid;
begin
  for r in
    select tc.id, tc.thread_id, tc.requester_id, tc.recipient_id
    from public.thread_contexts tc
    where tc.source_table = 'event_requests'
      and tc.requester_id is not null
      and tc.recipient_id is not null
  loop
    v_direct_thread_id := public.cx_ensure_pair_thread(r.requester_id, r.recipient_id, coalesce(r.requester_id, r.recipient_id));

    if v_direct_thread_id is distinct from r.thread_id then
      update public.thread_contexts
      set thread_id = v_direct_thread_id,
          updated_at = now()
      where id = r.id;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------
-- 5) Chat unlock guard: allowed only after accepted interaction context
-- ------------------------------------------------------------------
create or replace function public.cx_thread_chat_unlocked(
  p_thread_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_participant boolean := false;
  v_has_accepted_context boolean := false;
  v_has_blocked_connection boolean := false;
  v_has_text_history boolean := false;
begin
  if p_thread_id is null or p_user_id is null then
    return false;
  end if;

  select exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = p_user_id
  ) into v_participant;

  if not v_participant then
    return false;
  end if;

  select exists (
    select 1
    from public.thread_contexts tc
    join public.connections c
      on tc.source_table = 'connections'
     and tc.source_id = c.id
    where tc.thread_id = p_thread_id
      and (c.status = 'blocked' or c.blocked_by is not null)
  ) into v_has_blocked_connection;

  if v_has_blocked_connection then
    return false;
  end if;

  select exists (
    select 1
    from public.thread_contexts tc
    where tc.thread_id = p_thread_id
      and tc.context_tag in ('connection_request', 'trip_join_request', 'hosting_request', 'event_chat')
      and tc.status_tag in ('accepted', 'active')
  ) into v_has_accepted_context;

  if v_has_accepted_context then
    return true;
  end if;

  -- Legacy compatibility: if text history already exists in this thread,
  -- keep chat unlocked to avoid breaking historical conversations.
  select exists (
    select 1
    from public.thread_messages tm
    where tm.thread_id = p_thread_id
      and coalesce(tm.message_type, 'text') = 'text'
    limit 1
  ) into v_has_text_history;

  return v_has_text_history;
end;
$function$;

grant execute on function public.cx_thread_chat_unlocked(uuid, uuid) to authenticated;

create or replace function public.cx_enforce_thread_text_unlock()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if coalesce(new.message_type, 'text') <> 'text' then
    return new;
  end if;

  if not public.cx_thread_chat_unlocked(new.thread_id, auth.uid()) then
    raise exception 'chat_locked_until_accepted_request';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_thread_messages_chat_unlock on public.thread_messages;
create trigger trg_thread_messages_chat_unlock
before insert on public.thread_messages
for each row execute function public.cx_enforce_thread_text_unlock();

commit;
