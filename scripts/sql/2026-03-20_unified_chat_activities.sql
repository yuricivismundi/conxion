-- ConXion Unified Chat Activities
-- Date: 2026-03-20
-- Safe to re-run.

begin;

create extension if not exists pgcrypto;

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  activity_type text not null,
  status text not null default 'pending',
  title text,
  note text,
  start_at timestamptz,
  end_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);

alter table public.activities add column if not exists thread_id uuid;
alter table public.activities add column if not exists requester_id uuid;
alter table public.activities add column if not exists recipient_id uuid;
alter table public.activities add column if not exists activity_type text;
alter table public.activities add column if not exists status text;
alter table public.activities add column if not exists title text;
alter table public.activities add column if not exists note text;
alter table public.activities add column if not exists start_at timestamptz;
alter table public.activities add column if not exists end_at timestamptz;
alter table public.activities add column if not exists accepted_at timestamptz;
alter table public.activities add column if not exists completed_at timestamptz;
alter table public.activities add column if not exists resolved_at timestamptz;
alter table public.activities add column if not exists metadata jsonb;
alter table public.activities add column if not exists created_at timestamptz;
alter table public.activities add column if not exists updated_at timestamptz;

update public.activities set status = 'pending' where status is null or trim(status) = '';
update public.activities set metadata = '{}'::jsonb where metadata is null;
update public.activities set created_at = now() where created_at is null;
update public.activities set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;

