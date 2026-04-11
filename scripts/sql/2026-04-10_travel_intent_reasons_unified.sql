alter table if exists public.hosting_requests
  add column if not exists reason text;

create or replace function public.cx_normalize_travel_intent_reason(p_value text)
returns text
language sql
immutable
as $function$
  select case
    when p_value is null or trim(p_value) = '' then null
    when lower(trim(p_value)) in (
      'dance_trip_holiday',
      'dance trip / holiday',
      'dance trip',
      'holiday',
      'holiday trip',
      'holiday_trip',
      'social_dancing',
      'social dancing',
      'social_dance',
      'social'
    ) then 'dance_trip_holiday'
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
      'festival_event',
      'festival / event',
      'festival / events',
      'festival',
      'event',
      'events',
      'event_festival',
      'travel_events',
      'travel & events',
      'travel and events',
      'travel',
      'travelling',
      'traveling',
      'trip',
      'trip join request',
      'collaborate',
      'collaboration',
      'request_hosting'
    ) then 'festival_event'
    else null
  end
$function$;

create or replace function public.cx_travel_intent_reason_label(p_value text)
returns text
language sql
immutable
as $function$
  select case public.cx_normalize_travel_intent_reason(p_value)
    when 'dance_trip_holiday' then 'Dance trip / Holiday'
    when 'training_classes' then 'Training & Classes'
    when 'festival_event' then 'Festival / Event'
    else coalesce(nullif(trim(p_value), ''), 'Festival / Event')
  end
$function$;

create or replace function public.cx_normalize_trip_join_reason(p_value text)
returns text
language sql
immutable
as $function$
  select public.cx_normalize_travel_intent_reason(p_value)
$function$;

create or replace function public.cx_trip_join_reason_label(p_value text)
returns text
language sql
immutable
as $function$
  select public.cx_travel_intent_reason_label(p_value)
$function$;

update public.trip_requests
set reason = public.cx_normalize_travel_intent_reason(reason)
where public.cx_normalize_travel_intent_reason(reason) is not null
  and reason is distinct from public.cx_normalize_travel_intent_reason(reason);

update public.hosting_requests
set reason = public.cx_normalize_travel_intent_reason(reason)
where public.cx_normalize_travel_intent_reason(reason) is not null
  and reason is distinct from public.cx_normalize_travel_intent_reason(reason);

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
        'trip_join_reason', public.cx_normalize_travel_intent_reason(new.reason),
        'trip_join_reason_label', public.cx_travel_intent_reason_label(new.reason),
        'reason', coalesce(public.cx_normalize_travel_intent_reason(new.reason), nullif(trim(coalesce(new.reason, '')), '')),
        'note', nullif(trim(coalesce(new.note, '')), '')
      )
    )
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
    p_metadata => jsonb_strip_nulls(
      jsonb_build_object(
        'hosting_request_id', new.id,
        'request_type', new.request_type,
        'trip_id', new.trip_id,
        'travellers_count', new.travellers_count,
        'max_travellers_allowed', new.max_travellers_allowed,
        'reason', coalesce(
          case
            when new.request_type = 'request_hosting' then public.cx_normalize_travel_intent_reason(new.reason)
            else nullif(trim(coalesce(new.reason, '')), '')
          end,
          nullif(trim(coalesce(new.reason, '')), '')
        ),
        'reason_label', case
          when new.request_type = 'request_hosting' then public.cx_travel_intent_reason_label(new.reason)
          else nullif(trim(coalesce(new.reason, '')), '')
        end,
        'message', nullif(trim(coalesce(new.message, '')), '')
      )
    )
  );

  return null;
end;
$function$;

update public.thread_contexts tc
set metadata = coalesce(tc.metadata, '{}'::jsonb) || jsonb_strip_nulls(
  jsonb_build_object(
    'trip_join_reason', public.cx_normalize_travel_intent_reason(tr.reason),
    'trip_join_reason_label', public.cx_travel_intent_reason_label(tr.reason),
    'reason', coalesce(public.cx_normalize_travel_intent_reason(tr.reason), nullif(trim(coalesce(tr.reason, '')), '')),
    'note', nullif(trim(coalesce(tr.note, '')), '')
  )
)
from public.trip_requests tr
where tc.source_table = 'trip_requests'
  and tc.source_id = tr.id;

update public.thread_contexts tc
set metadata = coalesce(tc.metadata, '{}'::jsonb) || jsonb_strip_nulls(
  jsonb_build_object(
    'request_type', hr.request_type,
    'reason', coalesce(
      case
        when hr.request_type = 'request_hosting' then public.cx_normalize_travel_intent_reason(hr.reason)
        else nullif(trim(coalesce(hr.reason, '')), '')
      end,
      nullif(trim(coalesce(hr.reason, '')), '')
    ),
    'reason_label', case
      when hr.request_type = 'request_hosting' then public.cx_travel_intent_reason_label(hr.reason)
      else nullif(trim(coalesce(hr.reason, '')), '')
    end,
    'message', nullif(trim(coalesce(hr.message, '')), '')
  )
)
from public.hosting_requests hr
where tc.source_table = 'hosting_requests'
  and tc.source_id = hr.id;
