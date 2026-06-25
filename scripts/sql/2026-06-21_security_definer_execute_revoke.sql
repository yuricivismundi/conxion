-- Security hardening: revoke unnecessary EXECUTE on SECURITY DEFINER functions
-- Date: 2026-06-21
--
-- Fixes Supabase linter warnings (0028/0029) for SECURITY DEFINER functions
-- reachable via the REST API by anon or authenticated roles.
--
-- Strategy:
--   1. Trigger functions  → revoke from anon + authenticated (never need direct calls)
--   2. Admin/maintenance  → revoke from anon + authenticated (called via service_role only)
--   3. Internal helpers   → revoke from anon + authenticated (called within other SECURITY DEFINER fns)
--
-- Functions intentionally left accessible to authenticated:
--   - All user-action RPC functions (create_event, join_event, send_message, etc.)
--   - cx_ensure_pair_thread  (called from client-side messages/connections pages)
--   - cx_get_thread_entitlement  (called from client-side messages page)
--   - cx_sync_user_messaging_state  (called from client-side messages page)
--   - cx_sync_activities / cx_sync_reference_requests  (called via supabaseUser in API routes)
--   - cx_is_thread_participant / cx_event_thread_can_post / cx_thread_chat_unlocked
--     cx_can_select_thread_message  (likely used in RLS policies)
--   - event_host_user_id / is_group_member  (confirmed used in RLS policies)
--   - get_public_event_lite / list_public_events_lite  (intentionally anon-accessible)
--
-- Leaked password protection must be enabled separately via the Supabase Auth dashboard.

begin;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Trigger functions (RETURNS trigger) – never need direct REST calls
-- ──────────────────────────────────────────────────────────────────────────────

revoke execute on function public.bump_thread_message_daily_limit() from anon, authenticated;
revoke execute on function public.trg_group_member_add_to_thread() from anon, authenticated;
revoke execute on function public.groups_set_updated_at() from anon, authenticated;
revoke execute on function public.cx_guard_event_thread_message_insert() from anon, authenticated;
revoke execute on function public.cx_enforce_thread_text_unlock() from anon, authenticated;
revoke execute on function public.cx_profiles_apply_username() from anon, authenticated;
revoke execute on function public.cx_profiles_sync_username_history() from anon, authenticated;
revoke execute on function public.enforce_dance_moves_user_limits() from anon, authenticated;
revoke execute on function public.sync_dance_growth_public_summary() from anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Admin / maintenance functions – called only via service_role in API routes
-- ──────────────────────────────────────────────────────────────────────────────

revoke execute on function public.create_notification(uuid, text, text, text, text, jsonb) from anon, authenticated;
revoke execute on function public.cx_events_health_snapshot() from anon, authenticated;
revoke execute on function public.cx_run_events_maintenance(integer, integer, integer, integer, boolean) from anon, authenticated;
revoke execute on function public.cx_schedule_events_maintenance_daily(integer, integer) from anon, authenticated;
revoke execute on function public.cx_seed_upcoming_public_events() from anon, authenticated;
revoke execute on function public.archive_and_prune_past_events(integer, integer, integer) from anon, authenticated;
revoke execute on function public.prune_events_archive(integer, integer) from anon, authenticated;
revoke execute on function public.cx_references_reveal_mutual() from anon, authenticated;
revoke execute on function public.cx_refresh_member_interaction_counters(uuid) from anon, authenticated;
revoke execute on function public.cx_run_messaging_housekeeping(uuid) from anon, authenticated;
revoke execute on function public.refresh_dance_growth_public_summary(uuid) from anon, authenticated;

-- Called via service_role in groups/events API routes
revoke execute on function public.cx_check_group_create_allowed(uuid) from anon, authenticated;
revoke execute on function public.cx_check_group_slot_allowed(uuid, uuid) from anon, authenticated;
revoke execute on function public.cx_ensure_group_thread(uuid, uuid) from anon, authenticated;
revoke execute on function public.cx_ensure_event_thread(uuid, uuid, uuid) from anon, authenticated;
revoke execute on function public.cx_emit_thread_event(uuid, uuid, text, text, text, text, jsonb) from anon, authenticated;

-- Maintenance batch syncs – not wired to any user-facing code path
revoke execute on function public.cx_sync_connections_to_thread() from anon, authenticated;
revoke execute on function public.cx_sync_event_members_to_thread() from anon, authenticated;
revoke execute on function public.cx_sync_event_requests_to_thread() from anon, authenticated;
revoke execute on function public.cx_sync_hosting_requests_to_thread() from anon, authenticated;
revoke execute on function public.cx_sync_trip_requests_to_thread() from anon, authenticated;
revoke execute on function public.cx_sync_user_messaging_state() from anon; -- keep authenticated (client calls it)

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Internal helper functions – called only from within other SECURITY DEFINER fns
-- ──────────────────────────────────────────────────────────────────────────────

revoke execute on function public.active_group_slot_usage_count(uuid, uuid) from anon, authenticated;
revoke execute on function public.enforce_event_join_guardrails(uuid) from anon, authenticated;
revoke execute on function public.event_has_capacity(uuid) from anon, authenticated;
revoke execute on function public.group_slot_limit_for_user(uuid) from anon, authenticated;
revoke execute on function public.private_group_limit_for_user(uuid) from anon, authenticated;
revoke execute on function public.private_group_monthly_usage_count(uuid, timestamp with time zone) from anon, authenticated;
revoke execute on function public.teacher_profile_is_active(uuid) from anon, authenticated;
revoke execute on function public.cx_cancel_request_chat_entitlement(text, uuid) from anon, authenticated;
revoke execute on function public.cx_ensure_user_messaging_cycle(uuid, timestamp with time zone) from anon, authenticated;
revoke execute on function public.cx_group_messages_today(uuid) from anon, authenticated;
revoke execute on function public.cx_group_user_messages_today(uuid, uuid) from anon, authenticated;
revoke execute on function public.cx_log_thread_status(uuid, uuid, uuid, text, text, text, text, jsonb) from anon, authenticated;
revoke execute on function public.cx_mark_reference_request_completed(uuid) from anon, authenticated;
revoke execute on function public.cx_reference_prompt_allowed(uuid, uuid, text, text, uuid, timestamp with time zone) from anon, authenticated;
revoke execute on function public.cx_upsert_request_chat_entitlement(uuid, text, uuid, uuid, uuid, timestamp with time zone, timestamp with time zone) from anon, authenticated;
revoke execute on function public.cx_upsert_thread_context(uuid, text, uuid, text, text, text, text, date, date, uuid, uuid, jsonb) from anon, authenticated;

commit;
