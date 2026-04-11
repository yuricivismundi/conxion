begin;

create or replace function public.cx_thread_message_unlocked(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
as $function$
  with participant as (
    select exists (
      select 1
      from public.thread_participants tp
      where tp.thread_id = p_thread_id
        and tp.user_id = p_user_id
    ) as ok
  ),
  service_inquiry_state as (
    select
      exists (
        select 1
        from public.thread_contexts tc
        where tc.thread_id = p_thread_id
          and tc.context_tag = 'service_inquiry'
      ) as has_service_inquiry,
      exists (
        select 1
        from public.thread_contexts tc
        where tc.thread_id = p_thread_id
          and tc.context_tag = 'service_inquiry'
          and tc.status_tag = 'active'
      ) as service_active,
      exists (
        select 1
        from public.thread_contexts tc
        join public.service_inquiry_threads sit
          on sit.thread_id = tc.thread_id
         and tc.source_table = 'service_inquiries'
         and tc.source_id = sit.inquiry_id
        join public.service_inquiries si on si.id = sit.inquiry_id
        where tc.thread_id = p_thread_id
          and tc.context_tag = 'service_inquiry'
          and tc.status_tag = 'info_shared'
          and si.requester_id = p_user_id
          and sit.requester_followup_used = false
      ) as requester_free_followup
  ),
  unlock_sources as (
    select
      exists (
        select 1
        from public.thread_contexts tc
        where tc.thread_id = p_thread_id
          and tc.context_tag in ('connection_request', 'trip_join_request', 'hosting_request', 'event_chat', 'activity')
          and tc.status_tag in ('accepted', 'active', 'completed')
      ) as has_non_service_unlock_context,
      exists (
        select 1
        from public.threads t
        join public.connections c on c.id = t.connection_id
        where t.id = p_thread_id
          and (c.requester_id = p_user_id or c.target_id = p_user_id)
          and c.status = 'accepted'
          and c.blocked_by is null
      ) as has_accepted_thread_connection,
      exists (
        select 1
        from public.thread_contexts tc
        join public.connections c
          on tc.source_table = 'connections'
         and tc.source_id = c.id
        where tc.thread_id = p_thread_id
          and (c.requester_id = p_user_id or c.target_id = p_user_id)
          and c.status = 'accepted'
          and c.blocked_by is null
      ) as has_accepted_context_connection,
      exists (
        select 1
        from public.thread_messages tm
        where tm.thread_id = p_thread_id
          and coalesce(tm.message_type, 'text') = 'text'
      ) as has_text_history,
      exists (
        select 1
        from public.thread_contexts tc
        join public.connections c
          on tc.source_table = 'connections'
         and tc.source_id = c.id
        where tc.thread_id = p_thread_id
          and (c.status = 'blocked' or c.blocked_by is not null)
      ) as has_blocked_connection
  )
  select
    (select ok from participant)
    and not (select has_blocked_connection from unlock_sources)
    and (
      (select service_active from service_inquiry_state)
      or (select requester_free_followup from service_inquiry_state)
      or (select has_non_service_unlock_context from unlock_sources)
      or (select has_accepted_thread_connection from unlock_sources)
      or (select has_accepted_context_connection from unlock_sources)
      or (
        not (select has_service_inquiry from service_inquiry_state)
        and (select has_text_history from unlock_sources)
      )
    )
$function$;

grant execute on function public.cx_thread_message_unlocked(uuid, uuid) to authenticated;

create or replace function public.cx_thread_chat_unlocked(
  p_thread_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select public.cx_thread_message_unlocked(p_thread_id, p_user_id)
$function$;

grant execute on function public.cx_thread_chat_unlocked(uuid, uuid) to authenticated;

commit;
