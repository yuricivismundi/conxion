begin;

create extension if not exists pgcrypto;

-- ── 1. Event series metadata ────────────────────────────────────────────────

create table if not exists public.event_series (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null,
  recurrence_kind text not null,
  timezone text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_series_recurrence_kind_chk'
      and conrelid = 'public.event_series'::regclass
  ) then
    alter table public.event_series
      add constraint event_series_recurrence_kind_chk
      check (recurrence_kind in ('biweekly', 'monthly', 'custom'));
  end if;
end $$;

create index if not exists idx_event_series_host on public.event_series(host_user_id, created_at desc);

create or replace function public.set_event_series_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists trg_event_series_updated_at on public.event_series;
create trigger trg_event_series_updated_at
before update on public.event_series
for each row execute function public.set_event_series_updated_at();

alter table public.events
  add column if not exists event_series_id uuid references public.event_series(id) on delete set null,
  add column if not exists series_position integer;

create index if not exists idx_events_series_position
  on public.events(event_series_id, series_position)
  where event_series_id is not null;

-- ── 2. Event invitations ────────────────────────────────────────────────────

create table if not exists public.event_invitations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  inviter_user_id uuid not null,
  recipient_user_id uuid not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, recipient_user_id)
);

alter table public.event_invitations
  add column if not exists inviter_user_id uuid,
  add column if not exists recipient_user_id uuid,
  add column if not exists note text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'event_invitations'
      and column_name = 'sender_id'
  ) then
    execute $sql$
      update public.event_invitations
      set inviter_user_id = coalesce(inviter_user_id, sender_id)
      where inviter_user_id is null
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'event_invitations'
      and column_name = 'recipient_id'
  ) then
    execute $sql$
      update public.event_invitations
      set recipient_user_id = coalesce(recipient_user_id, recipient_id)
      where recipient_user_id is null
    $sql$;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'event_invitations'
      and column_name = 'sender_id'
  ) then
    execute 'alter table public.event_invitations alter column sender_id drop not null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'event_invitations'
      and column_name = 'recipient_id'
  ) then
    execute 'alter table public.event_invitations alter column recipient_id drop not null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'event_invitations'
      and column_name = 'status'
  ) then
    execute 'alter table public.event_invitations alter column status drop not null';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from public.event_invitations
    where inviter_user_id is null
  ) then
    alter table public.event_invitations
      alter column inviter_user_id set not null;
  end if;

  if not exists (
    select 1
    from public.event_invitations
    where recipient_user_id is null
  ) then
    alter table public.event_invitations
      alter column recipient_user_id set not null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_invitations_event_recipient_user_key'
      and conrelid = 'public.event_invitations'::regclass
  ) then
    alter table public.event_invitations
      add constraint event_invitations_event_recipient_user_key
      unique (event_id, recipient_user_id);
  end if;
end $$;

create index if not exists idx_event_invitations_event on public.event_invitations(event_id, updated_at desc);
create index if not exists idx_event_invitations_recipient on public.event_invitations(recipient_user_id, updated_at desc);

create or replace function public.set_event_invitation_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists trg_event_invitations_updated_at on public.event_invitations;
create trigger trg_event_invitations_updated_at
before update on public.event_invitations
for each row execute function public.set_event_invitation_updated_at();

alter table public.event_invitations enable row level security;

drop policy if exists event_invitations_select_none on public.event_invitations;
create policy event_invitations_select_none
on public.event_invitations for select
to authenticated
using (false);

drop policy if exists event_invitations_insert_none on public.event_invitations;
create policy event_invitations_insert_none
on public.event_invitations for insert
to authenticated
with check (false);

drop policy if exists event_invitations_update_none on public.event_invitations;
create policy event_invitations_update_none
on public.event_invitations for update
to authenticated
using (false)
with check (false);

drop policy if exists event_invitations_delete_none on public.event_invitations;
create policy event_invitations_delete_none
on public.event_invitations for delete
to authenticated
using (false);

-- ── 3. Event chat mode and moderation helpers ───────────────────────────────

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
    else case
      when lower(trim(coalesce(p_chat_mode, ''))) = 'discussion' then 'discussion'
      else 'broadcast'
    end
  end
