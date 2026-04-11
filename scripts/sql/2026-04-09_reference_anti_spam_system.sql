begin;

create or replace function public.cx_reference_public_category(p_context text)
returns text
language sql
immutable
as $function$
  select case lower(trim(coalesce(p_context, '')))
    when 'practice' then 'Practice'
    when 'social_dance' then 'Social Dance'
    when 'event_festival' then 'Event / Festival'
    when 'travelling' then 'Travelling'
    when 'request_hosting' then 'Request Hosting'
    when 'offer_hosting' then 'Offer Hosting'
    when 'private_class' then 'Classes'
    else 'Collaborate'
  end
$function$;

create or replace function public.cx_reference_family(p_category text)
returns text
language sql
immutable
as $function$
  select case trim(coalesce(p_category, ''))
    when 'Practice' then 'practice_social'
    when 'Social Dance' then 'practice_social'
    when 'Classes' then 'teaching'
    when 'Travelling' then 'hosting_trip'
    when 'Request Hosting' then 'hosting_trip'
    when 'Offer Hosting' then 'hosting_trip'
    else 'event_collab'
  end
$function$;

create or replace function public.cx_reference_cooldown_days(p_context text)
returns int
language sql
immutable
as $function$
  select case lower(trim(coalesce(p_context, '')))
    when 'practice' then 120
    when 'social_dance' then 120
    when 'private_class' then 90
    else null
  end
$function$;

create or replace function public.cx_reference_source_type(p_context text, p_source_table text default null)
returns text
language sql
immutable
as $function$
  select case
    when lower(trim(coalesce(p_source_table, ''))) = 'trip_requests' or lower(trim(coalesce(p_context, ''))) = 'travelling' then 'travel_activity'
    when lower(trim(coalesce(p_source_table, ''))) = 'hosting_requests'
      or lower(trim(coalesce(p_context, ''))) in ('request_hosting', 'offer_hosting') then 'hosting_stay'
    when lower(trim(coalesce(p_source_table, ''))) = 'events'
      or lower(trim(coalesce(p_context, ''))) = 'event_festival' then 'event_participation'
    when lower(trim(coalesce(p_context, ''))) = 'practice' then 'practice_activity'
    when lower(trim(coalesce(p_context, ''))) = 'social_dance' then 'social_dance_activity'
    when lower(trim(coalesce(p_context, ''))) = 'private_class' then 'class_activity'
    when lower(trim(coalesce(p_context, ''))) = 'collaborate' then 'collaboration_activity'
    else 'legacy'
  end
$function$;

alter table public.references add column if not exists author_user_id uuid references auth.users(id) on delete set null;
alter table public.references add column if not exists recipient_user_id uuid references auth.users(id) on delete set null;
alter table public.references add column if not exists source_id uuid;
alter table public.references add column if not exists source_type text;
alter table public.references add column if not exists public_category text;
alter table public.references add column if not exists reference_family text;

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.references'::regclass
      and tgname = 'trg_references_guardrails'
  ) then
    execute 'alter table public.references disable trigger trg_references_guardrails';
  end if;
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.references'::regclass
      and tgname = 'trg_references_immutable'
  ) then
    execute 'alter table public.references disable trigger trg_references_immutable';
  end if;
end $$;

update public.references
set author_user_id = coalesce(author_user_id, author_id, from_user_id)
where author_user_id is null;

update public.references
set recipient_user_id = coalesce(recipient_user_id, recipient_id, to_user_id, target_id)
where recipient_user_id is null;

update public.references
set source_id = coalesce(source_id, entity_id, sync_id)
where source_id is null;

update public.references
set public_category = public.cx_reference_public_category(coalesce(context_tag, entity_type, context, 'collaborate'))
where public_category is null or trim(public_category) = '';

update public.references
set reference_family = public.cx_reference_family(public_category)
where reference_family is null or trim(reference_family) = '';

update public.references
set source_type = public.cx_reference_source_type(coalesce(context_tag, entity_type, context, 'collaborate'), null)
where source_type is null or trim(source_type) = '';

alter table public.references drop constraint if exists references_public_category_chk;
alter table public.references
  add constraint references_public_category_chk
  check (public_category in (
    'Practice',
    'Social Dance',
    'Event / Festival',
    'Travelling',
    'Request Hosting',
    'Offer Hosting',
    'Collaborate',
    'Classes'
  )) not valid;

