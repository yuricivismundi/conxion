-- ConXion production release: run this whole file once in the Supabase SQL Editor (production project).
-- Contains, in order: early_access_free, protect_profile_moderation_fields, member_invites, beta_feedback.

-- ════════════════ 2026-10-20_early_access_free.sql ════════════════
-- ConXion early access: everything free, Plus-level limits for every account.
--
-- Pairs with lib/billing/early-access.ts (NEXT_PUBLIC_EARLY_ACCESS).
-- Run on STAGING first, verify, then production:
--   npm run db:run-sql -- scripts/sql/2026-10-20_early_access_free.sql
--   (or paste into the Supabase SQL editor)
--
-- To END early access later: redefine public.is_early_access() to return false
-- and set NEXT_PUBLIC_EARLY_ACCESS=false. Every function below falls back to
-- its original paid-plan behaviour.

begin;

-- ── 1. Global switch ────────────────────────────────────────────────────────
create or replace function public.is_early_access()
returns boolean
language sql
stable
set search_path = public
as $function$
  select true;
$function$;

grant execute on function public.is_early_access() to anon, authenticated, service_role;

-- ── 2. Events: 5 active events per member (Plus level) ─────────────────────
create or replace function public.active_event_limit_for_user(p_user_id uuid)
returns integer
language plpgsql
stable
set search_path = public
as $function$
declare
  v_pro_status text := null;
begin
  if public.is_app_admin(p_user_id) then
    return 100;
  end if;

  -- Verified organizers keep their higher cap (production behaviour).
  if public.is_organizer_verified(p_user_id) then
    return 25;
  end if;

  if public.is_early_access() then
    return 5;
  end if;

  select lower(trim(coalesce(u.raw_user_meta_data ->> 'billing_pro_status', '')))
    into v_pro_status
  from auth.users u
  where u.id = p_user_id
  limit 1;

  if coalesce(v_pro_status, '') in ('trialing', 'active', 'past_due') then
    return 5;
  end if;

  return 3;
end;
$function$;

