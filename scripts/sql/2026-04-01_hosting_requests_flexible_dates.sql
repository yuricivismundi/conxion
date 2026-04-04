-- Migration: allow flexible departure on hosting requests
--
-- Rule: arrival_date is always required. departure_date is optional when departure_flexible = true.

-- 1. Make departure_date nullable (arrival_date stays NOT NULL)
ALTER TABLE public.hosting_requests
  ALTER COLUMN departure_date DROP NOT NULL;

-- 2. Drop the departure >= arrival check constraint (function handles this logic)
ALTER TABLE public.hosting_requests
  DROP CONSTRAINT IF EXISTS hosting_requests_date_range_check;

-- 3. Replace create_hosting_request with updated validation
CREATE OR REPLACE FUNCTION public.create_hosting_request(
  p_recipient_user_id uuid,
  p_request_type text,
  p_trip_id uuid default null,
  p_arrival_date date default null,
  p_departure_date date default null,
  p_arrival_flexible boolean default false,
  p_departure_flexible boolean default false,
  p_travellers_count integer default 1,
  p_max_travellers_allowed integer default null,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_message text := nullif(trim(coalesce(p_message, '')), '');
  v_request_type text := lower(trim(coalesce(p_request_type, '')));
  v_existing uuid;
  v_trip_owner uuid;
  v_trip_status text;
  v_zero uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_rec_can_host boolean := false;
  v_rec_hosting_status text := null;
  v_rec_max_guests integer := null;
  v_me_can_host boolean := false;
  v_me_hosting_status text := null;
  v_me_max_guests integer := null;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_recipient_user_id is null then
    raise exception 'recipient_required';
  end if;

  if p_recipient_user_id = v_me then
    raise exception 'cannot_request_self';
  end if;

  if v_request_type not in ('request_hosting', 'offer_to_host') then
    raise exception 'invalid_request_type';
  end if;

  -- Arrival date is always required
  if p_arrival_date is null then
    raise exception 'arrival_date_required';
  end if;

  -- Departure: must have a date OR flexible flag
  if p_departure_date is null and not coalesce(p_departure_flexible, false) then
    raise exception 'departure_date_or_flexible_required';
  end if;

  if p_arrival_date < current_date then
    raise exception 'arrival_must_be_today_or_future';
  end if;

  if p_departure_date is not null then
    if p_departure_date < p_arrival_date then
      raise exception 'invalid_date_range';
    end if;

    if (p_departure_date - p_arrival_date) > 90 then
      raise exception 'date_range_too_long';
    end if;
  end if;

  if p_travellers_count is null or p_travellers_count < 1 or p_travellers_count > 20 then
    raise exception 'travellers_count_invalid';
  end if;

  if p_max_travellers_allowed is not null and (p_max_travellers_allowed < 1 or p_max_travellers_allowed > 20) then
    raise exception 'max_travellers_allowed_invalid';
  end if;

  if v_message is not null then
    if char_length(v_message) > 500 then
      raise exception 'message_too_long';
    end if;
    if v_message ~* '(https?://|www\.)' then
      raise exception 'links_not_allowed';
    end if;
    if v_message ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' then
      raise exception 'emails_not_allowed';
    end if;
    if v_message ~* '[@#][A-Za-z0-9_]+' then
      raise exception 'handles_not_allowed';
    end if;
    if v_message ~* '(\+?\d[\d\s().-]{7,}\d)' then
      raise exception 'phone_numbers_not_allowed';
    end if;
  end if;

  select p.can_host, coalesce(lower(trim(p.hosting_status)), 'inactive'), p.max_guests
    into v_rec_can_host, v_rec_hosting_status, v_rec_max_guests
  from public.profiles p
  where p.user_id = p_recipient_user_id
  limit 1;

  if v_request_type = 'request_hosting' then
    if coalesce(v_rec_can_host, false) is not true then
      raise exception 'recipient_not_hosting';
    end if;

    if coalesce(v_rec_hosting_status, 'inactive') not in ('available', 'active', 'open', 'on') then
      raise exception 'recipient_hosting_unavailable';
    end if;

    if v_rec_max_guests is not null and p_travellers_count > v_rec_max_guests then
      raise exception 'exceeds_recipient_capacity';
    end if;
  end if;

  select p.can_host, coalesce(lower(trim(p.hosting_status)), 'inactive'), p.max_guests
    into v_me_can_host, v_me_hosting_status, v_me_max_guests
  from public.profiles p
  where p.user_id = v_me
  limit 1;

  if v_request_type = 'offer_to_host' then
    if coalesce(v_me_can_host, false) is not true then
      raise exception 'sender_not_hosting';
    end if;
  end if;

  -- Check for existing pending request between these two users for the same type
  select id into v_existing
  from public.hosting_requests
  where (
    (sender_user_id = v_me and recipient_user_id = p_recipient_user_id)
    or (sender_user_id = p_recipient_user_id and recipient_user_id = v_me)
  )
  and request_type = v_request_type
  and status = 'pending'
  limit 1;

  if v_existing is not null then
    raise exception 'pending_request_exists';
  end if;

  insert into public.hosting_requests (
    sender_user_id,
    recipient_user_id,
    request_type,
    trip_id,
    arrival_date,
    departure_date,
    arrival_flexible,
    departure_flexible,
    travellers_count,
    max_travellers_allowed,
    message,
    status
  ) values (
    v_me,
    p_recipient_user_id,
    v_request_type,
    nullif(p_trip_id, v_zero),
    p_arrival_date,
    p_departure_date,
    coalesce(p_arrival_flexible, false),
    coalesce(p_departure_flexible, false),
    p_travellers_count,
    p_max_travellers_allowed,
    v_message,
    'pending'
  )
  returning id into v_id;

  return v_id;
end;
$function$;
