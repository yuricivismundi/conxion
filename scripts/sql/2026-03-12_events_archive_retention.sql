-- ConXion events feed retention + archival
-- Date: 2026-03-12
--
-- Goals:
-- 1) Public events feed only shows active/upcoming events (not ended).
-- 2) Keep old ended events out of the hot table via archive + prune job.
-- 3) Default retention: delete ended events after 30 days (after archiving snapshot).

begin;

create index if not exists idx_events_status_ends_at on public.events(status, ends_at desc);

create table if not exists public.events_archive (
  event_id uuid primary key,
  archived_at timestamptz not null default now(),
  ended_at timestamptz,
  archived_reason text not null default 'ended_event_retention',
  source_event jsonb not null
);

create index if not exists idx_events_archive_archived_at on public.events_archive(archived_at desc);
create index if not exists idx_events_archive_ended_at on public.events_archive(ended_at desc);

alter table public.events_archive enable row level security;

revoke all on public.events_archive from public;
revoke all on public.events_archive from anon;
revoke all on public.events_archive from authenticated;
grant select on public.events_archive to service_role;

-- Keep anon/auth public browsing aligned with "Facebook-like" behavior:
-- ended events are not returned in discover feed.
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
    and e.ends_at >= now()
  order by e.starts_at asc
  limit greatest(1, least(coalesce(p_limit, 300), 500));
$function$;

grant execute on function public.list_public_events_lite(integer) to anon, authenticated;

create or replace function public.archive_and_prune_past_events(
  p_archive_after_days integer default 0,
  p_delete_after_days integer default 30,
  p_batch integer default 1000
)
returns table (
  archived_count integer,
  deleted_count integer
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_archive_count integer := 0;
  v_delete_count integer := 0;
  v_archive_after interval;
  v_delete_after interval;
begin
  if coalesce(p_archive_after_days, 0) < 0 then
    raise exception 'invalid_archive_after_days';
  end if;

  if coalesce(p_delete_after_days, 30) < 1 then
    raise exception 'invalid_delete_after_days';
  end if;

  if p_delete_after_days < p_archive_after_days then
    raise exception 'delete_window_must_be_greater_or_equal_to_archive_window';
  end if;

  v_archive_after := make_interval(days => p_archive_after_days);
  v_delete_after := make_interval(days => p_delete_after_days);

  with archive_candidates as (
    select e.*
    from public.events e
    where e.ends_at < (now() - v_archive_after)
    order by e.ends_at asc
    limit greatest(1, least(coalesce(p_batch, 1000), 5000))
  ),
  archived as (
    insert into public.events_archive (event_id, ended_at, source_event)
    select c.id, c.ends_at, to_jsonb(c)
    from archive_candidates c
    on conflict (event_id) do nothing
    returning event_id
  )
  select count(*)::integer into v_archive_count
  from archived;

  with delete_candidates as (
    select e.id
    from public.events e
    where e.ends_at < (now() - v_delete_after)
      and exists (
        select 1
        from public.events_archive a
        where a.event_id = e.id
      )
    order by e.ends_at asc
    limit greatest(1, least(coalesce(p_batch, 1000), 5000))
  ),
  deleted as (
    delete from public.events e
    using delete_candidates d
    where e.id = d.id
    returning e.id
  )
  select count(*)::integer into v_delete_count
  from deleted;

  return query
  select v_archive_count, v_delete_count;
end;
$function$;

revoke all on function public.archive_and_prune_past_events(integer, integer, integer) from public;
grant execute on function public.archive_and_prune_past_events(integer, integer, integer) to service_role;

create or replace function public.prune_events_archive(
  p_keep_days integer default 30,
  p_batch integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_deleted integer := 0;
begin
  if coalesce(p_keep_days, 30) < 1 then
    raise exception 'invalid_keep_days';
  end if;

  with candidates as (
    select a.event_id
    from public.events_archive a
    where coalesce(a.ended_at, a.archived_at) < (now() - make_interval(days => p_keep_days))
    order by coalesce(a.ended_at, a.archived_at) asc
    limit greatest(1, least(coalesce(p_batch, 1000), 5000))
  ),
  deleted as (
    delete from public.events_archive a
    using candidates c
    where a.event_id = c.event_id
    returning 1
  )
  select count(*)::integer into v_deleted
  from deleted;

  return v_deleted;
end;
$function$;

revoke all on function public.prune_events_archive(integer, integer) from public;
grant execute on function public.prune_events_archive(integer, integer) to service_role;

commit;
