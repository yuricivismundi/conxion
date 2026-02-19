-- ConXion notifications hardening for deterministic e2e and production parity
-- Date: 2026-02-19
-- Idempotent: safe to run multiple times

begin;

create extension if not exists pgcrypto;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  actor_id uuid,
  kind text not null,
  title text not null,
  body text,
  link_url text,
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.notifications add column if not exists user_id uuid;
alter table public.notifications add column if not exists actor_id uuid;
alter table public.notifications add column if not exists kind text;
alter table public.notifications add column if not exists title text;
alter table public.notifications add column if not exists body text;
alter table public.notifications add column if not exists link_url text;
alter table public.notifications add column if not exists metadata jsonb;
alter table public.notifications add column if not exists is_read boolean;
alter table public.notifications add column if not exists created_at timestamptz;
alter table public.notifications add column if not exists read_at timestamptz;

update public.notifications
set metadata = '{}'::jsonb
where metadata is null;

update public.notifications
set is_read = false
where is_read is null;

update public.notifications
set created_at = now()
where created_at is null;

alter table public.notifications
  alter column metadata set default '{}'::jsonb;
alter table public.notifications
  alter column metadata set not null;
alter table public.notifications
  alter column is_read set default false;
alter table public.notifications
  alter column is_read set not null;
alter table public.notifications
  alter column created_at set default now();
alter table public.notifications
  alter column created_at set not null;

create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_user_unread
  on public.notifications(user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
on public.notifications for select
to authenticated
using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
on public.notifications for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.create_notification(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text default null,
  p_link_url text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_user_id is null then
    raise exception 'notification_user_required';
  end if;

  if trim(coalesce(p_kind, '')) = '' then
    raise exception 'notification_kind_required';
  end if;

  if trim(coalesce(p_title, '')) = '' then
    raise exception 'notification_title_required';
  end if;

  insert into public.notifications (
    user_id,
    actor_id,
    kind,
    title,
    body,
    link_url,
    metadata
  )
  values (
    p_user_id,
    auth.uid(),
    trim(p_kind),
    trim(p_title),
    nullif(trim(coalesce(p_body, '')), ''),
    nullif(trim(coalesce(p_link_url, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$function$;

grant execute on function public.create_notification(uuid, text, text, text, text, jsonb) to authenticated;

commit;
