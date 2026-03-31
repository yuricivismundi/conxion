-- ConXion Supabase lint security fixes
-- Date: 2026-03-18
--
-- Fixes:
-- 1) Replace the public dance growth SECURITY DEFINER-style view with an
--    RLS-protected summary table maintained by trigger-driven refreshes.
-- 2) Enable RLS on public.events_archive and keep direct access restricted.

begin;

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

alter table public.events_archive enable row level security;

revoke all on public.events_archive from public;
revoke all on public.events_archive from anon;
revoke all on public.events_archive from authenticated;
grant select on public.events_archive to service_role;

commit;
