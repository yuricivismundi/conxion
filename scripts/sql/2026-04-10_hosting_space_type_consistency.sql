create or replace function public.cx_normalize_hosting_space_type(p_value text)
returns text
language sql
immutable
as $function$
  select case lower(trim(coalesce(p_value, '')))
    when '' then null
    when 'not_specified' then 'not_specified'
    when 'not specified' then 'not_specified'
    when 'shared_room' then 'shared_room'
    when 'shared room' then 'shared_room'
    when 'spare_room' then 'shared_room'
    when 'spare room' then 'shared_room'
    when 'private_room' then 'private_room'
    when 'private room' then 'private_room'
    when 'private_space' then 'private_room'
    when 'private space' then 'private_room'
    when 'sofa' then 'sofa'
    when 'couch' then 'sofa'
    when 'couch / sofa' then 'sofa'
    when 'couch/sofa' then 'sofa'
    when 'floor_space' then 'floor_space'
    when 'floor space' then 'floor_space'
    when 'mixed' then 'mixed'
    when 'depends on dates' then 'mixed'
    else null
  end
$function$;

create or replace function public.cx_hosting_space_type_label(p_value text)
returns text
language sql
immutable
as $function$
  select case public.cx_normalize_hosting_space_type(p_value)
    when 'not_specified' then 'Not specified'
    when 'shared_room' then 'Spare room'
    when 'private_room' then 'Private space'
    when 'sofa' then 'Couch / sofa'
    when 'floor_space' then 'Floor space'
    when 'mixed' then 'Depends on dates'
    else nullif(trim(coalesce(p_value, '')), '')
  end
$function$;

update public.hosting_requests
set reason = public.cx_normalize_hosting_space_type(reason)
where request_type = 'offer_to_host'
  and public.cx_normalize_hosting_space_type(reason) is not null
  and reason is distinct from public.cx_normalize_hosting_space_type(reason);

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
            when new.request_type = 'offer_to_host' then public.cx_normalize_hosting_space_type(new.reason)
            else nullif(trim(coalesce(new.reason, '')), '')
          end,
          nullif(trim(coalesce(new.reason, '')), '')
        ),
        'reason_label', case
          when new.request_type = 'request_hosting' then public.cx_travel_intent_reason_label(new.reason)
          when new.request_type = 'offer_to_host' then public.cx_hosting_space_type_label(new.reason)
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
    'request_type', hr.request_type,
    'reason', coalesce(
      case
        when hr.request_type = 'request_hosting' then public.cx_normalize_travel_intent_reason(hr.reason)
        when hr.request_type = 'offer_to_host' then public.cx_normalize_hosting_space_type(hr.reason)
        else nullif(trim(coalesce(hr.reason, '')), '')
      end,
      nullif(trim(coalesce(hr.reason, '')), '')
    ),
    'reason_label', case
      when hr.request_type = 'request_hosting' then public.cx_travel_intent_reason_label(hr.reason)
      when hr.request_type = 'offer_to_host' then public.cx_hosting_space_type_label(hr.reason)
      else nullif(trim(coalesce(hr.reason, '')), '')
    end,
    'message', nullif(trim(coalesce(hr.message, '')), '')
  )
)
from public.hosting_requests hr
where tc.source_table = 'hosting_requests'
  and tc.source_id = hr.id;
