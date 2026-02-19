-- ConXion References Compatibility Bridge
-- Date: 2026-02-18
--
-- Purpose:
-- 1) Normalize legacy references schemas into canonical columns used by app/API/e2e.
-- 2) Backfill canonical values from common legacy aliases.
-- 3) Enforce one reference per (author, entity) after deduping old rows.

begin;

create extension if not exists pgcrypto;

alter table if exists public.references add column if not exists connection_id uuid;
alter table if exists public.references add column if not exists author_id uuid;
alter table if exists public.references add column if not exists recipient_id uuid;
alter table if exists public.references add column if not exists context text default 'connection';
alter table if exists public.references add column if not exists sentiment text;
alter table if exists public.references add column if not exists body text;
alter table if exists public.references add column if not exists created_at timestamptz default now();
alter table if exists public.references add column if not exists updated_at timestamptz default now();
alter table if exists public.references add column if not exists entity_type text default 'connection';
alter table if exists public.references add column if not exists entity_id uuid;
alter table if exists public.references add column if not exists reply_text text;
alter table if exists public.references add column if not exists replied_by uuid;
alter table if exists public.references add column if not exists replied_at timestamptz;
alter table if exists public.references add column if not exists edit_count int not null default 0;
alter table if exists public.references add column if not exists last_edited_at timestamptz;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'connection_request_id'
  ) then
    execute 'update public.references set connection_id = connection_request_id where connection_id is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'from_user_id'
  ) then
    execute 'update public.references set author_id = from_user_id where author_id is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'source_id'
  ) then
    execute 'update public.references set author_id = source_id where author_id is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'to_user_id'
  ) then
    execute 'update public.references set recipient_id = to_user_id where recipient_id is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'target_id'
  ) then
    execute 'update public.references set recipient_id = target_id where recipient_id is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'content'
  ) then
    execute 'update public.references set body = content where body is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'feedback'
  ) then
    execute 'update public.references set body = feedback where body is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'comment'
  ) then
    execute 'update public.references set body = comment where body is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'reference_text'
  ) then
    execute 'update public.references set body = reference_text where body is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'sync_id'
  ) then
    execute '
      update public.references
      set entity_type = coalesce(nullif(entity_type, ''''), ''sync''),
          entity_id = coalesce(entity_id, sync_id)
      where sync_id is not null
    ';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'reply'
  ) then
    execute 'update public.references set reply_text = reply where reply_text is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'response_text'
  ) then
    execute 'update public.references set reply_text = response_text where reply_text is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'reply_body'
  ) then
    execute 'update public.references set reply_text = reply_body where reply_text is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'responder_id'
  ) then
    execute 'update public.references set replied_by = responder_id where replied_by is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'reply_at'
  ) then
    execute 'update public.references set replied_at = reply_at where replied_at is null';
  end if;
end $$;

update public.references
set context = coalesce(nullif(trim(context), ''), 'connection');

update public.references
set entity_type = coalesce(nullif(trim(entity_type), ''), coalesce(nullif(trim(context), ''), 'connection'));

update public.references
set sentiment = lower(trim(sentiment))
where sentiment is not null;

update public.references
set sentiment = 'neutral'
where sentiment is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'rating'
  ) then
    execute $sql$
      update public.references
      set sentiment = case
        when sentiment in ('positive','neutral','negative') then sentiment
        when lower(nullif(trim(rating::text), '')) in ('positive','neutral','negative') then lower(trim(rating::text))
        when trim(rating::text) ~ '^-?[0-9]+(\.[0-9]+)?$' then
          case
            when (rating::text)::numeric >= 4 then 'positive'
            when (rating::text)::numeric <= 2 then 'negative'
            else 'neutral'
          end
        else 'neutral'
      end
      where sentiment is null or sentiment not in ('positive','neutral','negative')
    $sql$;
  end if;
end $$;

update public.references
set edit_count = 0
where edit_count is null;

-- Keep only newest row for each author+entity before creating unique index.
with ranked as (
  select ctid,
         row_number() over (
           partition by entity_type, entity_id, author_id
           order by created_at desc nulls last, id desc
         ) as rn
  from public.references
  where entity_type is not null
    and entity_id is not null
    and author_id is not null
)
delete from public.references r
using ranked d
where r.ctid = d.ctid
  and d.rn > 1;

create index if not exists idx_references_connection_id on public.references(connection_id);
create index if not exists idx_references_author_id on public.references(author_id);
create index if not exists idx_references_recipient_id on public.references(recipient_id);
create index if not exists idx_references_entity on public.references(entity_type, entity_id);

create unique index if not exists ux_references_entity_author
  on public.references(entity_type, entity_id, author_id)
  where entity_type is not null and entity_id is not null and author_id is not null;

alter table public.references enable row level security;

drop policy if exists references_select_participants on public.references;
create policy references_select_participants
on public.references for select
to authenticated
using (
  author_id = auth.uid()
  or recipient_id = auth.uid()
  or exists (
    select 1
    from public.connections c
    where c.id = "references".connection_id
      and (c.requester_id = auth.uid() or c.target_id = auth.uid())
  )
);

drop policy if exists references_insert_author on public.references;
create policy references_insert_author
on public.references for insert
to authenticated
with check (author_id = auth.uid());

commit;
