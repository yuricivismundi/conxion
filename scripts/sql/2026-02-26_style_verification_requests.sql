-- ConXion style verification requests (MVP phase 1)
-- Date: 2026-02-26
-- Safe to re-run.

begin;

create extension if not exists pgcrypto;

create table if not exists public.style_verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  style text not null,
  level text not null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  reviewer_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.style_verification_requests add column if not exists user_id uuid;
alter table public.style_verification_requests add column if not exists style text;
alter table public.style_verification_requests add column if not exists level text;
alter table public.style_verification_requests add column if not exists status text;
alter table public.style_verification_requests add column if not exists requested_at timestamptz;
alter table public.style_verification_requests add column if not exists reviewed_at timestamptz;
alter table public.style_verification_requests add column if not exists reviewed_by uuid;
alter table public.style_verification_requests add column if not exists reviewer_note text;
alter table public.style_verification_requests add column if not exists metadata jsonb;
alter table public.style_verification_requests add column if not exists created_at timestamptz;
alter table public.style_verification_requests add column if not exists updated_at timestamptz;

update public.style_verification_requests
set metadata = '{}'::jsonb
where metadata is null;

update public.style_verification_requests
set status = 'pending'
where status is null;

update public.style_verification_requests
set requested_at = coalesce(created_at, now())
where requested_at is null;

update public.style_verification_requests
set created_at = coalesce(requested_at, now())
where created_at is null;

update public.style_verification_requests
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table public.style_verification_requests
  alter column status set default 'pending';
alter table public.style_verification_requests
  alter column requested_at set default now();
alter table public.style_verification_requests
  alter column metadata set default '{}'::jsonb;
alter table public.style_verification_requests
  alter column created_at set default now();
alter table public.style_verification_requests
  alter column updated_at set default now();

alter table public.style_verification_requests
  alter column user_id set not null;
alter table public.style_verification_requests
  alter column style set not null;
alter table public.style_verification_requests
  alter column level set not null;
alter table public.style_verification_requests
  alter column status set not null;
alter table public.style_verification_requests
  alter column requested_at set not null;
alter table public.style_verification_requests
  alter column metadata set not null;
alter table public.style_verification_requests
  alter column created_at set not null;
alter table public.style_verification_requests
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'style_verification_requests_status_chk'
      and conrelid = 'public.style_verification_requests'::regclass
  ) then
    alter table public.style_verification_requests
      add constraint style_verification_requests_status_chk
      check (status in ('pending', 'approved', 'rejected', 'cancelled'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'style_verification_requests_style_not_blank_chk'
      and conrelid = 'public.style_verification_requests'::regclass
  ) then
    alter table public.style_verification_requests
      add constraint style_verification_requests_style_not_blank_chk
      check (char_length(trim(style)) > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'style_verification_requests_level_not_blank_chk'
      and conrelid = 'public.style_verification_requests'::regclass
  ) then
    alter table public.style_verification_requests
      add constraint style_verification_requests_level_not_blank_chk
      check (char_length(trim(level)) > 0);
  end if;
end $$;

create index if not exists idx_style_verification_requests_user_status_requested
  on public.style_verification_requests(user_id, status, requested_at desc);

create index if not exists idx_style_verification_requests_status_requested
  on public.style_verification_requests(status, requested_at desc);

create unique index if not exists ux_style_verification_requests_pending_per_style
  on public.style_verification_requests(user_id, lower(style))
  where status = 'pending';

drop trigger if exists trg_style_verification_requests_set_updated_at on public.style_verification_requests;
do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null then
    execute '
      create trigger trg_style_verification_requests_set_updated_at
      before update on public.style_verification_requests
      for each row execute function public.set_updated_at()
    ';
  elsif to_regprocedure('public.set_updated_at_ts()') is not null then
    execute '
      create trigger trg_style_verification_requests_set_updated_at
      before update on public.style_verification_requests
      for each row execute function public.set_updated_at_ts()
    ';
  end if;
end $$;

alter table public.style_verification_requests enable row level security;

drop policy if exists style_verification_requests_select_own_or_admin on public.style_verification_requests;
create policy style_verification_requests_select_own_or_admin
on public.style_verification_requests
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_app_admin(auth.uid())
);

drop policy if exists style_verification_requests_insert_own on public.style_verification_requests;
create policy style_verification_requests_insert_own
on public.style_verification_requests
for insert
to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
);

drop policy if exists style_verification_requests_update_admin on public.style_verification_requests;
create policy style_verification_requests_update_admin
on public.style_verification_requests
for update
to authenticated
using (public.is_app_admin(auth.uid()))
with check (public.is_app_admin(auth.uid()));

grant select, insert, update on public.style_verification_requests to authenticated;

commit;
