-- ConXion references + moderation + API guard hardening
-- Date: 2026-02-11
--
-- Covers:
-- 2) References MVP lifecycle (sync -> reference allowed -> immutable after 15 days)
-- 3) Moderation audit trail (moderation_logs + protected report moderation path)
-- 4) Thin APIs backed by DB RPC guards (block/unblock/report actions)

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- Admin helper
-- =========================================================

create or replace function public.is_app_admin(p_user_id uuid)
returns boolean
language plpgsql
stable
set search_path = public
as $function$
declare
  v_is_admin bool := false;
begin
  if p_user_id is null then
    return false;
  end if;

  if to_regclass('public.admins') is null then
    return false;
  end if;

  begin
    execute 'select exists (select 1 from public.admins a where a.user_id = $1)' into v_is_admin using p_user_id;
  exception
    when undefined_column then
      v_is_admin := false;
  end;

  return coalesce(v_is_admin, false);
end;
$function$;

-- =========================================================
-- Sync completion state
-- =========================================================

create table if not exists public.syncs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  completed_by uuid not null,
  completed_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  unique (connection_id, completed_by)
);

-- Backward-compatible upgrades when syncs already exists with older shape.
alter table public.syncs add column if not exists completed_by uuid;
alter table public.syncs add column if not exists completed_at timestamptz default now();
alter table public.syncs add column if not exists note text;
alter table public.syncs add column if not exists created_at timestamptz default now();

do $$
begin
  -- Backfill from common legacy column names when present.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'syncs' and column_name = 'user_id'
  ) then
    execute 'update public.syncs set completed_by = user_id where completed_by is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'syncs' and column_name = 'created_by'
  ) then
    execute 'update public.syncs set completed_by = created_by where completed_by is null';
  end if;
end $$;

create unique index if not exists ux_syncs_connection_completed_by
  on public.syncs(connection_id, completed_by)
  where completed_by is not null;

create index if not exists idx_syncs_connection_id on public.syncs(connection_id);
create index if not exists idx_syncs_completed_by on public.syncs(completed_by);

alter table public.syncs enable row level security;

drop policy if exists syncs_select_participants on public.syncs;
create policy syncs_select_participants
on public.syncs for select
to authenticated
using (
  completed_by = auth.uid()
  or exists (
    select 1
    from public.connections c
    where c.id = syncs.connection_id
      and (c.requester_id = auth.uid() or c.target_id = auth.uid())
  )
);

drop policy if exists syncs_insert_owner on public.syncs;
create policy syncs_insert_owner
on public.syncs for insert
to authenticated
with check (completed_by = auth.uid());

create or replace function public.mark_sync_completed(
  p_connection_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_ok bool := false;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select exists (
    select 1
    from public.connections c
    where c.id = p_connection_id
      and c.status = 'accepted'
      and c.blocked_by is null
      and (c.requester_id = v_me or c.target_id = v_me)
  ) into v_ok;

  if not v_ok then
    raise exception 'connection_not_eligible_for_sync';
  end if;

  insert into public.syncs(connection_id, completed_by, note)
  values (p_connection_id, v_me, nullif(trim(p_note), ''))
  on conflict (connection_id, completed_by)
  do update
    set completed_at = now(),
        note = excluded.note
  returning id into v_id;

  return v_id;
end;
$function$;

grant execute on function public.mark_sync_completed(uuid, text) to authenticated;

-- =========================================================
-- References lifecycle
-- =========================================================

create table if not exists public.references (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  author_id uuid not null,
  recipient_id uuid not null,
  context text not null default 'connection',
  sentiment text not null check (sentiment in ('positive', 'neutral', 'negative')),
  body text not null check (char_length(trim(body)) between 8 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint references_author_recipient_diff check (author_id <> recipient_id),
  constraint references_unique_pair_per_connection unique (connection_id, author_id, recipient_id)
);

-- Backward-compatible upgrades when references already exists with older shape.
alter table public.references add column if not exists connection_id uuid;
alter table public.references add column if not exists author_id uuid;
alter table public.references add column if not exists recipient_id uuid;
alter table public.references add column if not exists context text default 'connection';
alter table public.references add column if not exists sentiment text;
alter table public.references add column if not exists body text;
alter table public.references add column if not exists created_at timestamptz default now();
alter table public.references add column if not exists updated_at timestamptz default now();

do $$
begin
  -- Backfill from common legacy column names when present.
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
    where table_schema = 'public' and table_name = 'references' and column_name = 'to_user_id'
  ) then
    execute 'update public.references set recipient_id = to_user_id where recipient_id is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'references' and column_name = 'content'
  ) then
    execute 'update public.references set body = content where body is null';
  end if;
