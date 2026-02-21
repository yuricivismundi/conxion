-- ConXion Events module (MVP)
-- Date: 2026-02-11
--
-- Includes:
-- - Public/private events
-- - Event join + private invite-request flow
-- - Organizer request inbox actions (accept/decline)
-- - RLS + DB-enforced trust checks

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- Tables
-- =========================================================

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null,
  title text not null,
  description text,
  event_type text not null default 'Social',
  visibility text not null default 'public',
  city text not null,
  country text not null,
  venue_name text,
  venue_address text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer,
  cover_url text,
  links jsonb not null default '[]'::jsonb,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.events add column if not exists host_user_id uuid;
alter table public.events add column if not exists title text;
alter table public.events add column if not exists description text;
alter table public.events add column if not exists event_type text default 'Social';
alter table public.events add column if not exists visibility text default 'public';
alter table public.events add column if not exists city text;
alter table public.events add column if not exists country text;
alter table public.events add column if not exists venue_name text;
alter table public.events add column if not exists venue_address text;
alter table public.events add column if not exists starts_at timestamptz;
alter table public.events add column if not exists ends_at timestamptz;
alter table public.events add column if not exists capacity integer;
alter table public.events add column if not exists cover_url text;
alter table public.events add column if not exists links jsonb default '[]'::jsonb;
alter table public.events add column if not exists status text default 'published';
alter table public.events add column if not exists created_at timestamptz default now();
alter table public.events add column if not exists updated_at timestamptz default now();

update public.events
set links = '[]'::jsonb
where links is null;

alter table public.events
  alter column links set default '[]'::jsonb;

create table if not exists public.event_members (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null,
  member_role text not null default 'guest',
  status text not null default 'going',
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);

alter table public.event_members add column if not exists event_id uuid;
alter table public.event_members add column if not exists user_id uuid;
alter table public.event_members add column if not exists member_role text default 'guest';
alter table public.event_members add column if not exists status text default 'going';
alter table public.event_members add column if not exists joined_at timestamptz default now();
alter table public.event_members add column if not exists created_at timestamptz default now();
alter table public.event_members add column if not exists updated_at timestamptz default now();

create table if not exists public.event_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  requester_id uuid not null,
  note text,
  status text not null default 'pending',
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, requester_id)
);

alter table public.event_requests add column if not exists event_id uuid;
alter table public.event_requests add column if not exists requester_id uuid;
alter table public.event_requests add column if not exists note text;
alter table public.event_requests add column if not exists status text default 'pending';
alter table public.event_requests add column if not exists decided_by uuid;
alter table public.event_requests add column if not exists decided_at timestamptz;
alter table public.event_requests add column if not exists created_at timestamptz default now();
alter table public.event_requests add column if not exists updated_at timestamptz default now();

-- =========================================================
-- Constraints + indexes
-- =========================================================

do $$
begin
  begin
    alter table public.events
      add constraint events_visibility_chk
      check (visibility in ('public', 'private'));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.events
      add constraint events_status_chk
      check (status in ('draft', 'published', 'cancelled'));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.events
      add constraint events_time_chk
      check (ends_at > starts_at);
  exception when duplicate_object then null;
  end;

  begin
    alter table public.events
      add constraint events_capacity_chk
      check (capacity is null or (capacity between 1 and 2000));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.event_members
      add constraint event_members_status_chk
      check (status in ('host', 'going', 'waitlist', 'left'));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.event_requests
      add constraint event_requests_status_chk
      check (status in ('pending', 'accepted', 'declined', 'cancelled'));
  exception when duplicate_object then null;
  end;
end $$;

create index if not exists idx_events_host on public.events(host_user_id);
create index if not exists idx_events_visibility_status_starts on public.events(visibility, status, starts_at desc);
create index if not exists idx_events_city_country on public.events(city, country);

create index if not exists idx_event_members_event on public.event_members(event_id);
create index if not exists idx_event_members_user on public.event_members(user_id);
create index if not exists idx_event_members_event_status on public.event_members(event_id, status);

create index if not exists idx_event_requests_event on public.event_requests(event_id);
create index if not exists idx_event_requests_requester on public.event_requests(requester_id);
create index if not exists idx_event_requests_event_status on public.event_requests(event_id, status);

-- =========================================================
-- Helpers + triggers
-- =========================================================

