-- Beta feedback from the in-app "Beta feedback" button.
-- Read and triage it in Supabase → Table Editor → beta_feedback (status: new → seen → fixed / wontfix).
-- Only the server (service role) writes; nobody can read it from the browser.
-- Run on STAGING and PRODUCTION. Safe to re-run.

begin;

create table if not exists public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('bug', 'idea', 'other')),
  message text not null check (char_length(message) between 3 and 2000),
  page_url text,
  user_agent text,
  status text not null default 'new' check (status in ('new', 'seen', 'fixed', 'wontfix')),
  admin_note text,
  created_at timestamptz not null default now()
);

create index if not exists beta_feedback_created_idx on public.beta_feedback (created_at desc);
create index if not exists beta_feedback_user_created_idx on public.beta_feedback (user_id, created_at desc);

alter table public.beta_feedback enable row level security;
-- No policies on purpose: the service role (API route) bypasses RLS.

commit;
