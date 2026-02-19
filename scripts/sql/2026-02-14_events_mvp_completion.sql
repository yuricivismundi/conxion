-- ConXion Events MVP completion patch
-- Date: 2026-02-14
--
-- Adds missing backend pieces for Events MVP:
-- - Event styles + search indexes
-- - Organizer verification profile fields
-- - Public limited event RPCs for anonymous browse/detail
-- - Host event update RPC
-- - Guarded join wrapper
-- - Event reports table + RPC
-- - Post-event feedback table + RPCs

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- Events schema completion
-- =========================================================

do $$
begin
  if to_regclass('public.events') is null then
    raise notice 'public.events not found; run events module migration first.';
  else
    alter table public.events add column if not exists styles text[] not null default '{}'::text[];

    update public.events
    set styles = '{}'::text[]
    where styles is null;

    create index if not exists idx_events_city_starts_at on public.events(city, starts_at);
    create index if not exists idx_events_styles_gin on public.events using gin(styles);
    create index if not exists idx_events_type_status on public.events(event_type, status);
  end if;
end $$;

-- =========================================================
-- Organizer verification fields (profiles)
-- =========================================================

do $$
begin
  if to_regclass('public.profiles') is null then
    raise notice 'public.profiles not found; skipping organizer verification columns.';
  else
    alter table public.profiles add column if not exists organizer_verified boolean not null default false;
    alter table public.profiles add column if not exists organizer_verified_at timestamptz;
    alter table public.profiles add column if not exists organizer_verified_by uuid;

    create index if not exists idx_profiles_organizer_verified on public.profiles(organizer_verified);
  end if;
end $$;

-- =========================================================
-- Helpers
-- =========================================================

create or replace function public.normalize_event_styles(p_styles text[])
returns text[]
language sql
immutable
set search_path = public
as $function$
  select coalesce(
    array(
      select distinct lower(trim(s))
      from unnest(coalesce(p_styles, '{}'::text[])) as s
      where trim(s) <> ''
      order by 1
    ),
    '{}'::text[]
  );
$function$;

create or replace function public.is_organizer_verified(p_user_id uuid)
returns boolean
language plpgsql
stable
set search_path = public
as $function$
declare
  v_verified boolean := false;
  v_profile_verified boolean := false;
begin
  if p_user_id is null then
    return false;
  end if;

  if to_regclass('public.profiles') is null then
    return false;
  end if;

  begin
    execute 'select coalesce(organizer_verified, false) from public.profiles where user_id = $1 limit 1'
      into v_verified
      using p_user_id;
  exception
    when undefined_column then
      v_verified := false;
  end;

  if v_verified then
    return true;
  end if;

  begin
    execute 'select coalesce(verified, false) from public.profiles where user_id = $1 limit 1'
      into v_profile_verified
      using p_user_id;
  exception
    when undefined_column then
      v_profile_verified := false;
  end;

  return coalesce(v_profile_verified, false);
end;
$function$;

create or replace function public.active_event_limit_for_user(p_user_id uuid)
returns integer
language plpgsql
stable
set search_path = public
as $function$
begin
  if public.is_app_admin(p_user_id) then
    return 100;
  end if;

  if public.is_organizer_verified(p_user_id) then
    return 25;
  end if;

  return 3;
end;
$function$;

