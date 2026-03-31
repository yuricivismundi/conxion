begin;

create extension if not exists pgcrypto;

create table if not exists public.reference_archives (
  user_id uuid not null references auth.users(id) on delete cascade,
  reference_id uuid not null references public.references(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, reference_id)
);

create index if not exists idx_reference_archives_user_created
  on public.reference_archives(user_id, created_at desc);

alter table public.reference_archives enable row level security;

drop policy if exists reference_archives_select_own on public.reference_archives;
create policy reference_archives_select_own
on public.reference_archives
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists reference_archives_insert_own on public.reference_archives;
create policy reference_archives_insert_own
on public.reference_archives
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists reference_archives_delete_own on public.reference_archives;
create policy reference_archives_delete_own
on public.reference_archives
for delete
to authenticated
using (auth.uid() = user_id);

create table if not exists public.reference_report_claims (
  id uuid primary key default gen_random_uuid(),
  report_id uuid null references public.reports(id) on delete set null,
  reference_id uuid not null references public.references(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  reference_author_id uuid not null references auth.users(id) on delete cascade,
  reference_recipient_id uuid not null references auth.users(id) on delete cascade,
  context_tag text null,
  reference_excerpt text null,
  reason text not null,
  subject text not null,
  description text not null,
  reporter_email text null,
  profile_link text null,
  evidence_links text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_reference_report_claims_reporter_reference
  on public.reference_report_claims(reporter_id, reference_id);

create index if not exists idx_reference_report_claims_report_id
  on public.reference_report_claims(report_id);

create index if not exists idx_reference_report_claims_reference_id
  on public.reference_report_claims(reference_id);

create index if not exists idx_reference_report_claims_created_at
  on public.reference_report_claims(created_at desc);

alter table public.reference_report_claims enable row level security;

drop policy if exists reference_report_claims_select_party_or_admin on public.reference_report_claims;
create policy reference_report_claims_select_party_or_admin
on public.reference_report_claims
for select
to authenticated
using (
  reporter_id = auth.uid()
  or target_user_id = auth.uid()
  or public.is_app_admin(auth.uid())
);

drop policy if exists reference_report_claims_insert_reporter on public.reference_report_claims;
create policy reference_report_claims_insert_reporter
on public.reference_report_claims
for insert
to authenticated
with check (reporter_id = auth.uid());

drop policy if exists reference_report_claims_update_admin on public.reference_report_claims;
create policy reference_report_claims_update_admin
on public.reference_report_claims
for update
to authenticated
using (public.is_app_admin(auth.uid()))
with check (public.is_app_admin(auth.uid()));

commit;
