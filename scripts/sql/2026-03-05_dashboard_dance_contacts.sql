-- ConXion Dashboard Dance Contacts (MVP)
-- Date: 2026-03-05
-- Safe to run multiple times.

begin;

create extension if not exists pgcrypto;

create table if not exists public.dance_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  contact_type text not null default 'external',
  linked_user_id uuid,
  name text not null,
  role text[] not null default '{}'::text[],
  city text,
  country text,
  instagram text,
  whatsapp text,
  email text,
  tags text[] not null default '{}'::text[],
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dance_contacts add column if not exists user_id uuid;
alter table public.dance_contacts add column if not exists contact_type text;
alter table public.dance_contacts add column if not exists linked_user_id uuid;
alter table public.dance_contacts add column if not exists name text;
alter table public.dance_contacts add column if not exists role text[];
alter table public.dance_contacts add column if not exists city text;
alter table public.dance_contacts add column if not exists country text;
alter table public.dance_contacts add column if not exists instagram text;
alter table public.dance_contacts add column if not exists whatsapp text;
alter table public.dance_contacts add column if not exists email text;
alter table public.dance_contacts add column if not exists tags text[];
alter table public.dance_contacts add column if not exists notes text;
alter table public.dance_contacts add column if not exists created_at timestamptz;
alter table public.dance_contacts add column if not exists updated_at timestamptz;

update public.dance_contacts set contact_type = 'external' where contact_type is null;
update public.dance_contacts set role = '{}'::text[] where role is null;
update public.dance_contacts set tags = '{}'::text[] where tags is null;
update public.dance_contacts set created_at = now() where created_at is null;
update public.dance_contacts set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;

alter table public.dance_contacts alter column user_id set not null;
alter table public.dance_contacts alter column contact_type set not null;
alter table public.dance_contacts alter column contact_type set default 'external';
alter table public.dance_contacts alter column name set not null;
alter table public.dance_contacts alter column role set not null;
alter table public.dance_contacts alter column role set default '{}'::text[];
alter table public.dance_contacts alter column tags set not null;
alter table public.dance_contacts alter column tags set default '{}'::text[];
alter table public.dance_contacts alter column created_at set not null;
alter table public.dance_contacts alter column created_at set default now();
alter table public.dance_contacts alter column updated_at set not null;
alter table public.dance_contacts alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_contacts_user_fk'
      and conrelid = 'public.dance_contacts'::regclass
  ) then
    alter table public.dance_contacts
      add constraint dance_contacts_user_fk
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_contacts_linked_user_fk'
      and conrelid = 'public.dance_contacts'::regclass
  ) then
    alter table public.dance_contacts
      add constraint dance_contacts_linked_user_fk
      foreign key (linked_user_id) references auth.users(id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_contacts_type_allowed_chk'
      and conrelid = 'public.dance_contacts'::regclass
  ) then
    alter table public.dance_contacts
      add constraint dance_contacts_type_allowed_chk
      check (contact_type in ('member', 'external'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_contacts_name_not_blank_chk'
      and conrelid = 'public.dance_contacts'::regclass
  ) then
    alter table public.dance_contacts
      add constraint dance_contacts_name_not_blank_chk
      check (char_length(trim(name)) > 0 and char_length(trim(name)) <= 120);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_contacts_notes_length_chk'
      and conrelid = 'public.dance_contacts'::regclass
  ) then
    alter table public.dance_contacts
      add constraint dance_contacts_notes_length_chk
      check (notes is null or char_length(notes) <= 500);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_contacts_tags_limit_chk'
      and conrelid = 'public.dance_contacts'::regclass
  ) then
    alter table public.dance_contacts
      add constraint dance_contacts_tags_limit_chk
      check (coalesce(array_length(tags, 1), 0) <= 10);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_contacts_member_linked_chk'
      and conrelid = 'public.dance_contacts'::regclass
  ) then
    alter table public.dance_contacts
      add constraint dance_contacts_member_linked_chk
      check (
        (contact_type = 'member' and linked_user_id is not null)
        or (contact_type = 'external')
      );
  end if;
end $$;

do $$
declare
  v_is_partial boolean;
begin
  select i.indpred is not null
  into v_is_partial
  from pg_index i
  join pg_class c
    on c.oid = i.indexrelid
  join pg_namespace n
    on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'ux_dance_contacts_user_linked';

  if coalesce(v_is_partial, false) then
    drop index if exists public.ux_dance_contacts_user_linked;
  end if;
end $$;

create unique index if not exists ux_dance_contacts_user_linked
  on public.dance_contacts(user_id, linked_user_id);

create index if not exists idx_dance_contacts_user_updated
  on public.dance_contacts(user_id, updated_at desc);

create index if not exists idx_dance_contacts_user_type
  on public.dance_contacts(user_id, contact_type, updated_at desc);

create index if not exists idx_dance_contacts_user_city_country
  on public.dance_contacts(user_id, lower(coalesce(city, '')), lower(coalesce(country, '')));

create index if not exists idx_dance_contacts_role_gin
  on public.dance_contacts using gin(role);

create index if not exists idx_dance_contacts_tags_gin
  on public.dance_contacts using gin(tags);

create or replace function public.enforce_dance_contacts_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  if tg_op = 'INSERT' then
    select count(*) into v_count from public.dance_contacts where user_id = new.user_id;
    if v_count >= 100 then
      raise exception using
        errcode = 'check_violation',
        message = 'contact_limit_exceeded: max 100 contacts per user';
    end if;
  elsif tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    select count(*) into v_count from public.dance_contacts where user_id = new.user_id;
    if v_count >= 100 then
      raise exception using
        errcode = 'check_violation',
        message = 'contact_limit_exceeded: max 100 contacts per user';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dance_contacts_limit on public.dance_contacts;
create trigger trg_dance_contacts_limit
before insert or update on public.dance_contacts
for each row execute function public.enforce_dance_contacts_limit();

drop trigger if exists trg_dance_contacts_set_updated_at on public.dance_contacts;
do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null then
    execute '
      create trigger trg_dance_contacts_set_updated_at
      before update on public.dance_contacts
      for each row execute function public.set_updated_at()
    ';
  elsif to_regprocedure('public.set_updated_at_ts()') is not null then
    execute '
      create trigger trg_dance_contacts_set_updated_at
      before update on public.dance_contacts
      for each row execute function public.set_updated_at_ts()
    ';
  else
    create or replace function public._dance_contacts_set_updated_at()
    returns trigger
    language plpgsql
    set search_path = public
    as $fn$
    begin
      new.updated_at := now();
      return new;
    end;
    $fn$;

    execute '
      create trigger trg_dance_contacts_set_updated_at
      before update on public.dance_contacts
      for each row execute function public._dance_contacts_set_updated_at()
    ';
  end if;
end $$;

alter table public.dance_contacts enable row level security;

drop policy if exists dance_contacts_select_own on public.dance_contacts;
create policy dance_contacts_select_own
on public.dance_contacts
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists dance_contacts_insert_own on public.dance_contacts;
create policy dance_contacts_insert_own
on public.dance_contacts
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists dance_contacts_update_own on public.dance_contacts;
create policy dance_contacts_update_own
on public.dance_contacts
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists dance_contacts_delete_own on public.dance_contacts;
create policy dance_contacts_delete_own
on public.dance_contacts
for delete
to authenticated
using (user_id = auth.uid());

grant select, insert, update, delete on public.dance_contacts to authenticated;

commit;

notify pgrst, 'reload schema';
