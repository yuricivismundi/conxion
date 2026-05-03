-- Separate groups from events: dedicated groups + group_members tables + thread support

begin;

-- ── 1. groups table ──────────────────────────────────────────────────────────
create table if not exists public.groups (
  id              uuid        primary key default gen_random_uuid(),
  host_user_id    uuid        not null references auth.users(id) on delete cascade,
  title           text        not null check (char_length(trim(title)) between 1 and 120),
  description     text,
  chat_mode       text        not null default 'discussion'
                              check (chat_mode in ('broadcast', 'discussion')),
  city            text,
  country         text,
  cover_url       text,
  cover_status    text        not null default 'approved'
                              check (cover_status in ('pending', 'approved', 'rejected')),
  max_members     integer     not null default 25 check (max_members between 1 and 25),
  invite_token    text        unique default replace(gen_random_uuid()::text, '-', ''),
  status          text        not null default 'active'
                              check (status in ('active', 'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_groups_host on public.groups(host_user_id);
create index if not exists idx_groups_status on public.groups(status);

-- updated_at trigger
create or replace function public.groups_set_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_groups_updated_at on public.groups;
create trigger trg_groups_updated_at
  before update on public.groups
  for each row execute function public.groups_set_updated_at();

-- ── 2. group_members table ───────────────────────────────────────────────────
create table if not exists public.group_members (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.groups(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  role        text        not null default 'member' check (role in ('host', 'member')),
  joined_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (group_id, user_id)
);

create index if not exists idx_group_members_group  on public.group_members(group_id);
create index if not exists idx_group_members_user   on public.group_members(user_id);

-- ── 3. Add group_id to threads ───────────────────────────────────────────────
alter table public.threads add column if not exists group_id uuid
  references public.groups(id) on delete cascade;

create unique index if not exists ux_threads_group
  on public.threads(group_id) where group_id is not null;

-- Expand thread_type check to include 'group'
alter table public.threads drop constraint if exists threads_type_chk;
alter table public.threads
  add constraint threads_type_chk
  check (thread_type in ('connection', 'trip', 'direct', 'event', 'group')) not valid;

-- ── 4. cx_ensure_group_thread ────────────────────────────────────────────────
create or replace function public.cx_ensure_group_thread(
  p_group_id uuid,
  p_actor    uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_thread_id uuid;
  v_owner     uuid;
begin
  if p_group_id is null then
    raise exception 'group_required';
  end if;

  select host_user_id into v_owner from public.groups where id = p_group_id limit 1;
  if v_owner is null then
    raise exception 'group_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext('cx_group:' || p_group_id::text)::bigint);

  select id into v_thread_id
  from public.threads
  where thread_type = 'group' and group_id = p_group_id
  order by created_at asc
  limit 1;

  if v_thread_id is null then
    insert into public.threads (thread_type, group_id, created_by, last_message_at)
    values ('group', p_group_id, coalesce(p_actor, v_owner), now())
    returning id into v_thread_id;
  end if;

  insert into public.thread_participants (thread_id, user_id, role)
  values (v_thread_id, v_owner, 'owner')
  on conflict (thread_id, user_id) do nothing;

  if p_actor is not null and p_actor <> v_owner then
    insert into public.thread_participants (thread_id, user_id, role)
    values (v_thread_id, p_actor, 'member')
    on conflict (thread_id, user_id) do nothing;
  end if;

  return v_thread_id;
end;
$function$;

grant execute on function public.cx_ensure_group_thread(uuid, uuid) to authenticated;

-- ── 5. RLS ───────────────────────────────────────────────────────────────────
alter table public.groups      enable row level security;
alter table public.group_members enable row level security;

-- groups: members can read; host can modify
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select
  using (
    host_user_id = auth.uid()
    or exists (
      select 1 from public.group_members gm
      where gm.group_id = id and gm.user_id = auth.uid()
    )
  );

drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups for insert
  with check (host_user_id = auth.uid());

drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update
  using (host_user_id = auth.uid());

drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups for delete
  using (host_user_id = auth.uid());

-- group_members: members can see their group's members
drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members for select
  using (
    exists (
      select 1 from public.group_members gm2
      where gm2.group_id = group_id and gm2.user_id = auth.uid()
    )
    or exists (
      select 1 from public.groups g
      where g.id = group_id and g.host_user_id = auth.uid()
    )
  );

drop policy if exists group_members_insert on public.group_members;
create policy group_members_insert on public.group_members for insert
  with check (
    -- host can add anyone; members can add themselves
    exists (select 1 from public.groups g where g.id = group_id and g.host_user_id = auth.uid())
    or user_id = auth.uid()
  );

drop policy if exists group_members_delete on public.group_members;
create policy group_members_delete on public.group_members for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from public.groups g where g.id = group_id and g.host_user_id = auth.uid())
  );

commit;
