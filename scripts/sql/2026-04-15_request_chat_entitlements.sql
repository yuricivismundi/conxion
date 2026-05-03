-- Request-linked temporary chat entitlements
-- When a hosting or activity request is accepted, a time-bounded chat window is
-- granted automatically. This window does NOT consume a normal active chat slot
-- for either party. After expiry, normal conversation activation is required.

begin;

-- ── 1. Table ─────────────────────────────────────────────────────────────────
create table if not exists public.request_chat_entitlements (
  id                uuid primary key default gen_random_uuid(),
  thread_id         uuid not null references public.threads(id) on delete cascade,
  source_type       text not null,  -- 'hosting_request' | 'activity_request' | 'connection_request' | 'teacher_inquiry'
  source_id         uuid not null,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  responder_user_id uuid not null references auth.users(id) on delete cascade,
  status            text not null default 'scheduled'
                    check (status in ('scheduled', 'active', 'expired', 'cancelled')),
  opens_at          timestamptz not null,
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (expires_at > opens_at)
);

create index if not exists idx_rce_thread_id   on public.request_chat_entitlements(thread_id);
create index if not exists idx_rce_requester   on public.request_chat_entitlements(requester_user_id);
create index if not exists idx_rce_responder   on public.request_chat_entitlements(responder_user_id);
create index if not exists idx_rce_status      on public.request_chat_entitlements(status);
create index if not exists idx_rce_opens_at    on public.request_chat_entitlements(opens_at);
create index if not exists idx_rce_expires_at  on public.request_chat_entitlements(expires_at);
create unique index if not exists ux_rce_source on public.request_chat_entitlements(source_type, source_id);

-- Updated_at trigger
create or replace function public.rce_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists rce_updated_at on public.request_chat_entitlements;
create trigger rce_updated_at
  before update on public.request_chat_entitlements
  for each row execute function public.rce_set_updated_at();

-- ── 2. RLS ───────────────────────────────────────────────────────────────────
alter table public.request_chat_entitlements enable row level security;

create policy rce_select on public.request_chat_entitlements for select
  using (
    requester_user_id = auth.uid() or responder_user_id = auth.uid()
  );

-- Only service role / security-definer functions may insert/update
create policy rce_insert on public.request_chat_entitlements for insert
  with check (false);  -- blocked for direct client inserts; use definer functions

create policy rce_update on public.request_chat_entitlements for update
  using (false);  -- same: definer only

-- ── 3. Status evaluation helper (read-time) ──────────────────────────────────
create or replace function public.cx_rce_current_status(
  p_opens_at   timestamptz,
  p_expires_at timestamptz,
  p_status     text
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_status = 'cancelled' then 'cancelled'
    when now() < p_opens_at    then 'scheduled'
    when now() > p_expires_at  then 'expired'
    else 'active'
  end;
$$;

-- ── 4. Upsert entitlement (security definer — callable by service role / RPC) ─
create or replace function public.cx_upsert_request_chat_entitlement(
  p_thread_id         uuid,
  p_source_type       text,
  p_source_id         uuid,
  p_requester_user_id uuid,
  p_responder_user_id uuid,
  p_opens_at          timestamptz,
  p_expires_at        timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_status text;
begin
  v_status := public.cx_rce_current_status(p_opens_at, p_expires_at, 'scheduled');

  insert into public.request_chat_entitlements (
    thread_id, source_type, source_id,
    requester_user_id, responder_user_id,
    status, opens_at, expires_at
  ) values (
    p_thread_id, p_source_type, p_source_id,
    p_requester_user_id, p_responder_user_id,
    v_status, p_opens_at, p_expires_at
  )
  on conflict (source_type, source_id) do update set
    thread_id         = excluded.thread_id,
    opens_at          = excluded.opens_at,
    expires_at        = excluded.expires_at,
    status            = public.cx_rce_current_status(excluded.opens_at, excluded.expires_at,
                          case when request_chat_entitlements.status = 'cancelled' then 'cancelled' else 'scheduled' end),
    updated_at        = now()
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.cx_upsert_request_chat_entitlement(uuid,text,uuid,uuid,uuid,timestamptz,timestamptz) to authenticated, service_role;
grant execute on function public.cx_rce_current_status(timestamptz,timestamptz,text) to authenticated, service_role;

-- ── 5. Cancel entitlement ────────────────────────────────────────────────────
create or replace function public.cx_cancel_request_chat_entitlement(
  p_source_type text,
  p_source_id   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.request_chat_entitlements
  set status = 'cancelled', updated_at = now()
  where source_type = p_source_type
    and source_id = p_source_id
    and status in ('scheduled', 'active');
end;
$$;

grant execute on function public.cx_cancel_request_chat_entitlement(text, uuid) to authenticated, service_role;

-- ── 6. Fetch active/scheduled entitlement for a thread ───────────────────────
-- Returns the effective status evaluated at read time.
create or replace function public.cx_get_thread_entitlement(p_thread_id uuid, p_user_id uuid)
returns table (
  id                uuid,
  source_type       text,
  source_id         uuid,
  opens_at          timestamptz,
  expires_at        timestamptz,
  effective_status  text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.source_type,
    e.source_id,
    e.opens_at,
    e.expires_at,
    public.cx_rce_current_status(e.opens_at, e.expires_at, e.status) as effective_status
  from public.request_chat_entitlements e
  where e.thread_id = p_thread_id
    and (e.requester_user_id = p_user_id or e.responder_user_id = p_user_id)
    and e.status != 'cancelled'
  order by e.opens_at desc
  limit 1;
$$;

grant execute on function public.cx_get_thread_entitlement(uuid, uuid) to authenticated;

commit;
