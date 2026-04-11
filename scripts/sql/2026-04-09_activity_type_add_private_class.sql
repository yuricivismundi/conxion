-- Add private_class to canonical activity taxonomy
-- Date: 2026-04-09
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
    when 'private_class' then 'private_class'
    when 'private class' then 'private_class'
    when 'private lesson' then 'private_class'
    when 'private_lesson' then 'private_class'
    when 'privateclass' then 'private_class'
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

alter table public.activities drop constraint if exists activities_activity_type_chk;
alter table public.activities
  add constraint activities_activity_type_chk
  check (
    activity_type in (
      'practice',
      'private_class',
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
      'private_class',
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
      'private_class',
      'social_dance',
      'event_festival',
      'travelling',
      'request_hosting',
      'offer_hosting',
      'collaborate'
    )
  );

create or replace function public.cx_activity_type_label(p_activity_type text)
returns text
language sql
immutable
as $$
  select case public.cx_normalize_activity_type(p_activity_type)
    when 'practice' then 'Practice'
    when 'private_class' then 'Private Class'
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

commit;
