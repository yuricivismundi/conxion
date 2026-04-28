-- ============================================================
-- COMBINED MIGRATION — run in order in Supabase SQL editor
-- Date: 2026-04-15
-- Covers:
--   1. request_chat_entitlements  (request-linked chat windows)
--   2. groups event_id            (create group from event)
--   3. group message rate limits  (plan-based caps)
--   4. RLS on interaction counters
--   5. Fix function search_paths  (security)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. REQUEST CHAT ENTITLEMENTS
--    Time-bounded chat windows that do not consume normal
--    active chat slots.  Covers hosting + activity requests.
-- ────────────────────────────────────────────────────────────

begin;

create table if not exists public.request_chat_entitlements (
  id                uuid primary key default gen_random_uuid(),
  thread_id         uuid not null references public.threads(id) on delete cascade,
  source_type       text not null,
  source_id         uuid not null,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  responder_user_id uuid not null references auth.users(id) on delete cascade,
  status            text not null default 'scheduled'
                    check (status in ('scheduled', 'active', 'expired', 'cancelled')),
  opens_at          timestamptz not null,
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (expires_at > opens_at)
);

create index if not exists idx_rce_thread_id   on public.request_chat_entitlements(thread_id);
create index if not exists idx_rce_requester   on public.request_chat_entitlements(requester_user_id);
create index if not exists idx_rce_responder   on public.request_chat_entitlements(responder_user_id);
create index if not exists idx_rce_status      on public.request_chat_entitlements(status);
create index if not exists idx_rce_opens_at    on public.request_chat_entitlements(opens_at);
create index if not exists idx_rce_expires_at  on public.request_chat_entitlements(expires_at);
create unique index if not exists ux_rce_source on public.request_chat_entitlements(source_type, source_id);

create or replace function public.rce_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists rce_updated_at on public.request_chat_entitlements;
create trigger rce_updated_at
  before update on public.request_chat_entitlements
  for each row execute function public.rce_set_updated_at();

alter table public.request_chat_entitlements enable row level security;

drop policy if exists rce_select on public.request_chat_entitlements;
create policy rce_select on public.request_chat_entitlements for select
  using (
    requester_user_id = auth.uid() or responder_user_id = auth.uid()
  );

drop policy if exists rce_insert on public.request_chat_entitlements;
create policy rce_insert on public.request_chat_entitlements for insert
  with check (false);

drop policy if exists rce_update on public.request_chat_entitlements;
create policy rce_update on public.request_chat_entitlements for update
  using (false);

