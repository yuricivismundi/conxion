-- ConXion Hosting Requests (Discover Hosts/Travelers)
-- Date: 2026-03-09
-- Safe to run multiple times.

begin;

create extension if not exists pgcrypto;

alter table public.profiles add column if not exists can_host boolean not null default false;
alter table public.profiles add column if not exists hosting_status text not null default 'inactive';
alter table public.profiles add column if not exists max_guests integer;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'profiles_hosting_status_allowed_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      drop constraint profiles_hosting_status_allowed_chk;
  end if;

  alter table public.profiles
    add constraint profiles_hosting_status_allowed_chk
    check (hosting_status in ('inactive', 'available', 'paused', 'active', 'open', 'on'));
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_max_guests_range_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_max_guests_range_chk
      check (max_guests is null or (max_guests >= 0 and max_guests <= 20));
  end if;
end $$;

create table if not exists public.hosting_requests (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null default 'request_hosting',
  trip_id uuid null references public.trips(id) on delete set null,
  arrival_date date not null,
  departure_date date not null,
  arrival_flexible boolean not null default false,
  departure_flexible boolean not null default false,
  travellers_count integer not null default 1,
  max_travellers_allowed integer,
  message text,
  status text not null default 'pending',
  decided_by uuid null references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hosting_requests add column if not exists sender_user_id uuid;
alter table public.hosting_requests add column if not exists recipient_user_id uuid;
alter table public.hosting_requests add column if not exists request_type text;
alter table public.hosting_requests add column if not exists trip_id uuid;
alter table public.hosting_requests add column if not exists arrival_date date;
alter table public.hosting_requests add column if not exists departure_date date;
alter table public.hosting_requests add column if not exists arrival_flexible boolean;
alter table public.hosting_requests add column if not exists departure_flexible boolean;
alter table public.hosting_requests add column if not exists travellers_count integer;
alter table public.hosting_requests add column if not exists max_travellers_allowed integer;
alter table public.hosting_requests add column if not exists message text;
alter table public.hosting_requests add column if not exists status text;
alter table public.hosting_requests add column if not exists decided_by uuid;
alter table public.hosting_requests add column if not exists decided_at timestamptz;
alter table public.hosting_requests add column if not exists created_at timestamptz;
alter table public.hosting_requests add column if not exists updated_at timestamptz;

update public.hosting_requests
set request_type = 'request_hosting'
where request_type is null;

update public.hosting_requests
set status = 'pending'
where status is null;

update public.hosting_requests
set travellers_count = 1
where travellers_count is null or travellers_count < 1;

update public.hosting_requests
set created_at = now()
where created_at is null;

update public.hosting_requests
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table public.hosting_requests alter column sender_user_id set not null;
alter table public.hosting_requests alter column recipient_user_id set not null;
alter table public.hosting_requests alter column request_type set not null;
alter table public.hosting_requests alter column request_type set default 'request_hosting';
alter table public.hosting_requests alter column status set not null;
alter table public.hosting_requests alter column status set default 'pending';
alter table public.hosting_requests alter column arrival_date set not null;
alter table public.hosting_requests alter column departure_date set not null;
alter table public.hosting_requests alter column arrival_flexible set not null;
alter table public.hosting_requests alter column arrival_flexible set default false;
alter table public.hosting_requests alter column departure_flexible set not null;
alter table public.hosting_requests alter column departure_flexible set default false;
alter table public.hosting_requests alter column travellers_count set not null;
alter table public.hosting_requests alter column travellers_count set default 1;
alter table public.hosting_requests alter column created_at set not null;
alter table public.hosting_requests alter column created_at set default now();
alter table public.hosting_requests alter column updated_at set not null;
alter table public.hosting_requests alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hosting_requests_not_self_chk'
      and conrelid = 'public.hosting_requests'::regclass
  ) then
    alter table public.hosting_requests
      add constraint hosting_requests_not_self_chk
      check (sender_user_id <> recipient_user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hosting_requests_type_allowed_chk'
      and conrelid = 'public.hosting_requests'::regclass
  ) then
    alter table public.hosting_requests
      add constraint hosting_requests_type_allowed_chk
      check (request_type in ('request_hosting', 'offer_to_host'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hosting_requests_status_allowed_chk'
      and conrelid = 'public.hosting_requests'::regclass
  ) then
    alter table public.hosting_requests
      add constraint hosting_requests_status_allowed_chk
      check (status in ('pending', 'accepted', 'declined', 'cancelled'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hosting_requests_date_order_chk'
      and conrelid = 'public.hosting_requests'::regclass
  ) then
    alter table public.hosting_requests
      add constraint hosting_requests_date_order_chk
      check (departure_date >= arrival_date);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hosting_requests_travellers_range_chk'
      and conrelid = 'public.hosting_requests'::regclass
  ) then
    alter table public.hosting_requests
      add constraint hosting_requests_travellers_range_chk
      check (travellers_count >= 1 and travellers_count <= 20);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hosting_requests_max_travellers_range_chk'
      and conrelid = 'public.hosting_requests'::regclass
  ) then
    alter table public.hosting_requests
      add constraint hosting_requests_max_travellers_range_chk
      check (
        max_travellers_allowed is null
        or (max_travellers_allowed >= 1 and max_travellers_allowed <= 20)
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hosting_requests_message_security_chk'
      and conrelid = 'public.hosting_requests'::regclass
  ) then
    alter table public.hosting_requests
      add constraint hosting_requests_message_security_chk
      check (
        message is null
        or (
          char_length(trim(message)) >= 1
          and char_length(trim(message)) <= 500
          and trim(message) !~* '(https?://|www\.)'
          and trim(message) !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
          and trim(message) !~* '[@#][A-Za-z0-9_]+'
          and trim(message) !~* '(\+?\d[\d\s().-]{7,}\d)'
        )
      );
  end if;
