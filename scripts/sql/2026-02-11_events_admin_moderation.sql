-- ConXion Events admin moderation + cover approval hardening
-- Date: 2026-02-11
--
-- Covers:
-- - Event cover moderation fields and admin hide flags
-- - Admin-aware event policies
-- - DB-backed admin moderation RPC with audit logging
-- - create_event/join/request guardrails for hidden events + cover URL checks

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- Admin helper
-- =========================================================

create or replace function public.is_app_admin(p_user_id uuid)
returns boolean
language plpgsql
stable
set search_path = public
as $function$
declare
  v_is_admin bool := false;
begin
  if p_user_id is null then
    return false;
  end if;

  if to_regclass('public.admins') is null then
    return false;
  end if;

  begin
    execute 'select exists (select 1 from public.admins a where a.user_id = $1)' into v_is_admin using p_user_id;
  exception
    when undefined_column then
      v_is_admin := false;
  end;

  return coalesce(v_is_admin, false);
end;
$function$;

-- =========================================================
-- Moderation logs baseline (for event audit trail)
-- =========================================================

create table if not exists public.moderation_logs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid,
  actor_id uuid not null,
  target_user_id uuid,
  action text not null,
  reason text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.moderation_logs add column if not exists report_id uuid;
alter table public.moderation_logs add column if not exists actor_id uuid;
alter table public.moderation_logs add column if not exists target_user_id uuid;
alter table public.moderation_logs add column if not exists action text;
alter table public.moderation_logs add column if not exists reason text;
alter table public.moderation_logs add column if not exists note text;
alter table public.moderation_logs add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.moderation_logs add column if not exists created_at timestamptz default now();

create index if not exists idx_moderation_logs_report_id on public.moderation_logs(report_id);
create index if not exists idx_moderation_logs_actor_id on public.moderation_logs(actor_id);
create index if not exists idx_moderation_logs_created_at on public.moderation_logs(created_at desc);

alter table public.moderation_logs enable row level security;

drop policy if exists moderation_logs_select_admin on public.moderation_logs;
create policy moderation_logs_select_admin
on public.moderation_logs for select
to authenticated
using (public.is_app_admin(auth.uid()));

-- =========================================================
-- Events table moderation fields
-- =========================================================

do $$
begin
  if to_regclass('public.events') is null then
    raise notice 'public.events table not found; run 2026-02-11_events_module.sql first.';
  else
    alter table public.events add column if not exists cover_status text default 'pending';
    alter table public.events add column if not exists cover_reviewed_by uuid;
    alter table public.events add column if not exists cover_reviewed_at timestamptz;
    alter table public.events add column if not exists cover_review_note text;
    alter table public.events add column if not exists hidden_by_admin boolean not null default false;
    alter table public.events add column if not exists hidden_reason text;
    alter table public.events add column if not exists hidden_by uuid;
    alter table public.events add column if not exists hidden_at timestamptz;

    update public.events
    set cover_status = case
      when nullif(trim(coalesce(cover_url, '')), '') is null then 'approved'
      when lower(trim(coalesce(cover_status, ''))) in ('pending', 'approved', 'rejected') then lower(trim(coalesce(cover_status, '')))
      else 'pending'
    end
    where cover_status is null
       or lower(trim(coalesce(cover_status, ''))) not in ('pending', 'approved', 'rejected');

    update public.events
    set hidden_by_admin = false
    where hidden_by_admin is null;

    begin
      alter table public.events
        add constraint events_cover_status_chk
        check (cover_status in ('pending', 'approved', 'rejected'));
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;

-- =========================================================
-- Policy hardening for admin + hidden events
-- =========================================================

do $$
begin
  if to_regclass('public.events') is null then
    raise notice 'public.events table not found; skipping events policy hardening.';
  else
    execute 'drop policy if exists events_select_visible on public.events';
    execute $policy$
      create policy events_select_visible
      on public.events
      for select
      to authenticated
      using (
        public.is_app_admin(auth.uid())
        or host_user_id = auth.uid()
        or (
          coalesce(hidden_by_admin, false) = false
          and (
            status = 'published' and visibility in ('public', 'private')
          )
        )
      )
    $policy$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.event_members') is null then
    raise notice 'public.event_members table not found; skipping event_members policy hardening.';
  else
    execute 'drop policy if exists event_members_select_visible on public.event_members';
    execute $policy$
      create policy event_members_select_visible
      on public.event_members
      for select
      to authenticated
      using (
        public.is_app_admin(auth.uid())
        or user_id = auth.uid()
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
            and coalesce(e.hidden_by_admin, false) = false
        )
      )
    $policy$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.event_requests') is null then
    raise notice 'public.event_requests table not found; skipping event_requests policy hardening.';
  else
    execute 'drop policy if exists event_requests_select_parties on public.event_requests';
    execute $policy$
      create policy event_requests_select_parties
      on public.event_requests
      for select
      to authenticated
      using (
        public.is_app_admin(auth.uid())
        or requester_id = auth.uid()
        or exists (
          select 1
          from public.events e
          where e.id = event_requests.event_id
            and e.host_user_id = auth.uid()
        )
      )
    $policy$;

    execute 'drop policy if exists event_requests_insert_owner on public.event_requests';
    execute $policy$
      create policy event_requests_insert_owner
      on public.event_requests
      for insert
      to authenticated
      with check (
        requester_id = auth.uid()
        and exists (
          select 1
          from public.events e
          where e.id = event_requests.event_id
            and e.status = 'published'
            and e.visibility = 'private'
            and coalesce(e.hidden_by_admin, false) = false
            and e.host_user_id <> auth.uid()
        )
      )
    $policy$;
  end if;