create or replace function public.enforce_event_join_guardrails(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_email_confirmed_at timestamptz;
  v_created_at timestamptz;
  v_join_count int := 0;
begin
  if p_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select u.email_confirmed_at, u.created_at
    into v_email_confirmed_at, v_created_at
  from auth.users u
  where u.id = p_user_id
  limit 1;

  if v_email_confirmed_at is null then
    raise exception 'email_verification_required_for_join';
  end if;

  if v_created_at is not null and v_created_at >= now() - interval '24 hours' then
    select count(*)::int
      into v_join_count
    from public.event_members em
    where em.user_id = p_user_id
      and em.status in ('host', 'going', 'waitlist')
      and em.created_at >= now() - interval '24 hours';

    if v_join_count >= 3 then
      raise exception 'new_account_join_limit_reached';
    end if;
  end if;
end;
$function$;

-- =========================================================
-- Create / update event RPCs
-- =========================================================

drop function if exists public.create_event(text, text, text, text, text, text, text, text, timestamptz, timestamptz, integer, text, jsonb, text);
drop function if exists public.create_event(text, text, text, text, text, text, text, text, timestamptz, timestamptz, integer, text, jsonb, text, text[]);

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
  p_status text default 'published',
  p_styles text[] default null
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
  v_styles text[] := public.normalize_event_styles(p_styles);
  v_active_count int := 0;
  v_limit int := 3;
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
    if v_cover_url !~* '\\.(jpg|jpeg|png|webp)(\\?.*)?$' then
      raise exception 'invalid_cover_format';
    end if;
  end if;

  if cardinality(v_styles) > 12 then
    raise exception 'too_many_styles';
  end if;

  select public.active_event_limit_for_user(v_me) into v_limit;

  select count(*)::int
    into v_active_count
  from public.events e
  where e.host_user_id = v_me
    and e.status in ('draft', 'published')
    and e.ends_at >= now()
    and coalesce(e.hidden_by_admin, false) = false;

  if v_active_count >= v_limit then
    raise exception 'active_event_limit_reached';
  end if;

  insert into public.events (
    host_user_id,
    title,
    description,
    event_type,
    styles,
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
    coalesce(v_styles, '{}'::text[]),
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

create table if not exists public.event_edit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  editor_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_event_edit_logs_editor_created on public.event_edit_logs(editor_id, created_at desc);
create index if not exists idx_event_edit_logs_event on public.event_edit_logs(event_id);

create or replace function public.update_event(
  p_event_id uuid,
  p_title text,
  p_description text,
  p_event_type text,
  p_styles text[] default null,
  p_visibility text default 'public',
  p_city text default null,
  p_country text default null,
  p_venue_name text default null,
  p_venue_address text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_capacity integer default null,
  p_cover_url text default null,
  p_links jsonb default '[]'::jsonb,
  p_status text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_visibility text;
  v_status text;
  v_cover_url text;
  v_styles text[];
  v_edit_count int := 0;
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

  if v_event.host_user_id <> v_me then
    raise exception 'not_authorized';
  end if;

  select count(*)::int
    into v_edit_count
  from public.event_edit_logs l
  where l.editor_id = v_me
    and l.created_at >= now() - interval '1 day';

  if v_edit_count >= 5 then
    raise exception 'edit_rate_limit_daily';
  end if;

  v_visibility := lower(trim(coalesce(p_visibility, v_event.visibility)));
  if v_visibility not in ('public', 'private') then
    raise exception 'invalid_visibility';
  end if;

  v_status := lower(trim(coalesce(p_status, v_event.status)));
  if v_status not in ('draft', 'published', 'cancelled') then
    raise exception 'invalid_status';
  end if;

  v_cover_url := nullif(trim(coalesce(p_cover_url, v_event.cover_url, '')), '');
  if v_cover_url is not null then
    if v_cover_url !~* '/storage/v1/object/public/avatars/' then
      raise exception 'invalid_cover_url';
    end if;
    if v_cover_url !~* '\\.(jpg|jpeg|png|webp)(\\?.*)?$' then
      raise exception 'invalid_cover_format';
    end if;
  end if;

  if p_starts_at is null and p_ends_at is null then
    null;
  elsif p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_event_window';
  end if;

  if p_capacity is not null and (p_capacity < 1 or p_capacity > 2000) then
    raise exception 'invalid_capacity';
  end if;

  v_styles := public.normalize_event_styles(coalesce(p_styles, v_event.styles));
  if cardinality(v_styles) > 12 then
    raise exception 'too_many_styles';
  end if;

  update public.events
  set title = trim(coalesce(p_title, v_event.title)),
      description = nullif(trim(coalesce(p_description, v_event.description, '')), ''),
      event_type = coalesce(nullif(trim(coalesce(p_event_type, v_event.event_type)), ''), 'Social'),
      styles = coalesce(v_styles, '{}'::text[]),
      visibility = v_visibility,
      city = trim(coalesce(p_city, v_event.city)),
      country = trim(coalesce(p_country, v_event.country)),
      venue_name = nullif(trim(coalesce(p_venue_name, v_event.venue_name, '')), ''),
      venue_address = nullif(trim(coalesce(p_venue_address, v_event.venue_address, '')), ''),
      starts_at = coalesce(p_starts_at, v_event.starts_at),
      ends_at = coalesce(p_ends_at, v_event.ends_at),
      capacity = p_capacity,
      cover_url = v_cover_url,
      cover_status = case
        when v_cover_url is null then 'approved'
        when v_cover_url is distinct from v_event.cover_url then 'pending'
        else v_event.cover_status
      end,
      cover_reviewed_by = case when v_cover_url is distinct from v_event.cover_url then null else v_event.cover_reviewed_by end,
      cover_reviewed_at = case when v_cover_url is distinct from v_event.cover_url then null else v_event.cover_reviewed_at end,
      cover_review_note = case when v_cover_url is distinct from v_event.cover_url then null else v_event.cover_review_note end,
      links = coalesce(p_links, '[]'::jsonb),
      status = v_status,
      updated_at = now()
  where id = p_event_id;

  insert into public.event_edit_logs (event_id, editor_id)
  values (p_event_id, v_me);

  return p_event_id;
end;
$function$;

grant execute on function public.create_event(text, text, text, text, text, text, text, text, timestamptz, timestamptz, integer, text, jsonb, text, text[]) to authenticated;
grant execute on function public.update_event(uuid, text, text, text, text[], text, text, text, text, text, timestamptz, timestamptz, integer, text, jsonb, text) to authenticated;

-- =========================================================
-- Public limited events browse/detail RPCs (anon-safe)
-- =========================================================

create or replace function public.list_public_events_lite(
  p_limit integer default 300
)
returns table (
  id uuid,
  host_user_id uuid,
  title text,
  description text,
  event_type text,
  styles text[],
  visibility text,
  city text,
  country text,
  venue_name text,
  venue_address text,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity integer,
  cover_url text,
  cover_status text,
  cover_reviewed_by uuid,
  cover_reviewed_at timestamptz,
  cover_review_note text,
  hidden_by_admin boolean,
  hidden_reason text,
  links jsonb,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $function$
  select
    e.id,
    e.host_user_id,
    e.title,
    e.description,
    e.event_type,
    coalesce(e.styles, '{}'::text[]) as styles,
    e.visibility,
    e.city,
    e.country,
    e.venue_name,
    null::text as venue_address,
    e.starts_at,
    e.ends_at,
    e.capacity,
    case
      when coalesce(e.cover_status, 'pending') = 'approved' then e.cover_url
      when e.cover_url is null then null
      else null
    end as cover_url,
    coalesce(e.cover_status, 'pending') as cover_status,
    e.cover_reviewed_by,
    e.cover_reviewed_at,
    e.cover_review_note,
    coalesce(e.hidden_by_admin, false) as hidden_by_admin,
    e.hidden_reason,
    '[]'::jsonb as links,
    e.status,
    e.created_at,
    e.updated_at
  from public.events e
  where e.status = 'published'
    and e.visibility = 'public'
    and coalesce(e.hidden_by_admin, false) = false
  order by e.starts_at asc
  limit greatest(1, least(coalesce(p_limit, 300), 500));
$function$;

create or replace function public.get_public_event_lite(
  p_event_id uuid
)
returns table (
  id uuid,
  host_user_id uuid,
  title text,
  description text,
  event_type text,
  styles text[],
  visibility text,
  city text,
  country text,
  venue_name text,
  venue_address text,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity integer,
  cover_url text,
  cover_status text,
  cover_reviewed_by uuid,
  cover_reviewed_at timestamptz,
  cover_review_note text,
  hidden_by_admin boolean,
  hidden_reason text,
  links jsonb,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $function$
  select
    e.id,
    e.host_user_id,
    e.title,
    e.description,
    e.event_type,
    coalesce(e.styles, '{}'::text[]) as styles,
    e.visibility,
    e.city,
    e.country,
    e.venue_name,
    null::text as venue_address,
    e.starts_at,
    e.ends_at,
    e.capacity,
    case
      when coalesce(e.cover_status, 'pending') = 'approved' then e.cover_url
      when e.cover_url is null then null
      else null
    end as cover_url,
    coalesce(e.cover_status, 'pending') as cover_status,
    e.cover_reviewed_by,
    e.cover_reviewed_at,
    e.cover_review_note,
    coalesce(e.hidden_by_admin, false) as hidden_by_admin,
    e.hidden_reason,
    '[]'::jsonb as links,
    e.status,
    e.created_at,
    e.updated_at
  from public.events e
  where e.id = p_event_id
    and e.status = 'published'
    and e.visibility = 'public'
    and coalesce(e.hidden_by_admin, false) = false
  limit 1;
$function$;

grant execute on function public.list_public_events_lite(integer) to anon, authenticated;
grant execute on function public.get_public_event_lite(uuid) to anon, authenticated;

-- =========================================================
-- Guarded join wrapper
-- =========================================================

create or replace function public.join_event_guarded(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  perform public.enforce_event_join_guardrails(v_me);

  select public.join_public_event(p_event_id) into v_status;
  return v_status;
end;
$function$;

grant execute on function public.join_event_guarded(uuid) to authenticated;

-- =========================================================
-- Event reports (event-specific moderation channel)
-- =========================================================

create table if not exists public.event_reports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  reporter_id uuid not null,
  reason text not null,
  note text,
  status text not null default 'open',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.event_reports add column if not exists event_id uuid;
alter table public.event_reports add column if not exists reporter_id uuid;
alter table public.event_reports add column if not exists reason text;
alter table public.event_reports add column if not exists note text;
alter table public.event_reports add column if not exists status text default 'open';
alter table public.event_reports add column if not exists reviewed_by uuid;
alter table public.event_reports add column if not exists reviewed_at timestamptz;
alter table public.event_reports add column if not exists created_at timestamptz default now();
alter table public.event_reports add column if not exists updated_at timestamptz default now();

do $$
begin
  begin
    alter table public.event_reports
      add constraint event_reports_status_chk
      check (status in ('open', 'resolved', 'dismissed'));
  exception
    when duplicate_object then null;
  end;
end $$;

create index if not exists idx_event_reports_event on public.event_reports(event_id);
create index if not exists idx_event_reports_status on public.event_reports(status);
create index if not exists idx_event_reports_reporter on public.event_reports(reporter_id);
create unique index if not exists ux_event_reports_open_unique
  on public.event_reports(event_id, reporter_id)
  where status = 'open';

alter table public.event_reports enable row level security;

drop policy if exists event_reports_select_parties on public.event_reports;
create policy event_reports_select_parties
on public.event_reports
for select
to authenticated
using (
  reporter_id = auth.uid()
  or public.is_app_admin(auth.uid())
  or exists (
    select 1
    from public.events e
    where e.id = event_reports.event_id
      and e.host_user_id = auth.uid()
  )
);

drop policy if exists event_reports_insert_reporter on public.event_reports;
create policy event_reports_insert_reporter
on public.event_reports
for insert
to authenticated
with check (reporter_id = auth.uid());

create or replace function public.create_event_report(
  p_event_id uuid,
  p_reason text,
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
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'report_reason_required';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_event.host_user_id = v_me then
    raise exception 'cannot_report_own_event';
  end if;

  insert into public.event_reports (
    event_id,
    reporter_id,
    reason,
    note,
    status
  )
  values (
    p_event_id,
    v_me,
    trim(p_reason),
    nullif(trim(coalesce(p_note, '')), ''),
    'open'
  )
  returning id into v_id;

  -- Mirror into generic reports table if available, so existing admin queue sees event flags.
  if to_regclass('public.reports') is not null then
    begin
      execute '
        insert into public.reports (
          reporter_id,
          target_user_id,
          context,
          context_id,
          reason,
          note,
          status
        ) values ($1, $2, $3, $4, $5, $6, ''open'')'
      using v_me, v_event.host_user_id, 'event', p_event_id::text, trim(p_reason), nullif(trim(coalesce(p_note, '')), '');
    exception
      when undefined_column then null;
      when undefined_table then null;
    end;
  end if;

  return v_id;
end;
$function$;

grant execute on function public.create_event_report(uuid, text, text) to authenticated;

-- =========================================================
-- Post-event feedback / references
-- =========================================================

create table if not exists public.event_feedback (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  author_id uuid not null,
  happened_as_described boolean not null,
  quality smallint not null,
  note text,
  visibility text not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, author_id)
);

alter table public.event_feedback add column if not exists event_id uuid;
alter table public.event_feedback add column if not exists author_id uuid;
alter table public.event_feedback add column if not exists happened_as_described boolean;
alter table public.event_feedback add column if not exists quality smallint;
alter table public.event_feedback add column if not exists note text;
alter table public.event_feedback add column if not exists visibility text default 'private';
alter table public.event_feedback add column if not exists created_at timestamptz default now();
alter table public.event_feedback add column if not exists updated_at timestamptz default now();

do $$
begin
  begin
    alter table public.event_feedback
      add constraint event_feedback_quality_chk
      check (quality between 1 and 5);
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.event_feedback
      add constraint event_feedback_visibility_chk
      check (visibility in ('private', 'public'));
  exception
    when duplicate_object then null;
  end;
end $$;

create index if not exists idx_event_feedback_event on public.event_feedback(event_id);
create index if not exists idx_event_feedback_author on public.event_feedback(author_id);
create index if not exists idx_event_feedback_created on public.event_feedback(created_at desc);

alter table public.event_feedback enable row level security;

drop policy if exists event_feedback_select_visible on public.event_feedback;
create policy event_feedback_select_visible
on public.event_feedback
for select
to authenticated
using (
  author_id = auth.uid()
  or public.is_app_admin(auth.uid())
  or exists (
    select 1
    from public.events e
    where e.id = event_feedback.event_id
      and e.host_user_id = auth.uid()
  )
);

drop policy if exists event_feedback_insert_author on public.event_feedback;
create policy event_feedback_insert_author
on public.event_feedback
for insert
to authenticated
with check (author_id = auth.uid());

create or replace function public.set_event_feedback_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists trg_event_feedback_set_updated_at on public.event_feedback;
create trigger trg_event_feedback_set_updated_at
before update on public.event_feedback
for each row execute function public.set_event_feedback_updated_at();

create or replace function public.can_submit_event_feedback(
  p_event_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $function$
declare
  v_event public.events;
  v_attended boolean := false;
begin
  if p_event_id is null or p_user_id is null then
    return false;
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    return false;
  end if;

  if coalesce(v_event.hidden_by_admin, false) then
    return false;
  end if;

  if v_event.ends_at > now() then
    return false;
  end if;

  select exists (
    select 1
    from public.event_members em
    where em.event_id = p_event_id
      and em.user_id = p_user_id
      and em.status in ('host', 'going', 'waitlist')
  ) into v_attended;

  return v_attended;
end;
$function$;

create or replace function public.submit_event_feedback(
  p_event_id uuid,
  p_happened_as_described boolean,
  p_quality integer,
  p_note text default null,
  p_visibility text default 'private'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_visibility text := lower(trim(coalesce(p_visibility, 'private')));
  v_existing_created_at timestamptz;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_quality is null or p_quality < 1 or p_quality > 5 then
    raise exception 'invalid_quality';
  end if;

  if v_visibility not in ('private', 'public') then
    raise exception 'invalid_visibility';
  end if;

  if not public.can_submit_event_feedback(p_event_id, v_me) then
    raise exception 'event_feedback_not_allowed';
  end if;

  if length(trim(coalesce(p_note, ''))) > 1000 then
    raise exception 'feedback_note_too_long';
  end if;

  select ef.created_at
    into v_existing_created_at
  from public.event_feedback ef
  where ef.event_id = p_event_id
    and ef.author_id = v_me
  limit 1;

  if v_existing_created_at is not null and v_existing_created_at < now() - interval '15 days' then
    raise exception 'feedback_locked_after_15_days';
  end if;

  insert into public.event_feedback (
    event_id,
    author_id,
    happened_as_described,
    quality,
    note,
    visibility
  )
  values (
    p_event_id,
    v_me,
    p_happened_as_described,
    p_quality,
    nullif(trim(coalesce(p_note, '')), ''),
    v_visibility
  )
  on conflict (event_id, author_id)
  do update set
    happened_as_described = excluded.happened_as_described,
    quality = excluded.quality,
    note = excluded.note,
    visibility = excluded.visibility,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.get_event_feedback_summary(
  p_event_id uuid
)
returns table (
  total_count integer,
  avg_quality numeric,
  happened_yes integer,
  happened_no integer
)
language sql
security definer
set search_path = public
as $function$
  select
    count(*)::int as total_count,
    round(avg(quality)::numeric, 2) as avg_quality,
    sum(case when happened_as_described then 1 else 0 end)::int as happened_yes,
    sum(case when happened_as_described then 0 else 1 end)::int as happened_no
  from public.event_feedback ef
  where ef.event_id = p_event_id
    and (
      ef.visibility = 'public'
      or ef.author_id = auth.uid()
      or public.is_app_admin(auth.uid())
      or exists (
        select 1 from public.events e where e.id = ef.event_id and e.host_user_id = auth.uid()
      )
    );
$function$;

grant execute on function public.can_submit_event_feedback(uuid, uuid) to authenticated;
grant execute on function public.submit_event_feedback(uuid, boolean, integer, text, text) to authenticated;
grant execute on function public.get_event_feedback_summary(uuid) to authenticated;

-- =========================================================
-- Event respond helper (requester-based)
-- =========================================================

create or replace function public.respond_event_request_by_id(
  p_event_id uuid,
  p_requester_id uuid,
  p_action text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_request_id uuid;
begin
  select r.id
    into v_request_id
  from public.event_requests r
  where r.event_id = p_event_id
    and r.requester_id = p_requester_id
  limit 1;

  if v_request_id is null then
    raise exception 'request_not_found';
  end if;

  return public.respond_event_request(v_request_id, p_action);
end;
$function$;

grant execute on function public.respond_event_request_by_id(uuid, uuid, text) to authenticated;

commit;