$function$;

create or replace function public.cx_can_select_thread_message(
  p_thread_id uuid,
  p_sender_id uuid,
  p_message_type text,
  p_context_tag text,
  p_status_tag text,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_thread_type text;
  v_host_user_id uuid;
begin
  if p_user_id is null then
    return false;
  end if;

  if public.is_app_admin(p_user_id) then
    return true;
  end if;

  if not exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = p_user_id
  ) then
    return false;
  end if;

  if coalesce(lower(trim(p_status_tag)), 'active') <> 'pending' then
    return true;
  end if;

  if coalesce(lower(trim(p_message_type)), 'text') <> 'text' then
    return true;
  end if;

  if coalesce(lower(trim(p_context_tag)), 'event_chat') <> 'event_chat' then
    return true;
  end if;

  select t.thread_type, e.host_user_id
    into v_thread_type, v_host_user_id
  from public.threads t
  left join public.events e on e.id = t.event_id
  where t.id = p_thread_id
  limit 1;

  if v_thread_type <> 'event' then
    return true;
  end if;

  return p_user_id = p_sender_id or p_user_id = v_host_user_id;
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
declare
  v_event_id uuid;
  v_event_host uuid;
  v_requires_approval boolean := false;
  v_is_member boolean := false;
begin
  select e.id, e.host_user_id, coalesce(e.approve_messages, false)
    into v_event_id, v_event_host, v_requires_approval
  from public.threads t
  join public.events e on e.id = t.event_id
  where t.id = new.thread_id
    and t.thread_type = 'event'
  limit 1;

  if v_event_id is null then
    return new;
  end if;

  select exists (
    select 1
    from public.event_members em
    where em.event_id = v_event_id
      and em.user_id = new.sender_id
      and em.status in ('host', 'going', 'waitlist')
  )
  into v_is_member;

  if not public.cx_event_thread_can_post(new.thread_id, new.sender_id) then
    if not v_is_member then
      raise exception 'event_thread_member_required';
    end if;
    raise exception 'event_thread_broadcast_only';
  end if;

  new.context_tag := coalesce(nullif(trim(coalesce(new.context_tag, '')), ''), 'event_chat');

  if coalesce(new.message_type, 'text') <> 'text' then
    new.status_tag := coalesce(nullif(trim(coalesce(new.status_tag, '')), ''), 'active');
    return new;
  end if;

  if public.is_app_admin(new.sender_id) or new.sender_id = v_event_host then
    new.status_tag := coalesce(nullif(trim(coalesce(new.status_tag, '')), ''), 'active');
    return new;
  end if;

  if exists (
    select 1
    from public.thread_messages tm
    where tm.thread_id = new.thread_id
      and tm.sender_id = new.sender_id
      and coalesce(tm.message_type, 'text') = 'text'
      and coalesce(tm.context_tag, 'event_chat') = 'event_chat'
  ) then
    raise exception 'event_guest_message_limit_reached';
  end if;

  new.status_tag := case
    when v_requires_approval then 'pending'
    else coalesce(nullif(trim(coalesce(new.status_tag, '')), ''), 'active')
  end;
  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'eventMessageApproval', v_requires_approval,
      'eventMessageLimit', 'one_per_guest'
    );

  return new;
end;
$function$;

drop trigger if exists trg_cx_guard_event_thread_message_insert on public.thread_messages;
create trigger trg_cx_guard_event_thread_message_insert
before insert on public.thread_messages
for each row execute function public.cx_guard_event_thread_message_insert();

drop policy if exists thread_messages_select_participants on public.thread_messages;
create policy thread_messages_select_participants
on public.thread_messages for select
to authenticated
using (
  public.cx_can_select_thread_message(
    thread_id,
    sender_id,
    message_type,
    context_tag,
    status_tag,
    auth.uid()
  )
);

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

-- ── 4. Event update RPC with settings support ───────────────────────────────