end $$;

-- =========================================================
-- Hardened create_event with cover URL checks + moderation defaults
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
  v_cover_url text := nullif(trim(coalesce(p_cover_url, '')), '');
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

  if v_cover_url is not null then
    if v_cover_url !~* '/storage/v1/object/public/avatars/' then
      raise exception 'invalid_cover_url';
    end if;
    if v_cover_url !~* '\.(jpg|jpeg|png|webp)(\?.*)?$' then
      raise exception 'invalid_cover_format';
    end if;
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
    cover_status,
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
    v_cover_url,
    case when v_cover_url is null then 'approved' else 'pending' end,
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

-- =========================================================
-- Hidden event guardrails on event access RPCs
-- =========================================================

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

  if coalesce(v_event.hidden_by_admin, false) then
    raise exception 'event_hidden';
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

  if coalesce(v_event.hidden_by_admin, false) then
    raise exception 'event_hidden';
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

  if coalesce(v_event.hidden_by_admin, false) then
    raise exception 'event_hidden';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open';
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

-- =========================================================
-- Admin event moderation RPC + audit trail
-- =========================================================

create or replace function public.moderate_event(
  p_event_id uuid,
  p_action text,
  p_note text default null,
  p_hidden_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_hidden_reason text := nullif(trim(coalesce(p_hidden_reason, '')), '');
  v_log_id uuid;
  v_after_status text;
  v_after_cover_status text;
  v_after_hidden bool;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if not public.is_app_admin(v_me) then
    raise exception 'not_authorized';
  end if;

  if v_action not in ('approve_cover', 'reject_cover', 'hide', 'unhide', 'cancel', 'publish') then
    raise exception 'invalid_action';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_action = 'approve_cover' then
    if nullif(trim(coalesce(v_event.cover_url, '')), '') is null then
      raise exception 'event_cover_missing';
    end if;

    update public.events
      set cover_status = 'approved',
          cover_reviewed_by = v_me,
          cover_reviewed_at = now(),
          cover_review_note = v_note,
          updated_at = now()
    where id = p_event_id;
  elsif v_action = 'reject_cover' then
    if nullif(trim(coalesce(v_event.cover_url, '')), '') is null then
      raise exception 'event_cover_missing';
    end if;

    update public.events
      set cover_status = 'rejected',
          cover_reviewed_by = v_me,
          cover_reviewed_at = now(),
          cover_review_note = coalesce(v_note, 'Cover rejected by moderation.'),
          updated_at = now()
    where id = p_event_id;
  elsif v_action = 'hide' then
    update public.events
      set hidden_by_admin = true,
          hidden_reason = coalesce(v_hidden_reason, v_note, 'Hidden by moderation'),
          hidden_by = v_me,
          hidden_at = now(),
          updated_at = now()
    where id = p_event_id;
  elsif v_action = 'unhide' then
    update public.events
      set hidden_by_admin = false,
          hidden_reason = null,
          hidden_by = null,
          hidden_at = null,
          updated_at = now()
    where id = p_event_id;
  elsif v_action = 'cancel' then
    update public.events
      set status = 'cancelled',
          updated_at = now()
    where id = p_event_id;
  elsif v_action = 'publish' then
    update public.events
      set status = 'published',
          updated_at = now()
    where id = p_event_id;
  end if;

  select status, cover_status, hidden_by_admin
    into v_after_status, v_after_cover_status, v_after_hidden
  from public.events
  where id = p_event_id;

  if to_regclass('public.moderation_logs') is not null then
    insert into public.moderation_logs (
      report_id,
      actor_id,
      target_user_id,
      action,
      reason,
      note,
      metadata
    )
    values (
      null,
      v_me,
      v_event.host_user_id,
      'event_' || v_action,
      v_hidden_reason,
      v_note,
      jsonb_build_object(
        'event_id', v_event.id,
        'event_title', v_event.title,
        'from_status', v_event.status,
        'to_status', v_after_status,
        'from_cover_status', coalesce(v_event.cover_status, 'pending'),
        'to_cover_status', coalesce(v_after_cover_status, 'pending'),
        'from_hidden', coalesce(v_event.hidden_by_admin, false),
        'to_hidden', coalesce(v_after_hidden, false),
        'visibility', v_event.visibility
      )
    )
    returning id into v_log_id;
  else
    v_log_id := null;
  end if;

  return v_log_id;
end;
$function$;

grant execute on function public.moderate_event(uuid, text, text, text) to authenticated;

commit;
