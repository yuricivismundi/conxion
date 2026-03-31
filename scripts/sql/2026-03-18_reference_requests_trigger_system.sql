-- ConXion Reference Trigger System (Trip + Hosting)
-- Date: 2026-03-18
--
-- Triggers reference prompts after completed interactions:
-- - trip completed (accepted trip request + trip end date)
-- - hosting completed (accepted hosting request + departure date)
--
-- Rules:
-- - prompt becomes due 24h after completion
-- - reminder after 2 days if still pending
-- - stop/removal after 7 days (expired)

begin;

create table if not exists public.reference_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  peer_user_id uuid not null references auth.users(id) on delete cascade,
  context_tag text not null,
  source_table text not null,
  source_id uuid not null,
  connection_id uuid null references public.connections(id) on delete set null,
  due_at timestamptz not null,
  remind_after timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'pending',
  completed_reference_id uuid null references public.references(id) on delete set null,
  reminder_count int not null default 0,
  last_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_table, source_id, context_tag)
);

alter table public.reference_requests add column if not exists user_id uuid;
alter table public.reference_requests add column if not exists peer_user_id uuid;
alter table public.reference_requests add column if not exists context_tag text;
alter table public.reference_requests add column if not exists source_table text;
alter table public.reference_requests add column if not exists source_id uuid;
alter table public.reference_requests add column if not exists connection_id uuid;
alter table public.reference_requests add column if not exists due_at timestamptz;
alter table public.reference_requests add column if not exists remind_after timestamptz;
alter table public.reference_requests add column if not exists expires_at timestamptz;
alter table public.reference_requests add column if not exists status text;
alter table public.reference_requests add column if not exists completed_reference_id uuid;
alter table public.reference_requests add column if not exists reminder_count int;
alter table public.reference_requests add column if not exists last_reminded_at timestamptz;
alter table public.reference_requests add column if not exists created_at timestamptz;
alter table public.reference_requests add column if not exists updated_at timestamptz;

update public.reference_requests
set reminder_count = 0
where reminder_count is null;

update public.reference_requests
set status = 'pending'
where status is null or trim(status) = '';

update public.reference_requests
set created_at = now()
where created_at is null;