end $$;

create index if not exists idx_hosting_requests_sender_status_created
  on public.hosting_requests(sender_user_id, status, created_at desc);

create index if not exists idx_hosting_requests_recipient_status_created
  on public.hosting_requests(recipient_user_id, status, created_at desc);

create index if not exists idx_hosting_requests_trip
  on public.hosting_requests(trip_id, status, created_at desc);

create unique index if not exists ux_hosting_requests_pending_pair_type_trip
  on public.hosting_requests(
    sender_user_id,
    recipient_user_id,
    request_type,
    coalesce(trip_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'pending';

create or replace function public.set_updated_at_ts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_hosting_requests_set_updated_at on public.hosting_requests;
create trigger trg_hosting_requests_set_updated_at
before update on public.hosting_requests
for each row execute function public.set_updated_at_ts();

alter table public.hosting_requests enable row level security;

drop policy if exists hosting_requests_select_parties on public.hosting_requests;
create policy hosting_requests_select_parties
on public.hosting_requests for select
to authenticated
using (sender_user_id = auth.uid() or recipient_user_id = auth.uid());

drop policy if exists hosting_requests_insert_sender on public.hosting_requests;
create policy hosting_requests_insert_sender
on public.hosting_requests for insert
to authenticated
with check (sender_user_id = auth.uid());

drop policy if exists hosting_requests_update_none on public.hosting_requests;
create policy hosting_requests_update_none
on public.hosting_requests for update
to authenticated
using (false)
with check (false);

drop policy if exists hosting_requests_delete_none on public.hosting_requests;
create policy hosting_requests_delete_none
on public.hosting_requests for delete
to authenticated
using (false);

create or replace function public.create_hosting_request(
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

  if p_arrival_date is null or p_departure_date is null then
    raise exception 'dates_required';
  end if;

  if p_arrival_date < current_date then
    raise exception 'arrival_must_be_today_or_future';
  end if;

  if p_departure_date < p_arrival_date then
    raise exception 'invalid_date_range';
  end if;

  if (p_departure_date - p_arrival_date) > 90 then
    raise exception 'date_range_too_long';
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

    if coalesce(v_me_hosting_status, 'inactive') not in ('available', 'active', 'open', 'on') then
      raise exception 'sender_hosting_unavailable';
    end if;

    if p_trip_id is null then
      raise exception 'trip_required_for_offer';
    end if;

    if p_max_travellers_allowed is not null and v_me_max_guests is not null and p_max_travellers_allowed > v_me_max_guests then
      raise exception 'offer_capacity_exceeds_profile_capacity';
    end if;
  end if;

  if p_trip_id is not null then
    select t.user_id, coalesce(t.status, 'active')
      into v_trip_owner, v_trip_status
    from public.trips t
    where t.id = p_trip_id
    limit 1;

    if v_trip_owner is null then
      raise exception 'trip_not_found';
    end if;

    if v_trip_status <> 'active' then
      raise exception 'trip_not_active';
    end if;

    if v_request_type = 'request_hosting' and v_trip_owner <> v_me then
      raise exception 'request_trip_must_be_owned_by_sender';
    end if;

    if v_request_type = 'offer_to_host' and v_trip_owner <> p_recipient_user_id then
      raise exception 'offer_trip_must_be_owned_by_recipient';
    end if;
  end if;

  select hr.id
    into v_existing
  from public.hosting_requests hr
  where hr.sender_user_id = v_me
    and hr.recipient_user_id = p_recipient_user_id
    and hr.request_type = v_request_type
    and coalesce(hr.trip_id, v_zero) = coalesce(p_trip_id, v_zero)
    and hr.status = 'pending'
  limit 1;

  if v_existing is not null then
    raise exception 'already_pending_hosting_request';
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
    status,
    decided_by,
    decided_at
  )
  values (
    v_me,
    p_recipient_user_id,
    v_request_type,
    p_trip_id,
    p_arrival_date,
    p_departure_date,
    coalesce(p_arrival_flexible, false),
    coalesce(p_departure_flexible, false),
    p_travellers_count,
    p_max_travellers_allowed,
    v_message,
    'pending',
    null,
    null
  )
  returning id into v_id;

  if to_regprocedure('public.create_notification(uuid,text,text,text,text,jsonb)') is not null then
    perform public.create_notification(
      p_recipient_user_id,
      'hosting_request_received',
      case
        when v_request_type = 'offer_to_host' then 'New host offer'
        else 'New hosting request'
      end,
      case
        when v_request_type = 'offer_to_host' then 'You received an offer to host your trip.'
        else 'You received a hosting request.'
      end,
      '/trips/hosting',
      jsonb_build_object('hosting_request_id', v_id, 'request_type', v_request_type)
    );
  end if;

  return v_id;
end;
$function$;

grant execute on function public.create_hosting_request(uuid, text, uuid, date, date, boolean, boolean, integer, integer, text) to authenticated;

create or replace function public.respond_hosting_request(
  p_request_id uuid,
  p_action text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_row public.hosting_requests%rowtype;
  v_action text := lower(trim(coalesce(p_action, '')));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if v_action not in ('accepted', 'declined') then
    raise exception 'invalid_action';
  end if;

  select *
    into v_row
  from public.hosting_requests hr
  where hr.id = p_request_id
    and hr.recipient_user_id = v_me
  limit 1;

  if v_row.id is null then
    raise exception 'hosting_request_not_found';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'hosting_request_not_pending';
  end if;

  update public.hosting_requests
  set status = v_action,
      decided_by = v_me,
      decided_at = now(),
      updated_at = now()
  where id = v_row.id;

  if to_regprocedure('public.create_notification(uuid,text,text,text,text,jsonb)') is not null then
    perform public.create_notification(
      v_row.sender_user_id,
      'hosting_request_' || v_action,
      case when v_action = 'accepted' then 'Hosting request accepted' else 'Hosting request declined' end,
      case when v_action = 'accepted'
        then 'Your hosting request was accepted.'
        else 'Your hosting request was declined.'
      end,
      '/trips/hosting',
      jsonb_build_object('hosting_request_id', v_row.id, 'status', v_action)
    );
  end if;

  return v_row.id;
end;
$function$;

grant execute on function public.respond_hosting_request(uuid, text) to authenticated;

create or replace function public.cancel_hosting_request(
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_row public.hosting_requests%rowtype;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_row
  from public.hosting_requests hr
  where hr.id = p_request_id
    and hr.sender_user_id = v_me
  limit 1;

  if v_row.id is null then
    raise exception 'hosting_request_not_found';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'hosting_request_not_pending';
  end if;

  update public.hosting_requests
  set status = 'cancelled',
      decided_by = v_me,
      decided_at = now(),
      updated_at = now()
  where id = v_row.id;

  if to_regprocedure('public.create_notification(uuid,text,text,text,text,jsonb)') is not null then
    perform public.create_notification(
      v_row.recipient_user_id,
      'hosting_request_cancelled',
      'Hosting request cancelled',
      'A pending hosting request was cancelled.',
      '/trips/hosting',
      jsonb_build_object('hosting_request_id', v_row.id, 'status', 'cancelled')
    );
  end if;

  return v_row.id;
end;
$function$;

grant execute on function public.cancel_hosting_request(uuid) to authenticated;

commit;
