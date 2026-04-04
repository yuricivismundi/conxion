alter table if exists public.trip_requests
  add column if not exists linked_member_user_id uuid references public.profiles(user_id) on delete set null;

alter table if exists public.hosting_requests
  add column if not exists linked_member_user_id uuid references public.profiles(user_id) on delete set null;

alter table if exists public.event_requests
  add column if not exists linked_member_user_id uuid references public.profiles(user_id) on delete set null;

alter table if exists public.activities
  add column if not exists linked_member_user_id uuid references public.profiles(user_id) on delete set null;
