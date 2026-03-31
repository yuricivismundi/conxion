-- ConXion Dance Space growth tracking (MVP)
-- Date: 2026-03-02
-- Safe to run multiple times.

begin;

create extension if not exists pgcrypto;

create table if not exists public.dance_moves_catalog (
  id uuid primary key default gen_random_uuid(),
  style text not null,
  name text not null,
  level text,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dance_moves_catalog add column if not exists style text;
alter table public.dance_moves_catalog add column if not exists name text;
alter table public.dance_moves_catalog add column if not exists level text;
alter table public.dance_moves_catalog add column if not exists is_default boolean;
alter table public.dance_moves_catalog add column if not exists created_at timestamptz;
alter table public.dance_moves_catalog add column if not exists updated_at timestamptz;

update public.dance_moves_catalog set is_default = true where is_default is null;
update public.dance_moves_catalog set created_at = now() where created_at is null;
update public.dance_moves_catalog set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;

alter table public.dance_moves_catalog alter column style set not null;
alter table public.dance_moves_catalog alter column name set not null;
alter table public.dance_moves_catalog alter column is_default set not null;
alter table public.dance_moves_catalog alter column is_default set default true;
alter table public.dance_moves_catalog alter column created_at set not null;
alter table public.dance_moves_catalog alter column created_at set default now();
alter table public.dance_moves_catalog alter column updated_at set not null;
alter table public.dance_moves_catalog alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_catalog_style_not_blank_chk'
      and conrelid = 'public.dance_moves_catalog'::regclass
  ) then
    alter table public.dance_moves_catalog
      add constraint dance_moves_catalog_style_not_blank_chk
      check (char_length(trim(style)) > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_catalog_name_not_blank_chk'
      and conrelid = 'public.dance_moves_catalog'::regclass
  ) then
    alter table public.dance_moves_catalog
      add constraint dance_moves_catalog_name_not_blank_chk
      check (char_length(trim(name)) > 0);
  end if;
end $$;

create unique index if not exists ux_dance_moves_catalog_style_name
  on public.dance_moves_catalog(lower(style), lower(name));

drop trigger if exists trg_dance_moves_catalog_set_updated_at on public.dance_moves_catalog;
do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null then
    execute '
      create trigger trg_dance_moves_catalog_set_updated_at
      before update on public.dance_moves_catalog
      for each row execute function public.set_updated_at()
    ';
  elsif to_regprocedure('public.set_updated_at_ts()') is not null then
    execute '
      create trigger trg_dance_moves_catalog_set_updated_at
      before update on public.dance_moves_catalog
      for each row execute function public.set_updated_at_ts()
    ';
  end if;
end $$;

alter table public.dance_moves_catalog enable row level security;

drop policy if exists dance_moves_catalog_select_authenticated on public.dance_moves_catalog;
create policy dance_moves_catalog_select_authenticated
on public.dance_moves_catalog
for select
to authenticated
using (true);

grant select on public.dance_moves_catalog to authenticated;

create table if not exists public.dance_moves_user (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  style text not null,
  name text not null,
  status text not null default 'planned',
  confidence smallint,
  note text,
  is_public boolean not null default false,
  learned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dance_moves_user add column if not exists user_id uuid;
alter table public.dance_moves_user add column if not exists style text;
alter table public.dance_moves_user add column if not exists name text;
alter table public.dance_moves_user add column if not exists status text;
alter table public.dance_moves_user add column if not exists confidence smallint;
alter table public.dance_moves_user add column if not exists note text;
alter table public.dance_moves_user add column if not exists is_public boolean;
alter table public.dance_moves_user add column if not exists learned_at timestamptz;
alter table public.dance_moves_user add column if not exists created_at timestamptz;
alter table public.dance_moves_user add column if not exists updated_at timestamptz;

update public.dance_moves_user set status = 'planned' where status is null;
update public.dance_moves_user set is_public = false where is_public is null;
update public.dance_moves_user set created_at = now() where created_at is null;
update public.dance_moves_user set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;

alter table public.dance_moves_user alter column user_id set not null;
alter table public.dance_moves_user alter column style set not null;
alter table public.dance_moves_user alter column name set not null;
alter table public.dance_moves_user alter column status set not null;
alter table public.dance_moves_user alter column status set default 'planned';
alter table public.dance_moves_user alter column is_public set not null;
alter table public.dance_moves_user alter column is_public set default false;
alter table public.dance_moves_user alter column created_at set not null;
alter table public.dance_moves_user alter column created_at set default now();
alter table public.dance_moves_user alter column updated_at set not null;
alter table public.dance_moves_user alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_user_user_fk'
      and conrelid = 'public.dance_moves_user'::regclass
  ) then
    alter table public.dance_moves_user
      add constraint dance_moves_user_user_fk
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_user_status_chk'
      and conrelid = 'public.dance_moves_user'::regclass
  ) then
    alter table public.dance_moves_user
      add constraint dance_moves_user_status_chk
      check (status in ('planned', 'practicing', 'learned'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_user_confidence_chk'
      and conrelid = 'public.dance_moves_user'::regclass
  ) then
    alter table public.dance_moves_user
      add constraint dance_moves_user_confidence_chk
      check (confidence is null or confidence between 1 and 5);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_user_style_not_blank_chk'
      and conrelid = 'public.dance_moves_user'::regclass
  ) then
    alter table public.dance_moves_user
      add constraint dance_moves_user_style_not_blank_chk
      check (char_length(trim(style)) > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_user_name_not_blank_chk'
      and conrelid = 'public.dance_moves_user'::regclass
  ) then
    alter table public.dance_moves_user
      add constraint dance_moves_user_name_not_blank_chk
      check (char_length(trim(name)) > 0);
  end if;
