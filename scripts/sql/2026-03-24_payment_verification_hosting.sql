-- ConXion payment verification for hosting requests
-- - Adds payment verification state to profiles
-- - Adds host preference fields that remain free to configure

alter table public.profiles
  add column if not exists is_verified boolean not null default false;

alter table public.profiles
  add column if not exists verification_type text;

alter table public.profiles
  add column if not exists hosting_notes text;

alter table public.profiles
  add column if not exists house_rules text;

update public.profiles
set is_verified = true,
    verification_type = 'payment'
where verified = true
  and lower(coalesce(trim(verified_label), '')) = 'verified via payment';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_verification_type_allowed_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_verification_type_allowed_chk
      check (verification_type is null or verification_type in ('payment'));
  end if;
end
$$;
