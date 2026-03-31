-- ConXion Dashboard goals tracker (MVP)
-- Date: 2026-03-02
-- Safe to run multiple times.

begin;

create extension if not exists pgcrypto;

create table if not exists public.dance_goals_user (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  status text not null default 'active',
  progress integer not null default 0,
  target_date date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dance_goals_user add column if not exists user_id uuid;
alter table public.dance_goals_user add column if not exists title text;
alter table public.dance_goals_user add column if not exists status text;
alter table public.dance_goals_user add column if not exists progress integer;
alter table public.dance_goals_user add column if not exists target_date date;
alter table public.dance_goals_user add column if not exists note text;
alter table public.dance_goals_user add column if not exists created_at timestamptz;
alter table public.dance_goals_user add column if not exists updated_at timestamptz;

update public.dance_goals_user set status = 'active' where status is null;
update public.dance_goals_user set progress = 0 where progress is null;
update public.dance_goals_user set created_at = now() where created_at is null;
update public.dance_goals_user set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;

alter table public.dance_goals_user alter column user_id set not null;
alter table public.dance_goals_user alter column title set not null;
alter table public.dance_goals_user alter column status set not null;
alter table public.dance_goals_user alter column status set default 'active';
alter table public.dance_goals_user alter column progress set not null;
alter table public.dance_goals_user alter column progress set default 0;
alter table public.dance_goals_user alter column created_at set not null;
alter table public.dance_goals_user alter column created_at set default now();
alter table public.dance_goals_user alter column updated_at set not null;
alter table public.dance_goals_user alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_goals_user_user_fk'
      and conrelid = 'public.dance_goals_user'::regclass
  ) then
    alter table public.dance_goals_user
      add constraint dance_goals_user_user_fk
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_goals_title_not_blank_chk'
      and conrelid = 'public.dance_goals_user'::regclass
  ) then
    alter table public.dance_goals_user
      add constraint dance_goals_title_not_blank_chk
      check (char_length(trim(title)) > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_goals_status_allowed_chk'
      and conrelid = 'public.dance_goals_user'::regclass
  ) then
    alter table public.dance_goals_user
      add constraint dance_goals_status_allowed_chk
      check (status in ('active', 'completed'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_goals_progress_range_chk'
      and conrelid = 'public.dance_goals_user'::regclass
  ) then
    alter table public.dance_goals_user
      add constraint dance_goals_progress_range_chk
      check (progress between 0 and 100);
  end if;
end $$;

create index if not exists idx_dance_goals_user_status_created_at
  on public.dance_goals_user(user_id, status, created_at desc);

drop trigger if exists trg_dance_goals_user_set_updated_at on public.dance_goals_user;
do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null then
    execute '
      create trigger trg_dance_goals_user_set_updated_at
      before update on public.dance_goals_user
      for each row execute function public.set_updated_at()
    ';
  elsif to_regprocedure('public.set_updated_at_ts()') is not null then
    execute '
      create trigger trg_dance_goals_user_set_updated_at
      before update on public.dance_goals_user
      for each row execute function public.set_updated_at_ts()
    ';
  end if;
end $$;

alter table public.dance_goals_user enable row level security;

drop policy if exists dance_goals_select_own on public.dance_goals_user;
create policy dance_goals_select_own
on public.dance_goals_user
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists dance_goals_insert_own on public.dance_goals_user;
create policy dance_goals_insert_own
on public.dance_goals_user
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists dance_goals_update_own on public.dance_goals_user;
create policy dance_goals_update_own
on public.dance_goals_user
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists dance_goals_delete_own on public.dance_goals_user;
create policy dance_goals_delete_own
on public.dance_goals_user
for delete
to authenticated
using (user_id = auth.uid());

grant select, insert, update, delete on public.dance_goals_user to authenticated;

commit;
