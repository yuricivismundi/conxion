begin;

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
  v_unlocked boolean := false;
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

  if v_next = 'active' then
    v_unlocked := public.cx_thread_message_unlocked(p_thread_id, v_user);
    if not v_unlocked then
      raise exception 'thread_not_accepted';
    end if;

    v_cycle := public.cx_ensure_user_messaging_cycle(v_user, now());
    v_current_active := public.cx_count_user_active_threads(v_user);
    v_needs_activation := v_tp.activation_cycle_start is distinct from v_cycle.cycle_start;

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
    end if;

    update public.thread_participants
       set messaging_state = 'active',
           archived_at = null,
           activated_at = case when v_needs_activation then now() else coalesce(activated_at, now()) end,
           activation_cycle_start = case when v_needs_activation then v_cycle.cycle_start else activation_cycle_start end,
           activation_cycle_end = case when v_needs_activation then v_cycle.cycle_end else activation_cycle_end end,
           state_changed_at = now(),
           last_read_at = now()
     where thread_id = p_thread_id
       and user_id = v_user;

    if v_tp.messaging_state is distinct from 'active' or v_needs_activation then
      perform public.cx_log_thread_status(
        p_thread_id => p_thread_id,
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
  else
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
  end if;

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

commit;
