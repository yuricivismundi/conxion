begin;

alter table public.events add column if not exists event_access_type text;
alter table public.events add column if not exists chat_mode text;
alter table public.events add column if not exists max_members integer;
alter table public.events add column if not exists invite_token text;

alter table public.events alter column event_access_type set default 'public';
alter table public.events alter column chat_mode set default 'broadcast';
alter table public.events alter column invite_token set default replace(gen_random_uuid()::text, '-', '');

update public.events
   set event_access_type = case
     when lower(trim(coalesce(event_access_type, ''))) in ('request', 'private_group') then lower(trim(event_access_type))
     when lower(trim(coalesce(visibility, 'public'))) = 'private' then 'request'
     else 'public'
   end;

update public.events
   set chat_mode = case
     when event_access_type = 'private_group' and lower(trim(coalesce(chat_mode, ''))) in ('broadcast', 'discussion') then lower(trim(chat_mode))
     when event_access_type = 'private_group' then 'discussion'
     else 'broadcast'
   end,
       max_members = case
     when event_access_type = 'private_group' then coalesce(max_members, 25)
     else max_members
   end,
       visibility = case when event_access_type = 'private_group' then 'private' else 'public' end,
       invite_token = coalesce(nullif(trim(invite_token), ''), replace(gen_random_uuid()::text, '-', ''));

