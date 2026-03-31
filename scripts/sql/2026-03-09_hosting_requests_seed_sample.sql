-- ConXion Hosting Requests sample seed
-- Date: 2026-03-09
-- Purpose:
--   Quickly seed host visibility + one sample hosting request for local/staging testing.
-- Notes:
--   - Safe to run multiple times.
--   - Run after: scripts/sql/2026-03-09_hosting_requests.sql

begin;

-- 1) Ensure a few members are visible in Discover -> Hosts.
with ranked_profiles as (
  select p.user_id, row_number() over (order by p.created_at nulls last, p.user_id) as rn
  from public.profiles p
)
update public.profiles p
set can_host = true,
    hosting_status = 'available',
    max_guests = coalesce(p.max_guests, 2 + ((rp.rn - 1) % 3))
from ranked_profiles rp
where p.user_id = rp.user_id
  and rp.rn <= 6;

-- 2) Add one sample pending request if no pending request exists for the pair.
do $$
declare
  v_host uuid;
  v_sender uuid;
  v_exists uuid;
begin
  select p.user_id
    into v_host
  from public.profiles p
  where p.can_host = true
    and lower(coalesce(p.hosting_status, 'inactive')) in ('available', 'active', 'open', 'on')
  order by p.created_at nulls last, p.user_id
  limit 1;

  if v_host is null then
    return;
  end if;

  select p.user_id
    into v_sender
  from public.profiles p
  where p.user_id <> v_host
  order by p.created_at nulls last, p.user_id
  limit 1;

  if v_sender is null then
    return;
  end if;

  select hr.id
    into v_exists
  from public.hosting_requests hr
  where hr.sender_user_id = v_sender
    and hr.recipient_user_id = v_host
    and hr.request_type = 'request_hosting'
    and hr.trip_id is null
    and hr.status = 'pending'
  limit 1;

  if v_exists is not null then
    return;
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
    v_sender,
    v_host,
    'request_hosting',
    null,
    current_date + 14,
    current_date + 17,
    false,
    true,
    2,
    2,
    'Looking for hosting during a dance weekend.',
    'pending'
  );
end $$;

commit;
