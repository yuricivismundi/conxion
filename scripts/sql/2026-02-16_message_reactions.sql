-- ConXion Messages: server-synced message reactions
-- Date: 2026-02-16
-- Safe to re-run.

begin;

create extension if not exists pgcrypto;

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id text not null,
  thread_kind text not null,
  thread_id uuid not null,
  reactor_id uuid not null,
  emoji text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'message_reactions_thread_kind_chk'
      and conrelid = 'public.message_reactions'::regclass
  ) then
    alter table public.message_reactions
      add constraint message_reactions_thread_kind_chk
      check (thread_kind in ('connection', 'trip'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'message_reactions_emoji_len_chk'
      and conrelid = 'public.message_reactions'::regclass
  ) then
    alter table public.message_reactions
      add constraint message_reactions_emoji_len_chk
      check (char_length(emoji) between 1 and 16);
  end if;
end $$;

create unique index if not exists ux_message_reactions_unique
  on public.message_reactions(thread_kind, thread_id, message_id, reactor_id, emoji);

create index if not exists idx_message_reactions_thread
  on public.message_reactions(thread_kind, thread_id, created_at desc);

create index if not exists idx_message_reactions_message
  on public.message_reactions(message_id, created_at desc);

alter table public.message_reactions enable row level security;

drop policy if exists message_reactions_select_participant on public.message_reactions;
create policy message_reactions_select_participant
on public.message_reactions for select
to authenticated
using (
  (
    thread_kind = 'connection'
    and exists (
      select 1
      from public.connections c
      where c.id = message_reactions.thread_id
        and c.status = 'accepted'
        and c.blocked_by is null
        and (c.requester_id = auth.uid() or c.target_id = auth.uid())
    )
  )
  or
  (
    thread_kind = 'trip'
    and exists (
      select 1
      from public.thread_participants tp
      join public.threads t on t.id = tp.thread_id
      where t.id = message_reactions.thread_id
        and t.thread_type = 'trip'
        and tp.user_id = auth.uid()
    )
  )
);

drop policy if exists message_reactions_insert_participant on public.message_reactions;
create policy message_reactions_insert_participant
on public.message_reactions for insert
to authenticated
with check (
  reactor_id = auth.uid()
  and (
    (
      thread_kind = 'connection'
      and exists (
        select 1
        from public.connections c
        where c.id = message_reactions.thread_id
          and c.status = 'accepted'
          and c.blocked_by is null
          and (c.requester_id = auth.uid() or c.target_id = auth.uid())
      )
    )
    or
    (
      thread_kind = 'trip'
      and exists (
        select 1
        from public.thread_participants tp
        join public.threads t on t.id = tp.thread_id
        where t.id = message_reactions.thread_id
          and t.thread_type = 'trip'
          and tp.user_id = auth.uid()
      )
    )
  )
);

drop policy if exists message_reactions_delete_owner on public.message_reactions;
create policy message_reactions_delete_owner
on public.message_reactions for delete
to authenticated
using (reactor_id = auth.uid());

grant select, insert, delete on public.message_reactions to authenticated;

commit;
