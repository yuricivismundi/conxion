-- ConXion Dashboard connections baseline (MVP)
-- Date: 2026-03-03
-- Safe to run multiple times.

begin;

create extension if not exists pgcrypto;

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null,
  target_id uuid not null,
  status text not null default 'pending',
  blocked_by uuid,
  connect_context text,
  connect_reason text,
  connect_reason_role text,
  trip_id uuid,
  connect_note text,
  block_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.connections add column if not exists requester_id uuid;
alter table public.connections add column if not exists target_id uuid;
alter table public.connections add column if not exists status text;
alter table public.connections add column if not exists blocked_by uuid;
alter table public.connections add column if not exists connect_context text;
alter table public.connections add column if not exists connect_reason text;
alter table public.connections add column if not exists connect_reason_role text;
alter table public.connections add column if not exists trip_id uuid;
alter table public.connections add column if not exists connect_note text;
alter table public.connections add column if not exists block_reason text;
alter table public.connections add column if not exists created_at timestamptz;
alter table public.connections add column if not exists updated_at timestamptz;

update public.connections set status = 'pending' where status is null;
update public.connections set created_at = now() where created_at is null;
update public.connections set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;

alter table public.connections alter column requester_id set not null;
alter table public.connections alter column target_id set not null;
alter table public.connections alter column status set not null;
alter table public.connections alter column status set default 'pending';
alter table public.connections alter column created_at set not null;
alter table public.connections alter column created_at set default now();
alter table public.connections alter column updated_at set not null;
alter table public.connections alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'connections_status_allowed_chk'
      and conrelid = 'public.connections'::regclass
  ) then
    alter table public.connections
      add constraint connections_status_allowed_chk
      check (status in ('pending', 'accepted', 'declined', 'cancelled', 'blocked'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'connections_not_self'
      and conrelid = 'public.connections'::regclass
  ) then
    alter table public.connections
      add constraint connections_not_self
      check (requester_id <> target_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'connections_connect_context_check'
      and conrelid = 'public.connections'::regclass
  ) then
    alter table public.connections
      add constraint connections_connect_context_check
      check (connect_context is null or connect_context in ('member', 'traveller'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'connections_unique_pair'
      and conrelid = 'public.connections'::regclass
  ) then
    alter table public.connections
      add constraint connections_unique_pair
      unique (requester_id, target_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'connections_requester_id_fkey'
      and conrelid = 'public.connections'::regclass
  ) then
    alter table public.connections
      add constraint connections_requester_id_fkey
      foreign key (requester_id) references auth.users(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'connections_target_id_fkey'
      and conrelid = 'public.connections'::regclass
  ) then
    alter table public.connections
      add constraint connections_target_id_fkey
      foreign key (target_id) references auth.users(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if to_regclass('public.trips') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'connections_trip_id_fkey'
         and conrelid = 'public.connections'::regclass
     ) then
    alter table public.connections
      add constraint connections_trip_id_fkey
      foreign key (trip_id) references public.trips(id) on delete set null;
  end if;
end $$;

create index if not exists connections_pair_idx on public.connections(requester_id, target_id);
create index if not exists connections_requester_idx on public.connections(requester_id);
create index if not exists connections_target_idx on public.connections(target_id);
create index if not exists connections_status_idx on public.connections(status);
create index if not exists connections_blocked_by_idx on public.connections(blocked_by);
create index if not exists connections_context_idx on public.connections(connect_context);
create index if not exists connections_trip_id_idx on public.connections(trip_id);
create index if not exists connections_requester_status_idx on public.connections(requester_id, status, created_at desc);
create index if not exists connections_target_status_idx on public.connections(target_id, status, created_at desc);

drop trigger if exists trg_connections_set_updated_at on public.connections;
do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null then
    execute '
      create trigger trg_connections_set_updated_at
      before update on public.connections
      for each row execute function public.set_updated_at()
    ';
  elsif to_regprocedure('public.set_updated_at_ts()') is not null then
    execute '
      create trigger trg_connections_set_updated_at
      before update on public.connections
      for each row execute function public.set_updated_at_ts()
    ';
  else
    create or replace function public._connections_set_updated_at()
    returns trigger
    language plpgsql
    as $fn$
    begin
      new.updated_at := now();
      return new;
    end;
    $fn$;

    execute '
      create trigger trg_connections_set_updated_at
      before update on public.connections
      for each row execute function public._connections_set_updated_at()
    ';
  end if;
end $$;

alter table public.connections enable row level security;

drop policy if exists connections_read_own on public.connections;
create policy connections_read_own
on public.connections
for select
to authenticated
using ((auth.uid() = requester_id) or (auth.uid() = target_id));

drop policy if exists connections_insert_request on public.connections;
create policy connections_insert_request
on public.connections
for insert
to authenticated
with check (auth.uid() = requester_id);

drop policy if exists connections_requester_can_cancel on public.connections;
create policy connections_requester_can_cancel
on public.connections
for update
to authenticated
using ((auth.uid() = requester_id) and (status = 'pending'))
with check ((auth.uid() = requester_id) and (status = 'cancelled'));

drop policy if exists connections_requester_can_delete_pending on public.connections;
create policy connections_requester_can_delete_pending
on public.connections
for delete
to authenticated
using ((auth.uid() = requester_id) and (status = 'pending'));

drop policy if exists connections_target_can_respond on public.connections;
create policy connections_target_can_respond
on public.connections
for update
to authenticated
using ((auth.uid() = target_id) and (status = 'pending'))
with check ((auth.uid() = target_id) and (status in ('accepted', 'declined')));

drop policy if exists connections_update_by_participants on public.connections;
create policy connections_update_by_participants
on public.connections
for update
to authenticated
using ((auth.uid() = requester_id) or (auth.uid() = target_id))
with check ((auth.uid() = requester_id) or (auth.uid() = target_id));

grant select, insert, update, delete on public.connections to authenticated;

commit;

notify pgrst, 'reload schema';