end $$;

create index if not exists idx_dance_moves_user_user_status_updated
  on public.dance_moves_user(user_id, status, updated_at desc);

create index if not exists idx_dance_moves_user_user_style
  on public.dance_moves_user(user_id, lower(style));

create index if not exists idx_dance_moves_user_user_learned_at
  on public.dance_moves_user(user_id, learned_at desc nulls last, updated_at desc);

drop trigger if exists trg_dance_moves_user_set_updated_at on public.dance_moves_user;
do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null then
    execute '
      create trigger trg_dance_moves_user_set_updated_at
      before update on public.dance_moves_user
      for each row execute function public.set_updated_at()
    ';
  elsif to_regprocedure('public.set_updated_at_ts()') is not null then
    execute '
      create trigger trg_dance_moves_user_set_updated_at
      before update on public.dance_moves_user
      for each row execute function public.set_updated_at_ts()
    ';
  end if;
end $$;

alter table public.dance_moves_user enable row level security;

drop policy if exists dance_moves_user_select_own on public.dance_moves_user;
create policy dance_moves_user_select_own
on public.dance_moves_user
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists dance_moves_user_insert_own on public.dance_moves_user;
create policy dance_moves_user_insert_own
on public.dance_moves_user
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists dance_moves_user_update_own on public.dance_moves_user;
create policy dance_moves_user_update_own
on public.dance_moves_user
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists dance_moves_user_delete_own on public.dance_moves_user;
create policy dance_moves_user_delete_own
on public.dance_moves_user
for delete
to authenticated
using (user_id = auth.uid());

grant select, insert, update, delete on public.dance_moves_user to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'dance_growth_public_summary'
      and c.relkind = 'v'
  ) then
    execute 'drop view public.dance_growth_public_summary';
  end if;
end $$;

create table if not exists public.dance_growth_public_summary (
  user_id uuid primary key,
  planned_count integer not null default 0,
  practicing_count integer not null default 0,
  learned_count integer not null default 0,
  styles_tracked text[] not null default '{}'::text[],
  recently_learned text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

alter table public.dance_growth_public_summary add column if not exists user_id uuid;
alter table public.dance_growth_public_summary add column if not exists planned_count integer;
alter table public.dance_growth_public_summary add column if not exists practicing_count integer;
alter table public.dance_growth_public_summary add column if not exists learned_count integer;
alter table public.dance_growth_public_summary add column if not exists styles_tracked text[];
alter table public.dance_growth_public_summary add column if not exists recently_learned text[];
alter table public.dance_growth_public_summary add column if not exists updated_at timestamptz;

update public.dance_growth_public_summary set planned_count = 0 where planned_count is null;
update public.dance_growth_public_summary set practicing_count = 0 where practicing_count is null;
update public.dance_growth_public_summary set learned_count = 0 where learned_count is null;
update public.dance_growth_public_summary set styles_tracked = '{}'::text[] where styles_tracked is null;
update public.dance_growth_public_summary set recently_learned = '{}'::text[] where recently_learned is null;
update public.dance_growth_public_summary set updated_at = now() where updated_at is null;

alter table public.dance_growth_public_summary alter column user_id set not null;
alter table public.dance_growth_public_summary alter column planned_count set not null;
alter table public.dance_growth_public_summary alter column planned_count set default 0;
alter table public.dance_growth_public_summary alter column practicing_count set not null;
alter table public.dance_growth_public_summary alter column practicing_count set default 0;
alter table public.dance_growth_public_summary alter column learned_count set not null;
alter table public.dance_growth_public_summary alter column learned_count set default 0;
alter table public.dance_growth_public_summary alter column styles_tracked set not null;
alter table public.dance_growth_public_summary alter column styles_tracked set default '{}'::text[];
alter table public.dance_growth_public_summary alter column recently_learned set not null;
alter table public.dance_growth_public_summary alter column recently_learned set default '{}'::text[];
alter table public.dance_growth_public_summary alter column updated_at set not null;
alter table public.dance_growth_public_summary alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_growth_public_summary_pkey'
      and conrelid = 'public.dance_growth_public_summary'::regclass
  ) then
    alter table public.dance_growth_public_summary
      add constraint dance_growth_public_summary_pkey primary key (user_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_growth_public_summary_user_fk'
      and conrelid = 'public.dance_growth_public_summary'::regclass
  ) then
    alter table public.dance_growth_public_summary
      add constraint dance_growth_public_summary_user_fk
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

