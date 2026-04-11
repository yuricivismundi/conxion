begin;

do $$
declare
  v_start_type text;
  v_end_type text;
begin
  select data_type
    into v_start_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'thread_participants'
    and column_name = 'activation_cycle_start';

  if v_start_type = 'date' then
    execute $sql$
      alter table public.thread_participants
        alter column activation_cycle_start
        type timestamptz
        using case
          when activation_cycle_start is null then null
          else (activation_cycle_start::timestamp at time zone 'UTC')
        end
    $sql$;
  end if;

  select data_type
    into v_end_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'thread_participants'
    and column_name = 'activation_cycle_end';

  if v_end_type = 'date' then
    execute $sql$
      alter table public.thread_participants
        alter column activation_cycle_end
        type timestamptz
        using case
          when activation_cycle_end is null then null
          else ((activation_cycle_end::timestamp + interval '1 day') at time zone 'UTC')
        end
    $sql$;
  end if;
end
$$;

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
    and (tp.activation_cycle_end is null or tp.activation_cycle_end > now())
$function$;

grant execute on function public.cx_count_user_active_threads(uuid) to authenticated;

create or replace function public.cx_run_messaging_housekeeping(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_expired_pending_count integer := 0;
  v_expired_active_count integer := 0;
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
    v_expired_pending_count := v_expired_pending_count + 1;

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
       set messaging_state = 'inactive',
           state_changed_at = v_now
     where coalesce(tp.messaging_state, 'inactive') = 'active'
       and tp.archived_at is null
       and tp.activation_cycle_end is not null
       and tp.activation_cycle_end <= v_now
       and (p_user_id is null or tp.user_id = p_user_id)
    returning tp.thread_id, tp.user_id
  loop
    v_expired_active_count := v_expired_active_count + 1;
    perform public.cx_log_thread_status(
      p_thread_id => v_row.thread_id,
      p_participant_user_id => v_row.user_id,
      p_actor_user_id => null,
      p_context_type => 'messaging',
      p_event_type => 'activation_window_expired',
      p_from_status => 'active',
      p_to_status => 'inactive',
      p_metadata => jsonb_build_object('reason', 'one_month_window_elapsed')
    );
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
    'expiredPending', v_expired_pending_count,
    'expiredActive', v_expired_active_count,
    'archivedThreads', v_archived_count
  );
end;
$function$;

