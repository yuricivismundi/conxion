-- ConXion Discover Hosts profile fields
-- Date: 2026-03-06
-- Purpose:
--   Add explicit hosting fields used by Discover -> Hosts mode.

begin;

alter table public.profiles
  add column if not exists can_host boolean not null default false;

alter table public.profiles
  add column if not exists hosting_status text not null default 'inactive';

alter table public.profiles
  add column if not exists max_guests integer;

update public.profiles
set hosting_status = lower(trim(hosting_status))
where hosting_status is not null;

update public.profiles
set hosting_status = 'inactive'
where hosting_status is null
   or hosting_status not in ('inactive', 'available', 'paused');

update public.profiles
set max_guests = null
where max_guests is not null and max_guests < 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_hosting_status_allowed_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_hosting_status_allowed_chk
      check (hosting_status in ('inactive', 'available', 'paused'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_max_guests_range_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_max_guests_range_chk
      check (max_guests is null or (max_guests >= 0 and max_guests <= 20));
  end if;
end $$;

create index if not exists idx_profiles_hosts_discover
  on public.profiles(can_host, hosting_status, country, city);

commit;

notify pgrst, 'reload schema';
