-- Enable RLS on internal anti-spam counter tables.
-- These tables are written exclusively by security-definer functions
-- (cx_refresh_member_interaction_counters) which bypass RLS automatically.
-- No direct user access is needed, so we enable RLS with no permissive policies,
-- which effectively denies all direct reads/writes from client connections.

alter table public.member_interaction_counters enable row level security;
alter table public.pair_interaction_counters enable row level security;
