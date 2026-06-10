-- Allow 'teacher_booking' as a thread_contexts.context_tag.
-- Without this, the API's upsertTeacherBookingContext silently fails
-- (try/catch in app/api/teacher-bookings/route.ts swallows it) and the
-- booking thread keeps its prior contextTag, so the inbox shows it under
-- Connections instead of Bookings.

alter table public.thread_contexts drop constraint if exists thread_contexts_context_tag_chk;
alter table public.thread_contexts
  add constraint thread_contexts_context_tag_chk
  check (context_tag in (
    'connection_request',
    'hosting_request',
    'trip_join_request',
    'event_chat',
    'regular_chat',
    'activity',
    'service_inquiry',
    'teacher_booking'
  )) not valid;

-- Keep the RPC validator in sync, in case anyone routes through it.
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
  if p_context_tag not in (
    'connection_request', 'hosting_request', 'trip_join_request',
    'event_chat', 'regular_chat', 'activity',
    'service_inquiry', 'teacher_booking'
  ) then
    raise exception 'invalid_context_tag';
  end if;
  if v_status not in ('pending', 'accepted', 'declined', 'cancelled', 'active', 'completed', 'expired') then
    raise exception 'invalid_status_tag';
  end if;

  insert into public.thread_contexts (
    thread_id, source_table, source_id, context_tag, status_tag,
    title, city, start_date, end_date,
    requester_id, recipient_id, metadata,
    is_pinned, resolved_at
  )
  values (
    p_thread_id, trim(p_source_table), p_source_id, p_context_tag, v_status,
    p_title, p_city, p_start_date, p_end_date,
    p_requester_id, p_recipient_id, coalesce(p_metadata, '{}'::jsonb),
    v_status = 'pending',
    case when v_status in ('accepted', 'declined', 'cancelled', 'completed') then now() else null end
  )
  on conflict (source_table, source_id) do update set
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
    resolved_at = excluded.resolved_at,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$function$;

grant execute on function public.cx_upsert_thread_context(uuid, text, uuid, text, text, text, text, date, date, uuid, uuid, jsonb) to authenticated;
