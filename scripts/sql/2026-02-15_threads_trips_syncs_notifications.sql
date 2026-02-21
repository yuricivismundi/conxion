-- ConXion Core MVP Completion: Threads, Trips Requests, Sync Lifecycle, Notifications, References v2
-- Date: 2026-02-15
--
-- This patch is idempotent and designed to coexist with existing
-- connections/messages/events/references schema.

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- Shared helper
-- =========================================================

create or replace function public.set_updated_at_ts()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- =========================================================
-- Notifications
-- =========================================================

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
alter table public.notifications add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.notifications add column if not exists is_read boolean not null default false;
alter table public.notifications add column if not exists created_at timestamptz not null default now();
alter table public.notifications add column if not exists read_at timestamptz;

create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_user_unread on public.notifications(user_id, is_read, created_at desc);

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

-- =========================================================
-- Threads + Participants + Thread Messages
-- =========================================================

create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  thread_type text not null,
  connection_id uuid references public.connections(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz
);

alter table public.threads drop constraint if exists threads_type_chk;
alter table public.threads
  add constraint threads_type_chk
  check (thread_type in ('connection', 'trip')) not valid;

create unique index if not exists ux_threads_connection on public.threads(connection_id) where connection_id is not null;
create unique index if not exists ux_threads_trip on public.threads(trip_id) where trip_id is not null;
drop index if exists ux_threads_event;
create index if not exists idx_threads_last_message_at on public.threads(last_message_at desc nulls last, created_at desc);

drop trigger if exists trg_threads_set_updated_at on public.threads;
create trigger trg_threads_set_updated_at
before update on public.threads
for each row execute function public.set_updated_at_ts();

create table if not exists public.thread_participants (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  archived_at timestamptz,
  muted_until timestamptz,
  pinned_at timestamptz,
  unique (thread_id, user_id)
);

alter table public.thread_participants add column if not exists archived_at timestamptz;
alter table public.thread_participants add column if not exists muted_until timestamptz;
alter table public.thread_participants add column if not exists pinned_at timestamptz;

create index if not exists idx_thread_participants_user on public.thread_participants(user_id, thread_id);
create index if not exists idx_thread_participants_thread on public.thread_participants(thread_id, user_id);
create index if not exists idx_thread_participants_user_archived on public.thread_participants(user_id, archived_at);
create index if not exists idx_thread_participants_user_muted on public.thread_participants(user_id, muted_until);
create index if not exists idx_thread_participants_user_pinned on public.thread_participants(user_id, pinned_at);

create table if not exists public.thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  sender_id uuid not null,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists idx_thread_messages_thread_created on public.thread_messages(thread_id, created_at asc);
create index if not exists idx_thread_messages_sender_created on public.thread_messages(sender_id, created_at desc);

create table if not exists public.message_limits (
  user_id uuid not null,
  date_key date not null,
  sent_count int not null default 0,
  primary key (user_id, date_key)
);

create or replace function public.bump_thread_message_daily_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count int := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if new.sender_id is distinct from auth.uid() then
    raise exception 'sender_mismatch';
  end if;

  insert into public.message_limits(user_id, date_key, sent_count)
  values (new.sender_id, current_date, 1)
  on conflict (user_id, date_key)
  do update set sent_count = public.message_limits.sent_count + 1
  returning sent_count into v_count;

  if v_count > 100 then
    raise exception 'daily_limit_reached';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_thread_messages_daily_limit on public.thread_messages;
create trigger trg_thread_messages_daily_limit
before insert on public.thread_messages
for each row execute function public.bump_thread_message_daily_limit();

create or replace function public.update_thread_last_message_at()
returns trigger
language plpgsql
as $function$
begin
  update public.threads
  set last_message_at = new.created_at,
      updated_at = now()
  where id = new.thread_id;

  return new;
end;
$function$;

drop trigger if exists trg_thread_messages_touch_thread on public.thread_messages;
create trigger trg_thread_messages_touch_thread
after insert on public.thread_messages
for each row execute function public.update_thread_last_message_at();

