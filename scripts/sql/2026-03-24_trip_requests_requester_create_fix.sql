create or replace function public.create_trip_request(
  p_trip_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_trip_owner uuid;
  v_trip_status text;
  v_existing_id uuid;
  v_id uuid;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_reason text := coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Trip join request');
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select t.user_id, coalesce(t.status, 'active')
    into v_trip_owner, v_trip_status
  from public.trips t
  where t.id = p_trip_id
  limit 1;

  if v_trip_owner is null then
    raise exception 'trip_not_found';
  end if;

  if v_trip_owner = v_me then
    raise exception 'cannot_request_own_trip';
  end if;

  if v_trip_status <> 'active' then
    raise exception 'trip_not_active';
  end if;

  select tr.id
    into v_existing_id
  from public.trip_requests tr
  where tr.trip_id = p_trip_id
    and tr.requester_id = v_me
    and tr.status in ('pending', 'accepted')
  order by tr.created_at desc
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  insert into public.trip_requests (trip_id, requester_id, reason, note, status)
  values (p_trip_id, v_me, v_reason, v_note, 'pending')
  returning id into v_id;

  if v_trip_owner <> v_me then
    perform public.create_notification(
      v_trip_owner,
      'trip_request_received',
      'New trip request',
      'You received a new request for your trip.',
      '/trips/' || p_trip_id::text,
      jsonb_build_object('trip_id', p_trip_id, 'request_id', v_id, 'requester_id', v_me)
    );
  end if;

  return v_id;
end;
$function$;

grant execute on function public.create_trip_request(uuid, text) to authenticated;
