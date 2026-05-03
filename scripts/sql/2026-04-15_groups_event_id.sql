-- Add nullable event_id to groups so a group can be created from an event.
-- The link is purely informational (creation context); group membership
-- does NOT sync with event attendance after creation.

alter table public.groups
  add column if not exists event_id uuid references public.events(id) on delete set null;

create index if not exists idx_groups_event_id on public.groups(event_id) where event_id is not null;