alter table public.references drop constraint if exists references_reference_family_chk;
alter table public.references
  add constraint references_reference_family_chk
  check (reference_family in ('practice_social', 'event_collab', 'hosting_trip', 'teaching')) not valid;

alter table public.references drop constraint if exists references_source_type_chk;
alter table public.references
  add constraint references_source_type_chk
  check (source_type in (
    'practice_activity',
    'social_dance_activity',
    'event_participation',
    'travel_activity',
    'hosting_stay',
    'collaboration_activity',
    'class_activity',
    'legacy'
  )) not valid;

drop index if exists public.ux_references_pair_context_once;
create unique index if not exists ux_references_author_source_once
  on public.references(author_user_id, recipient_user_id, source_type, source_id)
  where author_user_id is not null
    and recipient_user_id is not null
    and source_type is not null
    and source_id is not null;

create index if not exists idx_references_author_family_created
  on public.references(author_user_id, recipient_user_id, reference_family, created_at desc);

create index if not exists idx_references_recipient_created
  on public.references(recipient_user_id, created_at desc);

create index if not exists idx_references_source
  on public.references(source_type, source_id);

drop index if exists public.ux_reference_requests_pending_pair_context;
create index if not exists idx_reference_requests_pending_pair_family
  on public.reference_requests(user_id, peer_user_id, context_tag, status, due_at desc);

create table if not exists public.member_interaction_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  counter_type text not null,
  count int not null default 0,
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_member_interaction_counters_user_type
  on public.member_interaction_counters(user_id, counter_type);

create index if not exists idx_member_interaction_counters_user
  on public.member_interaction_counters(user_id, updated_at desc);

create table if not exists public.pair_interaction_counters (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references profiles(user_id) on delete cascade,
  user_b_id uuid not null references profiles(user_id) on delete cascade,
  counter_type text not null,
  count int not null default 0,
  updated_at timestamptz not null default now(),
  check (user_a_id <> user_b_id)
);

create unique index if not exists ux_pair_interaction_counters_pair_type
  on public.pair_interaction_counters(user_a_id, user_b_id, counter_type);

create index if not exists idx_pair_interaction_counters_pair
  on public.pair_interaction_counters(user_a_id, user_b_id, updated_at desc);