create or replace function public.set_event_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.event_is_host(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
set search_path = public
as $function$
  select exists(
    select 1
    from public.events e
    where e.id = p_event_id
      and e.host_user_id = p_user_id
  );
$function$;

create or replace function public.event_has_capacity(p_event_id uuid)
returns boolean
language sql
stable
set search_path = public
as $function$
  with target as (
    select e.id, e.capacity
    from public.events e
    where e.id = p_event_id
  ), current_count as (
    select count(*)::int as going_count
    from public.event_members em
    where em.event_id = p_event_id
      and em.status in ('host', 'going')
  )
  select
    case
      when t.capacity is null then true
      else c.going_count < t.capacity
    end
  from target t
  cross join current_count c;
$function$;

drop trigger if exists trg_events_set_updated_at on public.events;
create trigger trg_events_set_updated_at
before update on public.events
for each row execute function public.set_event_updated_at();

drop trigger if exists trg_event_members_set_updated_at on public.event_members;
create trigger trg_event_members_set_updated_at
before update on public.event_members
for each row execute function public.set_event_updated_at();

drop trigger if exists trg_event_requests_set_updated_at on public.event_requests;
create trigger trg_event_requests_set_updated_at
before update on public.event_requests
for each row execute function public.set_event_updated_at();

-- =========================================================
-- RLS
-- =========================================================

alter table public.events enable row level security;
alter table public.event_members enable row level security;
alter table public.event_requests enable row level security;

drop policy if exists events_select_visible on public.events;
create policy events_select_visible
on public.events
for select
to authenticated
using (
  host_user_id = auth.uid()
  or (
    status = 'published'
    and visibility = 'public'
  )
);

drop policy if exists events_insert_host on public.events;
create policy events_insert_host
on public.events
for insert
to authenticated
with check (host_user_id = auth.uid());

drop policy if exists events_update_host on public.events;
create policy events_update_host
on public.events
for update
to authenticated
using (host_user_id = auth.uid())
with check (host_user_id = auth.uid());

drop policy if exists events_delete_host on public.events;
create policy events_delete_host
on public.events
for delete
to authenticated
using (host_user_id = auth.uid());

drop policy if exists event_members_select_visible on public.event_members;
create policy event_members_select_visible
on public.event_members
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.events e
    where e.id = event_members.event_id
      and e.host_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.events e
    where e.id = event_members.event_id
      and e.status = 'published'
      and e.visibility = 'public'
  )
);

drop policy if exists event_requests_select_parties on public.event_requests;
create policy event_requests_select_parties
on public.event_requests
for select
to authenticated
using (
  requester_id = auth.uid()
  or exists (
    select 1
    from public.events e
    where e.id = event_requests.event_id
      and e.host_user_id = auth.uid()
  )
);

drop policy if exists event_requests_insert_owner on public.event_requests;
create policy event_requests_insert_owner
on public.event_requests
for insert
to authenticated
with check (requester_id = auth.uid());

-- =========================================================
-- RPCs (DB-backed guards)
-- =========================================================

create or replace function public.create_event(
  p_title text,
  p_description text,
  p_event_type text,
  p_visibility text,
  p_city text,
  p_country text,
  p_venue_name text,
  p_venue_address text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_capacity integer default null,
  p_cover_url text default null,
  p_links jsonb default '[]'::jsonb,
  p_status text default 'published'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_visibility text := lower(trim(coalesce(p_visibility, 'public')));
  v_status text := lower(trim(coalesce(p_status, 'published')));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if trim(coalesce(p_title, '')) = '' then
    raise exception 'title_required';
  end if;

  if trim(coalesce(p_city, '')) = '' or trim(coalesce(p_country, '')) = '' then
    raise exception 'location_required';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_event_window';
  end if;

  if v_visibility not in ('public', 'private') then
    raise exception 'invalid_visibility';
  end if;

  if v_status not in ('draft', 'published') then
    raise exception 'invalid_status';
  end if;

  if p_capacity is not null and (p_capacity < 1 or p_capacity > 2000) then
    raise exception 'invalid_capacity';
  end if;

  insert into public.events (
    host_user_id,
    title,
    description,
    event_type,
    visibility,
    city,
    country,
    venue_name,
    venue_address,
    starts_at,
    ends_at,
    capacity,
    cover_url,
    links,
    status
  ) values (
    v_me,
    trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''),
    coalesce(nullif(trim(coalesce(p_event_type, '')), ''), 'Social'),
    v_visibility,
    trim(p_city),
    trim(p_country),
    nullif(trim(coalesce(p_venue_name, '')), ''),
    nullif(trim(coalesce(p_venue_address, '')), ''),
    p_starts_at,
    p_ends_at,
    p_capacity,
    nullif(trim(coalesce(p_cover_url, '')), ''),
    coalesce(p_links, '[]'::jsonb),
    v_status
  )
  returning id into v_id;

  insert into public.event_members (event_id, user_id, member_role, status)
  values (v_id, v_me, 'host', 'host')
  on conflict (event_id, user_id)
  do update set
    member_role = 'host',
    status = 'host',
    updated_at = now();

  return v_id;