alter table public.dance_growth_public_summary enable row level security;

drop policy if exists dance_growth_public_summary_select_authenticated on public.dance_growth_public_summary;
create policy dance_growth_public_summary_select_authenticated
on public.dance_growth_public_summary
for select
to authenticated
using (true);

revoke all on public.dance_growth_public_summary from public;
revoke all on public.dance_growth_public_summary from anon;
revoke all on public.dance_growth_public_summary from authenticated;
grant select on public.dance_growth_public_summary to authenticated;

create or replace function public.refresh_dance_growth_public_summary(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_summary record;
begin
  if p_user_id is null then
    return;
  end if;

  with per_user as (
    select
      m.user_id,
      count(*) filter (where m.status = 'planned')::int as planned_count,
      count(*) filter (where m.status = 'practicing')::int as practicing_count,
      count(*) filter (where m.status = 'learned')::int as learned_count,
      coalesce(array_agg(distinct m.style order by m.style), '{}'::text[]) as styles_tracked
    from public.dance_moves_user m
    where m.user_id = p_user_id
    group by m.user_id
  ),
  recent as (
    select
      m.user_id,
      coalesce(
        (
          array_agg(m.name order by coalesce(m.learned_at, m.updated_at, m.created_at) desc)
        )[1:3],
        '{}'::text[]
      ) as recently_learned
    from public.dance_moves_user m
    where m.user_id = p_user_id
      and m.status = 'learned'
    group by m.user_id
  )
  select
    p.user_id,
    p.planned_count,
    p.practicing_count,
    p.learned_count,
    p.styles_tracked,
    coalesce(r.recently_learned, '{}'::text[]) as recently_learned
  into v_summary
  from per_user p
  left join recent r on r.user_id = p.user_id;

  if not found then
    delete from public.dance_growth_public_summary where user_id = p_user_id;
    return;
  end if;

  insert into public.dance_growth_public_summary (
    user_id,
    planned_count,
    practicing_count,
    learned_count,
    styles_tracked,
    recently_learned,
    updated_at
  )
  values (
    v_summary.user_id,
    v_summary.planned_count,
    v_summary.practicing_count,
    v_summary.learned_count,
    v_summary.styles_tracked,
    v_summary.recently_learned,
    now()
  )
  on conflict (user_id) do update
  set planned_count = excluded.planned_count,
      practicing_count = excluded.practicing_count,
      learned_count = excluded.learned_count,
      styles_tracked = excluded.styles_tracked,
      recently_learned = excluded.recently_learned,
      updated_at = excluded.updated_at;
end;
$function$;

create or replace function public.sync_dance_growth_public_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_dance_growth_public_summary(old.user_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_dance_growth_public_summary(new.user_id);
  end if;

  return null;
end;
$function$;

drop trigger if exists trg_dance_growth_public_summary_sync on public.dance_moves_user;
create trigger trg_dance_growth_public_summary_sync
after insert or update or delete on public.dance_moves_user
for each row
execute function public.sync_dance_growth_public_summary();

do $$
declare
  v_user_id uuid;
begin
  delete from public.dance_growth_public_summary;

  for v_user_id in
    select distinct user_id
    from public.dance_moves_user
  loop
    perform public.refresh_dance_growth_public_summary(v_user_id);
  end loop;
end $$;

commit;
