-- Enable RLS on tables flagged by Supabase Security Advisor.
-- These tables are public-schema and exposed to PostgREST but had no RLS.

alter table public.user_messaging_plans      enable row level security;
alter table public.user_messaging_cycles     enable row level security;
alter table public.thread_status_history     enable row level security;
alter table public.profile_username_history  enable row level security;

-- ── user_messaging_plans ─────────────────────────────────────────────────────
-- Users can read/write only their own plan row.
create policy "users_own_messaging_plan" on public.user_messaging_plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── user_messaging_cycles ────────────────────────────────────────────────────
create policy "users_own_messaging_cycles" on public.user_messaging_cycles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── thread_status_history ────────────────────────────────────────────────────
-- Each participant can see history rows for threads they are part of.
create policy "participants_see_thread_status_history" on public.thread_status_history
  for select using (
    exists (
      select 1 from public.threads t
      where t.id = thread_status_history.thread_id
        and (t.requester_id = auth.uid() or t.target_id = auth.uid())
    )
  );

create policy "participants_insert_thread_status_history" on public.thread_status_history
  for insert with check (
    exists (
      select 1 from public.threads t
      where t.id = thread_status_history.thread_id
        and (t.requester_id = auth.uid() or t.target_id = auth.uid())
    )
  );

-- ── profile_username_history ─────────────────────────────────────────────────
-- Users can see their own history; no one can write directly.
create policy "users_own_username_history" on public.profile_username_history
  for select using (auth.uid() = user_id);
