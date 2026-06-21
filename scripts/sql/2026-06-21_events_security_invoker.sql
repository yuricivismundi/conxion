-- Convert event-domain SECURITY DEFINER functions to SECURITY INVOKER
-- Date: 2026-06-21
--
-- New RLS policies added:
--   event_members_update_member   – lets a member update their own membership row
--                                   (needed by leave_event)
--   event_requests_update_requester – lets the requester cancel their own pending request
--                                   (needed by cancel_event_request)
--   event_feedback_update_author  – lets the author update their own feedback row
--                                   (needed by submit_event_feedback ON CONFLICT DO UPDATE)
--
-- Functions intentionally left as SECURITY DEFINER:
--   create_event           → INSERT into event_members as host; no INSERT policy for members
--   join_event_guarded     → INSERT into event_members; no INSERT policy for members
--   join_public_event      → INSERT into event_members; no INSERT policy for members
--   request_private_event_access → calls create_notification
--   respond_event_request  → INSERT into event_members + calls create_notification
--   respond_event_request_by_id  → same

begin;

-- ──────────────────────────────────────────────────────────────────────────────
-- New RLS policies
-- ──────────────────────────────────────────────────────────────────────────────

drop policy if exists event_members_update_member on public.event_members;
create policy event_members_update_member
  on public.event_members
  for update
  to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists event_requests_update_requester on public.event_requests;
create policy event_requests_update_requester
  on public.event_requests
  for update
  to authenticated
  using  (requester_id = auth.uid())
  with check (requester_id = auth.uid());

drop policy if exists event_feedback_update_author on public.event_feedback;
create policy event_feedback_update_author
  on public.event_feedback
  for update
  to authenticated
  using  (author_id = auth.uid())
  with check (author_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────────
-- leave_event  (events_select_visible + new event_members_update_member)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.leave_event(p_event_id uuid)
returns void
language plpgsql
set search_path = public
as $$
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
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- cancel_event_request  (new event_requests_update_requester covers the UPDATE)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.cancel_event_request(p_event_id uuid)
returns void
language plpgsql
set search_path = public
as $$
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
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- create_event_report
--   events_select_visible covers SELECT on events
--   event_reports_insert_reporter covers INSERT on event_reports
--   reports_insert_own covers INSERT on reports (via dynamic SQL)
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.create_event_report(p_event_id uuid, p_reason text, p_note text default null::text)
returns uuid
language plpgsql
set search_path = public
as $_$
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
$_$;

-- ──────────────────────────────────────────────────────────────────────────────
-- submit_event_feedback
--   event_feedback_select_visible covers SELECT (author_id = auth.uid())
--   event_feedback_insert_author covers INSERT
--   new event_feedback_update_author covers ON CONFLICT DO UPDATE
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.submit_event_feedback(
  p_event_id uuid,
  p_happened_as_described boolean,
  p_quality integer,
  p_note text default null::text,
  p_visibility text default 'private'::text
)
returns uuid
language plpgsql
set search_path = public
as $$
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
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- update_event
--   events_select_visible covers SELECT (host_user_id = auth.uid())
--   events_update_host covers UPDATE
--   event_edit_logs has no RLS → authenticated can read/insert freely
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.update_event(
  p_event_id uuid,
  p_title text,
  p_description text,
  p_event_type text,
  p_styles text[] default null::text[],
  p_visibility text default 'public'::text,
  p_city text default null::text,
  p_country text default null::text,
  p_venue_name text default null::text,
  p_venue_address text default null::text,
  p_starts_at timestamp with time zone default null::timestamp with time zone,
  p_ends_at timestamp with time zone default null::timestamp with time zone,
  p_capacity integer default null::integer,
  p_cover_url text default null::text,
  p_links jsonb default '[]'::jsonb,
  p_status text default null::text
)
returns uuid
language plpgsql
set search_path = public
as $_$
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
$_$;

commit;