alter table public.threads enable row level security;
alter table public.thread_participants enable row level security;
alter table public.thread_messages enable row level security;
alter table public.message_limits enable row level security;

drop policy if exists threads_select_participant on public.threads;
create policy threads_select_participant
on public.threads for select
to authenticated
using (
  exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = threads.id
      and tp.user_id = auth.uid()
  )
);

drop policy if exists threads_insert_creator on public.threads;
create policy threads_insert_creator
on public.threads for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists threads_update_creator on public.threads;
create policy threads_update_creator
on public.threads for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists thread_participants_select_thread_members on public.thread_participants;
create policy thread_participants_select_thread_members
on public.thread_participants for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = thread_participants.thread_id
      and tp.user_id = auth.uid()
  )
);

drop policy if exists thread_participants_insert_self_or_creator on public.thread_participants;
create policy thread_participants_insert_self_or_creator
on public.thread_participants for insert
to authenticated
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.threads t
    where t.id = thread_participants.thread_id
      and t.created_by = auth.uid()
  )
);

drop policy if exists thread_participants_update_self on public.thread_participants;
create policy thread_participants_update_self
on public.thread_participants for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists thread_messages_select_participants on public.thread_messages;
create policy thread_messages_select_participants
on public.thread_messages for select
to authenticated
using (
  exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = thread_messages.thread_id
      and tp.user_id = auth.uid()
  )
);

drop policy if exists thread_messages_insert_sender_participant on public.thread_messages;
create policy thread_messages_insert_sender_participant
on public.thread_messages for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = thread_messages.thread_id
      and tp.user_id = auth.uid()
  )
);

drop policy if exists thread_messages_delete_sender on public.thread_messages;
create policy thread_messages_delete_sender
on public.thread_messages for delete
to authenticated
using (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = thread_messages.thread_id
      and tp.user_id = auth.uid()
  )
);

do $$
begin
  if to_regclass('public.messages') is not null then
    alter table public.messages enable row level security;
    drop policy if exists messages_delete_sender on public.messages;
    create policy messages_delete_sender
    on public.messages for delete
    to authenticated
    using (
      sender_id = auth.uid()
      and exists (
        select 1
        from public.connections c
        where c.id = messages.connection_id
          and (c.requester_id = auth.uid() or c.target_id = auth.uid())
      )
    );
  end if;
end $$;

drop policy if exists message_limits_select_own on public.message_limits;
create policy message_limits_select_own
on public.message_limits for select
to authenticated
using (user_id = auth.uid());

-- =========================================================
-- Trip Requests
-- =========================================================

create table if not exists public.trip_requests (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  requester_id uuid not null,
  note text,
  status text not null default 'pending',
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, requester_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trip_requests_status_chk'
      and conrelid = 'public.trip_requests'::regclass
  ) then
    alter table public.trip_requests
      add constraint trip_requests_status_chk
      check (status in ('pending', 'accepted', 'declined', 'cancelled'));
  end if;
end $$;

create index if not exists idx_trip_requests_trip on public.trip_requests(trip_id, status, created_at desc);
create index if not exists idx_trip_requests_requester on public.trip_requests(requester_id, status, created_at desc);

drop trigger if exists trg_trip_requests_set_updated_at on public.trip_requests;
create trigger trg_trip_requests_set_updated_at
before update on public.trip_requests
for each row execute function public.set_updated_at_ts();

alter table public.trip_requests enable row level security;

drop policy if exists trip_requests_select_parties on public.trip_requests;
create policy trip_requests_select_parties
on public.trip_requests for select
to authenticated
using (
  requester_id = auth.uid()
  or exists (
    select 1
    from public.trips t
    where t.id = trip_requests.trip_id
      and t.user_id = auth.uid()
  )
);

drop policy if exists trip_requests_insert_requester on public.trip_requests;
create policy trip_requests_insert_requester
on public.trip_requests for insert
to authenticated
with check (requester_id = auth.uid());

