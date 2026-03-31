-- ConXion Unified References Model
-- Date: 2026-03-17
--
-- Refactor trust system into canonical references fields:
--   from_user_id, to_user_id, text, rating (optional), context_tag, created_at
--
-- Context tags:
--   practice, event, host, guest, travel, festival, collaboration
--
-- Notes:
-- - Safe to run multiple times.
-- - Keeps legacy columns for backward compatibility while canonical fields become primary.

begin;

-- Some environments have immutable reference guard triggers that block
-- historical backfills (updates on rows older than 15 days). Temporarily
-- disable those triggers only for this migration transaction.
do $$
begin
  if to_regclass('public.references') is null then
    return;
  end if;

  if exists (
    select 1
    from pg_trigger t
    where t.tgname = 'trg_references_guardrails'
      and t.tgrelid = 'public.references'::regclass
  ) then
    execute 'alter table public.references disable trigger trg_references_guardrails';
  end if;

  if exists (
    select 1
    from pg_trigger t
    where t.tgname = 'trg_references_immutable'
      and t.tgrelid = 'public.references'::regclass
  ) then
    execute 'alter table public.references disable trigger trg_references_immutable';
  end if;
end $$;

alter table if exists public.references add column if not exists from_user_id uuid;
alter table if exists public.references add column if not exists to_user_id uuid;
alter table if exists public.references add column if not exists text text;
alter table if exists public.references add column if not exists rating int;
alter table if exists public.references add column if not exists context_tag text;
alter table if exists public.references add column if not exists created_at timestamptz default now();
-- Legacy compatibility columns (only if missing).
alter table if exists public.references add column if not exists author_id uuid;
alter table if exists public.references add column if not exists recipient_id uuid;
alter table if exists public.references add column if not exists body text;
alter table if exists public.references add column if not exists context text;
alter table if exists public.references add column if not exists entity_type text;
alter table if exists public.references add column if not exists sentiment text;

-- Ensure canonical rating is integer across heterogeneous legacy schemas.
do $$
declare
  v_rating_data_type text;
  v_source_column text;
begin
  if to_regclass('public.references') is null then
    return;
  end if;

  select c.data_type
    into v_rating_data_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'references'
    and c.column_name = 'rating';

  if v_rating_data_type is null then
    execute 'alter table public.references add column rating int';
  elsif v_rating_data_type <> 'integer' then
    -- Avoid in-place type rewrites because legacy schemas may have text-only
    -- constraints such as lower(rating) that fail during cast recreation.
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'references'
        and column_name = 'rating_legacy_text'
    ) then
      execute 'alter table public.references rename column rating to rating_legacy_text_migrated';
      v_source_column := 'rating_legacy_text_migrated';
    else
      execute 'alter table public.references rename column rating to rating_legacy_text';
      v_source_column := 'rating_legacy_text';
    end if;

    execute 'alter table public.references add column if not exists rating int';

    execute format(
      $sql$
        update public.references
        set rating = case
          when nullif(trim(%1$I::text), '') is null then null
          when %1$I::text ~* '^\s*positive\s*$' then 5
          when %1$I::text ~* '^\s*neutral\s*$' then 3
          when %1$I::text ~* '^\s*negative\s*$' then 1
          when trim(%1$I::text) ~ '^-?[0-9]+(\.[0-9]+)?$' then
            least(5, greatest(1, round((%1$I::text)::numeric)::int))
          else null
        end
        where rating is null
      $sql$,
      v_source_column
    );
  end if;
end $$;

-- Backfill canonical actor columns.
update public.references
set from_user_id = coalesce(from_user_id, author_id)
where from_user_id is null and author_id is not null;

update public.references
set to_user_id = coalesce(to_user_id, recipient_id)
where to_user_id is null and recipient_id is not null;

-- Backfill canonical text.
update public.references r
set text = coalesce(
  nullif(trim(r.text), ''),
  nullif(trim(coalesce(to_jsonb(r)->>'body', '')), ''),
  nullif(trim(coalesce(to_jsonb(r)->>'content', '')), ''),
  nullif(trim(coalesce(to_jsonb(r)->>'feedback', '')), ''),
  nullif(trim(coalesce(to_jsonb(r)->>'comment', '')), ''),
  nullif(trim(coalesce(to_jsonb(r)->>'reference_text', '')), '')
)
where r.text is null or trim(coalesce(r.text, '')) = '';

-- Backfill numeric rating from sentiment when missing.
update public.references r
set rating = case lower(coalesce(nullif(trim(coalesce(to_jsonb(r)->>'sentiment', '')), ''), ''))
  when 'positive' then 5
  when 'neutral' then 3
  when 'negative' then 1
  else null
end
where r.rating is null;