alter table public.events alter column event_access_type set not null;
alter table public.events alter column chat_mode set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'events_event_access_type_chk'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_event_access_type_chk
      check (event_access_type in ('public', 'request', 'private_group'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_chat_mode_chk'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_chat_mode_chk
      check (chat_mode in ('none', 'broadcast', 'discussion'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_private_group_limit_chk'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_private_group_limit_chk
      check (
        event_access_type <> 'private_group'
        or coalesce(max_members, 25) between 1 and 25
      );
  end if;
end $$;

create index if not exists idx_events_access_status_starts
  on public.events(event_access_type, status, starts_at);

create unique index if not exists ux_events_invite_token
  on public.events(invite_token)
  where invite_token is not null;

create or replace function public.event_legacy_visibility_for_access(p_access text)
returns text
language sql
immutable
as $function$
  select case
    when lower(trim(coalesce(p_access, 'public'))) = 'private_group' then 'private'
    else 'public'
  end
$function$;

create or replace function public.event_chat_mode_for_access(p_access text, p_chat_mode text default null)
returns text
language sql
immutable
as $function$
  select case
    when lower(trim(coalesce(p_access, 'public'))) = 'private_group'
      then case
        when lower(trim(coalesce(p_chat_mode, ''))) in ('broadcast', 'discussion') then lower(trim(p_chat_mode))
        else 'discussion'
      end
    else 'broadcast'
  end
$function$;

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
    and coalesce(e.hidden_by_admin, false) = false
    and coalesce(em.joined_at, em.created_at, e.created_at) >= date_trunc('month', p_anchor);
$function$;

create or replace function public.event_has_capacity(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_limit integer;
  v_current integer;
begin
  select coalesce(e.max_members, e.capacity)
    into v_limit
  from public.events e
  where e.id = p_event_id;

  if v_limit is null then
    return true;
  end if;

  select count(*)::integer
    into v_current
  from public.event_members em
  where em.event_id = p_event_id
    and em.status in ('host', 'going');

  return v_current < v_limit;
end;
$function$;

drop function if exists public.create_event(text, text, text, text, text, text, text, text, timestamptz, timestamptz, integer, text, jsonb, text, text[]);

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
  v_access_type text := lower(trim(coalesce(p_event_access_type, case when lower(trim(coalesce(p_visibility, 'public'))) = 'private' then 'request' else 'public' end)));
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

  if trim(coalesce(p_city, '')) = '' or trim(coalesce(p_country, '')) = '' then
    raise exception 'location_required';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_event_window';
  end if;

  if v_access_type not in ('public', 'request', 'private_group') then
    raise exception 'invalid_event_access_type';
  end if;

  v_visibility := public.event_legacy_visibility_for_access(v_access_type);
  v_chat_mode := public.event_chat_mode_for_access(v_access_type, p_chat_mode);

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
      and coalesce(e.hidden_by_admin, false) = false
      and coalesce(e.event_access_type, 'public') <> 'private_group';

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
    event_access_type,
    chat_mode,
    max_members,
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
    v_access_type,
    v_chat_mode,
    case when v_access_type = 'private_group' then 25 else null end,
    trim(p_city),
    trim(p_country),
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
  do update set
    member_role = 'host',
    status = 'host',
    updated_at = now();

  perform public.cx_ensure_event_thread(v_id, v_me, null);

  return v_id;
end;
$function$;

drop function if exists public.update_event(uuid, text, text, text, text[], text, text, text, text, text, timestamptz, timestamptz, integer, text, jsonb, text);

create or replace function public.update_event(
  p_event_id uuid,
  p_title text,
  p_description text,
  p_event_type text,
  p_styles text[] default null,
  p_visibility text default 'public',
  p_event_access_type text default null,
  p_chat_mode text default null,
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
  v_access_type text;
  v_chat_mode text;
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

  v_access_type := lower(trim(coalesce(
    p_event_access_type,
    v_event.event_access_type,
    case when lower(trim(coalesce(p_visibility, v_event.visibility, 'public'))) = 'private' then 'request' else 'public' end
  )));
  if v_access_type not in ('public', 'request', 'private_group') then
    raise exception 'invalid_event_access_type';
  end if;

  v_visibility := public.event_legacy_visibility_for_access(v_access_type);
  v_chat_mode := public.event_chat_mode_for_access(v_access_type, p_chat_mode);

  v_status := lower(trim(coalesce(p_status, v_event.status)));
  if v_status not in ('draft', 'published', 'cancelled') then
    raise exception 'invalid_status';
  end if;

  v_cover_url := nullif(trim(coalesce(p_cover_url, v_event.cover_url, '')), '');
  if v_cover_url is not null then
    if v_cover_url !~* '/storage/v1/(object/public|render/image/public)/avatars/' then
      raise exception 'invalid_cover_url';
    end if;
  end if;

  if p_starts_at is null and p_ends_at is null then
    null;
  elsif p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_event_window';
  end if;

  if v_access_type = 'private_group' then
    if coalesce(p_capacity, 25) > 25 then
      raise exception 'private_group_member_limit_reached';
    end if;
  elsif p_capacity is not null and (p_capacity < 1 or p_capacity > 2000) then
    raise exception 'invalid_capacity';
  end if;

  v_styles := public.normalize_event_styles(coalesce(p_styles, v_event.styles));
  if cardinality(v_styles) > 12 then
    raise exception 'too_many_styles';
  end if;

  if v_status = 'published'
     and v_access_type = 'private_group'
     and coalesce(v_event.event_access_type, 'public') <> 'private_group' then
    if public.private_group_monthly_usage_count(v_me) >= public.private_group_limit_for_user(v_me) then
      raise exception 'private_group_monthly_limit_reached';
    end if;
  elsif v_status = 'published' and v_event.status <> 'published' and v_access_type <> 'private_group' then
    select public.active_event_limit_for_user(v_me) into v_limit;

    select count(*)::int
      into v_active_count
    from public.events e
    where e.host_user_id = v_me
      and e.id <> p_event_id
      and e.status = 'published'
      and e.ends_at >= now()
      and coalesce(e.hidden_by_admin, false) = false
      and coalesce(e.event_access_type, 'public') <> 'private_group';

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
      event_access_type = v_access_type,
      chat_mode = v_chat_mode,
      max_members = case when v_access_type = 'private_group' then 25 else null end,
      city = trim(coalesce(p_city, v_event.city)),
      country = trim(coalesce(p_country, v_event.country)),
      venue_name = nullif(trim(coalesce(p_venue_name, v_event.venue_name, '')), ''),
      venue_address = nullif(trim(coalesce(p_venue_address, v_event.venue_address, '')), ''),
      starts_at = coalesce(p_starts_at, v_event.starts_at),
      ends_at = coalesce(p_ends_at, v_event.ends_at),
      capacity = case when v_access_type = 'private_group' then null else p_capacity end,
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

  perform public.cx_ensure_event_thread(p_event_id, v_me, null);

  return p_event_id;
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

  if v_event.event_access_type = 'request' then
    raise exception 'request_event_requires_approval';
  end if;

  if v_event.event_access_type not in ('public', 'private_group') then
    raise exception 'event_is_request_only';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open';
  end if;

  if v_event.host_user_id = v_me then
    return 'host';
  end if;

  if v_event.event_access_type = 'private_group' then
    if public.private_group_monthly_usage_count(v_me) >= public.private_group_limit_for_user(v_me) then
      raise exception 'private_group_monthly_limit_reached';
    end if;
    if not public.event_has_capacity(p_event_id) then
      raise exception 'private_group_member_limit_reached';
    end if;
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
    joined_at = now(),
    updated_at = now();

  return v_status;
end;
$function$;

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

  if v_event.event_access_type <> 'request' then
    raise exception 'event_is_not_request';
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

  if v_event.event_access_type <> 'request' then
    raise exception 'event_is_not_request';
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
      joined_at = now(),
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

create or replace function public.cx_event_thread_can_post(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when not exists (
      select 1 from public.threads t where t.id = p_thread_id and t.thread_type = 'event'
    ) then true
    when public.is_app_admin(p_user_id) then true
    when exists (
      select 1
      from public.threads t
      join public.events e on e.id = t.event_id
      where t.id = p_thread_id
        and e.host_user_id = p_user_id
    ) then true
    when exists (
      select 1
      from public.threads t
      join public.events e on e.id = t.event_id
      join public.event_members em on em.event_id = e.id and em.user_id = p_user_id
      where t.id = p_thread_id
        and coalesce(e.chat_mode, 'broadcast') = 'discussion'
        and coalesce(e.event_access_type, 'public') = 'private_group'
        and em.status in ('host', 'going', 'waitlist')
    ) then true
    else false
  end
$function$;

create or replace function public.cx_guard_event_thread_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.cx_event_thread_can_post(new.thread_id, new.sender_id) then
    raise exception 'event_thread_broadcast_only';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_cx_guard_event_thread_message_insert on public.thread_messages;
create trigger trg_cx_guard_event_thread_message_insert
before insert on public.thread_messages
for each row
execute function public.cx_guard_event_thread_message_insert();

create or replace function public.cx_sync_event_members_to_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_thread_id uuid;
  v_status text;
  v_actor uuid;
begin
  v_status := lower(trim(coalesce(new.status::text, '')));

  if v_status in ('host', 'going', 'waitlist') then
    v_actor := coalesce(auth.uid(), new.user_id);
    v_thread_id := public.cx_ensure_event_thread(new.event_id, v_actor, new.user_id);

    insert into public.thread_participants (thread_id, user_id, role)
    values (
      v_thread_id,
      new.user_id,
      case when new.status = 'host' or new.member_role = 'host' then 'owner' else 'member' end
    )
    on conflict (thread_id, user_id) do update
      set role = excluded.role;
  else
    select t.id
      into v_thread_id
    from public.threads t
    where t.thread_type = 'event'
      and t.event_id = new.event_id
    order by t.created_at asc
    limit 1;

    if v_thread_id is not null then
      delete from public.thread_participants tp
      where tp.thread_id = v_thread_id
        and tp.user_id = new.user_id
        and not exists (
          select 1
          from public.events e
          where e.id = new.event_id
            and e.host_user_id = new.user_id
        );
    end if;
  end if;

  return null;
end;
$function$;

drop trigger if exists trg_cx_sync_event_members_to_thread on public.event_members;
create trigger trg_cx_sync_event_members_to_thread
after insert or update on public.event_members
for each row
execute function public.cx_sync_event_members_to_thread();

create or replace function public.cx_thread_message_unlocked(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
as $function$
  with participant as (
    select exists (
      select 1
      from public.thread_participants tp
      where tp.thread_id = p_thread_id
        and tp.user_id = p_user_id
    ) as ok
  ),
  event_thread_access as (
    select exists (
      select 1
      from public.threads t
      join public.events e on e.id = t.event_id
      join public.event_members em on em.event_id = e.id and em.user_id = p_user_id
      where t.id = p_thread_id
        and t.thread_type = 'event'
        and e.status = 'published'
        and coalesce(e.hidden_by_admin, false) = false
        and em.status in ('host', 'going', 'waitlist')
    ) as ok
  ),
  service_inquiry_state as (
    select
      exists (
        select 1
        from public.thread_contexts tc
        where tc.thread_id = p_thread_id
          and tc.context_tag = 'service_inquiry'
      ) as has_service_inquiry,
      exists (
        select 1
        from public.thread_contexts tc
        where tc.thread_id = p_thread_id
          and tc.context_tag = 'service_inquiry'
          and tc.status_tag = 'active'
      ) as service_active,
      exists (
        select 1
        from public.thread_contexts tc
        join public.service_inquiry_threads sit
          on sit.thread_id = tc.thread_id
         and tc.source_table = 'service_inquiries'
         and tc.source_id = sit.inquiry_id
        join public.service_inquiries si on si.id = sit.inquiry_id
        where tc.thread_id = p_thread_id
          and tc.context_tag = 'service_inquiry'
          and tc.status_tag = 'info_shared'
          and si.requester_id = p_user_id
          and sit.requester_followup_used = false
      ) as requester_free_followup
  ),
  unlock_sources as (
    select
      exists (
        select 1
        from public.thread_contexts tc
        where tc.thread_id = p_thread_id
          and tc.context_tag in ('connection_request', 'trip_join_request', 'hosting_request', 'event_chat', 'activity')
          and tc.status_tag in ('accepted', 'active', 'completed')
      ) as has_non_service_unlock_context,
      exists (
        select 1
        from public.threads t
        join public.connections c on c.id = t.connection_id
        where t.id = p_thread_id
          and (c.requester_id = p_user_id or c.target_id = p_user_id)
          and c.status = 'accepted'
          and c.blocked_by is null
      ) as has_accepted_thread_connection,
      exists (
        select 1
        from public.thread_contexts tc
        join public.connections c
          on tc.source_table = 'connections'
         and tc.source_id = c.id
        where tc.thread_id = p_thread_id
          and (c.requester_id = p_user_id or c.target_id = p_user_id)
          and c.status = 'accepted'
          and c.blocked_by is null
      ) as has_accepted_context_connection,
      exists (
        select 1
        from public.thread_messages tm
        where tm.thread_id = p_thread_id
          and coalesce(tm.message_type, 'text') = 'text'
      ) as has_text_history,
      exists (
        select 1
        from public.thread_contexts tc
        join public.connections c
          on tc.source_table = 'connections'
         and tc.source_id = c.id
        where tc.thread_id = p_thread_id
          and (c.status = 'blocked' or c.blocked_by is not null)
      ) as has_blocked_connection
  )
  select
    (select ok from participant)
    and not (select has_blocked_connection from unlock_sources)
    and (
      (select ok from event_thread_access)
      or (select service_active from service_inquiry_state)
      or (select requester_free_followup from service_inquiry_state)
      or (select has_non_service_unlock_context from unlock_sources)
      or (select has_accepted_thread_connection from unlock_sources)
      or (select has_accepted_context_connection from unlock_sources)
      or (
        not (select has_service_inquiry from service_inquiry_state)
        and (select has_text_history from unlock_sources)
      )
    )
$function$;

grant execute on function public.cx_thread_message_unlocked(uuid, uuid) to authenticated;

drop policy if exists thread_messages_insert_sender_participant on public.thread_messages;
create policy thread_messages_insert_sender_participant
on public.thread_messages for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = thread_messages.thread_id
      and tp.user_id = auth.uid()
  )
  and public.cx_event_thread_can_post(thread_id, auth.uid())
);

drop policy if exists events_select_visible on public.events;
create policy events_select_visible
on public.events
for select
to authenticated
using (
  public.is_app_admin(auth.uid())
  or host_user_id = auth.uid()
  or (
    status = 'published'
    and coalesce(hidden_by_admin, false) = false
    and event_access_type in ('public', 'request', 'private_group')
  )
  or exists (
    select 1
    from public.event_members em
    where em.event_id = events.id
      and em.user_id = auth.uid()
      and em.status in ('host', 'going', 'waitlist', 'interested')
  )
);

drop policy if exists event_requests_insert_owner on public.event_requests;
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
      and coalesce(e.hidden_by_admin, false) = false
      and e.event_access_type = 'request'
      and e.host_user_id <> auth.uid()
  )
);

drop function if exists public.list_public_events_lite(integer);

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
  event_access_type text,
  chat_mode text,
  max_members integer,
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
  invite_token text,
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
    e.event_access_type,
    e.chat_mode,
    e.max_members,
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
    null::text as invite_token,
    e.created_at,
    e.updated_at
  from public.events e
  where e.status = 'published'
    and e.event_access_type in ('public', 'request')
    and coalesce(e.hidden_by_admin, false) = false
  order by e.starts_at asc
  limit greatest(1, least(coalesce(p_limit, 300), 500));
$function$;

drop function if exists public.get_public_event_lite(uuid);

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
  event_access_type text,
  chat_mode text,
  max_members integer,
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
  invite_token text,
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
    e.event_access_type,
    e.chat_mode,
    e.max_members,
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
    null::text as invite_token,
    e.created_at,
    e.updated_at
  from public.events e
  where e.id = p_event_id
    and e.status = 'published'
    and e.event_access_type in ('public', 'request', 'private_group')
    and coalesce(e.hidden_by_admin, false) = false
  limit 1;
$function$;

grant execute on function public.create_event(text, text, text, text, text, text, text, text, text, text, timestamptz, timestamptz, integer, text, jsonb, text, text[]) to authenticated;
grant execute on function public.update_event(uuid, text, text, text, text[], text, text, text, text, text, text, text, timestamptz, timestamptz, integer, text, jsonb, text) to authenticated;
grant execute on function public.join_public_event(uuid) to authenticated;
grant execute on function public.join_event_guarded(uuid) to authenticated;
grant execute on function public.request_private_event_access(uuid, text) to authenticated;
grant execute on function public.respond_event_request(uuid, text) to authenticated;
grant execute on function public.cx_event_thread_can_post(uuid, uuid) to authenticated;
grant execute on function public.list_public_events_lite(integer) to anon, authenticated;
grant execute on function public.get_public_event_lite(uuid) to anon, authenticated;

commit;