create or replace function public.cx_reference_prompt_allowed(
  p_user_id uuid,
  p_peer_user_id uuid,
  p_context_tag text,
  p_source_table text,
  p_source_id uuid,
  p_due_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_category text := public.cx_reference_public_category(p_context_tag);
  v_family text := public.cx_reference_family(v_category);
  v_cooldown_days int := public.cx_reference_cooldown_days(p_context_tag);
  v_source_type text := public.cx_reference_source_type(p_context_tag, p_source_table);
begin
  if p_user_id is null or p_peer_user_id is null or p_source_id is null then
    return false;
  end if;

  if v_cooldown_days is null then
    if exists (
      select 1
      from public.references ref
      where coalesce(ref.author_user_id, ref.author_id, ref.from_user_id) = p_user_id
        and coalesce(ref.recipient_user_id, ref.recipient_id, ref.to_user_id, ref.target_id) = p_peer_user_id
        and coalesce(ref.source_type, public.cx_reference_source_type(coalesce(ref.context_tag, ref.entity_type, ref.context, 'collaborate'), null)) = v_source_type
        and coalesce(ref.source_id, ref.entity_id, ref.sync_id) = p_source_id
    ) then
      return false;
    end if;
    return true;
  end if;

  if exists (
    select 1
    from public.reference_requests rr
    where rr.user_id = p_user_id
      and rr.peer_user_id = p_peer_user_id
      and rr.status = 'pending'
      and public.cx_reference_family(public.cx_reference_public_category(rr.context_tag)) = v_family
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.references ref
    where coalesce(ref.author_user_id, ref.author_id, ref.from_user_id) = p_user_id
      and coalesce(ref.recipient_user_id, ref.recipient_id, ref.to_user_id, ref.target_id) = p_peer_user_id
      and coalesce(ref.reference_family, public.cx_reference_family(coalesce(ref.public_category, public.cx_reference_public_category(coalesce(ref.context_tag, ref.entity_type, ref.context, 'collaborate'))))) = v_family
      and ref.created_at + make_interval(days => v_cooldown_days) > now()
  ) then
    return false;
  end if;

  return true;
end;
$function$;

grant execute on function public.cx_reference_prompt_allowed(uuid, uuid, text, text, uuid, timestamptz) to authenticated;

create or replace function public.cx_refresh_member_interaction_counters(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
begin
  if p_user_id is null then
    delete from public.member_interaction_counters;
    delete from public.pair_interaction_counters;
  else
    delete from public.member_interaction_counters where user_id = p_user_id;
    delete from public.pair_interaction_counters where user_a_id = p_user_id or user_b_id = p_user_id;
  end if;

  with all_interactions as (
    select a.requester_id as user_id,
           a.recipient_id as peer_user_id,
           case lower(trim(coalesce(a.activity_type, 'collaborate')))
             when 'practice' then 'practice_count'
             when 'social_dance' then 'social_dance_count'
             when 'event_festival' then 'event_festival_count'
             when 'travelling' then 'travelling_count'
             when 'request_hosting' then 'request_hosting_count'
             when 'offer_hosting' then 'offer_hosting_count'
             when 'private_class' then 'classes_count'
             else 'collaborate_count'
           end as counter_type
    from public.activities a
    where a.status = 'completed'
      and (p_user_id is null or a.requester_id = p_user_id or a.recipient_id = p_user_id)

    union all

    select a.recipient_id as user_id,
           a.requester_id as peer_user_id,
           case lower(trim(coalesce(a.activity_type, 'collaborate')))
             when 'practice' then 'practice_count'
             when 'social_dance' then 'social_dance_count'
             when 'event_festival' then 'event_festival_count'
             when 'travelling' then 'travelling_count'
             when 'request_hosting' then 'request_hosting_count'
             when 'offer_hosting' then 'offer_hosting_count'
             when 'private_class' then 'classes_count'
             else 'collaborate_count'
           end as counter_type
    from public.activities a
    where a.status = 'completed'
      and (p_user_id is null or a.requester_id = p_user_id or a.recipient_id = p_user_id)

    union all

    select s.requester_id as user_id,
           s.recipient_id as peer_user_id,
           case lower(trim(coalesce(s.sync_type, 'training')))
             when 'social_dancing' then 'social_dance_count'
             when 'private_class' then 'classes_count'
             when 'workshop' then 'classes_count'
             else 'practice_count'
           end as counter_type
    from public.connection_syncs s
    where s.status = 'completed'
      and (p_user_id is null or s.requester_id = p_user_id or s.recipient_id = p_user_id)

    union all

    select s.recipient_id as user_id,
           s.requester_id as peer_user_id,
           case lower(trim(coalesce(s.sync_type, 'training')))
             when 'social_dancing' then 'social_dance_count'
             when 'private_class' then 'classes_count'
             when 'workshop' then 'classes_count'
             else 'practice_count'
           end as counter_type
    from public.connection_syncs s
    where s.status = 'completed'
      and (p_user_id is null or s.requester_id = p_user_id or s.recipient_id = p_user_id)

    union all

    select tr.requester_id as user_id,
           t.user_id as peer_user_id,
           'travelling_count' as counter_type
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and t.end_date is not null
      and t.end_date <= current_date
      and (p_user_id is null or tr.requester_id = p_user_id or t.user_id = p_user_id)

    union all

    select t.user_id as user_id,
           tr.requester_id as peer_user_id,
           'travelling_count' as counter_type
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and t.end_date is not null
      and t.end_date <= current_date
      and (p_user_id is null or tr.requester_id = p_user_id or t.user_id = p_user_id)

    union all

    select case
             when hr.request_type = 'request_hosting' then hr.recipient_user_id
             when hr.request_type = 'offer_to_host' then hr.sender_user_id
             else hr.recipient_user_id
           end as user_id,
           case
             when hr.request_type = 'request_hosting' then hr.sender_user_id
             when hr.request_type = 'offer_to_host' then hr.recipient_user_id
             else hr.sender_user_id
           end as peer_user_id,
           'offer_hosting_count' as counter_type
    from public.hosting_requests hr
    where hr.status = 'accepted'
      and hr.departure_date is not null
      and hr.departure_date <= current_date
      and (p_user_id is null or hr.sender_user_id = p_user_id or hr.recipient_user_id = p_user_id)

    union all

    select case
             when hr.request_type = 'request_hosting' then hr.sender_user_id
             when hr.request_type = 'offer_to_host' then hr.recipient_user_id
             else hr.sender_user_id
           end as user_id,
           case
             when hr.request_type = 'request_hosting' then hr.recipient_user_id
             when hr.request_type = 'offer_to_host' then hr.sender_user_id
             else hr.recipient_user_id
           end as peer_user_id,
           'request_hosting_count' as counter_type
    from public.hosting_requests hr
    where hr.status = 'accepted'
      and hr.departure_date is not null
      and hr.departure_date <= current_date
      and (p_user_id is null or hr.sender_user_id = p_user_id or hr.recipient_user_id = p_user_id)

    union all

    select em.user_id as user_id,
           e.host_user_id as peer_user_id,
           'event_festival_count' as counter_type
    from public.event_members em
    join public.events e on e.id = em.event_id
    where em.status in ('host', 'going', 'waitlist')
      and e.ends_at is not null
      and e.ends_at <= now()
      and (p_user_id is null or em.user_id = p_user_id or e.host_user_id = p_user_id)
  ),
  member_counts as (
    select user_id, counter_type, count(*)::int as count
    from all_interactions
    where user_id is not null
    group by user_id, counter_type
  )
  insert into public.member_interaction_counters (user_id, counter_type, count, updated_at)
  select user_id, counter_type, count, v_now
  from member_counts
  on conflict (user_id, counter_type)
  do update set count = excluded.count, updated_at = excluded.updated_at;

  with all_interactions as (
    select a.requester_id as user_id,
           a.recipient_id as peer_user_id,
           case lower(trim(coalesce(a.activity_type, 'collaborate')))
             when 'practice' then 'practice_count'
             when 'social_dance' then 'social_dance_count'
             when 'event_festival' then 'event_festival_count'
             when 'travelling' then 'travelling_count'
             when 'request_hosting' then 'request_hosting_count'
             when 'offer_hosting' then 'offer_hosting_count'
             when 'private_class' then 'classes_count'
             else 'collaborate_count'
           end as counter_type
    from public.activities a
    where a.status = 'completed'
      and (p_user_id is null or a.requester_id = p_user_id or a.recipient_id = p_user_id)

    union all

    select a.recipient_id as user_id,
           a.requester_id as peer_user_id,
           case lower(trim(coalesce(a.activity_type, 'collaborate')))
             when 'practice' then 'practice_count'
             when 'social_dance' then 'social_dance_count'
             when 'event_festival' then 'event_festival_count'
             when 'travelling' then 'travelling_count'
             when 'request_hosting' then 'request_hosting_count'
             when 'offer_hosting' then 'offer_hosting_count'
             when 'private_class' then 'classes_count'
             else 'collaborate_count'
           end as counter_type
    from public.activities a
    where a.status = 'completed'
      and (p_user_id is null or a.requester_id = p_user_id or a.recipient_id = p_user_id)

    union all

    select s.requester_id as user_id,
           s.recipient_id as peer_user_id,
           case lower(trim(coalesce(s.sync_type, 'training')))
             when 'social_dancing' then 'social_dance_count'
             when 'private_class' then 'classes_count'
             when 'workshop' then 'classes_count'
             else 'practice_count'
           end as counter_type
    from public.connection_syncs s
    where s.status = 'completed'
      and (p_user_id is null or s.requester_id = p_user_id or s.recipient_id = p_user_id)

    union all

    select s.recipient_id as user_id,
           s.requester_id as peer_user_id,
           case lower(trim(coalesce(s.sync_type, 'training')))
             when 'social_dancing' then 'social_dance_count'
             when 'private_class' then 'classes_count'
             when 'workshop' then 'classes_count'
             else 'practice_count'
           end as counter_type
    from public.connection_syncs s
    where s.status = 'completed'
      and (p_user_id is null or s.requester_id = p_user_id or s.recipient_id = p_user_id)

    union all

    select tr.requester_id as user_id,
           t.user_id as peer_user_id,
           'travelling_count' as counter_type
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and t.end_date is not null
      and t.end_date <= current_date
      and (p_user_id is null or tr.requester_id = p_user_id or t.user_id = p_user_id)

    union all

    select t.user_id as user_id,
           tr.requester_id as peer_user_id,
           'travelling_count' as counter_type
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and t.end_date is not null
      and t.end_date <= current_date
      and (p_user_id is null or tr.requester_id = p_user_id or t.user_id = p_user_id)

    union all

    select case
             when hr.request_type = 'request_hosting' then hr.recipient_user_id
             when hr.request_type = 'offer_to_host' then hr.sender_user_id
             else hr.recipient_user_id
           end as user_id,
           case
             when hr.request_type = 'request_hosting' then hr.sender_user_id
             when hr.request_type = 'offer_to_host' then hr.recipient_user_id
             else hr.sender_user_id
           end as peer_user_id,
           'offer_hosting_count' as counter_type
    from public.hosting_requests hr
    where hr.status = 'accepted'
      and hr.departure_date is not null
      and hr.departure_date <= current_date
      and (p_user_id is null or hr.sender_user_id = p_user_id or hr.recipient_user_id = p_user_id)

    union all

    select case
             when hr.request_type = 'request_hosting' then hr.sender_user_id
             when hr.request_type = 'offer_to_host' then hr.recipient_user_id
             else hr.sender_user_id
           end as user_id,
           case
             when hr.request_type = 'request_hosting' then hr.recipient_user_id
             when hr.request_type = 'offer_to_host' then hr.sender_user_id
             else hr.recipient_user_id
           end as peer_user_id,
           'request_hosting_count' as counter_type
    from public.hosting_requests hr
    where hr.status = 'accepted'
      and hr.departure_date is not null
      and hr.departure_date <= current_date
      and (p_user_id is null or hr.sender_user_id = p_user_id or hr.recipient_user_id = p_user_id)

    union all

    select em.user_id as user_id,
           e.host_user_id as peer_user_id,
           'event_festival_count' as counter_type
    from public.event_members em
    join public.events e on e.id = em.event_id
    where em.status in ('host', 'going', 'waitlist')
      and e.ends_at is not null
      and e.ends_at <= now()
      and (p_user_id is null or em.user_id = p_user_id or e.host_user_id = p_user_id)
  ),
  pair_counts as (
    select
      least(user_id, peer_user_id) as user_a_id,
      greatest(user_id, peer_user_id) as user_b_id,
      case
        when counter_type in ('request_hosting_count', 'offer_hosting_count') then 'hosting_count'
        else counter_type
      end as counter_type,
      count(*)::int as count
    from all_interactions
    where user_id is not null
      and peer_user_id is not null
      and user_id <> peer_user_id
    group by least(user_id, peer_user_id), greatest(user_id, peer_user_id),
      case
        when counter_type in ('request_hosting_count', 'offer_hosting_count') then 'hosting_count'
        else counter_type
      end
  )
  insert into public.pair_interaction_counters (user_a_id, user_b_id, counter_type, count, updated_at)
  select user_a_id, user_b_id, counter_type, count, v_now
  from pair_counts
  on conflict (user_a_id, user_b_id, counter_type)
  do update set count = excluded.count, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'user_id', p_user_id);
end;
$function$;

grant execute on function public.cx_refresh_member_interaction_counters(uuid) to authenticated;

create or replace function public.cx_mark_reference_request_completed(
  p_reference_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_rows int := 0;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_reference_id is null then
    return 0;
  end if;

  update public.reference_requests rr
  set
    status = 'completed',
    completed_reference_id = ref.id,
    updated_at = now()
  from public.references ref
  where ref.id = p_reference_id
    and rr.user_id = v_me
    and rr.status = 'pending'
    and coalesce(ref.author_user_id, ref.author_id, ref.from_user_id) = v_me
    and coalesce(ref.recipient_user_id, ref.recipient_id, ref.to_user_id, ref.target_id) = rr.peer_user_id
    and coalesce(ref.source_id, ref.entity_id, ref.sync_id) = rr.source_id
    and coalesce(ref.context_tag, rr.context_tag) = rr.context_tag;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

grant execute on function public.cx_mark_reference_request_completed(uuid) to authenticated;

create or replace function public.cx_sync_reference_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_created int := 0;
  v_completed int := 0;
  v_expired int := 0;
  v_reminded int := 0;
  v_conn_id uuid;
  v_due_at timestamptz;
  v_remind_after timestamptz;
  v_expires_at timestamptz;
  v_peer_id uuid;
  v_context_tag text;
  v_inserted int := 0;
  v_row record;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  for v_row in
    select
      tr.id as source_id,
      tr.requester_id,
      t.user_id as owner_id,
      t.end_date
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and t.end_date is not null
      and t.end_date <= current_date
      and (tr.requester_id = v_me or t.user_id = v_me)
  loop
    v_peer_id := case when v_row.requester_id = v_me then v_row.owner_id else v_row.requester_id end;
    if v_peer_id is null or v_peer_id = v_me then
      continue;
    end if;

    v_due_at := (v_row.end_date::timestamptz + interval '24 hours');
    if v_due_at > now() then
      continue;
    end if;

    if not public.cx_reference_prompt_allowed(v_me, v_peer_id, 'travelling', 'trip_requests', v_row.source_id, v_due_at) then
      continue;
    end if;

    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '10 days';
    v_context_tag := 'travelling';

    select c.id into v_conn_id
    from public.connections c
    where coalesce(c.status::text, '') = 'accepted'
      and c.blocked_by is null
      and (
        (c.requester_id = v_me and c.target_id = v_peer_id)
        or (c.requester_id = v_peer_id and c.target_id = v_me)
      )
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    insert into public.reference_requests (
      user_id, peer_user_id, context_tag, source_table, source_id, connection_id, due_at, remind_after, expires_at, status
    )
    values (
      v_me, v_peer_id, v_context_tag, 'trip_requests', v_row.source_id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending'
    )
    on conflict (user_id, source_table, source_id, context_tag) do nothing;

    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end loop;

  for v_row in
    select
      hr.id as source_id,
      hr.sender_user_id,
      hr.recipient_user_id,
      hr.request_type,
      hr.departure_date
    from public.hosting_requests hr
    where hr.status = 'accepted'
      and hr.departure_date is not null
      and hr.departure_date <= current_date
      and (hr.sender_user_id = v_me or hr.recipient_user_id = v_me)
  loop
    v_peer_id := case when v_row.sender_user_id = v_me then v_row.recipient_user_id else v_row.sender_user_id end;
    if v_peer_id is null or v_peer_id = v_me then
      continue;
    end if;

    if (v_row.request_type = 'request_hosting' and v_row.recipient_user_id = v_me)
       or (v_row.request_type = 'offer_to_host' and v_row.sender_user_id = v_me) then
      v_context_tag := 'offer_hosting';
    else
      v_context_tag := 'request_hosting';
    end if;

    v_due_at := (v_row.departure_date::timestamptz + interval '24 hours');
    if v_due_at > now() then
      continue;
    end if;

    if not public.cx_reference_prompt_allowed(v_me, v_peer_id, v_context_tag, 'hosting_requests', v_row.source_id, v_due_at) then
      continue;
    end if;

    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '10 days';

    select c.id into v_conn_id
    from public.connections c
    where coalesce(c.status::text, '') = 'accepted'
      and c.blocked_by is null
      and (
        (c.requester_id = v_me and c.target_id = v_peer_id)
        or (c.requester_id = v_peer_id and c.target_id = v_me)
      )
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    insert into public.reference_requests (
      user_id, peer_user_id, context_tag, source_table, source_id, connection_id, due_at, remind_after, expires_at, status
    )
    values (
      v_me, v_peer_id, v_context_tag, 'hosting_requests', v_row.source_id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending'
    )
    on conflict (user_id, source_table, source_id, context_tag) do nothing;

    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end loop;

  update public.reference_requests rr
  set
    status = 'completed',
    completed_reference_id = ref.id,
    updated_at = now()
  from public.references ref
  where rr.user_id = v_me
    and rr.status = 'pending'
    and coalesce(ref.author_user_id, ref.author_id, ref.from_user_id) = v_me
    and coalesce(ref.recipient_user_id, ref.recipient_id, ref.to_user_id, ref.target_id) = rr.peer_user_id
    and coalesce(ref.source_id, ref.entity_id, ref.sync_id) = rr.source_id
    and coalesce(ref.context_tag, rr.context_tag) = rr.context_tag;
  get diagnostics v_completed = row_count;

  update public.reference_requests rr
  set status = 'dismissed', updated_at = now()
  where rr.user_id = v_me
    and rr.status = 'pending'
    and public.cx_reference_cooldown_days(rr.context_tag) is not null
    and exists (
      select 1
      from public.references ref
      where coalesce(ref.author_user_id, ref.author_id, ref.from_user_id) = v_me
        and coalesce(ref.recipient_user_id, ref.recipient_id, ref.to_user_id, ref.target_id) = rr.peer_user_id
        and coalesce(ref.reference_family, public.cx_reference_family(coalesce(ref.public_category, public.cx_reference_public_category(coalesce(ref.context_tag, ref.entity_type, ref.context, 'collaborate'))))) =
          public.cx_reference_family(public.cx_reference_public_category(rr.context_tag))
        and ref.created_at + make_interval(days => public.cx_reference_cooldown_days(rr.context_tag)) > now()
    );

  update public.reference_requests rr
  set status = 'expired', updated_at = now()
  where rr.user_id = v_me
    and rr.status = 'pending'
    and now() > rr.expires_at;
  get diagnostics v_expired = row_count;

  if to_regclass('public.notifications') is not null then
    for v_row in
      select rr.id, rr.peer_user_id, rr.context_tag, rr.source_table, rr.source_id, rr.reminder_count
      from public.reference_requests rr
      where rr.user_id = v_me
        and rr.status = 'pending'
        and now() >= rr.remind_after
        and now() <= rr.expires_at
        and (rr.last_reminded_at is null or rr.last_reminded_at <= now() - interval '2 days')
    loop
      insert into public.notifications (user_id, actor_id, kind, title, body, link_url, metadata)
      values (
        v_me,
        v_row.peer_user_id,
        'reference_reminder',
        'Reference reminder',
        'Leave a quick reference for your recent interaction.',
        '/references',
        jsonb_build_object(
          'context_tag', v_row.context_tag,
          'source_table', v_row.source_table,
          'source_id', v_row.source_id,
          'prompt_id', v_row.id
        )
      );

      update public.reference_requests
      set reminder_count = coalesce(reminder_count, 0) + 1,
          last_reminded_at = now(),
          updated_at = now()
      where id = v_row.id;

      v_reminded := v_reminded + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'created', v_created, 'completed', v_completed, 'expired', v_expired, 'reminded', v_reminded);
end;
$function$;

grant execute on function public.cx_sync_reference_requests() to authenticated;

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
      p_end_date => case when r.end_at is null then null else (r.end_at at time zone 'UTC')::date end,
      p_requester_id => r.requester_id,
      p_recipient_id => r.recipient_id,
      p_metadata => coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
        'activity_type', r.activity_type,
        'activity_id', r.id,
        'title', coalesce(nullif(trim(coalesce(r.title, '')), ''), public.cx_activity_type_label(r.activity_type))
      )
    );

    v_context_tag := public.cx_activity_reference_context(r.activity_type);
    v_due_at := coalesce(r.completed_at, now());
    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '10 days';

    select c.id into v_conn_id
    from public.connections c
    where coalesce(c.status::text, '') = 'accepted'
      and c.blocked_by is null
      and (
        (c.requester_id = r.requester_id and c.target_id = r.recipient_id)
        or (c.requester_id = r.recipient_id and c.target_id = r.requester_id)
      )
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    if public.cx_reference_prompt_allowed(r.requester_id, r.recipient_id, v_context_tag, 'activities', r.id, v_due_at) then
      insert into public.reference_requests (
        user_id, peer_user_id, context_tag, source_table, source_id, connection_id, due_at, remind_after, expires_at, status
      )
      values (
        r.requester_id, r.recipient_id, v_context_tag, 'activities', r.id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending'
      )
      on conflict (user_id, source_table, source_id, context_tag) do nothing;
      get diagnostics v_inserted = row_count;
      v_prompt_count := v_prompt_count + v_inserted;
    end if;

    if public.cx_reference_prompt_allowed(r.recipient_id, r.requester_id, v_context_tag, 'activities', r.id, v_due_at) then
      insert into public.reference_requests (
        user_id, peer_user_id, context_tag, source_table, source_id, connection_id, due_at, remind_after, expires_at, status
      )
      values (
        r.recipient_id, r.requester_id, v_context_tag, 'activities', r.id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending'
      )
      on conflict (user_id, source_table, source_id, context_tag) do nothing;
      get diagnostics v_inserted = row_count;
      v_prompt_count := v_prompt_count + v_inserted;
    end if;
  end loop;

  perform public.cx_refresh_member_interaction_counters(v_me);

  return jsonb_build_object('completed', v_completed_count, 'reference_prompts_created', v_prompt_count);
end;
$function$;

grant execute on function public.cx_sync_activities() to authenticated;

select public.cx_refresh_member_interaction_counters(null);

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.references'::regclass
      and tgname = 'trg_references_guardrails'
  ) then
    execute 'alter table public.references enable trigger trg_references_guardrails';
  end if;
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.references'::regclass
      and tgname = 'trg_references_immutable'
  ) then
    execute 'alter table public.references enable trigger trg_references_immutable';
  end if;
end $$;

commit;
