-- Canonical activity type unification
-- Date: 2026-04-08
-- Safe to re-run.

begin;

create or replace function public.cx_normalize_activity_type(p_activity_type text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(p_activity_type, '')))
    when 'practice' then 'practice'
    when 'practice_sync' then 'practice'
    when 'social' then 'social_dance'
    when 'social_dance' then 'social_dance'
    when 'social_dancing' then 'social_dance'
    when 'socialdance' then 'social_dance'
    when 'event' then 'event_festival'
    when 'events' then 'event_festival'
    when 'festival' then 'event_festival'
    when 'congress' then 'event_festival'
    when 'workshop' then 'event_festival'
    when 'competition' then 'event_festival'
    when 'contest' then 'event_festival'
    when 'event_festival' then 'event_festival'
    when 'trip' then 'travelling'
    when 'travel' then 'travelling'
    when 'traveling' then 'travelling'
    when 'travelling' then 'travelling'
    when 'travel_trip' then 'travelling'
    when 'travel_together' then 'travelling'
    when 'request_hosting' then 'request_hosting'
    when 'stay_as_guest' then 'request_hosting'
    when 'guest' then 'request_hosting'
    when 'stay' then 'request_hosting'
    when 'offer_hosting' then 'offer_hosting'
    when 'offer_to_host' then 'offer_hosting'
    when 'hosting' then 'offer_hosting'
    when 'host' then 'offer_hosting'
    when 'private_class' then 'practice'
    when 'private lesson' then 'practice'
    when 'private_lesson' then 'practice'
    when 'privateclass' then 'practice'
    when 'group_class' then 'practice'
    when 'group lesson' then 'practice'
    when 'group_lesson' then 'practice'
    when 'groupclass' then 'practice'
    when 'collaboration' then 'collaborate'
    when 'collaborate' then 'collaborate'
    when 'content' then 'collaborate'
    when 'video' then 'collaborate'
    when 'content/video' then 'collaborate'
    when 'content_video' then 'collaborate'
    else 'collaborate'
  end;
$$;

create or replace function public.cx_activity_uses_date_range(p_activity_type text)
returns boolean
language sql
immutable
as $$
  select public.cx_normalize_activity_type(p_activity_type) in (
    'event_festival',
    'travelling',
    'request_hosting',
    'offer_hosting'
  );
$$;

drop index if exists public.ux_reference_requests_pending_pair_context;
alter table public.activities drop constraint if exists activities_activity_type_chk;
alter table public.activities drop constraint if exists activities_date_shape_chk;
alter table public.references drop constraint if exists references_context_tag_allowed_chk;
alter table public.reference_requests drop constraint if exists reference_requests_context_tag_chk;

update public.activities
set activity_type = public.cx_normalize_activity_type(activity_type),
    metadata = case
      when coalesce(metadata, '{}'::jsonb) ? 'activity_type' then jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{activity_type}',
        to_jsonb(public.cx_normalize_activity_type(metadata->>'activity_type')),
        true
      )
      else coalesce(metadata, '{}'::jsonb)
    end,
    updated_at = now()
where activity_type is distinct from public.cx_normalize_activity_type(activity_type)
   or (
     coalesce(metadata, '{}'::jsonb) ? 'activity_type'
     and coalesce(metadata->>'activity_type', '') is distinct from public.cx_normalize_activity_type(metadata->>'activity_type')
   );

update public.thread_contexts
set metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{activity_type}',
      to_jsonb(public.cx_normalize_activity_type(metadata->>'activity_type')),
      true
    )
where source_table = 'activities'
  and coalesce(metadata, '{}'::jsonb) ? 'activity_type'
  and coalesce(metadata->>'activity_type', '') is distinct from public.cx_normalize_activity_type(metadata->>'activity_type');

do $$
begin
  if exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.references'::regclass
      and t.tgname = 'trg_references_guardrails'
  ) then
    execute 'alter table public.references disable trigger trg_references_guardrails';
  end if;

  if exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.references'::regclass
      and t.tgname = 'trg_references_immutable'
  ) then
    execute 'alter table public.references disable trigger trg_references_immutable';
  end if;
end $$;

update public.references
set context_tag = public.cx_normalize_activity_type(context_tag)
where coalesce(context_tag, '') is distinct from public.cx_normalize_activity_type(context_tag);

do $$
begin
  if exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.references'::regclass
      and t.tgname = 'trg_references_guardrails'
  ) then
    execute 'alter table public.references enable trigger trg_references_guardrails';
  end if;

  if exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.references'::regclass
      and t.tgname = 'trg_references_immutable'
  ) then
    execute 'alter table public.references enable trigger trg_references_immutable';
  end if;
end $$;

update public.reference_requests
set context_tag = public.cx_normalize_activity_type(context_tag)
where coalesce(context_tag, '') is distinct from public.cx_normalize_activity_type(context_tag);

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, peer_user_id, context_tag
      order by
        case status
          when 'pending' then 0
          when 'completed' then 1
          when 'dismissed' then 2
          when 'expired' then 3
          else 4
        end,
        due_at desc nulls last,
        expires_at desc nulls last,
        created_at desc nulls last,
        id desc
    ) as rn
  from public.reference_requests
  where status = 'pending'
)
delete from public.reference_requests rr
using ranked d
where rr.id = d.id
  and d.rn > 1;

alter table public.activities drop constraint if exists activities_activity_type_chk;
alter table public.activities
  add constraint activities_activity_type_chk
  check (
    activity_type in (
      'practice',
      'social_dance',
      'event_festival',
      'travelling',
      'request_hosting',
      'offer_hosting',
      'collaborate'
    )
  );

alter table public.references drop constraint if exists references_context_tag_allowed_chk;
alter table public.references
  add constraint references_context_tag_allowed_chk
  check (
    context_tag in (
      'practice',
      'social_dance',
      'event_festival',
      'travelling',
      'request_hosting',
      'offer_hosting',
      'collaborate'
    )
  );

alter table public.reference_requests drop constraint if exists reference_requests_context_tag_chk;
alter table public.reference_requests
  add constraint reference_requests_context_tag_chk
  check (
    context_tag in (
      'practice',
      'social_dance',
      'event_festival',
      'travelling',
      'request_hosting',
      'offer_hosting',
      'collaborate'
    )
  );

create unique index if not exists ux_reference_requests_pending_pair_context
  on public.reference_requests(user_id, peer_user_id, context_tag)
  where status = 'pending';

create or replace function public.cx_activity_type_label(p_activity_type text)
returns text
language sql
immutable
as $$
  select case public.cx_normalize_activity_type(p_activity_type)
    when 'practice' then 'Practice'
    when 'social_dance' then 'Social Dance'
    when 'event_festival' then 'Event / Festival'
    when 'travelling' then 'Travelling'
    when 'request_hosting' then 'Request Hosting'
    when 'offer_hosting' then 'Offer Hosting'
    else 'Collaborate'
  end;
$$;

create or replace function public.cx_activity_reference_context(p_activity_type text)
returns text
language sql
immutable
as $$
  select public.cx_normalize_activity_type(p_activity_type);
$$;

alter table public.activities
  add constraint activities_date_shape_chk
  check (
    end_at is null or public.cx_activity_uses_date_range(activity_type)
  );

commit;