grant execute on function public.cx_run_messaging_housekeeping(uuid) to authenticated;

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
  v_current_active integer := 0;
  v_needs_activation boolean := false;
  v_has_live_activation boolean := false;
  v_unlocked boolean := false;
  v_now timestamptz := now();
  v_previous_state text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_thread_id is null then
    raise exception 'thread_required';
  end if;
  if v_next not in ('active', 'inactive', 'archived') then
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

  v_previous_state := coalesce(v_tp.messaging_state, 'inactive');

  if v_next = 'active' then
    v_unlocked := public.cx_thread_message_unlocked(p_thread_id, v_user);
    if not v_unlocked then
      raise exception 'thread_not_accepted';
    end if;

    v_cycle := public.cx_ensure_user_messaging_cycle(v_user, v_now);
    v_current_active := public.cx_count_user_active_threads(v_user);
    v_has_live_activation := case
      when v_tp.activation_cycle_end is not null then v_tp.activation_cycle_end > v_now
      else coalesce(v_tp.activation_cycle_start is not null or v_tp.activated_at is not null, false)
    end;
    v_needs_activation := not v_has_live_activation;

    if coalesce(v_tp.messaging_state, 'inactive') <> 'active' or v_tp.archived_at is not null or v_needs_activation then
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
             updated_at = v_now
       where user_id = v_user
         and cycle_start = v_cycle.cycle_start
      returning * into v_cycle;
    end if;

    update public.thread_participants
       set messaging_state = 'active',
           archived_at = null,
           activated_at = case when v_needs_activation then v_now else coalesce(activated_at, v_now) end,
           activation_cycle_start = case when v_needs_activation then v_now else coalesce(activation_cycle_start, activated_at, v_now) end,
           activation_cycle_end = case when v_needs_activation then v_now + interval '1 month' else activation_cycle_end end,
           state_changed_at = v_now,
           last_read_at = v_now
     where thread_id = p_thread_id
       and user_id = v_user
    returning * into v_tp;

    if v_previous_state is distinct from 'active' or v_needs_activation then
      perform public.cx_log_thread_status(
        p_thread_id => p_thread_id,
        p_participant_user_id => v_user,
        p_actor_user_id => v_user,
        p_context_type => 'messaging',
        p_event_type => case when v_needs_activation then 'thread_activated' else 'thread_reactivated' end,
        p_from_status => v_previous_state,
        p_to_status => 'active',
        p_metadata => jsonb_build_object(
          'activationConsumed', v_needs_activation,
          'activationStart', coalesce(v_tp.activation_cycle_start, v_tp.activated_at),
          'activationEnd', v_tp.activation_cycle_end
        )
      );
    end if;
  else
    update public.thread_participants
       set messaging_state = v_next,
           archived_at = case when v_next = 'archived' then v_now else null end,
           state_changed_at = v_now
     where thread_id = p_thread_id
       and user_id = v_user
    returning * into v_tp;

    perform public.cx_log_thread_status(
      p_thread_id => p_thread_id,
      p_participant_user_id => v_user,
      p_actor_user_id => v_user,
      p_context_type => 'messaging',
      p_event_type => case when v_next = 'archived' then 'manual_archive' else 'manual_unarchive' end,
      p_from_status => v_previous_state,
      p_to_status => v_next,
      p_metadata => '{}'::jsonb
    );

    v_cycle := public.cx_ensure_user_messaging_cycle(v_user, v_now);
  end if;

  return jsonb_build_object(
    'ok', true,
    'threadId', p_thread_id,
    'messagingState', v_next,
    'activatedAt', v_tp.activated_at,
    'activationStart', coalesce(v_tp.activation_cycle_start, v_tp.activated_at),
    'activationEnd', v_tp.activation_cycle_end,
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
  v_now timestamptz := now();
  v_has_live_activation boolean := false;
  v_previous_state text;
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

  v_previous_state := coalesce(v_tp.messaging_state, 'inactive');

  if v_connection.id is not null then
    v_unlocked := true;
  else
    v_unlocked := public.cx_thread_message_unlocked(v_tracking_thread_id, v_user);
  end if;

  if not v_unlocked then
    raise exception 'thread_not_accepted';
  end if;

  v_cycle := public.cx_ensure_user_messaging_cycle(v_user, v_now);
  v_current_active := public.cx_count_user_active_threads(v_user);
  v_has_live_activation := case
    when v_tp.activation_cycle_end is not null then v_tp.activation_cycle_end > v_now
    else coalesce(v_tp.activation_cycle_start is not null or v_tp.activated_at is not null, false)
  end;
  v_needs_activation := not v_has_live_activation;
  v_activation_reused := not v_needs_activation;

  if coalesce(v_tp.messaging_state, 'inactive') <> 'active' or v_tp.archived_at is not null or v_needs_activation then
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
           updated_at = v_now
     where user_id = v_user
       and cycle_start = v_cycle.cycle_start
    returning * into v_cycle;

    v_activated := true;
  end if;

  update public.thread_participants
     set messaging_state = 'active',
         archived_at = null,
         activated_at = case when v_needs_activation then v_now else coalesce(activated_at, v_now) end,
         activation_cycle_start = case when v_needs_activation then v_now else coalesce(activation_cycle_start, activated_at, v_now) end,
         activation_cycle_end = case when v_needs_activation then v_now + interval '1 month' else activation_cycle_end end,
         state_changed_at = v_now,
         last_read_at = v_now
   where thread_id = v_tracking_thread_id
     and user_id = v_user
  returning * into v_tp;

  if v_previous_state is distinct from 'active' or v_needs_activation then
    perform public.cx_log_thread_status(
      p_thread_id => v_tracking_thread_id,
      p_participant_user_id => v_user,
      p_actor_user_id => v_user,
      p_context_type => 'messaging',
      p_event_type => case when v_needs_activation then 'thread_activated' else 'thread_reactivated' end,
      p_from_status => v_previous_state,
      p_to_status => 'active',
      p_metadata => jsonb_build_object(
        'activationConsumed', v_needs_activation,
        'activationStart', coalesce(v_tp.activation_cycle_start, v_tp.activated_at),
        'activationEnd', v_tp.activation_cycle_end
      )
    );
  end if;

  if p_thread_id is null and v_connection.id is not null then
    perform public.send_message(v_connection.id, v_clean_body);
    update public.threads
       set last_message_at = v_now,
           updated_at = v_now
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
    'activatedAt', v_tp.activated_at,
    'activationStart', coalesce(v_tp.activation_cycle_start, v_tp.activated_at),
    'activationEnd', v_tp.activation_cycle_end,
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

commit;
