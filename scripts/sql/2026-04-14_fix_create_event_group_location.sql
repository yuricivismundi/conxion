-- Fix create_event: location optional for private groups + remove COALESCE bool/int mismatch

begin;

-- ── Helper: event_legacy_visibility_for_access ──────────────────────────────
create or replace function public.event_legacy_visibility_for_access(p_access_type text)
returns text
language sql
immutable
security definer
set search_path = public
as $function$
  select case
    when p_access_type = 'private_group' then 'private'
    else 'public'
  end
$function$;

-- ── Helper: event_chat_mode_for_access ──────────────────────────────────────
create or replace function public.event_chat_mode_for_access(p_access_type text, p_chat_mode text)
returns text
language sql
immutable
security definer
set search_path = public
as $function$
  select case
    when p_access_type = 'private_group' then
      case
        when lower(trim(coalesce(p_chat_mode, ''))) in ('broadcast', 'discussion') then lower(trim(p_chat_mode))
        else 'discussion'
      end
    else 'broadcast'
  end
$function$;

-- ── Helper: private_group_limit_for_user ────────────────────────────────────
create or replace function public.private_group_limit_for_user(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when public.is_app_admin(p_user_id) then 500
    else 5
  end
$function$;

-- ── Helper: private_group_monthly_usage_count ───────────────────────────────
create or replace function public.private_group_monthly_usage_count(
  p_user_id uuid,
  p_anchor timestamptz default now()
)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select count(distinct e.id)::integer
  from public.events e
  join public.event_members em on em.event_id = e.id
  where em.user_id = p_user_id
    and em.status in ('host', 'going', 'waitlist')
    and e.event_access_type = 'private_group'
    and e.status = 'published'
    and e.hidden_by_admin is not true
    and coalesce(em.joined_at, em.created_at, e.created_at) >= date_trunc('month', p_anchor);
$function$;

-- ── Drop old create_event signature (no p_event_access_type) ────────────────
drop function if exists public.create_event(text, text, text, text, text, text, text, text, timestamptz, timestamptz, integer, text, jsonb, text, text[]);

-- ── create_event: new signature with p_event_access_type + p_chat_mode ──────
create or replace function public.create_event(
  p_title text,
  p_description text,
  p_event_type text,
  p_visibility text,
  p_event_access_type text,
  p_chat_mode text,
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
  v_access_type text := lower(trim(coalesce(p_event_access_type,
    case when lower(trim(coalesce(p_visibility, 'public'))) = 'private'
         then 'request' else 'public' end)));
  v_chat_mode text;
  v_visibility text;
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

  -- Location required for events, optional for private groups
  if v_access_type <> 'private_group'
     and (trim(coalesce(p_city, '')) = '' or trim(coalesce(p_country, '')) = '') then
    raise exception 'location_required';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_event_window';
  end if;

  if v_access_type not in ('public', 'request', 'private_group') then
    raise exception 'invalid_event_access_type';
  end if;

  v_visibility := public.event_legacy_visibility_for_access(v_access_type);
  v_chat_mode  := public.event_chat_mode_for_access(v_access_type, p_chat_mode);

  if v_status not in ('draft', 'published') then
    raise exception 'invalid_status';
  end if;

  if v_access_type = 'private_group' then
    if coalesce(p_capacity, 25) > 25 then
      raise exception 'private_group_member_limit_reached';
    end if;
  elsif p_capacity is not null and (p_capacity < 1 or p_capacity > 2000) then
    raise exception 'invalid_capacity';
  end if;

  if v_cover_url is not null then
    if v_cover_url !~* '/storage/v1/(object/public|render/image/public)/avatars/' then
      raise exception 'invalid_cover_url';
    end if;
  end if;

  if cardinality(v_styles) > 12 then
    raise exception 'too_many_styles';
  end if;

  if v_status = 'published' and v_access_type = 'private_group' then
    if public.private_group_monthly_usage_count(v_me) >= public.private_group_limit_for_user(v_me) then
      raise exception 'private_group_monthly_limit_reached';
    end if;
  elsif v_status = 'published' then
    select public.active_event_limit_for_user(v_me) into v_limit;

    select count(*)::int
      into v_active_count
    from public.events e
    where e.host_user_id = v_me
      and e.status = 'published'
      and e.ends_at >= now()
      and e.hidden_by_admin is not true
      and coalesce(e.event_access_type, 'public') <> 'private_group';

    if v_active_count >= v_limit then
      raise exception 'active_event_limit_reached';
    end if;
  end if;

  -- Draft limit for private groups (max 2 drafts)
  if v_status = 'draft' and v_access_type = 'private_group' then
    select count(*)::int
      into v_active_count
    from public.events e
    where e.host_user_id = v_me
      and e.status = 'draft'
      and e.event_access_type = 'private_group'
      and e.hidden_by_admin is not true;

    if v_active_count >= 2 then
      raise exception 'private_group_draft_limit_reached';
    end if;
  end if;

  insert into public.events (
    host_user_id, title, description, event_type, styles,
    visibility, event_access_type, chat_mode, max_members,
    city, country, venue_name, venue_address,
    starts_at, ends_at, capacity,
    cover_url, cover_status, links, status
  ) values (
    v_me,
    trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''),
    coalesce(nullif(trim(coalesce(p_event_type, '')), ''), 'Social'),
    coalesce(v_styles, '{}'::text[]),
    v_visibility,
    v_access_type,
    v_chat_mode,
    case when v_access_type = 'private_group' then 25 else null end,
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_country, '')), ''),
    nullif(trim(coalesce(p_venue_name, '')), ''),
    nullif(trim(coalesce(p_venue_address, '')), ''),
    p_starts_at,
    p_ends_at,
    case when v_access_type = 'private_group' then null else p_capacity end,
    v_cover_url,
    case when v_cover_url is null then 'approved' else 'pending' end,
    coalesce(p_links, '[]'::jsonb),
    v_status
  )
  returning id into v_id;

  insert into public.event_members (event_id, user_id, member_role, status)
  values (v_id, v_me, 'host', 'host')
  on conflict (event_id, user_id)
  do update set member_role = 'host', status = 'host', updated_at = now();

  perform public.cx_ensure_event_thread(v_id, v_me, null);

  return v_id;
end;
$function$;

grant execute on function public.create_event(text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,integer,text,jsonb,text,text[]) to authenticated;

commit;
