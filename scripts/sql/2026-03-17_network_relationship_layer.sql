-- ConXion Network relationship layer upgrade
-- Date: 2026-03-17
-- Purpose:
--   - richer saved dancer/contact memory
--   - optional follow + activity tracking
-- Safe to run multiple times.

begin;

alter table public.dance_contacts
  add column if not exists meeting_context text;

alter table public.dance_contacts
  add column if not exists is_following boolean not null default false;

alter table public.dance_contacts
  add column if not exists track_activity text[] not null default '{}'::text[];

alter table public.dance_contacts
  add column if not exists dance_styles text[] not null default '{}'::text[];

update public.dance_contacts
set is_following = false
where is_following is null;

update public.dance_contacts
set track_activity = '{}'::text[]
where track_activity is null;

update public.dance_contacts
set dance_styles = '{}'::text[]
where dance_styles is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_contacts_meeting_context_length_chk'
      and conrelid = 'public.dance_contacts'::regclass
  ) then
    alter table public.dance_contacts
      add constraint dance_contacts_meeting_context_length_chk
      check (meeting_context is null or char_length(trim(meeting_context)) <= 160);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_contacts_track_activity_allowed_chk'
      and conrelid = 'public.dance_contacts'::regclass
  ) then
    alter table public.dance_contacts
      add constraint dance_contacts_track_activity_allowed_chk
      check (
        track_activity <@ array['travel_plans','hosting_availability','new_references','competition_results']::text[]
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_contacts_track_activity_limit_chk'
      and conrelid = 'public.dance_contacts'::regclass
  ) then
    alter table public.dance_contacts
      add constraint dance_contacts_track_activity_limit_chk
      check (coalesce(array_length(track_activity, 1), 0) <= 4);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_contacts_styles_limit_chk'
      and conrelid = 'public.dance_contacts'::regclass
  ) then
    alter table public.dance_contacts
      add constraint dance_contacts_styles_limit_chk
      check (coalesce(array_length(dance_styles, 1), 0) <= 10);
  end if;
end $$;

create index if not exists idx_dance_contacts_user_following
  on public.dance_contacts(user_id, is_following, updated_at desc);

create index if not exists idx_dance_contacts_track_activity_gin
  on public.dance_contacts using gin(track_activity);

create index if not exists idx_dance_contacts_styles_gin
  on public.dance_contacts using gin(dance_styles);

commit;

notify pgrst, 'reload schema';
