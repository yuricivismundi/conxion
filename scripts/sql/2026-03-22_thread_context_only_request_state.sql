begin;

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
  if p_context_tag not in ('connection_request', 'hosting_request', 'trip_join_request', 'event_chat', 'regular_chat', 'activity') then
    raise exception 'invalid_context_tag';
  end if;
  if v_status not in ('pending', 'accepted', 'declined', 'cancelled', 'active', 'completed') then
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

  update public.threads
     set last_message_at = now(),
         updated_at = now()
   where id = p_thread_id;

  return v_id;
end;
$function$;

grant execute on function public.cx_upsert_thread_context(uuid, text, uuid, text, text, text, text, date, date, uuid, uuid, jsonb) to authenticated;

create or replace function public.cx_sync_connections_to_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_thread_id uuid;
  v_status text;
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

  return null;
end;
$function$;

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

  return null;
end;
$function$;

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

  return null;
end;
$function$;

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

  return null;
end;
$function$;

create or replace function public.cx_sync_activities()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_completed_count int := 0;
  v_prompt_count int := 0;
  v_context_tag text;
  v_conn_id uuid;
  v_due_at timestamptz;
  v_remind_after timestamptz;
  v_expires_at timestamptz;
  r record;
  v_inserted int := 0;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  for r in
    update public.activities a
    set status = 'completed',
        completed_at = coalesce(a.completed_at, now()),
        resolved_at = coalesce(a.resolved_at, now()),
        updated_at = now()
    where a.status = 'accepted'
      and (a.requester_id = v_me or a.recipient_id = v_me)
      and (
        case
          when coalesce(a.end_at, a.start_at) is not null then coalesce(a.end_at, a.start_at) + interval '24 hours'
          when a.accepted_at is not null then a.accepted_at + interval '24 hours'
          else null
        end
      ) <= now()
    returning a.*
  loop
    v_completed_count := v_completed_count + 1;

    perform public.cx_upsert_thread_context(
      p_thread_id => r.thread_id,
      p_source_table => 'activities',
      p_source_id => r.id,
      p_context_tag => 'activity',
      p_status_tag => 'completed',
      p_title => coalesce(nullif(trim(coalesce(r.title, '')), ''), public.cx_activity_type_label(r.activity_type)),
      p_city => null,
      p_start_date => case when r.start_at is null then null else (r.start_at at time zone 'UTC')::date end,
      p_end_date => case when coalesce(r.end_at, r.start_at) is null then null else (coalesce(r.end_at, r.start_at) at time zone 'UTC')::date end,
      p_requester_id => r.requester_id,
      p_recipient_id => r.recipient_id,
      p_metadata => coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
        'activity_type', r.activity_type,
        'activity_id', r.id,
        'title', coalesce(nullif(trim(coalesce(r.title, '')), ''), public.cx_activity_type_label(r.activity_type))
      )
    );

    v_context_tag := public.cx_activity_reference_context(r.activity_type);
    v_due_at := coalesce(r.completed_at, now());
    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '7 days';

    select c.id
      into v_conn_id
    from public.connections c
    where coalesce(c.status::text, '') = 'accepted'
      and c.blocked_by is null
      and (
        (c.requester_id = r.requester_id and c.target_id = r.recipient_id)
        or (c.requester_id = r.recipient_id and c.target_id = r.requester_id)
      )
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    insert into public.reference_requests (
      user_id,
      peer_user_id,
      context_tag,
      source_table,
      source_id,
      connection_id,
      due_at,
      remind_after,
      expires_at,
      status
    )
    values
      (r.requester_id, r.recipient_id, v_context_tag, 'activities', r.id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending'),
      (r.recipient_id, r.requester_id, v_context_tag, 'activities', r.id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending')
    on conflict (user_id, source_table, source_id, context_tag) do nothing;

    get diagnostics v_inserted = row_count;
    v_prompt_count := v_prompt_count + v_inserted;
  end loop;

  return jsonb_build_object(
    'completed', v_completed_count,
    'reference_prompts_created', v_prompt_count
  );
end;
$function$;

grant execute on function public.cx_sync_activities() to authenticated;

delete from public.thread_messages
where coalesce(message_type, 'text') <> 'text';

with canonical_connection as (
  select distinct on (thread_id)
    id,
    thread_id
  from public.thread_contexts
  where context_tag = 'connection_request'
  order by
    thread_id,
    case
      when status_tag in ('accepted', 'active') then 3
      when status_tag = 'pending' then 2
      else 1
    end desc,
    updated_at desc,
    created_at desc,
    id desc
)
delete from public.thread_contexts tc
using canonical_connection cc
where tc.thread_id = cc.thread_id
  and tc.context_tag = 'connection_request'
  and tc.id <> cc.id;

commit;