drop function if exists public.update_event(uuid, text, text, text, text[], text, text, text, text, text, text, text, timestamptz, timestamptz, integer, text, jsonb, text);

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
  p_status text default null,
  p_show_guest_list boolean default null,
  p_guests_can_invite boolean default null,
  p_approve_messages boolean default null
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
      show_guest_list = coalesce(p_show_guest_list, v_event.show_guest_list, true),
      guests_can_invite = coalesce(p_guests_can_invite, v_event.guests_can_invite, false),
      approve_messages = coalesce(p_approve_messages, v_event.approve_messages, false),
      updated_at = now()
  where id = p_event_id;

  insert into public.event_edit_logs (event_id, editor_id)
  values (p_event_id, v_me);

  perform public.cx_ensure_event_thread(p_event_id, v_me, null);

  return p_event_id;
end;
$function$;

grant execute on function public.update_event(uuid, text, text, text, text[], text, text, text, text, text, text, text, timestamptz, timestamptz, integer, text, jsonb, text, boolean, boolean, boolean) to authenticated;

-- ── 5. Recurring series creation RPC ────────────────────────────────────────

create or replace function public.create_event_series(
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
  p_occurrences jsonb,
  p_capacity integer default null,
  p_cover_url text default null,
  p_links jsonb default '[]'::jsonb,
  p_status text default 'published',
  p_styles text[] default null,
  p_show_guest_list boolean default true,
  p_guests_can_invite boolean default false,
  p_approve_messages boolean default false,
  p_recurrence_kind text default 'custom',
  p_timezone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_occurrence jsonb;
  v_series_id uuid;
  v_event_id uuid;
  v_event_ids uuid[] := '{}'::uuid[];
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_position integer := 0;
  v_kind text := lower(trim(coalesce(p_recurrence_kind, 'custom')));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if jsonb_typeof(coalesce(p_occurrences, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_occurrences';
  end if;

  if jsonb_array_length(coalesce(p_occurrences, '[]'::jsonb)) < 2 then
    raise exception 'series_occurrence_count_invalid';
  end if;

  if jsonb_array_length(p_occurrences) > 12 then
    raise exception 'series_occurrence_count_invalid';
  end if;

  if v_kind not in ('biweekly', 'monthly', 'custom') then
    raise exception 'invalid_recurrence_kind';
  end if;

  insert into public.event_series (
    host_user_id,
    recurrence_kind,
    timezone,
    metadata
  )
  values (
    v_me,
    v_kind,
    nullif(trim(coalesce(p_timezone, '')), ''),
    jsonb_build_object(
      'title', trim(coalesce(p_title, '')),
      'occurrenceCount', jsonb_array_length(p_occurrences)
    )
  )
  returning id into v_series_id;

  for v_occurrence in
    select value
    from jsonb_array_elements(p_occurrences)
  loop
    v_starts_at := nullif(trim(coalesce(v_occurrence ->> 'startsAt', '')), '')::timestamptz;
    v_ends_at := nullif(trim(coalesce(v_occurrence ->> 'endsAt', '')), '')::timestamptz;

    v_event_id := public.create_event(
      p_title,
      p_description,
      p_event_type,
      p_visibility,
      p_event_access_type,
      p_chat_mode,
      p_city,
      p_country,
      p_venue_name,
      p_venue_address,
      v_starts_at,
      v_ends_at,
      p_capacity,
      p_cover_url,
      p_links,
      p_status,
      p_styles,
      p_show_guest_list,
      p_guests_can_invite,
      p_approve_messages
    );

    v_position := v_position + 1;
    update public.events
       set event_series_id = v_series_id,
           series_position = v_position
     where id = v_event_id;

    v_event_ids := array_append(v_event_ids, v_event_id);
  end loop;

  update public.event_series
     set metadata = coalesce(metadata, '{}'::jsonb)
       || jsonb_build_object(
         'eventIds', to_jsonb(v_event_ids),
         'occurrenceCount', coalesce(array_length(v_event_ids, 1), 0)
       )
   where id = v_series_id;

  return jsonb_build_object(
    'series_id', v_series_id,
    'primary_event_id', v_event_ids[1],
    'event_ids', to_jsonb(v_event_ids),
    'occurrence_count', coalesce(array_length(v_event_ids, 1), 0)
  );
end;
$function$;

grant execute on function public.create_event_series(text, text, text, text, text, text, text, text, text, text, jsonb, integer, text, jsonb, text, text[], boolean, boolean, boolean, text, text) to authenticated;

-- ── 6. Event invitation RPC ─────────────────────────────────────────────────

create or replace function public.send_event_invitation(
  p_event_id uuid,
  p_recipient_id uuid,
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
  v_invitation_id uuid;
  v_has_sender_id boolean := false;
  v_has_recipient_id boolean := false;
  v_has_status boolean := false;
  v_sql text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_event_id is null then
    raise exception 'event_not_found';
  end if;

  if p_recipient_id is null then
    raise exception 'recipient_required';
  end if;

  if p_recipient_id = v_me then
    raise exception 'cannot_invite_self';
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

  if coalesce(v_event.hidden_by_admin, false) then
    raise exception 'event_hidden';
  end if;

  if v_event.host_user_id <> v_me then
    if coalesce(v_event.guests_can_invite, false) is not true then
      raise exception 'invite_not_allowed';
    end if;

    if not exists (
      select 1
      from public.event_members em
      where em.event_id = p_event_id
        and em.user_id = v_me
        and em.status in ('host', 'going', 'waitlist')
    ) then
      raise exception 'invite_requires_event_membership';
    end if;
  end if;

  if not exists (
    select 1
    from public.connections c
    where (
      (c.requester_id = v_me and c.target_id = p_recipient_id)
      or (c.requester_id = p_recipient_id and c.target_id = v_me)
    )
      and c.status = 'accepted'
      and c.blocked_by is null
  ) then
    raise exception 'invite_requires_connection';
  end if;

  if exists (
    select 1
    from public.event_members em
    where em.event_id = p_event_id
      and em.user_id = p_recipient_id
      and em.status in ('host', 'going', 'waitlist')
  ) then
    raise exception 'already_joined_or_waitlisted';
  end if;

  select exists (
           select 1
           from information_schema.columns
           where table_schema = 'public'
             and table_name = 'event_invitations'
             and column_name = 'sender_id'
         ),
         exists (
           select 1
           from information_schema.columns
           where table_schema = 'public'
             and table_name = 'event_invitations'
             and column_name = 'recipient_id'
         ),
         exists (
           select 1
           from information_schema.columns
           where table_schema = 'public'
             and table_name = 'event_invitations'
             and column_name = 'status'
         )
    into v_has_sender_id, v_has_recipient_id, v_has_status;

  v_sql := '
    insert into public.event_invitations (
      event_id,
      inviter_user_id,
      recipient_user_id' ||
      case when v_has_sender_id then ', sender_id' else '' end ||
      case when v_has_recipient_id then ', recipient_id' else '' end ||
      ', note' ||
      case when v_has_status then ', status' else '' end ||
    ')
    values (
      $1,
      $2,
      $3' ||
      case when v_has_sender_id then ', $2' else '' end ||
      case when v_has_recipient_id then ', $3' else '' end ||
      ', nullif(trim(coalesce($4, '''')), '''')' ||
      case when v_has_status then ', ''pending''' else '' end ||
    ')
    on conflict (event_id, recipient_user_id)
    do update set
      inviter_user_id = excluded.inviter_user_id,
      recipient_user_id = excluded.recipient_user_id' ||
      case when v_has_sender_id then ', sender_id = excluded.sender_id' else '' end ||
      case when v_has_recipient_id then ', recipient_id = excluded.recipient_id' else '' end ||
      ', note = excluded.note' ||
      case when v_has_status then ', status = coalesce(public.event_invitations.status, excluded.status)' else '' end ||
      ', updated_at = now()
    returning id';

  execute v_sql
    using p_event_id, v_me, p_recipient_id, p_note
    into v_invitation_id;

  if to_regprocedure('public.create_notification(uuid,text,text,text,text,jsonb)') is not null then
    perform public.create_notification(
      p_recipient_id,
      'event_invite_received',
      'Event invite',
      'A connection invited you to an event.',
      '/events/' || p_event_id::text,
      jsonb_build_object(
        'event_id', p_event_id,
        'inviter_user_id', v_me,
        'invitation_id', v_invitation_id
      )
    );
  end if;

  return v_invitation_id;
end;
$function$;

grant execute on function public.send_event_invitation(uuid, uuid, text) to authenticated;

commit;