update public.reference_requests
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table public.reference_requests alter column user_id set not null;
alter table public.reference_requests alter column peer_user_id set not null;
alter table public.reference_requests alter column context_tag set not null;
alter table public.reference_requests alter column source_table set not null;
alter table public.reference_requests alter column source_id set not null;
alter table public.reference_requests alter column due_at set not null;
alter table public.reference_requests alter column remind_after set not null;
alter table public.reference_requests alter column expires_at set not null;
alter table public.reference_requests alter column status set not null;
alter table public.reference_requests alter column status set default 'pending';
alter table public.reference_requests alter column reminder_count set not null;
alter table public.reference_requests alter column reminder_count set default 0;
alter table public.reference_requests alter column created_at set not null;
alter table public.reference_requests alter column created_at set default now();
alter table public.reference_requests alter column updated_at set not null;
alter table public.reference_requests alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reference_requests_status_chk'
      and conrelid = 'public.reference_requests'::regclass
  ) then
    alter table public.reference_requests
      add constraint reference_requests_status_chk
      check (status in ('pending', 'completed', 'dismissed', 'expired'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reference_requests_context_tag_chk'
      and conrelid = 'public.reference_requests'::regclass
  ) then
    alter table public.reference_requests
      add constraint reference_requests_context_tag_chk
      check (context_tag in ('practice', 'event', 'host', 'guest', 'travel', 'festival', 'collaboration'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reference_requests_source_table_chk'
      and conrelid = 'public.reference_requests'::regclass
  ) then
    alter table public.reference_requests
      add constraint reference_requests_source_table_chk
      check (source_table in ('trip_requests', 'hosting_requests'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reference_requests_due_window_chk'
      and conrelid = 'public.reference_requests'::regclass
  ) then
    alter table public.reference_requests
      add constraint reference_requests_due_window_chk
      check (due_at <= remind_after and remind_after <= expires_at);
  end if;
end $$;

create index if not exists idx_reference_requests_user_status_due
  on public.reference_requests(user_id, status, due_at desc);

create index if not exists idx_reference_requests_peer_status
  on public.reference_requests(peer_user_id, status, due_at desc);

create index if not exists idx_reference_requests_source
  on public.reference_requests(source_table, source_id);

create unique index if not exists ux_reference_requests_unique
  on public.reference_requests(user_id, source_table, source_id, context_tag);

drop trigger if exists trg_reference_requests_set_updated_at on public.reference_requests;
create trigger trg_reference_requests_set_updated_at
before update on public.reference_requests
for each row execute function public.set_updated_at_ts();

alter table public.reference_requests enable row level security;

drop policy if exists reference_requests_select_own on public.reference_requests;
create policy reference_requests_select_own
on public.reference_requests for select
to authenticated
using (user_id = auth.uid());

drop policy if exists reference_requests_update_own on public.reference_requests;
create policy reference_requests_update_own
on public.reference_requests for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.cx_sync_reference_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_created int := 0;
  v_completed int := 0;
  v_expired int := 0;
  v_reminded int := 0;
  v_conn_id uuid;
  v_due_at timestamptz;
  v_remind_after timestamptz;
  v_expires_at timestamptz;
  v_peer_id uuid;
  v_context_tag text;
  v_inserted int := 0;
  v_row record;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  -- Trip completion prompts (24h after trip end date).
  for v_row in
    select
      tr.id as source_id,
      tr.requester_id,
      t.user_id as owner_id,
      t.end_date
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and t.end_date is not null
      and t.end_date <= current_date
      and (tr.requester_id = v_me or t.user_id = v_me)
  loop
    v_peer_id := case when v_row.requester_id = v_me then v_row.owner_id else v_row.requester_id end;
    if v_peer_id is null or v_peer_id = v_me then
      continue;
    end if;

    v_due_at := (v_row.end_date::timestamptz + interval '24 hours');
    if v_due_at > now() then
      continue;
    end if;

    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '7 days';
    v_context_tag := 'travel';

    select c.id
      into v_conn_id
    from public.connections c
    where coalesce(c.status::text, '') = 'accepted'
      and c.blocked_by is null
      and (
        (c.requester_id = v_me and c.target_id = v_peer_id)
        or (c.requester_id = v_peer_id and c.target_id = v_me)
      )
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    insert into public.reference_requests (
      user_id,
      peer_user_id,
      context_tag,
      source_table,
      source_id,
      connection_id,
      due_at,
      remind_after,
      expires_at,
      status
    )
    values (
      v_me,
      v_peer_id,
      v_context_tag,
      'trip_requests',
      v_row.source_id,
      v_conn_id,
      v_due_at,
      v_remind_after,
      v_expires_at,
      'pending'
    )
    on conflict (user_id, source_table, source_id, context_tag) do nothing;

    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end loop;

  -- Hosting completion prompts (24h after departure date).
  for v_row in
    select
      hr.id as source_id,
      hr.sender_user_id,
      hr.recipient_user_id,
      hr.request_type,
      hr.departure_date
    from public.hosting_requests hr
    where hr.status = 'accepted'
      and hr.departure_date is not null
      and hr.departure_date <= current_date
      and (hr.sender_user_id = v_me or hr.recipient_user_id = v_me)
  loop
    v_peer_id := case when v_row.sender_user_id = v_me then v_row.recipient_user_id else v_row.sender_user_id end;
    if v_peer_id is null or v_peer_id = v_me then
      continue;
    end if;

    if (v_row.request_type = 'request_hosting' and v_row.recipient_user_id = v_me)
       or (v_row.request_type = 'offer_to_host' and v_row.sender_user_id = v_me) then
      v_context_tag := 'host';
    else
      v_context_tag := 'guest';
    end if;

    v_due_at := (v_row.departure_date::timestamptz + interval '24 hours');
    if v_due_at > now() then
      continue;
    end if;

    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '7 days';

    select c.id
      into v_conn_id
    from public.connections c
    where coalesce(c.status::text, '') = 'accepted'
      and c.blocked_by is null
      and (
        (c.requester_id = v_me and c.target_id = v_peer_id)
        or (c.requester_id = v_peer_id and c.target_id = v_me)
      )
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    insert into public.reference_requests (
      user_id,
      peer_user_id,
      context_tag,
      source_table,
      source_id,
      connection_id,
      due_at,
      remind_after,
      expires_at,
      status
    )
    values (
      v_me,
      v_peer_id,
      v_context_tag,
      'hosting_requests',
      v_row.source_id,
      v_conn_id,
      v_due_at,
      v_remind_after,
      v_expires_at,
      'pending'
    )
    on conflict (user_id, source_table, source_id, context_tag) do nothing;

    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end loop;

  -- Auto-complete prompts that already have a matching authored reference.
  update public.reference_requests rr
  set
    status = 'completed',
    completed_reference_id = ref.id,
    updated_at = now()
  from public.references ref
  where rr.user_id = v_me
    and rr.status = 'pending'
    and coalesce(ref.from_user_id, ref.author_id, ref.source_id) = v_me
    and coalesce(ref.to_user_id, ref.recipient_id, ref.target_id) = rr.peer_user_id
    and coalesce(ref.context_tag, ref.context, ref.entity_type) = rr.context_tag
    and (ref.entity_id is null or ref.entity_id = rr.source_id);
  get diagnostics v_completed = row_count;

  -- Expire stale prompts after 7 days.
  update public.reference_requests rr
  set status = 'expired', updated_at = now()
  where rr.user_id = v_me
    and rr.status = 'pending'
    and now() > rr.expires_at;
  get diagnostics v_expired = row_count;

  -- Reminder cadence: every 2 days while pending, stop once expired.
  if to_regclass('public.notifications') is not null then
    for v_row in
      select rr.id, rr.peer_user_id, rr.context_tag, rr.source_table, rr.source_id, rr.reminder_count
      from public.reference_requests rr
      where rr.user_id = v_me
        and rr.status = 'pending'
        and now() >= rr.remind_after
        and now() <= rr.expires_at
        and (rr.last_reminded_at is null or rr.last_reminded_at <= now() - interval '2 days')
    loop
      insert into public.notifications (user_id, actor_id, kind, title, body, link_url, metadata)
      values (
        v_me,
        v_row.peer_user_id,
        'reference_reminder',
        'Reference reminder',
        'Leave a quick reference for your recent interaction.',
        '/references',
        jsonb_build_object(
          'context_tag', v_row.context_tag,
          'source_table', v_row.source_table,
          'source_id', v_row.source_id,
          'prompt_id', v_row.id
        )
      );

      update public.reference_requests
      set
        reminder_count = coalesce(reminder_count, 0) + 1,
        last_reminded_at = now(),
        updated_at = now()
      where id = v_row.id;

      v_reminded := v_reminded + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'completed', v_completed,
    'expired', v_expired,
    'reminded', v_reminded
  );
end;
$function$;

grant execute on function public.cx_sync_reference_requests() to authenticated;

create or replace function public.cx_mark_reference_request_completed(
  p_reference_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_rows int := 0;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_reference_id is null then
    return 0;
  end if;

  update public.reference_requests rr
  set
    status = 'completed',
    completed_reference_id = ref.id,
    updated_at = now()
  from public.references ref
  where ref.id = p_reference_id
    and rr.user_id = v_me
    and rr.status = 'pending'
    and coalesce(ref.from_user_id, ref.author_id, ref.source_id) = v_me
    and coalesce(ref.to_user_id, ref.recipient_id, ref.target_id) = rr.peer_user_id
    and coalesce(ref.context_tag, ref.context, ref.entity_type) = rr.context_tag
    and (ref.entity_id is null or ref.entity_id = rr.source_id);

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

grant execute on function public.cx_mark_reference_request_completed(uuid) to authenticated;

commit;
