begin;

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

  if v_status = 'published' then
    select public.active_event_limit_for_user(v_me) into v_limit;

    select count(*)::int
      into v_active_count
    from public.events e
    where e.host_user_id = v_me
      and e.status = 'published'
      and e.ends_at >= now()
      and coalesce(e.hidden_by_admin, false) = false;

    if v_active_count >= v_limit then
      raise exception 'active_event_limit_reached';
    end if;
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
  v_active_count int := 0;
  v_limit int := 3;
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

  if v_status = 'published' and v_event.status <> 'published' then
    select public.active_event_limit_for_user(v_me) into v_limit;

    select count(*)::int
      into v_active_count
    from public.events e
    where e.host_user_id = v_me
      and e.id <> p_event_id
      and e.status = 'published'
      and e.ends_at >= now()
      and coalesce(e.hidden_by_admin, false) = false;

    if v_active_count >= v_limit then
      raise exception 'active_event_limit_reached';
    end if;
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

commit;
