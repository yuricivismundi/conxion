create or replace function public.cx_normalize_trip_join_reason(p_value text)
returns text
language sql
immutable
as $function$
  select case
    when p_value is null or trim(p_value) = '' then null
    when lower(trim(p_value)) in ('social_dancing', 'social dancing', 'social_dance', 'social') then 'social_dancing'
    when lower(trim(p_value)) in (
      'training_classes',
      'training & classes',
      'training and classes',
      'training / classes',
      'training / workshops',
      'training',
      'workshop',
      'workshops',
      'class',
      'classes',
      'private_class',
      'private class',
      'private_lesson',
      'private lesson',
      'practice'
    ) then 'training_classes'
    when lower(trim(p_value)) in (
      'travel_events',
      'travel & events',
      'travel and events',
      'travel',
      'travelling',
      'traveling',
      'trip',
      'trip join request',
      'holiday_trip',
      'holiday trip',
      'event',
      'events',
      'festival',
      'event_festival',
      'collaborate',
      'collaboration',
      'request_hosting'
    ) then 'travel_events'
    else null
  end
$function$;

create or replace function public.cx_trip_join_reason_label(p_value text)
returns text
language sql
immutable
as $function$
  select case public.cx_normalize_trip_join_reason(p_value)
    when 'social_dancing' then 'Social dancing'
    when 'training_classes' then 'Training & classes'
    when 'travel_events' then 'Travel & events'
    else coalesce(nullif(trim(p_value), ''), 'Travel & events')
  end
$function$;

update public.trip_requests
set reason = public.cx_normalize_trip_join_reason(reason)
where public.cx_normalize_trip_join_reason(reason) is not null
  and reason is distinct from public.cx_normalize_trip_join_reason(reason);

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
    p_metadata => jsonb_strip_nulls(
      jsonb_build_object(
        'trip_id', new.trip_id,
        'request_id', new.id,
        'trip_join_reason', public.cx_normalize_trip_join_reason(new.reason),
        'trip_join_reason_label', public.cx_trip_join_reason_label(new.reason),
        'reason', coalesce(public.cx_normalize_trip_join_reason(new.reason), nullif(trim(coalesce(new.reason, '')), '')),
        'note', nullif(trim(coalesce(new.note, '')), '')
      )
    )
  );

  return null;
end;
$function$;

update public.thread_contexts tc
set metadata = coalesce(tc.metadata, '{}'::jsonb) || jsonb_strip_nulls(
  jsonb_build_object(
    'trip_join_reason', public.cx_normalize_trip_join_reason(tr.reason),
    'trip_join_reason_label', public.cx_trip_join_reason_label(tr.reason),
    'reason', coalesce(public.cx_normalize_trip_join_reason(tr.reason), nullif(trim(coalesce(tr.reason, '')), '')),
    'note', nullif(trim(coalesce(tr.note, '')), '')
  )
)
from public.trip_requests tr
where tc.source_table = 'trip_requests'
  and tc.source_id = tr.id;
