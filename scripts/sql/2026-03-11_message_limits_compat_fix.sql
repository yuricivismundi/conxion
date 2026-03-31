-- ConXion Messaging Compatibility Fix: message_limits schema
-- Date: 2026-03-11
--
-- Why:
--   Some environments have an older public.message_limits shape that does not
--   include date_key, but bump_thread_message_daily_limit() expects:
--     (user_id uuid, date_key date, sent_count int)
--   and an upsert target on (user_id, date_key).
--
-- Safe to re-run.

begin;

create extension if not exists pgcrypto;

-- Ensure table exists with required columns.
create table if not exists public.message_limits (
  user_id uuid not null,
  date_key date not null,
  sent_count int not null default 0
);

alter table public.message_limits add column if not exists user_id uuid;
alter table public.message_limits add column if not exists date_key date;
alter table public.message_limits add column if not exists sent_count int default 0;

-- Backfill date_key from likely legacy columns when available.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'message_limits'
      and column_name = 'day_key'
  ) then
    execute $q$
      update public.message_limits
      set date_key = day_key::date
      where date_key is null
        and day_key is not null
    $q$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'message_limits'
      and column_name = 'created_at'
  ) then
    execute $q$
      update public.message_limits
      set date_key = created_at::date
      where date_key is null
        and created_at is not null
    $q$;
  end if;
end $$;

update public.message_limits
set date_key = current_date
where date_key is null;

update public.message_limits
set sent_count = 0
where sent_count is null;

-- Legacy compatibility: some environments have a required "day" column.
-- Ensure it is populated and has a safe default so trigger upserts using
-- (user_id, date_key, sent_count) do not fail on NOT NULL(day).
do $$
declare
  v_day_udt text;
begin
  select c.udt_name
    into v_day_udt
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'message_limits'
    and c.column_name = 'day'
  limit 1;

  if v_day_udt is not null then
    if v_day_udt = 'date' then
      execute $q$
        update public.message_limits
        set day = coalesce(day, date_key, current_date)
        where day is null
      $q$;
      execute 'alter table public.message_limits alter column day set default current_date';
    elsif v_day_udt in ('timestamp', 'timestamptz') then
      execute $q$
        update public.message_limits
        set day = coalesce(day, date_key::timestamp, now())
        where day is null
      $q$;
      execute 'alter table public.message_limits alter column day set default now()';
    elsif v_day_udt in ('text', 'varchar') then
      execute $q$
        update public.message_limits
        set day = coalesce(day, coalesce(date_key, current_date)::text)
        where day is null
      $q$;
      execute 'alter table public.message_limits alter column day set default (current_date::text)';
    elsif v_day_udt in ('int2', 'int4', 'int8') then
      execute $q$
        update public.message_limits
        set day = coalesce(day, extract(epoch from coalesce(date_key::timestamp, now()))::bigint)
        where day is null
      $q$;
      execute 'alter table public.message_limits alter column day set default (extract(epoch from now())::bigint)';
    else
      -- Unknown legacy type: prevent insert failure by permitting nulls.
      execute 'alter table public.message_limits alter column day drop not null';
    end if;
  end if;
end $$;

-- Aggregate duplicates to make (user_id, date_key) unique.
with ranked as (
  select
    ctid,
    user_id,
    date_key,
    row_number() over (partition by user_id, date_key order by ctid) as rn,
    sum(coalesce(sent_count, 0)) over (partition by user_id, date_key) as total_sent
  from public.message_limits
  where user_id is not null
    and date_key is not null
)
update public.message_limits ml
set sent_count = ranked.total_sent::int
from ranked
where ml.ctid = ranked.ctid
  and ranked.rn = 1;

with ranked as (
  select
    ctid,
    row_number() over (partition by user_id, date_key order by ctid) as rn
  from public.message_limits
  where user_id is not null
    and date_key is not null
)
delete from public.message_limits ml
using ranked
where ml.ctid = ranked.ctid
  and ranked.rn > 1;

-- Remove invalid rows that cannot participate in upsert key.
delete from public.message_limits
where user_id is null
   or date_key is null;

alter table public.message_limits alter column user_id set not null;
alter table public.message_limits alter column date_key set not null;
alter table public.message_limits alter column sent_count set default 0;
alter table public.message_limits alter column sent_count set not null;

create unique index if not exists ux_message_limits_user_date_key
  on public.message_limits(user_id, date_key);

commit;