alter table public.activities alter column thread_id set not null;
alter table public.activities alter column requester_id set not null;
alter table public.activities alter column recipient_id set not null;
alter table public.activities alter column activity_type set not null;
alter table public.activities alter column status set not null;
alter table public.activities alter column status set default 'pending';
alter table public.activities alter column metadata set not null;
alter table public.activities alter column metadata set default '{}'::jsonb;
alter table public.activities alter column created_at set not null;
alter table public.activities alter column created_at set default now();
alter table public.activities alter column updated_at set not null;
alter table public.activities alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'activities_activity_type_chk'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_activity_type_chk
      check (
        activity_type in (
          'practice',
          'social_dance',
          'event',
          'festival',
          'travel_together',
          'hosting',
          'stay_as_guest',
          'private_class',
          'group_class',
          'workshop',
          'collaboration',
          'content_video',
          'competition'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'activities_status_chk'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_status_chk
      check (status in ('pending', 'accepted', 'declined', 'cancelled', 'completed'));
  end if;
end $$;

create index if not exists idx_activities_thread_updated
  on public.activities(thread_id, updated_at desc);
create index if not exists idx_activities_requester_status
  on public.activities(requester_id, status, updated_at desc);
create index if not exists idx_activities_recipient_status
  on public.activities(recipient_id, status, updated_at desc);

drop trigger if exists trg_activities_set_updated_at on public.activities;
create trigger trg_activities_set_updated_at
before update on public.activities
for each row execute function public.set_updated_at_ts();

alter table public.activities enable row level security;

drop policy if exists activities_select_participants on public.activities;
create policy activities_select_participants
on public.activities for select
to authenticated
using (requester_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists activities_insert_requester on public.activities;
create policy activities_insert_requester
on public.activities for insert
to authenticated
with check (requester_id = auth.uid());

drop policy if exists activities_update_none on public.activities;
create policy activities_update_none
on public.activities for update
to authenticated
using (false)
with check (false);

drop policy if exists activities_delete_none on public.activities;
create policy activities_delete_none
on public.activities for delete
to authenticated
using (false);

alter table public.thread_contexts drop constraint if exists thread_contexts_context_tag_chk;
alter table public.thread_contexts
  add constraint thread_contexts_context_tag_chk
  check (context_tag in ('connection_request', 'hosting_request', 'trip_join_request', 'event_chat', 'regular_chat', 'activity')) not valid;

alter table public.thread_contexts drop constraint if exists thread_contexts_status_tag_chk;
alter table public.thread_contexts
  add constraint thread_contexts_status_tag_chk
  check (status_tag in ('pending', 'accepted', 'declined', 'cancelled', 'active', 'completed')) not valid;

create or replace function public.cx_activity_type_label(p_activity_type text)
returns text
language sql
immutable
as $$
  select case trim(coalesce(p_activity_type, ''))
    when 'practice' then 'Practice'
    when 'social_dance' then 'Social Dance'
    when 'event' then 'Event'
    when 'festival' then 'Festival'
    when 'travel_together' then 'Travel Together'
    when 'hosting' then 'Hosting'
    when 'stay_as_guest' then 'Stay as Guest'
    when 'private_class' then 'Private Class'
    when 'group_class' then 'Group Class'
    when 'workshop' then 'Workshop'
    when 'collaboration' then 'Collaboration'
    when 'content_video' then 'Content / Video'
    when 'competition' then 'Competition'
    else 'Activity'
  end;
$$;

create or replace function public.cx_activity_reference_context(p_activity_type text)
returns text
language sql
immutable
as $$
  select case trim(coalesce(p_activity_type, ''))
    when 'practice' then 'practice'
    when 'social_dance' then 'social_dance'
    when 'event' then 'event'
    when 'festival' then 'festival'
    when 'travel_together' then 'travel_together'
    when 'hosting' then 'hosting'
    when 'stay_as_guest' then 'stay_as_guest'
    when 'private_class' then 'private_class'
    when 'group_class' then 'group_class'
    when 'workshop' then 'workshop'
    when 'collaboration' then 'collaboration'
    when 'content_video' then 'content_video'
    when 'competition' then 'competition'
    else 'collaboration'
  end;
$$;

create or replace function public.cx_upsert_thread_context(
  p_thread_id uuid,
  p_source_table text,
  p_source_id uuid,
  p_context_tag text,
  p_status_tag text,
  p_title text default null,
  p_city text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_requester_id uuid default null,
  p_recipient_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id uuid;
  v_status text := lower(trim(coalesce(p_status_tag, 'pending')));
begin
  if p_thread_id is null or p_source_id is null then
    raise exception 'thread_or_source_required';
  end if;
  if p_source_table is null or trim(p_source_table) = '' then
    raise exception 'source_table_required';
  end if;
  if p_context_tag not in ('connection_request', 'hosting_request', 'trip_join_request', 'event_chat', 'regular_chat', 'activity') then
    raise exception 'invalid_context_tag';
  end if;
  if v_status not in ('pending', 'accepted', 'declined', 'cancelled', 'active', 'completed') then
    raise exception 'invalid_status_tag';
  end if;

  insert into public.thread_contexts (
    thread_id,
    source_table,
    source_id,
    context_tag,
    status_tag,
    title,
    city,
    start_date,
    end_date,
    requester_id,
    recipient_id,
    metadata,
    is_pinned,
    resolved_at
  )
  values (
    p_thread_id,
    trim(p_source_table),
    p_source_id,
    p_context_tag,
    v_status,
    nullif(trim(coalesce(p_title, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    p_start_date,
    p_end_date,
    p_requester_id,
    p_recipient_id,
    coalesce(p_metadata, '{}'::jsonb),
    v_status = 'pending',
    case when v_status = 'pending' then null else now() end
  )
  on conflict (source_table, source_id)
  do update set
    thread_id = excluded.thread_id,
    context_tag = excluded.context_tag,
    status_tag = excluded.status_tag,
    title = excluded.title,
    city = excluded.city,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    requester_id = excluded.requester_id,
    recipient_id = excluded.recipient_id,
    metadata = excluded.metadata,
    is_pinned = excluded.is_pinned,
    resolved_at = case when excluded.status_tag = 'pending' then null else now() end,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.cx_sync_activities()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_completed_count int := 0;
  v_prompt_count int := 0;
  v_context_tag text;
  v_conn_id uuid;
  v_due_at timestamptz;
  v_remind_after timestamptz;
  v_expires_at timestamptz;
  r record;
  v_inserted int := 0;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  for r in
    update public.activities a
    set status = 'completed',
        completed_at = coalesce(a.completed_at, now()),
        resolved_at = coalesce(a.resolved_at, now()),
        updated_at = now()
    where a.status = 'accepted'
      and (a.requester_id = v_me or a.recipient_id = v_me)
      and (
        case
          when coalesce(a.end_at, a.start_at) is not null then coalesce(a.end_at, a.start_at) + interval '24 hours'
          when a.accepted_at is not null then a.accepted_at + interval '24 hours'
          else null
        end
      ) <= now()
    returning a.*
  loop
    v_completed_count := v_completed_count + 1;

    perform public.cx_upsert_thread_context(
      p_thread_id => r.thread_id,
      p_source_table => 'activities',
      p_source_id => r.id,
      p_context_tag => 'activity',
      p_status_tag => 'completed',
      p_title => coalesce(nullif(trim(coalesce(r.title, '')), ''), public.cx_activity_type_label(r.activity_type)),
      p_city => null,
      p_start_date => case when r.start_at is null then null else (r.start_at at time zone 'UTC')::date end,
      p_end_date => case when coalesce(r.end_at, r.start_at) is null then null else (coalesce(r.end_at, r.start_at) at time zone 'UTC')::date end,
      p_requester_id => r.requester_id,
      p_recipient_id => r.recipient_id,
      p_metadata => coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
        'activity_type', r.activity_type,
        'activity_id', r.id,
        'title', coalesce(nullif(trim(coalesce(r.title, '')), ''), public.cx_activity_type_label(r.activity_type))
      )
    );

    perform public.cx_emit_thread_event(
      p_thread_id => r.thread_id,
      p_sender_id => r.requester_id,
      p_body => public.cx_activity_type_label(r.activity_type) || ' completed. Leave a reference.',
      p_message_type => 'system',
      p_context_tag => 'activity',
      p_status_tag => 'completed',
      p_metadata => coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object('activity_type', r.activity_type, 'activity_id', r.id)
    );

    v_context_tag := public.cx_activity_reference_context(r.activity_type);
    v_due_at := coalesce(r.completed_at, now());
    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '7 days';

    select c.id
      into v_conn_id
    from public.connections c
    where coalesce(c.status::text, '') = 'accepted'
      and c.blocked_by is null
      and (
        (c.requester_id = r.requester_id and c.target_id = r.recipient_id)
        or (c.requester_id = r.recipient_id and c.target_id = r.requester_id)
      )
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    insert into public.reference_requests (
      user_id,
      peer_user_id,
      context_tag,
      source_table,
      source_id,
      connection_id,
      due_at,
      remind_after,
      expires_at,
      status
    )
    values
      (r.requester_id, r.recipient_id, v_context_tag, 'activities', r.id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending'),
      (r.recipient_id, r.requester_id, v_context_tag, 'activities', r.id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending')
    on conflict (user_id, source_table, source_id, context_tag) do nothing;

    get diagnostics v_inserted = row_count;
    v_prompt_count := v_prompt_count + v_inserted;
  end loop;

  return jsonb_build_object(
    'completed', v_completed_count,
    'reference_prompts_created', v_prompt_count
  );
end;
$function$;

grant execute on function public.cx_sync_activities() to authenticated;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'reference_requests_source_table_chk'
      and conrelid = 'public.reference_requests'::regclass
  ) then
    alter table public.reference_requests drop constraint reference_requests_source_table_chk;
  end if;

  alter table public.reference_requests
    add constraint reference_requests_source_table_chk
    check (source_table in ('trip_requests', 'hosting_requests', 'activities'));
exception when undefined_table then
  null;
end $$;

commit;
