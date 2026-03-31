-- ConXion Dashboard competitions tracker (MVP)
-- Date: 2026-03-02
-- Safe to run multiple times.

begin;

create extension if not exists pgcrypto;

create table if not exists public.dance_competitions_user (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  event_name text not null,
  city text,
  country text,
  style text not null,
  division text not null,
  role text not null default 'Leader',
  result text not null default 'Participated',
  year integer not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dance_competitions_user add column if not exists user_id uuid;
alter table public.dance_competitions_user add column if not exists event_name text;
alter table public.dance_competitions_user add column if not exists city text;
alter table public.dance_competitions_user add column if not exists country text;
alter table public.dance_competitions_user add column if not exists style text;
alter table public.dance_competitions_user add column if not exists division text;
alter table public.dance_competitions_user add column if not exists role text;
alter table public.dance_competitions_user add column if not exists result text;
alter table public.dance_competitions_user add column if not exists year integer;
alter table public.dance_competitions_user add column if not exists note text;
alter table public.dance_competitions_user add column if not exists created_at timestamptz;
alter table public.dance_competitions_user add column if not exists updated_at timestamptz;

update public.dance_competitions_user set role = 'Leader' where role is null;
update public.dance_competitions_user set result = 'Participated' where result is null;
update public.dance_competitions_user set result = 'Quarterfinalist' where result in ('Top 5', 'Quarter of Finals', 'Quarterfinal', 'Quarterfinals');
update public.dance_competitions_user set result = 'Semifinalist' where result in ('Semifinal', 'Semi Finalist');
update public.dance_competitions_user set result = 'Finalist' where result = 'Podium';
update public.dance_competitions_user set created_at = now() where created_at is null;
update public.dance_competitions_user set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;

alter table public.dance_competitions_user alter column user_id set not null;
alter table public.dance_competitions_user alter column event_name set not null;
alter table public.dance_competitions_user alter column style set not null;
alter table public.dance_competitions_user alter column division set not null;
alter table public.dance_competitions_user alter column role set not null;
alter table public.dance_competitions_user alter column role set default 'Leader';
alter table public.dance_competitions_user alter column result set not null;
alter table public.dance_competitions_user alter column result set default 'Participated';
alter table public.dance_competitions_user alter column year set not null;
alter table public.dance_competitions_user alter column created_at set not null;
alter table public.dance_competitions_user alter column created_at set default now();
alter table public.dance_competitions_user alter column updated_at set not null;
alter table public.dance_competitions_user alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_competitions_user_user_fk'
      and conrelid = 'public.dance_competitions_user'::regclass
  ) then
    alter table public.dance_competitions_user
      add constraint dance_competitions_user_user_fk
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_competitions_event_name_not_blank_chk'
      and conrelid = 'public.dance_competitions_user'::regclass
  ) then
    alter table public.dance_competitions_user
      add constraint dance_competitions_event_name_not_blank_chk
      check (char_length(trim(event_name)) > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_competitions_style_not_blank_chk'
      and conrelid = 'public.dance_competitions_user'::regclass
  ) then
    alter table public.dance_competitions_user
      add constraint dance_competitions_style_not_blank_chk
      check (char_length(trim(style)) > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_competitions_division_not_blank_chk'
      and conrelid = 'public.dance_competitions_user'::regclass
  ) then
    alter table public.dance_competitions_user
      add constraint dance_competitions_division_not_blank_chk
      check (char_length(trim(division)) > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_competitions_role_allowed_chk'
      and conrelid = 'public.dance_competitions_user'::regclass
  ) then
    alter table public.dance_competitions_user
      add constraint dance_competitions_role_allowed_chk
      check (role in ('Leader', 'Follower', 'Switch'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_competitions_result_allowed_chk'
      and conrelid = 'public.dance_competitions_user'::regclass
  ) then
    alter table public.dance_competitions_user
      add constraint dance_competitions_result_allowed_chk
      check (result in ('Participated', 'Quarterfinalist', 'Semifinalist', 'Finalist', 'Winner'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_competitions_year_range_chk'
      and conrelid = 'public.dance_competitions_user'::regclass
  ) then
    alter table public.dance_competitions_user
      add constraint dance_competitions_year_range_chk
      check (year between 1990 and (extract(year from now())::int + 1));
  end if;
end $$;

create index if not exists idx_dance_competitions_user_year
  on public.dance_competitions_user(user_id, year desc, created_at desc);

drop trigger if exists trg_dance_competitions_user_set_updated_at on public.dance_competitions_user;
do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null then
    execute '
      create trigger trg_dance_competitions_user_set_updated_at
      before update on public.dance_competitions_user
      for each row execute function public.set_updated_at()
    ';
  elsif to_regprocedure('public.set_updated_at_ts()') is not null then
    execute '
      create trigger trg_dance_competitions_user_set_updated_at
      before update on public.dance_competitions_user
      for each row execute function public.set_updated_at_ts()
    ';
  end if;
end $$;

alter table public.dance_competitions_user enable row level security;

drop policy if exists dance_competitions_select_own on public.dance_competitions_user;
create policy dance_competitions_select_own
on public.dance_competitions_user
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists dance_competitions_insert_own on public.dance_competitions_user;
create policy dance_competitions_insert_own
on public.dance_competitions_user
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists dance_competitions_update_own on public.dance_competitions_user;
create policy dance_competitions_update_own
on public.dance_competitions_user
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists dance_competitions_delete_own on public.dance_competitions_user;
create policy dance_competitions_delete_own
on public.dance_competitions_user
for delete
to authenticated
using (user_id = auth.uid());

grant select, insert, update, delete on public.dance_competitions_user to authenticated;

commit;