-- ── 3. Private groups and group slots (Plus level) ─────────────────────────
create or replace function public.private_group_limit_for_user(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_pro_status text := null;
begin
  if public.is_app_admin(p_user_id) then
    return 500;
  end if;

  if public.is_early_access() then
    return 25;
  end if;

  select lower(trim(coalesce(u.raw_user_meta_data ->> 'billing_pro_status', '')))
    into v_pro_status
  from auth.users u
  where u.id = p_user_id
  limit 1;

  if coalesce(v_pro_status, '') in ('trialing', 'active', 'past_due') then
    return 25;
  end if;

  return 5;
end;
$function$;

create or replace function public.group_slot_limit_for_user(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_pro_status text := null;
begin
  if public.is_app_admin(p_user_id) then
    return 500;
  end if;

  if public.is_early_access() then
    return 25;
  end if;

  select lower(trim(coalesce(u.raw_user_meta_data ->> 'billing_pro_status', '')))
    into v_pro_status
  from auth.users u
  where u.id = p_user_id
  limit 1;

  if coalesce(v_pro_status, '') in ('trialing', 'active', 'past_due') then
    return 25;
  end if;

  return 5;
end;
$function$;

-- ── 4. Trips: 5 active trips, 3 accepted per month (Plus level) ────────────
create or replace function public.trip_plan_limits(p_user uuid)
returns table(max_active_trips integer, max_accepted_trips_per_month integer, plan_label text)
language plpgsql
stable
set search_path = public
as $function$
declare
  v_profile jsonb := '{}'::jsonb;
  v_plan_text text := '';
  v_boolean_text text := 'false';
  v_is_plus boolean := false;
begin
  if public.is_early_access() then
    return query select 5, 3, 'early_access'::text;
    return;
  end if;

  select coalesce(to_jsonb(p), '{}'::jsonb)
    into v_profile
  from public.profiles p
  where p.user_id = p_user
  limit 1;

  v_plan_text := lower(
    trim(
      coalesce(
        nullif(v_profile ->> 'trip_plan', ''),
        nullif(v_profile ->> 'plan_tier', ''),
        nullif(v_profile ->> 'membership_tier', ''),
        nullif(v_profile ->> 'subscription_tier', ''),
        nullif(v_profile ->> 'billing_tier', ''),
        nullif(v_profile ->> 'plan', ''),
        nullif(v_profile ->> 'tier', ''),
        nullif(v_profile ->> 'account_tier', ''),
        ''
      )
    )
  );

  if v_plan_text in ('plus', 'pro', 'premium', 'paid') then
    v_is_plus := true;
  else
    v_boolean_text := lower(
      trim(
        coalesce(
          nullif(v_profile ->> 'is_plus', ''),
          nullif(v_profile ->> 'plus', ''),
          nullif(v_profile ->> 'has_plus', ''),
          nullif(v_profile ->> 'plus_active', ''),
          nullif(v_profile ->> 'pro_active', ''),
          nullif(v_profile ->> 'premium_active', ''),
          'false'
        )
      )
    );

    v_is_plus := v_boolean_text in ('true', 't', '1', 'yes', 'y', 'on');
  end if;

  if v_is_plus then
    return query select 3, 3, 'plus'::text;
  else
    return query select 1, 1, 'starter'::text;
  end if;
end;
$function$;

-- ── 5. Messaging: 30 chat activations / 30 active chats (Plus level) ───────
create or replace function public.cx_ensure_user_messaging_cycle(
  p_user_id uuid,
  p_at timestamp with time zone default now()
)
returns public.user_messaging_cycles
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cycle_start date;
  v_cycle_end date;
  v_plan text := 'free';
  v_free_limit integer := case when public.is_early_access() then 30 else 10 end;
  v_monthly_limit integer := null;
  v_concurrent_limit integer := null;
  v_row public.user_messaging_cycles%rowtype;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;

  select cycle_start, cycle_end
    into v_cycle_start, v_cycle_end
  from public.cx_messaging_cycle_bounds(p_at);

  select
    coalesce(plan, 'free'),
    case
      when coalesce(plan, 'free') = 'premium' then coalesce(monthly_activation_limit, 1000000)
      else coalesce(monthly_activation_limit, v_free_limit)
    end,
    case
      when coalesce(plan, 'free') = 'premium' then coalesce(concurrent_active_limit, 1000000)
      else coalesce(concurrent_active_limit, v_free_limit)
    end
  into v_plan, v_monthly_limit, v_concurrent_limit
  from public.user_messaging_plans
  where user_id = p_user_id
  limit 1;

  v_plan := coalesce(v_plan, 'free');
  v_monthly_limit := coalesce(v_monthly_limit, case when v_plan = 'premium' then 1000000 else v_free_limit end);
  v_concurrent_limit := coalesce(v_concurrent_limit, case when v_plan = 'premium' then 1000000 else v_free_limit end);

  insert into public.user_messaging_cycles (
    user_id,
    cycle_start,
    cycle_end,
    plan,
    monthly_activation_limit,
    concurrent_active_limit
  )
  values (
    p_user_id,
    v_cycle_start,
    v_cycle_end,
    v_plan,
    v_monthly_limit,
    v_concurrent_limit
  )
  on conflict (user_id, cycle_start)
  do update set
    cycle_end = excluded.cycle_end,
    plan = excluded.plan,
    monthly_activation_limit = excluded.monthly_activation_limit,
    concurrent_active_limit = excluded.concurrent_active_limit,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$function$;

-- ── 6. Dance Page (teacher_profiles): open to everyone, user-chosen label ──
alter table public.teacher_profiles
  add column if not exists page_label text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'teacher_profiles_page_label_allowed_chk'
  ) then
    alter table public.teacher_profiles
      add constraint teacher_profiles_page_label_allowed_chk
      check (
        page_label is null
        or page_label in ('Teacher', 'Artist', 'Performer', 'Competitor', 'DJ', 'Organizer', 'Studio Owner', 'Social Dancer')
      );
  end if;
end;
$$;

comment on column public.teacher_profiles.page_label is
  'Label shown on the public Dance Page (Teacher, Artist, Performer, Competitor, DJ, Organizer, Studio Owner, Social Dancer). Null = derived from profile roles.';

-- No trial / verification needed for the page during early access.
create or replace function public.teacher_profile_is_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.teacher_profiles tp
    where tp.user_id = p_user_id
      and tp.teacher_profile_enabled = true
      and tp.is_public = true
      and (
        public.is_early_access()
        or tp.teacher_profile_trial_ends_at is null
        or tp.teacher_profile_trial_ends_at > now()
        or exists (
          select 1 from public.profiles p
          where p.user_id = tp.user_id
            and p.roles @> array['verified']
        )
      )
  )
$function$;

commit;

-- Make PostgREST pick up the new column immediately.
notify pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────────────
-- select public.is_early_access();                                   -- true
-- select * from public.trip_plan_limits(auth.uid());                 -- 5, 3, early_access
-- select column_name from information_schema.columns
--   where table_name = 'teacher_profiles' and column_name = 'page_label';

