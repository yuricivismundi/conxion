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
