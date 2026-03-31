-- ConXion reference context tags aligned to exact activity types
-- Date: 2026-03-20
-- Safe to re-run.

begin;

update public.references
set context_tag = case trim(coalesce(context_tag, ''))
  when 'host' then 'hosting'
  when 'guest' then 'stay_as_guest'
  when 'travel' then 'travel_together'
  else context_tag
end
where context_tag in ('host', 'guest', 'travel');

update public.reference_requests
set context_tag = case trim(coalesce(context_tag, ''))
  when 'host' then 'hosting'
  when 'guest' then 'stay_as_guest'
  when 'travel' then 'travel_together'
  else context_tag
end
where context_tag in ('host', 'guest', 'travel');

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'references_context_tag_allowed_chk'
      and conrelid = 'public.references'::regclass
  ) then
    alter table public.references drop constraint references_context_tag_allowed_chk;
  end if;

  alter table public.references
    add constraint references_context_tag_allowed_chk
    check (
      context_tag in (
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
exception when undefined_table then
  null;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'reference_requests_context_tag_chk'
      and conrelid = 'public.reference_requests'::regclass
  ) then
    alter table public.reference_requests drop constraint reference_requests_context_tag_chk;
  end if;

  alter table public.reference_requests
    add constraint reference_requests_context_tag_chk
    check (
      context_tag in (
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
exception when undefined_table then
  null;
end $$;

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

commit;