end $$;

create index if not exists idx_references_connection_id on public.references(connection_id);
create index if not exists idx_references_author_id on public.references(author_id);
create index if not exists idx_references_recipient_id on public.references(recipient_id);
create index if not exists idx_references_created_at on public.references(created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'references_connection_fk'
      and conrelid = 'public.references'::regclass
  ) then
    alter table public.references
      add constraint references_connection_fk
      foreign key (connection_id) references public.connections(id) on delete cascade;
  end if;
exception
  when undefined_column then
    null;
end $$;

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

create or replace function public.set_reference_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists trg_references_set_updated_at on public.references;
create trigger trg_references_set_updated_at
before update on public.references
for each row execute function public.set_reference_updated_at();

create or replace function public.enforce_reference_immutability()
returns trigger
language plpgsql
as $function$
begin
  if old.created_at < now() - interval '15 days' then
    raise exception 'references_immutable_after_15_days';
  end if;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists trg_references_immutable on public.references;
create trigger trg_references_immutable
before update or delete on public.references
for each row execute function public.enforce_reference_immutability();

create or replace function public.create_reference(
  p_connection_id uuid,
  p_recipient_id uuid,
  p_sentiment text,
  p_body text,
  p_context text default 'connection'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_connection record;
  v_sync_exists bool := false;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_recipient_id = v_me then
    raise exception 'cannot_reference_self';
  end if;

  if p_sentiment not in ('positive', 'neutral', 'negative') then
    raise exception 'invalid_sentiment';
  end if;

  if length(trim(coalesce(p_body, ''))) < 8 then
    raise exception 'reference_body_too_short';
  end if;

  select c.*
    into v_connection
  from public.connections c
  where c.id = p_connection_id
    and c.status = 'accepted'
    and c.blocked_by is null
    and (c.requester_id = v_me or c.target_id = v_me)
  limit 1;

  if v_connection is null then
    raise exception 'connection_not_eligible_for_reference';
  end if;

  if not (
    (v_connection.requester_id = v_me and v_connection.target_id = p_recipient_id)
    or
    (v_connection.target_id = v_me and v_connection.requester_id = p_recipient_id)
  ) then
    raise exception 'recipient_not_in_connection';
  end if;

  select exists (
    select 1
    from public.syncs s
    where s.connection_id = p_connection_id
  ) into v_sync_exists;

  if not v_sync_exists then
    raise exception 'references_require_completed_sync';
  end if;

  insert into public.references (
    connection_id,
    author_id,
    recipient_id,
    context,
    sentiment,
    body
  )
  values (
    p_connection_id,
    v_me,
    p_recipient_id,
    coalesce(nullif(trim(p_context), ''), 'connection'),
    p_sentiment,
    trim(p_body)
  )
  returning id into v_id;

  return v_id;
end;
$function$;

grant execute on function public.create_reference(uuid, uuid, text, text, text) to authenticated;

-- =========================================================
-- Moderation audit trail
-- =========================================================

create table if not exists public.moderation_logs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid,
  actor_id uuid not null,
  target_user_id uuid,
  action text not null,
  reason text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.reports') is not null then
    begin
      alter table public.moderation_logs
        add constraint moderation_logs_report_fk
        foreign key (report_id) references public.reports(id) on delete set null;
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;

create index if not exists idx_moderation_logs_report_id on public.moderation_logs(report_id);
create index if not exists idx_moderation_logs_actor_id on public.moderation_logs(actor_id);
create index if not exists idx_moderation_logs_created_at on public.moderation_logs(created_at desc);

alter table public.moderation_logs enable row level security;

drop policy if exists moderation_logs_select_admin on public.moderation_logs;
create policy moderation_logs_select_admin
on public.moderation_logs for select
to authenticated
using (public.is_app_admin(auth.uid()));

create or replace function public.moderate_report(
  p_report_id uuid,
  p_action text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_report record;
  v_log_id uuid;
  v_next_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if not public.is_app_admin(v_me) then
    raise exception 'not_authorized';
  end if;

  if to_regclass('public.reports') is null then
    raise exception 'reports_table_missing';
  end if;

  if p_action not in ('resolve', 'dismiss', 'reopen') then
    raise exception 'invalid_action';
  end if;

  select r.*
    into v_report
  from public.reports r
  where r.id = p_report_id
  limit 1;

  if v_report is null then
    raise exception 'report_not_found';
  end if;

  v_next_status :=
    case p_action
      when 'resolve' then 'resolved'
      when 'dismiss' then 'dismissed'
      when 'reopen' then 'open'
      else 'open'
    end;

  execute 'update public.reports set status = $1 where id = $2'
    using v_next_status, p_report_id;

  insert into public.moderation_logs (
    report_id,
    actor_id,
    target_user_id,
    action,
    note,
    metadata
  )
  values (
    p_report_id,
    v_me,
    (to_jsonb(v_report)->>'target_user_id')::uuid,
    p_action,
    nullif(trim(p_note), ''),
    jsonb_build_object('from_status', coalesce(to_jsonb(v_report)->>'status', ''))
  )
  returning id into v_log_id;

  return v_log_id;
end;
$function$;

grant execute on function public.moderate_report(uuid, text, text) to authenticated;

-- =========================================================
-- DB-backed guard RPCs for thin API routes
-- =========================================================

create or replace function public.block_connection(
  p_connection_id uuid default null,
  p_target_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_conn_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_connection_id is not null then
    update public.connections c
      set status = 'blocked',
          blocked_by = v_me
    where c.id = p_connection_id
      and (c.requester_id = v_me or c.target_id = v_me)
    returning c.id into v_conn_id;

    if v_conn_id is null then
      raise exception 'connection_not_found_or_not_allowed';
    end if;

    return v_conn_id;
  end if;

  if p_target_user_id is null then
    raise exception 'missing_target_user_id';
  end if;

  if p_target_user_id = v_me then
    raise exception 'cannot_block_self';
  end if;

  insert into public.connections (requester_id, target_id, status, blocked_by)
  values (v_me, p_target_user_id, 'blocked', v_me)
  on conflict do nothing;

  select c.id
    into v_conn_id
  from public.connections c
  where ((c.requester_id = v_me and c.target_id = p_target_user_id)
      or (c.requester_id = p_target_user_id and c.target_id = v_me))
  limit 1;

  if v_conn_id is null then
    raise exception 'failed_to_block';
  end if;

  update public.connections
    set status = 'blocked',
        blocked_by = v_me
  where id = v_conn_id;

  return v_conn_id;
end;
$function$;

create or replace function public.undo_decline_connection_request(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  update public.connections c
  set status = 'pending'
  where c.id = p_connection_id
    and c.target_id = v_me
    and c.status = 'declined';

  if not found then
    raise exception 'not_found_or_not_allowed';
  end if;
end;
$function$;

create or replace function public.unblock_connection(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  update public.connections c
  set blocked_by = null,
      status = case when c.status = 'blocked' then 'accepted' else c.status end
  where c.id = p_connection_id
    and c.blocked_by = v_me;

  if not found then
    raise exception 'not_found_or_not_allowed';
  end if;
end;
$function$;

create or replace function public.create_report(
  p_connection_id uuid default null,
  p_target_user_id uuid default null,
  p_context text default 'connection',
  p_context_id text default null,
  p_reason text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_target uuid;
  v_report_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if to_regclass('public.reports') is null then
    raise exception 'reports_table_missing';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'report_reason_required';
  end if;

  if p_target_user_id is not null then
    v_target := p_target_user_id;
  elsif p_connection_id is not null then
    select case when c.requester_id = v_me then c.target_id else c.requester_id end
      into v_target
    from public.connections c
    where c.id = p_connection_id
      and (c.requester_id = v_me or c.target_id = v_me)
    limit 1;
  else
    raise exception 'missing_target';
  end if;

  if v_target is null then
    raise exception 'target_not_found_or_not_allowed';
  end if;

  if v_target = v_me then
    raise exception 'cannot_report_self';
  end if;

  insert into public.reports (
    reporter_id,
    target_user_id,
    context,
    context_id,
    reason,
    note,
    status
  )
  values (
    v_me,
    v_target,
    coalesce(nullif(trim(p_context), ''), 'connection'),
    coalesce(nullif(trim(p_context_id), ''), p_connection_id::text),
    trim(p_reason),
    nullif(trim(p_note), ''),
    'open'
  )
  returning id into v_report_id;

  return v_report_id;
end;
$function$;

grant execute on function public.block_connection(uuid, uuid) to authenticated;
grant execute on function public.undo_decline_connection_request(uuid) to authenticated;
grant execute on function public.unblock_connection(uuid) to authenticated;
grant execute on function public.create_report(uuid, uuid, text, text, text, text) to authenticated;

commit;
