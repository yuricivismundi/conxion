create sequence if not exists public.privacy_request_ticket_seq;

create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  requester_email text,
  request_type text not null,
  status text not null default 'open',
  subject text not null,
  description text not null,
  scope_tags text[] not null default '{}'::text[],
  ticket_code text not null default ('PR-' || lpad(nextval('public.privacy_request_ticket_seq')::text, 6, '0')),
  admin_note text,
  due_at timestamptz not null default (now() + interval '30 days'),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint privacy_requests_request_type_check check (
    request_type in ('access', 'portability', 'erasure', 'rectification', 'objection', 'restriction', 'consent_withdrawal', 'other')
  ),
  constraint privacy_requests_status_check check (
    status in ('open', 'under_review', 'needs_info', 'resolved', 'dismissed')
  ),
  constraint privacy_requests_subject_check check (char_length(subject) between 6 and 160),
  constraint privacy_requests_description_check check (char_length(description) between 30 and 5000)
);

create unique index if not exists uq_privacy_requests_ticket_code
  on public.privacy_requests(ticket_code);

create index if not exists idx_privacy_requests_requester_created_at
  on public.privacy_requests(requester_id, created_at desc);

create index if not exists idx_privacy_requests_status_created_at
  on public.privacy_requests(status, created_at desc);

create or replace function public.touch_privacy_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.status in ('resolved', 'dismissed') and old.status is distinct from new.status and new.resolved_at is null then
    new.resolved_at := now();
  elsif new.status not in ('resolved', 'dismissed') then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touch_privacy_requests_updated_at on public.privacy_requests;
create trigger trg_touch_privacy_requests_updated_at
before update on public.privacy_requests
for each row execute function public.touch_privacy_requests_updated_at();

alter table public.privacy_requests enable row level security;

drop policy if exists privacy_requests_select_requester_or_admin on public.privacy_requests;
create policy privacy_requests_select_requester_or_admin
on public.privacy_requests
for select
to authenticated
using (
  requester_id = auth.uid()
  or exists (
    select 1
    from public.admins a
    where a.user_id = auth.uid()
  )
);

drop policy if exists privacy_requests_insert_requester on public.privacy_requests;
create policy privacy_requests_insert_requester
on public.privacy_requests
for insert
to authenticated
with check (
  requester_id = auth.uid()
);

drop policy if exists privacy_requests_update_admin on public.privacy_requests;
create policy privacy_requests_update_admin
on public.privacy_requests
for update
to authenticated
using (
  exists (
    select 1
    from public.admins a
    where a.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.admins a
    where a.user_id = auth.uid()
  )
);
