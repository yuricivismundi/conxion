-- Member email invites ("Invite dancers").
--
-- Stores a SHA-256 hash of the invited address, never the address itself, so
-- we can enforce anti-spam limits without keeping third-party emails:
--   * 20 invites per member per 24h (enforced in app/api/invites/route.ts)
--   * the same address is emailed at most once every 30 days, by anyone
-- Only the server (service role) reads or writes this table.
--
-- Run on STAGING first, then production. Safe to re-run.

begin;

create table if not exists public.member_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references auth.users (id) on delete cascade,
  invitee_email_hash text not null,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists member_invites_inviter_created_idx
  on public.member_invites (inviter_user_id, created_at desc);

create index if not exists member_invites_email_hash_created_idx
  on public.member_invites (invitee_email_hash, created_at desc);

alter table public.member_invites enable row level security;
-- No policies on purpose: anon/authenticated get nothing; the service role bypasses RLS.

commit;