end;
$function$;

create or replace function public.join_public_event(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_existing public.event_members;
  v_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_event.visibility <> 'public' then
    raise exception 'private_event_requires_request';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open';
  end if;

  if v_event.host_user_id = v_me then
    return 'host';
  end if;

  select *
    into v_existing
  from public.event_members em
  where em.event_id = p_event_id
    and em.user_id = v_me
  limit 1;

  if v_existing is not null and v_existing.status in ('going', 'host', 'waitlist') then
    return v_existing.status;
  end if;

  if public.event_has_capacity(p_event_id) then
    v_status := 'going';
  else
    v_status := 'waitlist';
  end if;

  insert into public.event_members (event_id, user_id, member_role, status)
  values (p_event_id, v_me, 'guest', v_status)
  on conflict (event_id, user_id)
  do update set
    status = excluded.status,
    member_role = 'guest',
    updated_at = now();

  return v_status;
end;
$function$;

create or replace function public.request_private_event_access(
  p_event_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_existing_member public.event_members;
  v_req_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open';
  end if;

  if v_event.visibility <> 'private' then
    raise exception 'event_is_public';
  end if;

  if v_event.host_user_id = v_me then
    raise exception 'host_cannot_request_own_event';
  end if;

  select *
    into v_existing_member
  from public.event_members em
  where em.event_id = p_event_id
    and em.user_id = v_me
    and em.status in ('host', 'going', 'waitlist')
  limit 1;

  if v_existing_member is not null then
    raise exception 'already_joined_or_waitlisted';
  end if;

  insert into public.event_requests (event_id, requester_id, note, status)
  values (p_event_id, v_me, nullif(trim(coalesce(p_note, '')), ''), 'pending')
  on conflict (event_id, requester_id)
  do update set
    note = excluded.note,
    status = 'pending',
    decided_by = null,
    decided_at = null,
    updated_at = now()
  returning id into v_req_id;

  return v_req_id;
end;
$function$;

create or replace function public.respond_event_request(
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
  v_request public.event_requests;
  v_event public.events;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_member_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if v_action not in ('accept', 'decline') then
    raise exception 'invalid_action';
  end if;

  select *
    into v_request
  from public.event_requests r
  where r.id = p_request_id
  limit 1;

  if v_request is null then
    raise exception 'request_not_found';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = v_request.event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_event.host_user_id <> v_me then
    raise exception 'not_authorized';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  if v_action = 'accept' then
    if public.event_has_capacity(v_event.id) then
      v_member_status := 'going';
    else
      v_member_status := 'waitlist';
    end if;

    insert into public.event_members (event_id, user_id, member_role, status)
    values (v_event.id, v_request.requester_id, 'guest', v_member_status)
    on conflict (event_id, user_id)
    do update set
      member_role = 'guest',
      status = excluded.status,
      updated_at = now();

    update public.event_requests
      set status = 'accepted',
          decided_by = v_me,
          decided_at = now(),
          updated_at = now()
    where id = p_request_id;
  else
    update public.event_requests
      set status = 'declined',
          decided_by = v_me,
          decided_at = now(),
          updated_at = now()
    where id = p_request_id;
  end if;

  return v_event.id;
end;
$function$;

create or replace function public.cancel_event_request(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  update public.event_requests r
    set status = 'cancelled',
        decided_by = null,
        decided_at = null,
        updated_at = now()
  where r.event_id = p_event_id
    and r.requester_id = v_me
    and r.status = 'pending';

  if not found then
    raise exception 'request_not_found_or_not_pending';
  end if;
end;
$function$;

create or replace function public.leave_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_host uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select e.host_user_id into v_host
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_host is null then
    raise exception 'event_not_found';
  end if;

  if v_host = v_me then
    raise exception 'host_cannot_leave_own_event';
  end if;

  update public.event_members em
    set status = 'left',
        updated_at = now()
  where em.event_id = p_event_id
    and em.user_id = v_me
    and em.status in ('going', 'waitlist');

  if not found then
    raise exception 'membership_not_found';
  end if;
end;
$function$;

grant execute on function public.create_event(text, text, text, text, text, text, text, text, timestamptz, timestamptz, integer, text, jsonb, text) to authenticated;
grant execute on function public.join_public_event(uuid) to authenticated;
grant execute on function public.request_private_event_access(uuid, text) to authenticated;
grant execute on function public.respond_event_request(uuid, text) to authenticated;
grant execute on function public.cancel_event_request(uuid) to authenticated;
grant execute on function public.leave_event(uuid) to authenticated;

commit;
