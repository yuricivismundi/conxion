alter table public.profiles add column if not exists hosting_last_minute_ok boolean not null default false;
alter table public.profiles add column if not exists hosting_preferred_guest_gender text not null default 'any';
alter table public.profiles add column if not exists hosting_kid_friendly boolean not null default false;
alter table public.profiles add column if not exists hosting_pet_friendly boolean not null default false;
alter table public.profiles add column if not exists hosting_smoking_allowed boolean not null default false;
alter table public.profiles add column if not exists hosting_sleeping_arrangement text not null default 'not_specified';
alter table public.profiles add column if not exists hosting_guest_share text;
alter table public.profiles add column if not exists hosting_transit_access text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_hosting_preferred_guest_gender_chk'
  ) then
    alter table public.profiles
      add constraint profiles_hosting_preferred_guest_gender_chk
      check (hosting_preferred_guest_gender in ('any', 'women', 'men', 'nonbinary'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_hosting_sleeping_arrangement_chk'
  ) then
    alter table public.profiles
      add constraint profiles_hosting_sleeping_arrangement_chk
      check (hosting_sleeping_arrangement in ('not_specified', 'shared_room', 'private_room', 'sofa', 'floor_space', 'mixed'));
  end if;
end $$;
