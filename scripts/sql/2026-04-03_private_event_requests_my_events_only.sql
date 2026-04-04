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

  -- Private-event access requests stay in My Events while pending.
  -- Only accepted requests unlock an event chat thread.
  if v_status <> 'accepted' then
    return null;
  end if;

  v_actor := coalesce(auth.uid(), v_owner);
  v_thread_id := public.cx_ensure_event_thread(new.event_id, v_actor, new.requester_id);

  perform public.cx_upsert_thread_context(
    p_thread_id => v_thread_id,
    p_source_table => 'event_requests',
    p_source_id => new.id,
    p_context_tag => 'event_chat',
    p_status_tag => 'accepted',
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
