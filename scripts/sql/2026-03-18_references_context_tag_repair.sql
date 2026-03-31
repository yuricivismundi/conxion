-- ConXion References Context Tag Repair
-- Date: 2026-03-18
--
-- Purpose:
--   Reclassify existing references.context_tag values that were previously
--   normalized to 'collaboration' even when legacy context/entity fields
--   indicate practice/travel/event/festival/host/guest.
--
-- Safe:
--   - Idempotent
--   - Keeps 'collaboration' where no stronger context is detectable.

begin;

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

update public.references r
set context_tag = case
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
where coalesce(r.context_tag, '') in ('', 'collaboration');

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