-- Normalize and backfill context_tag from any legacy context/entity hints.
update public.references r
set context_tag = case
  when r.context_tag in ('practice','event','host','guest','travel','festival','collaboration') then r.context_tag
  when lower(coalesce(r.context_tag, '')) like '%host%' then 'host'
  when lower(coalesce(r.context_tag, '')) like '%guest%' then 'guest'
  when lower(coalesce(
      nullif(trim(coalesce(to_jsonb(r)->>'context', '')), ''),
      nullif(trim(coalesce(to_jsonb(r)->>'entity_type', '')), ''),
      ''
    )) like '%host%' then 'host'
  when lower(coalesce(
      nullif(trim(coalesce(to_jsonb(r)->>'context', '')), ''),
      nullif(trim(coalesce(to_jsonb(r)->>'entity_type', '')), ''),
      ''
    )) like '%guest%' then 'guest'
  when lower(coalesce(
      nullif(trim(coalesce(to_jsonb(r)->>'context', '')), ''),
      nullif(trim(coalesce(to_jsonb(r)->>'entity_type', '')), ''),
      ''
    )) like '%festival%' then 'festival'
  when lower(coalesce(
      nullif(trim(coalesce(to_jsonb(r)->>'context', '')), ''),
      nullif(trim(coalesce(to_jsonb(r)->>'entity_type', '')), ''),
      ''
    )) like '%event%' then 'event'
  when lower(coalesce(
      nullif(trim(coalesce(to_jsonb(r)->>'context', '')), ''),
      nullif(trim(coalesce(to_jsonb(r)->>'entity_type', '')), ''),
      ''
    )) like '%trip%' then 'travel'
  when lower(coalesce(
      nullif(trim(coalesce(to_jsonb(r)->>'context', '')), ''),
      nullif(trim(coalesce(to_jsonb(r)->>'entity_type', '')), ''),
      ''
    )) like '%travel%' then 'travel'
  when lower(coalesce(
      nullif(trim(coalesce(to_jsonb(r)->>'context', '')), ''),
      nullif(trim(coalesce(to_jsonb(r)->>'entity_type', '')), ''),
      ''
    )) like '%sync%' then 'practice'
  when lower(coalesce(
      nullif(trim(coalesce(to_jsonb(r)->>'context', '')), ''),
      nullif(trim(coalesce(to_jsonb(r)->>'entity_type', '')), ''),
      ''
    )) like '%practice%' then 'practice'
  when lower(coalesce(
      nullif(trim(coalesce(to_jsonb(r)->>'context', '')), ''),
      nullif(trim(coalesce(to_jsonb(r)->>'entity_type', '')), ''),
      ''
    )) like '%collab%' then 'collaboration'
  when lower(coalesce(
      nullif(trim(coalesce(to_jsonb(r)->>'context', '')), ''),
      nullif(trim(coalesce(to_jsonb(r)->>'entity_type', '')), ''),
      ''
    )) like '%connection%' then 'collaboration'
  else 'collaboration'
end
where r.context_tag is null
   or r.context_tag not in ('practice','event','host','guest','travel','festival','collaboration');

-- Keep legacy aliases aligned from canonical fields when possible.
update public.references
set author_id = coalesce(author_id, from_user_id)
where author_id is null and from_user_id is not null;

update public.references
set recipient_id = coalesce(recipient_id, to_user_id)
where recipient_id is null and to_user_id is not null;

update public.references
set body = coalesce(body, text)
where body is null and text is not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'references_context_tag_allowed_chk'
      and conrelid = 'public.references'::regclass
  ) then
    alter table public.references drop constraint references_context_tag_allowed_chk;
  end if;

  alter table public.references
    add constraint references_context_tag_allowed_chk
    check (context_tag in ('practice','event','host','guest','travel','festival','collaboration'));
exception when undefined_table then
  null;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'references_rating_range_chk'
      and conrelid = 'public.references'::regclass
  ) then
    alter table public.references drop constraint references_rating_range_chk;
  end if;

  alter table public.references
    add constraint references_rating_range_chk
    check (rating is null or (rating >= 1 and rating <= 5));
exception when undefined_table then
  null;
end $$;

-- Helpful indexes for profile/network breakdown by context.
create index if not exists idx_references_to_user_context_created
  on public.references(to_user_id, context_tag, created_at desc);

create index if not exists idx_references_from_user_context_created
  on public.references(from_user_id, context_tag, created_at desc);

create index if not exists idx_references_context_tag
  on public.references(context_tag);

-- Re-enable immutable/guard triggers after backfill.
do $$
begin
  if to_regclass('public.references') is null then
    return;
  end if;

  if exists (
    select 1
    from pg_trigger t
    where t.tgname = 'trg_references_guardrails'
      and t.tgrelid = 'public.references'::regclass
  ) then
    execute 'alter table public.references enable trigger trg_references_guardrails';
  end if;

  if exists (
    select 1
    from pg_trigger t
    where t.tgname = 'trg_references_immutable'
      and t.tgrelid = 'public.references'::regclass
  ) then
    execute 'alter table public.references enable trigger trg_references_immutable';
  end if;
end $$;

commit;
