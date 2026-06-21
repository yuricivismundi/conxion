-- Convert trip-domain SECURITY DEFINER functions to SECURITY INVOKER
-- Date: 2026-06-21
--
-- New RLS policy added:
--   trip_requests_update_requester – lets the requester cancel their own pending request
--     (existing trip_requests_update_trip_owner only covers the trip owner)
--
-- Functions intentionally left as SECURITY DEFINER:
--   create_trip_request  → calls create_notification (EXECUTE revoked from authenticated)
--   respond_trip_request → calls create_notification + inserts into threads/thread_participants

begin;

-- ──────────────────────────────────────────────────────────────────────────────
-- New RLS policy
-- ──────────────────────────────────────────────────────────────────────────────

drop policy if exists trip_requests_update_requester on public.trip_requests;
create policy trip_requests_update_requester
  on public.trip_requests
  for update
  to authenticated
  using  (requester_id = auth.uid())
  with check (requester_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────────
-- create_trip_checked  (trips RLS covers SELECT + INSERT)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.create_trip_checked(
  p_destination_city text,
  p_destination_country text,
  p_start_date date,
  p_end_date date,
  p_purpose text,
  p_styles text[],
  p_looking_for text[],
  p_note text
)
returns public.trips
language plpgsql
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_active_count int;
  v_row public.trips;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select count(*) into v_active_count
  from public.trips t
  where t.user_id = v_user
    and t.end_date >= current_date;

  if v_active_count >= 5 then
    raise exception 'You can only have up to 5 active trips.';
  end if;

  insert into public.trips (
    user_id, destination_city, destination_country,
    start_date, end_date, purpose, styles, looking_for, note, status
  )
  values (
    v_user, p_destination_city, p_destination_country,
    p_start_date, p_end_date, p_purpose, coalesce(p_styles,'{}'),
    coalesce(p_looking_for,'{}'), nullif(trim(p_note),''), 'published'
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- cancel_trip_request  (new trip_requests_update_requester covers the UPDATE)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.cancel_trip_request(p_request_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_row record;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_row
  from public.trip_requests tr
  where tr.id = p_request_id
  limit 1;

  if v_row is null then
    raise exception 'trip_request_not_found';
  end if;

  if v_row.requester_id <> v_me then
    raise exception 'not_authorized';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'trip_request_not_pending';
  end if;

  update public.trip_requests
  set status = 'cancelled',
      updated_at = now()
  where id = p_request_id;

  return v_row.trip_id;
end;
$$;

commit;
