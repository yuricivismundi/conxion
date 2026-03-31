begin;

create table if not exists public.user_messaging_plans (
  user_id uuid primary key,
  plan text not null default 'free',
  monthly_activation_limit integer,
  concurrent_active_limit integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_messaging_plans_plan_chk check (plan in ('free', 'premium'))
);

create table if not exists public.user_messaging_cycles (
  user_id uuid not null,
  cycle_start date not null,
  cycle_end date not null,
  plan text not null,
  monthly_activation_limit integer not null,
  monthly_activations_used integer not null default 0,
  concurrent_active_limit integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, cycle_start),
  constraint user_messaging_cycles_plan_chk check (plan in ('free', 'premium'))
);

create table if not exists public.thread_status_history (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  participant_user_id uuid,
  actor_user_id uuid,
  context_type text not null,
  event_type text not null,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.thread_participants
  add column if not exists messaging_state text not null default 'inactive';
alter table public.thread_participants
  add column if not exists activated_at timestamptz;
alter table public.thread_participants
  add column if not exists activation_cycle_start date;
alter table public.thread_participants
  add column if not exists activation_cycle_end date;
alter table public.thread_participants
  add column if not exists state_changed_at timestamptz not null default now();

alter table public.thread_contexts drop constraint if exists thread_contexts_status_tag_chk;
alter table public.thread_contexts
  add constraint thread_contexts_status_tag_chk
  check (status_tag in ('pending', 'accepted', 'declined', 'cancelled', 'active', 'completed', 'expired')) not valid;

alter table public.thread_participants drop constraint if exists thread_participants_messaging_state_chk;
alter table public.thread_participants
  add constraint thread_participants_messaging_state_chk
  check (messaging_state in ('inactive', 'active', 'archived')) not valid;

create index if not exists idx_thread_participants_user_messaging_state on public.thread_participants(user_id, messaging_state, archived_at);
create index if not exists idx_thread_contexts_pending_expiry on public.thread_contexts(status_tag, created_at);
create index if not exists idx_thread_status_history_thread_created on public.thread_status_history(thread_id, created_at desc);
create index if not exists idx_user_messaging_cycles_user_start on public.user_messaging_cycles(user_id, cycle_start desc);

create or replace function public.cx_log_thread_status(
  p_thread_id uuid,
  p_participant_user_id uuid,
  p_actor_user_id uuid,
  p_context_type text,
  p_event_type text,
  p_from_status text default null,
  p_to_status text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id uuid;
begin
  if p_thread_id is null then
    raise exception 'thread_required';
  end if;
  if trim(coalesce(p_context_type, '')) = '' then
    raise exception 'context_type_required';
  end if;
  if trim(coalesce(p_event_type, '')) = '' then
    raise exception 'event_type_required';
  end if;

  insert into public.thread_status_history (
    thread_id,
    participant_user_id,
    actor_user_id,
    context_type,
    event_type,
    from_status,
    to_status,
    metadata
  )
  values (
    p_thread_id,
    p_participant_user_id,
    p_actor_user_id,
    trim(p_context_type),
    trim(p_event_type),
    nullif(trim(coalesce(p_from_status, '')), ''),
    nullif(trim(coalesce(p_to_status, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$function$;

grant execute on function public.cx_log_thread_status(uuid, uuid, uuid, text, text, text, text, jsonb) to authenticated;

create or replace function public.cx_messaging_cycle_bounds(p_at timestamptz default now())
returns table(cycle_start date, cycle_end date)
language sql
stable
as $function$
  select
    date_trunc('month', p_at)::date as cycle_start,
    (date_trunc('month', p_at) + interval '1 month - 1 day')::date as cycle_end
$function$;

grant execute on function public.cx_messaging_cycle_bounds(timestamptz) to authenticated;

create or replace function public.cx_ensure_user_messaging_cycle(p_user_id uuid, p_at timestamptz default now())
returns public.user_messaging_cycles
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cycle_start date;
  v_cycle_end date;
  v_plan text := 'free';
  v_monthly_limit integer := 10;
  v_concurrent_limit integer := 10;
  v_row public.user_messaging_cycles%rowtype;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;

  select cycle_start, cycle_end
    into v_cycle_start, v_cycle_end
  from public.cx_messaging_cycle_bounds(p_at);

  select
    coalesce(plan, 'free'),
    case
      when coalesce(plan, 'free') = 'premium' then coalesce(monthly_activation_limit, 1000000)
      else coalesce(monthly_activation_limit, 10)
    end,
    case
      when coalesce(plan, 'free') = 'premium' then coalesce(concurrent_active_limit, 1000000)
      else coalesce(concurrent_active_limit, 10)
    end
  into v_plan, v_monthly_limit, v_concurrent_limit
  from public.user_messaging_plans
  where user_id = p_user_id;

  insert into public.user_messaging_cycles (
    user_id,
    cycle_start,
    cycle_end,
    plan,
    monthly_activation_limit,
    concurrent_active_limit
  )
  values (
    p_user_id,
    v_cycle_start,
    v_cycle_end,
    v_plan,
    v_monthly_limit,
    v_concurrent_limit
  )
  on conflict (user_id, cycle_start)
  do update set
    cycle_end = excluded.cycle_end,
    plan = excluded.plan,
    monthly_activation_limit = excluded.monthly_activation_limit,
    concurrent_active_limit = excluded.concurrent_active_limit,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$function$;

grant execute on function public.cx_ensure_user_messaging_cycle(uuid, timestamptz) to authenticated;

create or replace function public.cx_count_user_active_threads(p_user_id uuid)
returns integer
language sql
stable
as $function$
  select count(*)::integer
  from public.thread_participants tp
  where tp.user_id = p_user_id
    and coalesce(tp.messaging_state, 'inactive') = 'active'
    and tp.archived_at is null
$function$;

grant execute on function public.cx_count_user_active_threads(uuid) to authenticated;

create or replace function public.cx_thread_message_unlocked(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
as $function$
  select exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = p_user_id
  ) and (
    exists (
      select 1
      from public.thread_contexts tc
      where tc.thread_id = p_thread_id
        and tc.context_tag in ('connection_request', 'trip_join_request', 'hosting_request', 'event_chat', 'activity')
        and tc.status_tag in ('accepted', 'active', 'completed')
    )
    or exists (
      select 1
      from public.threads t
      join public.connections c on c.id = t.connection_id
      where t.id = p_thread_id
        and (c.requester_id = p_user_id or c.target_id = p_user_id)
        and c.status = 'accepted'
        and c.blocked_by is null
    )
    or exists (
      select 1
      from public.thread_messages tm
      where tm.thread_id = p_thread_id
        and coalesce(tm.message_type, 'text') = 'text'
    )
  )
$function$;

grant execute on function public.cx_thread_message_unlocked(uuid, uuid) to authenticated;

create or replace function public.cx_run_messaging_housekeeping(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_expired_count integer := 0;
  v_archived_count integer := 0;
  v_now timestamptz := now();
  v_row record;
  v_participant_id uuid;
begin
  for v_row in
    update public.thread_contexts tc
       set status_tag = 'expired',
           is_pinned = false,
           resolved_at = v_now,
           updated_at = v_now,
           metadata = coalesce(tc.metadata, '{}'::jsonb) || jsonb_build_object('expired_at', v_now)
     where tc.status_tag = 'pending'
       and coalesce(tc.created_at, tc.updated_at, v_now) <= v_now - interval '14 days'
       and (
         p_user_id is null
         or tc.requester_id = p_user_id
         or tc.recipient_id = p_user_id
       )
    returning tc.thread_id, tc.id, tc.context_tag, tc.requester_id, tc.recipient_id
  loop
    v_expired_count := v_expired_count + 1;

    for v_participant_id in
      select distinct u.participant_id
      from (
        select v_row.requester_id as participant_id
        union all
        select v_row.recipient_id as participant_id
      ) as u
      where u.participant_id is not null
    loop
      perform public.cx_log_thread_status(
        p_thread_id => v_row.thread_id,
        p_participant_user_id => v_participant_id,
        p_actor_user_id => null,
        p_context_type => v_row.context_tag,
        p_event_type => 'request_expired',
        p_from_status => 'pending',
        p_to_status => 'expired',
        p_metadata => jsonb_build_object('thread_context_id', v_row.id)
      );
    end loop;
  end loop;

  for v_row in
    update public.thread_participants tp
       set messaging_state = 'archived',
           archived_at = coalesce(tp.archived_at, v_now),
           state_changed_at = v_now
      from public.threads t
     where tp.thread_id = t.id
       and coalesce(tp.messaging_state, 'inactive') = 'active'
       and coalesce(t.last_message_at, t.updated_at, t.created_at, v_now) <= v_now - interval '45 days'
       and (p_user_id is null or tp.user_id = p_user_id)
    returning tp.thread_id, tp.user_id
  loop
    v_archived_count := v_archived_count + 1;
    perform public.cx_log_thread_status(
      p_thread_id => v_row.thread_id,
      p_participant_user_id => v_row.user_id,
      p_actor_user_id => null,
      p_context_type => 'messaging',
      p_event_type => 'auto_archived',
      p_from_status => 'active',
      p_to_status => 'archived',
      p_metadata => jsonb_build_object('reason', '45_days_inactive')
    );
  end loop;

  return jsonb_build_object(
    'expiredPending', v_expired_count,
    'archivedThreads', v_archived_count
  );
end;
$function$;

grant execute on function public.cx_run_messaging_housekeeping(uuid) to authenticated;

create or replace function public.cx_sync_user_messaging_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user uuid := auth.uid();
  v_cycle public.user_messaging_cycles%rowtype;
  v_active_count integer := 0;
  v_pending_count integer := 0;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  perform public.cx_run_messaging_housekeeping(v_user);
  v_cycle := public.cx_ensure_user_messaging_cycle(v_user, now());
  v_active_count := public.cx_count_user_active_threads(v_user);

  select count(*)::integer
    into v_pending_count
  from (
    select distinct tc.thread_id
    from public.thread_contexts tc
    where (tc.requester_id = v_user or tc.recipient_id = v_user)
      and tc.status_tag = 'pending'
      and not exists (
        select 1
        from public.thread_contexts tc2
        where tc2.thread_id = tc.thread_id
          and tc2.context_tag in ('connection_request', 'trip_join_request', 'hosting_request', 'event_chat', 'activity')
          and tc2.status_tag in ('accepted', 'active', 'completed')
      )
  ) q;

  return jsonb_build_object(
    'plan', v_cycle.plan,
    'cycleStart', v_cycle.cycle_start,
    'cycleEnd', v_cycle.cycle_end,
    'monthlyLimit', v_cycle.monthly_activation_limit,
    'monthlyUsed', v_cycle.monthly_activations_used,
    'activeLimit', v_cycle.concurrent_active_limit,
    'activeCount', v_active_count,
    'pendingCount', v_pending_count
  );
end;
$function$;

grant execute on function public.cx_sync_user_messaging_state() to authenticated;

create or replace function public.cx_set_thread_messaging_state(
  p_thread_id uuid,
  p_next_state text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user uuid := auth.uid();
  v_tp public.thread_participants%rowtype;
  v_next text := lower(trim(coalesce(p_next_state, '')));
  v_cycle public.user_messaging_cycles%rowtype;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_thread_id is null then
    raise exception 'thread_required';
  end if;
  if v_next not in ('inactive', 'archived') then
    raise exception 'invalid_messaging_state';
  end if;

  select *
    into v_tp
  from public.thread_participants
  where thread_id = p_thread_id
    and user_id = v_user
  limit 1;

  if not found then
    raise exception 'no_permission_for_thread';
  end if;

  update public.thread_participants
     set messaging_state = v_next,
         archived_at = case when v_next = 'archived' then now() else null end,
         state_changed_at = now()
   where thread_id = p_thread_id
     and user_id = v_user;

  perform public.cx_log_thread_status(
    p_thread_id => p_thread_id,
    p_participant_user_id => v_user,
    p_actor_user_id => v_user,
    p_context_type => 'messaging',
    p_event_type => case when v_next = 'archived' then 'manual_archive' else 'manual_unarchive' end,
    p_from_status => coalesce(v_tp.messaging_state, 'inactive'),
    p_to_status => v_next,
    p_metadata => '{}'::jsonb
  );

  v_cycle := public.cx_ensure_user_messaging_cycle(v_user, now());

  return jsonb_build_object(
    'ok', true,
    'threadId', p_thread_id,
    'messagingState', v_next,
    'plan', v_cycle.plan,
    'cycleStart', v_cycle.cycle_start,
    'cycleEnd', v_cycle.cycle_end,
    'monthlyLimit', v_cycle.monthly_activation_limit,
    'monthlyUsed', v_cycle.monthly_activations_used,
    'activeLimit', v_cycle.concurrent_active_limit,
    'activeCount', public.cx_count_user_active_threads(v_user)
  );
end;
$function$;

grant execute on function public.cx_set_thread_messaging_state(uuid, text) to authenticated;

create or replace function public.cx_send_inbox_message(
  p_thread_id uuid default null,
  p_connection_id uuid default null,
  p_body text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user uuid := auth.uid();
  v_clean_body text := trim(coalesce(p_body, ''));
  v_thread public.threads%rowtype;
  v_connection public.connections%rowtype;
  v_tracking_thread_id uuid;
  v_cycle public.user_messaging_cycles%rowtype;
  v_tp public.thread_participants%rowtype;
  v_current_active integer := 0;
  v_needs_activation boolean := false;
  v_activation_reused boolean := false;
  v_activated boolean := false;
  v_unlocked boolean := false;
  v_message_thread_id uuid;
  v_peer_id uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_thread_id is null and p_connection_id is null then
    raise exception 'thread_or_connection_required';
  end if;
  if length(v_clean_body) < 1 or length(v_clean_body) > 1000 then
    raise exception 'Message length invalid';
  end if;

  if p_thread_id is not null then
    select *
      into v_thread
    from public.threads
    where id = p_thread_id
    limit 1;

    if not found then
      raise exception 'thread_not_found';
    end if;

    if not exists (
      select 1
      from public.thread_participants tp
      where tp.thread_id = v_thread.id
        and tp.user_id = v_user
    ) then
      raise exception 'no_permission_for_thread';
    end if;
  end if;

  if p_connection_id is not null then
    select *
      into v_connection
    from public.connections
    where id = p_connection_id
      and (requester_id = v_user or target_id = v_user)
    limit 1;

    if not found then
      raise exception 'no_permission_for_connection';
    end if;
  elsif v_thread.connection_id is not null then
    select *
      into v_connection
    from public.connections
    where id = v_thread.connection_id
      and (requester_id = v_user or target_id = v_user)
    limit 1;
  elsif v_thread.id is not null then
    select c.*
      into v_connection
    from public.thread_contexts tc
    join public.connections c on c.id = tc.source_id
    where tc.thread_id = v_thread.id
      and tc.source_table = 'connections'
      and (c.requester_id = v_user or c.target_id = v_user)
    order by tc.updated_at desc
    limit 1;
  end if;

  if v_connection.id is not null and (coalesce(v_connection.status::text, '') <> 'accepted' or v_connection.blocked_by is not null) then
    raise exception 'thread_not_accepted';
  end if;

  if v_thread.id is not null then
    v_tracking_thread_id := v_thread.id;
  elsif v_connection.id is not null then
    select tc.thread_id
      into v_tracking_thread_id
    from public.thread_contexts tc
    where tc.source_table = 'connections'
      and tc.source_id = v_connection.id
    order by tc.updated_at desc
    limit 1;

    if v_tracking_thread_id is null then
      v_tracking_thread_id := public.cx_ensure_pair_thread(v_connection.requester_id, v_connection.target_id, v_user);
      perform public.cx_upsert_thread_context(
        p_thread_id => v_tracking_thread_id,
        p_source_table => 'connections',
        p_source_id => v_connection.id,
        p_context_tag => 'connection_request',
        p_status_tag => case when lower(trim(coalesce(v_connection.status::text, 'accepted'))) in ('pending', 'accepted', 'declined', 'cancelled') then lower(trim(coalesce(v_connection.status::text, 'accepted'))) else 'accepted' end,
        p_title => 'Connection request',
        p_requester_id => v_connection.requester_id,
        p_recipient_id => v_connection.target_id,
        p_metadata => '{}'::jsonb
      );
    end if;
  end if;

  if v_tracking_thread_id is null then
    raise exception 'thread_not_found';
  end if;

  if v_connection.id is not null then
    v_peer_id := case when v_connection.requester_id = v_user then v_connection.target_id else v_connection.requester_id end;
    insert into public.thread_participants (thread_id, user_id, role)
    values
      (v_tracking_thread_id, v_user, 'member'),
      (v_tracking_thread_id, v_peer_id, 'member')
    on conflict (thread_id, user_id) do nothing;
  end if;

  select *
    into v_tp
  from public.thread_participants
  where thread_id = v_tracking_thread_id
    and user_id = v_user
  limit 1;

  if not found then
    raise exception 'no_permission_for_thread';
  end if;

  if v_connection.id is not null then
    v_unlocked := true;
  else
    v_unlocked := public.cx_thread_message_unlocked(v_tracking_thread_id, v_user);
  end if;

  if not v_unlocked then
    raise exception 'thread_not_accepted';
  end if;

  v_cycle := public.cx_ensure_user_messaging_cycle(v_user, now());
  v_current_active := public.cx_count_user_active_threads(v_user);
  v_needs_activation := v_tp.activation_cycle_start is distinct from v_cycle.cycle_start;
  v_activation_reused := not v_needs_activation;

  if coalesce(v_tp.messaging_state, 'inactive') <> 'active' then
    if v_current_active >= v_cycle.concurrent_active_limit then
      raise exception 'concurrent_active_limit_reached';
    end if;
  end if;

  if v_needs_activation then
    if v_cycle.monthly_activations_used >= v_cycle.monthly_activation_limit then
      raise exception 'monthly_activation_limit_reached';
    end if;

    update public.user_messaging_cycles
       set monthly_activations_used = monthly_activations_used + 1,
           updated_at = now()
     where user_id = v_user
       and cycle_start = v_cycle.cycle_start
    returning * into v_cycle;

    v_activated := true;
  end if;

  update public.thread_participants
     set messaging_state = 'active',
         archived_at = null,
         activated_at = case when v_needs_activation then now() else coalesce(activated_at, now()) end,
         activation_cycle_start = case when v_needs_activation then v_cycle.cycle_start else activation_cycle_start end,
         activation_cycle_end = case when v_needs_activation then v_cycle.cycle_end else activation_cycle_end end,
         state_changed_at = now(),
         last_read_at = now()
   where thread_id = v_tracking_thread_id
     and user_id = v_user;

  if v_tp.messaging_state is distinct from 'active' or v_needs_activation then
    perform public.cx_log_thread_status(
      p_thread_id => v_tracking_thread_id,
      p_participant_user_id => v_user,
      p_actor_user_id => v_user,
      p_context_type => 'messaging',
      p_event_type => case when v_needs_activation then 'thread_activated' else 'thread_reactivated' end,
      p_from_status => coalesce(v_tp.messaging_state, 'inactive'),
      p_to_status => 'active',
      p_metadata => jsonb_build_object(
        'activationConsumed', v_needs_activation,
        'activationCycleStart', v_cycle.cycle_start,
        'activationCycleEnd', v_cycle.cycle_end
      )
    );
  end if;

  if p_thread_id is null and v_connection.id is not null then
    perform public.send_message(v_connection.id, v_clean_body);
    update public.threads
       set last_message_at = now(),
           updated_at = now()
     where id = v_tracking_thread_id;
    v_message_thread_id := v_tracking_thread_id;
  else
    insert into public.thread_messages (thread_id, sender_id, body)
    values (v_tracking_thread_id, v_user, v_clean_body)
    returning thread_id into v_message_thread_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'threadId', v_tracking_thread_id,
    'messageThreadId', v_message_thread_id,
    'activated', v_activated,
    'activationReused', v_activation_reused,
    'messagingState', 'active',
    'plan', v_cycle.plan,
    'cycleStart', v_cycle.cycle_start,
    'cycleEnd', v_cycle.cycle_end,
    'monthlyLimit', v_cycle.monthly_activation_limit,
    'monthlyUsed', v_cycle.monthly_activations_used,
    'activeLimit', v_cycle.concurrent_active_limit,
    'activeCount', public.cx_count_user_active_threads(v_user)
  );
end;
$function$;

grant execute on function public.cx_send_inbox_message(uuid, uuid, text) to authenticated;

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
  if v_status not in ('pending', 'accepted', 'declined', 'cancelled', 'active', 'completed', 'expired') then
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

commit;