create or replace function public.create_trip_request(
  p_trip_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_trip_owner uuid;
  v_trip_status text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select t.user_id, coalesce(t.status, 'active')
    into v_trip_owner, v_trip_status
  from public.trips t
  where t.id = p_trip_id
  limit 1;

  if v_trip_owner is null then
    raise exception 'trip_not_found';
  end if;

  if v_trip_owner = v_me then
    raise exception 'cannot_request_own_trip';
  end if;

  if v_trip_status <> 'active' then
    raise exception 'trip_not_active';
  end if;

  insert into public.trip_requests (trip_id, requester_id, note, status, decided_by, decided_at)
  values (p_trip_id, v_me, nullif(trim(coalesce(p_note, '')), ''), 'pending', null, null)
  on conflict (trip_id, requester_id)
  do update set
    note = excluded.note,
    status = 'pending',
    decided_by = null,
    decided_at = null,
    updated_at = now()
  returning id into v_id;

  if v_trip_owner <> v_me then
    perform public.create_notification(
      v_trip_owner,
      'trip_request_received',
      'New trip request',
      'You received a new request for your trip.',
      '/trips/' || p_trip_id::text,
      jsonb_build_object('trip_id', p_trip_id, 'requester_id', v_me)
    );
  end if;

  return v_id;
end;
$function$;

grant execute on function public.create_trip_request(uuid, text) to authenticated;

create or replace function public.respond_trip_request(
  p_request_id uuid,
  p_action text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_row record;
  v_thread_id uuid;
  v_next_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_action not in ('accept', 'decline') then
    raise exception 'invalid_action';
  end if;

  select tr.*, t.user_id as owner_id
    into v_row
  from public.trip_requests tr
  join public.trips t on t.id = tr.trip_id
  where tr.id = p_request_id
  limit 1;

  if v_row is null then
    raise exception 'trip_request_not_found';
  end if;

  if v_row.owner_id <> v_me then
    raise exception 'not_authorized';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'trip_request_not_pending';
  end if;

  v_next_status := case when p_action = 'accept' then 'accepted' else 'declined' end;

  update public.trip_requests
  set status = v_next_status,
      decided_by = v_me,
      decided_at = now(),
      updated_at = now()
  where id = p_request_id;

  if p_action = 'accept' then
    insert into public.threads (thread_type, trip_id, created_by, last_message_at)
    values ('trip', v_row.trip_id, v_me, now())
    on conflict (trip_id) do update set updated_at = now()
    returning id into v_thread_id;

    if v_thread_id is null then
      select id into v_thread_id from public.threads where trip_id = v_row.trip_id limit 1;
    end if;

    if v_thread_id is not null then
      insert into public.thread_participants (thread_id, user_id, role)
      values
        (v_thread_id, v_row.owner_id, 'owner'),
        (v_thread_id, v_row.requester_id, 'member')
      on conflict (thread_id, user_id) do nothing;
    end if;
  end if;

  perform public.create_notification(
    v_row.requester_id,
    case when p_action = 'accept' then 'trip_request_accepted' else 'trip_request_declined' end,
    case when p_action = 'accept' then 'Trip request accepted' else 'Trip request declined' end,
    null,
    '/trips/' || v_row.trip_id::text,
    jsonb_build_object('trip_id', v_row.trip_id, 'request_id', p_request_id)
  );

  return v_row.trip_id;
end;
$function$;

grant execute on function public.respond_trip_request(uuid, text) to authenticated;

create or replace function public.cancel_trip_request(
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_row record;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_row
  from public.trip_requests tr
  where tr.id = p_request_id
  limit 1;

  if v_row is null then
    raise exception 'trip_request_not_found';
  end if;

  if v_row.requester_id <> v_me then
    raise exception 'not_authorized';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'trip_request_not_pending';
  end if;

  update public.trip_requests
  set status = 'cancelled',
      updated_at = now()
  where id = p_request_id;

  return v_row.trip_id;
end;
$function$;

grant execute on function public.cancel_trip_request(uuid) to authenticated;

-- =========================================================
-- Sync lifecycle (propose / accept / decline / cancel / complete)
-- =========================================================

create table if not exists public.connection_syncs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  requester_id uuid not null,
  recipient_id uuid not null,
  sync_type text not null,
  scheduled_at timestamptz,
  note text,
  status text not null default 'pending',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'connection_syncs_type_chk'
      and conrelid = 'public.connection_syncs'::regclass
  ) then
    alter table public.connection_syncs
      add constraint connection_syncs_type_chk
      check (sync_type in ('training', 'social_dancing', 'workshop'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'connection_syncs_status_chk'
      and conrelid = 'public.connection_syncs'::regclass
  ) then
    alter table public.connection_syncs
      add constraint connection_syncs_status_chk
      check (status in ('pending', 'accepted', 'declined', 'cancelled', 'completed'));
  end if;
end $$;

create index if not exists idx_connection_syncs_connection on public.connection_syncs(connection_id, created_at desc);
create index if not exists idx_connection_syncs_requester on public.connection_syncs(requester_id, status, created_at desc);
create index if not exists idx_connection_syncs_recipient on public.connection_syncs(recipient_id, status, created_at desc);

drop trigger if exists trg_connection_syncs_set_updated_at on public.connection_syncs;
create trigger trg_connection_syncs_set_updated_at
before update on public.connection_syncs
for each row execute function public.set_updated_at_ts();

alter table public.connection_syncs enable row level security;

drop policy if exists connection_syncs_select_participants on public.connection_syncs;
create policy connection_syncs_select_participants
on public.connection_syncs for select
to authenticated
using (requester_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists connection_syncs_insert_requester on public.connection_syncs;
create policy connection_syncs_insert_requester
on public.connection_syncs for insert
to authenticated
with check (requester_id = auth.uid());

create or replace function public.propose_connection_sync(
  p_connection_id uuid,
  p_sync_type text,
  p_scheduled_at timestamptz default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_conn record;
  v_recipient uuid;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_sync_type not in ('training', 'social_dancing', 'workshop') then
    raise exception 'invalid_sync_type';
  end if;

  select c.*
    into v_conn
  from public.connections c
  where c.id = p_connection_id
    and c.status = 'accepted'
    and c.blocked_by is null
    and (c.requester_id = v_me or c.target_id = v_me)
  limit 1;

  if v_conn is null then
    raise exception 'connection_not_eligible';
  end if;

  v_recipient := case when v_conn.requester_id = v_me then v_conn.target_id else v_conn.requester_id end;

  insert into public.connection_syncs (
    connection_id,
    requester_id,
    recipient_id,
    sync_type,
    scheduled_at,
    note,
    status
  )
  values (
    p_connection_id,
    v_me,
    v_recipient,
    p_sync_type,
    p_scheduled_at,
    nullif(trim(coalesce(p_note, '')), ''),
    'pending'
  )
  returning id into v_id;

  perform public.create_notification(
    v_recipient,
    'sync_proposed',
    'New sync proposal',
    'You received a new sync proposal.',
    '/connections/' || p_connection_id::text,
    jsonb_build_object('connection_id', p_connection_id, 'sync_id', v_id, 'sync_type', p_sync_type)
  );

  return v_id;
end;
$function$;

grant execute on function public.propose_connection_sync(uuid, text, timestamptz, text) to authenticated;

create or replace function public.respond_connection_sync(
  p_sync_id uuid,
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
  v_row record;
  v_next_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_action not in ('accept', 'decline') then
    raise exception 'invalid_action';
  end if;

  select *
    into v_row
  from public.connection_syncs s
  where s.id = p_sync_id
  limit 1;

  if v_row is null then
    raise exception 'sync_not_found';
  end if;

  if v_row.recipient_id <> v_me then
    raise exception 'not_authorized';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'sync_not_pending';
  end if;

  v_next_status := case when p_action = 'accept' then 'accepted' else 'declined' end;

  update public.connection_syncs
  set status = v_next_status,
      note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note),
      updated_at = now()
  where id = p_sync_id;

  perform public.create_notification(
    v_row.requester_id,
    case when p_action = 'accept' then 'sync_accepted' else 'sync_declined' end,
    case when p_action = 'accept' then 'Sync accepted' else 'Sync declined' end,
    null,
    '/connections/' || v_row.connection_id::text,
    jsonb_build_object('connection_id', v_row.connection_id, 'sync_id', p_sync_id)
  );

  return p_sync_id;
end;
$function$;

grant execute on function public.respond_connection_sync(uuid, text, text) to authenticated;

create or replace function public.cancel_connection_sync(
  p_sync_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_row record;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_row
  from public.connection_syncs s
  where s.id = p_sync_id
  limit 1;

  if v_row is null then
    raise exception 'sync_not_found';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'sync_not_pending';
  end if;

  if v_row.requester_id <> v_me and v_row.recipient_id <> v_me then
    raise exception 'not_authorized';
  end if;

  update public.connection_syncs
  set status = 'cancelled',
      updated_at = now()
  where id = p_sync_id;

  return p_sync_id;
end;
$function$;

grant execute on function public.cancel_connection_sync(uuid) to authenticated;

create or replace function public.complete_connection_sync(
  p_sync_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_row record;
  v_other uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_row
  from public.connection_syncs s
  where s.id = p_sync_id
  limit 1;

  if v_row is null then
    raise exception 'sync_not_found';
  end if;

  if v_row.status <> 'accepted' then
    raise exception 'sync_not_accepted';
  end if;

  if v_row.requester_id <> v_me and v_row.recipient_id <> v_me then
    raise exception 'not_authorized';
  end if;

  update public.connection_syncs
  set status = 'completed',
      completed_at = now(),
      note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note),
      updated_at = now()
  where id = p_sync_id;

  -- Keep backward compatibility with legacy sync completion table.
  update public.syncs
  set completed_at = now(),
      note = nullif(trim(coalesce(p_note, '')), '')
  where connection_id = v_row.connection_id
    and completed_by = v_me;

  if not found then
    insert into public.syncs (connection_id, completed_by, note)
    values (v_row.connection_id, v_me, nullif(trim(coalesce(p_note, '')), ''));
  end if;

  v_other := case when v_row.requester_id = v_me then v_row.recipient_id else v_row.requester_id end;
  perform public.create_notification(
    v_other,
    'sync_completed',
    'Sync marked completed',
    'A sync was marked completed. You can now leave a reference.',
    '/connections/' || v_row.connection_id::text,
    jsonb_build_object('connection_id', v_row.connection_id, 'sync_id', p_sync_id)
  );

  return p_sync_id;
end;
$function$;

grant execute on function public.complete_connection_sync(uuid, text) to authenticated;

-- =========================================================
-- References v2 support (entity + reply + one author edit)
-- =========================================================

alter table public.references add column if not exists entity_type text default 'connection';
alter table public.references add column if not exists entity_id uuid;
alter table public.references add column if not exists reply_text text;
alter table public.references add column if not exists replied_by uuid;
alter table public.references add column if not exists replied_at timestamptz;
alter table public.references add column if not exists edit_count int not null default 0;
alter table public.references add column if not exists last_edited_at timestamptz;

create index if not exists idx_references_entity on public.references(entity_type, entity_id);
create unique index if not exists ux_references_entity_author
  on public.references(entity_type, entity_id, author_id)
  where entity_type is not null and entity_id is not null;

create or replace function public.create_reference_v2(
  p_connection_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_recipient_id uuid,
  p_sentiment text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_connection record;
  v_sync_ok bool := false;
  v_trip_ok bool := false;
  v_event_ok bool := false;
  v_entity_type text := lower(trim(coalesce(p_entity_type, 'connection')));
  v_entity_id uuid := coalesce(p_entity_id, p_connection_id);
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

  if char_length(trim(coalesce(p_body, ''))) < 8 then
    raise exception 'reference_body_too_short';
  end if;

  if v_entity_type not in ('connection', 'sync', 'trip', 'event') then
    raise exception 'invalid_entity_type';
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

  if v_entity_type = 'connection' then
    select exists (
      select 1
      from public.syncs s
      where s.connection_id = p_connection_id
    ) into v_sync_ok;
    if not v_sync_ok then
      raise exception 'references_require_completed_sync';
    end if;
  elsif v_entity_type = 'sync' then
    select exists (
      select 1
      from public.connection_syncs s
      where s.id = v_entity_id
        and s.connection_id = p_connection_id
        and s.status = 'completed'
        and s.completed_at is not null
        and s.completed_at >= now() - interval '15 days'
        and ((s.requester_id = v_me and s.recipient_id = p_recipient_id) or (s.requester_id = p_recipient_id and s.recipient_id = v_me))
    ) into v_sync_ok;
    if not v_sync_ok then
      raise exception 'sync_reference_not_allowed';
    end if;
  elsif v_entity_type = 'trip' then
    select exists (
      select 1
      from public.trip_requests tr
      join public.trips t on t.id = tr.trip_id
      where tr.id = v_entity_id
        and tr.status = 'accepted'
        and t.end_date::date <= current_date
        and t.end_date::date >= current_date - 15
        and ((t.user_id = v_me and tr.requester_id = p_recipient_id) or (t.user_id = p_recipient_id and tr.requester_id = v_me))
    ) into v_trip_ok;
    if not v_trip_ok then
      raise exception 'trip_reference_not_allowed';
    end if;
  elsif v_entity_type = 'event' then
    select exists (
      select 1
      from public.events e
      join public.event_members em_a on em_a.event_id = e.id and em_a.user_id = v_me and em_a.status in ('host', 'going', 'waitlist')
      join public.event_members em_b on em_b.event_id = e.id and em_b.user_id = p_recipient_id and em_b.status in ('host', 'going', 'waitlist')
      where e.id = v_entity_id
        and e.ends_at <= now()
        and e.ends_at >= now() - interval '15 days'
    ) into v_event_ok;
    if not v_event_ok then
      raise exception 'event_reference_not_allowed';
    end if;
  end if;

  insert into public.references (
    connection_id,
    author_id,
    recipient_id,
    context,
    entity_type,
    entity_id,
    sentiment,
    body
  )
  values (
    p_connection_id,
    v_me,
    p_recipient_id,
    v_entity_type,
    v_entity_type,
    v_entity_id,
    p_sentiment,
    trim(p_body)
  )
  returning id into v_id;

  perform public.create_notification(
    p_recipient_id,
    'reference_received',
    'New reference received',
    'You received a new reference.',
    '/members/' || p_recipient_id::text,
    jsonb_build_object('reference_id', v_id, 'entity_type', v_entity_type, 'entity_id', v_entity_id)
  );

  return v_id;
end;
$function$;

grant execute on function public.create_reference_v2(uuid, text, uuid, uuid, text, text) to authenticated;

create or replace function public.update_reference_author(
  p_reference_id uuid,
  p_sentiment text,
  p_body text
)
returns uuid
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
  if p_sentiment not in ('positive', 'neutral', 'negative') then
    raise exception 'invalid_sentiment';
  end if;
  if char_length(trim(coalesce(p_body, ''))) < 8 then
    raise exception 'reference_body_too_short';
  end if;

  update public.references r
  set sentiment = p_sentiment,
      body = trim(p_body),
      edit_count = coalesce(r.edit_count, 0) + 1,
      last_edited_at = now()
  where r.id = p_reference_id
    and r.author_id = v_me
    and coalesce(r.edit_count, 0) < 1
    and r.created_at >= now() - interval '15 days';

  if not found then
    raise exception 'reference_update_not_allowed';
  end if;

  return p_reference_id;
end;
$function$;

grant execute on function public.update_reference_author(uuid, text, text) to authenticated;

create or replace function public.reply_reference_receiver(
  p_reference_id uuid,
  p_reply_text text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_clean text := trim(coalesce(p_reply_text, ''));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if char_length(v_clean) < 2 or char_length(v_clean) > 400 then
    raise exception 'invalid_reply_length';
  end if;

  update public.references r
  set reply_text = v_clean,
      replied_by = v_me,
      replied_at = now()
  where r.id = p_reference_id
    and r.recipient_id = v_me
    and r.reply_text is null
    and r.created_at >= now() - interval '15 days';

  if not found then
    raise exception 'reference_reply_not_allowed';
  end if;

  return p_reference_id;
end;
$function$;

grant execute on function public.reply_reference_receiver(uuid, text) to authenticated;

commit;