-- ════════════════ 2026-10-21_protect_profile_moderation_fields.sql ════════════════
-- Protect admin-moderated profile fields from self-edits.
--
-- Why: profiles_update_own lets a member update their own row, so without this
-- a member could set avatar_status = 'approved' (or verified = true) from the
-- browser and skip admin photo approval, which now gates hosting requests.
--
-- Rules for non-admin members (auth.uid() set and not an admin):
--   * verified / verified_* / organizer_verified* / is_verified /
--     verification_type can't be changed by the member.
--   * avatar_status can't be set by the member. Changing the photo
--     (avatar_path or avatar_url) resets it to 'pending' so an admin reviews it.
-- Admins (public.is_app_admin) and server code using the service role
-- (auth.uid() is null) are not affected.
--
-- Run on STAGING first, then production. Safe to re-run.

begin;

create or replace function public.protect_profile_moderation_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
begin
  -- Service role, SQL editor, cron: trusted.
  if v_uid is null then
    return new;
  end if;

  if public.is_app_admin(v_uid) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.avatar_status := 'pending';
    new.verified := false;
    new.verified_at := null;
    new.verified_by := null;
    new.verified_label := null;
    new.organizer_verified := false;
    new.organizer_verified_at := null;
    new.organizer_verified_by := null;
    new.is_verified := false;
    new.verification_type := null;
    return new;
  end if;

  -- UPDATE: moderation fields stay as they were.
  new.verified := old.verified;
  new.verified_at := old.verified_at;
  new.verified_by := old.verified_by;
  new.verified_label := old.verified_label;
  new.organizer_verified := old.organizer_verified;
  new.organizer_verified_at := old.organizer_verified_at;
  new.organizer_verified_by := old.organizer_verified_by;
  new.is_verified := old.is_verified;
  new.verification_type := old.verification_type;

  -- New photo => back to the admin review queue. Otherwise keep the status.
  if new.avatar_path is distinct from old.avatar_path
     or new.avatar_url is distinct from old.avatar_url then
    new.avatar_status := 'pending';
  else
    new.avatar_status := old.avatar_status;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_protect_profile_moderation_fields on public.profiles;

create trigger trg_protect_profile_moderation_fields
  before insert or update on public.profiles
  for each row
  execute function public.protect_profile_moderation_fields();

commit;

-- ── Verify (as a normal member in the app, not in the SQL editor) ───────────
-- update profiles set avatar_status = 'approved' where user_id = auth.uid();
--   -> avatar_status stays unchanged

-- ════════════════ 2026-10-21_member_invites.sql ════════════════
-- Member email invites ("Invite dancers").
--
-- Stores a SHA-256 hash of the invited address, never the address itself, so
-- we can enforce anti-spam limits without keeping third-party emails:
--   * 20 invites per member per 24h (enforced in app/api/invites/route.ts)
--   * the same address is emailed at most once every 30 days, by anyone
-- Only the server (service role) reads or writes this table.
--
-- Run on STAGING first, then production. Safe to re-run.

begin;

create table if not exists public.member_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references auth.users (id) on delete cascade,
  invitee_email_hash text not null,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists member_invites_inviter_created_idx
  on public.member_invites (inviter_user_id, created_at desc);

create index if not exists member_invites_email_hash_created_idx
  on public.member_invites (invitee_email_hash, created_at desc);

alter table public.member_invites enable row level security;
-- No policies on purpose: anon/authenticated get nothing; the service role bypasses RLS.

commit;

-- ════════════════ 2026-10-21_beta_feedback.sql ════════════════
-- Beta feedback from the in-app "Beta feedback" button.
-- Read and triage it in Supabase → Table Editor → beta_feedback (status: new → seen → fixed / wontfix).
-- Only the server (service role) writes; nobody can read it from the browser.
-- Run on STAGING and PRODUCTION. Safe to re-run.

begin;

create table if not exists public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('bug', 'idea', 'other')),
  message text not null check (char_length(message) between 3 and 2000),
  page_url text,
  user_agent text,
  status text not null default 'new' check (status in ('new', 'seen', 'fixed', 'wontfix')),
  admin_note text,
  created_at timestamptz not null default now()
);

create index if not exists beta_feedback_created_idx on public.beta_feedback (created_at desc);
create index if not exists beta_feedback_user_created_idx on public.beta_feedback (user_id, created_at desc);

alter table public.beta_feedback enable row level security;
-- No policies on purpose: the service role (API route) bypasses RLS.

commit;