-- Read-time status evaluator (immutable — safe to call inline)
create or replace function public.cx_rce_current_status(
  p_opens_at   timestamptz,
  p_expires_at timestamptz,
  p_status     text
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_status = 'cancelled' then 'cancelled'
    when now() < p_opens_at    then 'scheduled'
    when now() > p_expires_at  then 'expired'
    else 'active'
  end;
$$;

-- Upsert entitlement — callable by service role via RPC
create or replace function public.cx_upsert_request_chat_entitlement(
  p_thread_id         uuid,
  p_source_type       text,
  p_source_id         uuid,
  p_requester_user_id uuid,
  p_responder_user_id uuid,
  p_opens_at          timestamptz,
  p_expires_at        timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_status text;
begin
  v_status := public.cx_rce_current_status(p_opens_at, p_expires_at, 'scheduled');

  insert into public.request_chat_entitlements (
    thread_id, source_type, source_id,
    requester_user_id, responder_user_id,
    status, opens_at, expires_at
  ) values (
    p_thread_id, p_source_type, p_source_id,
    p_requester_user_id, p_responder_user_id,
    v_status, p_opens_at, p_expires_at
  )
  on conflict (source_type, source_id) do update set
    thread_id         = excluded.thread_id,
    opens_at          = excluded.opens_at,
    expires_at        = excluded.expires_at,
    status            = public.cx_rce_current_status(excluded.opens_at, excluded.expires_at,
                          case when request_chat_entitlements.status = 'cancelled' then 'cancelled' else 'scheduled' end),
    updated_at        = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Cancel entitlement (on request cancellation)
create or replace function public.cx_cancel_request_chat_entitlement(
  p_source_type text,
  p_source_id   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.request_chat_entitlements
  set status = 'cancelled', updated_at = now()
  where source_type = p_source_type
    and source_id = p_source_id
    and status in ('scheduled', 'active');
end;
$$;

-- Fetch active/scheduled entitlement for a thread (called by messages page)
create or replace function public.cx_get_thread_entitlement(p_thread_id uuid, p_user_id uuid)
returns table (
  id                uuid,
  source_type       text,
  source_id         uuid,
  opens_at          timestamptz,
  expires_at        timestamptz,
  effective_status  text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.source_type,
    e.source_id,
    e.opens_at,
    e.expires_at,
    public.cx_rce_current_status(e.opens_at, e.expires_at, e.status) as effective_status
  from public.request_chat_entitlements e
  where e.thread_id = p_thread_id
    and (e.requester_user_id = p_user_id or e.responder_user_id = p_user_id)
    and e.status != 'cancelled'
  order by e.opens_at desc
  limit 1;
$$;

grant execute on function public.cx_rce_current_status(timestamptz,timestamptz,text)              to authenticated, service_role;
grant execute on function public.cx_upsert_request_chat_entitlement(uuid,text,uuid,uuid,uuid,timestamptz,timestamptz) to authenticated, service_role;
grant execute on function public.cx_cancel_request_chat_entitlement(text,uuid)                   to authenticated, service_role;
grant execute on function public.cx_get_thread_entitlement(uuid,uuid)                            to authenticated;

commit;


-- ────────────────────────────────────────────────────────────
-- 2. GROUPS — ADD event_id
--    Nullable link to the source event (creation context only).
--    Group membership does NOT sync with event attendance.
-- ────────────────────────────────────────────────────────────

alter table public.groups
  add column if not exists event_id uuid references public.events(id) on delete set null;

create index if not exists idx_groups_event_id on public.groups(event_id) where event_id is not null;


-- ────────────────────────────────────────────────────────────
-- 3. GROUP MESSAGE RATE LIMITS
--    Starter: 3 groups / 50 user msgs/day / 200 group msgs/day
--    Plus:   10 groups / 100 user msgs/day / 500 group msgs/day
-- ────────────────────────────────────────────────────────────

begin;

create or replace function public.cx_group_user_messages_today(
  p_group_id uuid,
  p_user_id  uuid
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(count(*)::int, 0)
  from public.thread_messages tm
  join public.threads t on t.id = tm.thread_id
  where t.group_id = p_group_id
    and t.thread_type = 'group'
    and tm.sender_id = p_user_id
    and tm.created_at >= date_trunc('day', now() at time zone 'utc');
$$;

create or replace function public.cx_group_messages_today(p_group_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(count(*)::int, 0)
  from public.thread_messages tm
  join public.threads t on t.id = tm.thread_id
  where t.group_id = p_group_id
    and t.thread_type = 'group'
    and tm.created_at >= date_trunc('day', now() at time zone 'utc');
$$;

create or replace function public.cx_check_group_message_allowed(
  p_group_id uuid,
  p_user_id  uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan            text;
  v_is_owner        boolean;
  v_user_daily_max  int;
  v_group_daily_max int;
  v_chat_mode       text;
begin
  select coalesce(plan, 'starter') into v_plan
  from public.profiles
  where user_id = p_user_id;

  select chat_mode, (host_user_id = p_user_id) into v_chat_mode, v_is_owner
  from public.groups
  where id = p_group_id;

  if v_chat_mode = 'broadcast' and not v_is_owner then
    raise exception 'broadcast_only_owner';
  end if;

  if v_plan = 'pro' then
    v_user_daily_max  := 100;
    v_group_daily_max := 500;
  else
    v_user_daily_max  := 50;
    v_group_daily_max := 200;
  end if;

  if public.cx_group_user_messages_today(p_group_id, p_user_id) >= v_user_daily_max then
    raise exception 'group_user_daily_limit_reached';
  end if;

  if public.cx_group_messages_today(p_group_id) >= v_group_daily_max then
    raise exception 'group_daily_limit_reached';
  end if;

  return true;
end;
$$;

create or replace function public.cx_check_group_create_allowed(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    text;
  v_max     int;
  v_current int;
begin
  select coalesce(plan, 'starter') into v_plan
  from public.profiles
  where user_id = p_user_id;

  v_max := case when v_plan = 'pro' then 10 else 3 end;

  select count(*) into v_current
  from public.groups
  where host_user_id = p_user_id;

  if v_current >= v_max then
    raise exception 'group_limit_reached';
  end if;

  return true;
end;
$$;

grant execute on function public.cx_check_group_message_allowed(uuid, uuid) to authenticated;
grant execute on function public.cx_group_user_messages_today(uuid, uuid)   to authenticated;
grant execute on function public.cx_group_messages_today(uuid)              to authenticated;
grant execute on function public.cx_check_group_create_allowed(uuid)        to authenticated;

commit;


-- ────────────────────────────────────────────────────────────
-- 4. RLS ON INTERACTION COUNTER TABLES
--    These are written by security-definer functions only.
--    Enabling RLS with no permissive policies blocks direct
--    client reads/writes.
-- ────────────────────────────────────────────────────────────

alter table public.member_interaction_counters enable row level security;
alter table public.pair_interaction_counters   enable row level security;


-- ────────────────────────────────────────────────────────────
-- 5. FIX FUNCTION search_path (security hardening)
--    Prevents search_path injection on all functions that
--    were missing an explicit set search_path = public.
-- ────────────────────────────────────────────────────────────

alter function public.cx_reference_author_id             set search_path = public;
alter function public.cx_reference_recipient_id          set search_path = public;
alter function public.cx_reference_context_key           set search_path = public;
alter function public.cx_reference_public_category       set search_path = public;
alter function public.cx_reference_family                set search_path = public;
alter function public.cx_reference_cooldown_days         set search_path = public;
alter function public.cx_reference_source_type           set search_path = public;

alter function public.cx_normalize_trip_join_reason      set search_path = public;
alter function public.cx_trip_join_reason_label          set search_path = public;
alter function public.cx_normalize_hosting_space_type    set search_path = public;
alter function public.cx_hosting_space_type_label        set search_path = public;
alter function public.cx_normalize_activity_type         set search_path = public;
alter function public.cx_activity_type_label             set search_path = public;
alter function public.cx_activity_reference_context      set search_path = public;
alter function public.cx_activity_uses_date_range        set search_path = public;
alter function public.cx_normalize_travel_intent_reason  set search_path = public;
alter function public.cx_travel_intent_reason_label      set search_path = public;

alter function public.cx_messaging_cycle_bounds          set search_path = public;
alter function public.cx_count_user_active_threads       set search_path = public;
alter function public.cx_thread_message_unlocked         set search_path = public;

alter function public.event_legacy_visibility_for_access set search_path = public;
alter function public.event_chat_mode_for_access         set search_path = public;
alter function public.set_event_invitation_updated_at    set search_path = public;

alter function public.cx_refresh_member_interaction_counters  set search_path = public;

alter function public.cancel_trip_request                set search_path = public;
alter function public.respond_trip_request               set search_path = public;
alter function public.create_notification                set search_path = public;

alter function public.groups_set_updated_at              set search_path = public;

-- Drop overly-broad storage bucket policy (avatars public listing)
drop policy if exists "Read avatars" on storage.objects;
