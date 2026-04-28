-- Fix: pin search_path on all functions that were missing it.
-- Prevents search_path injection attacks where a malicious schema placed
-- earlier in the path could shadow public objects.

alter function public.cx_reference_author_id             set search_path = public;
alter function public.cx_reference_recipient_id          set search_path = public;
alter function public.cx_reference_context_key           set search_path = public;
alter function public.cx_reference_public_category       set search_path = public;
alter function public.cx_reference_family                set search_path = public;
alter function public.cx_reference_cooldown_days         set search_path = public;
alter function public.cx_reference_source_type           set search_path = public;

alter function public.cx_normalize_trip_join_reason      set search_path = public;
alter function public.cx_trip_join_reason_label          set search_path = public;
alter function public.cx_normalize_hosting_space_type    set search_path = public;
alter function public.cx_hosting_space_type_label        set search_path = public;
alter function public.cx_normalize_activity_type         set search_path = public;
alter function public.cx_activity_type_label             set search_path = public;
alter function public.cx_activity_reference_context      set search_path = public;
alter function public.cx_activity_uses_date_range        set search_path = public;
alter function public.cx_normalize_travel_intent_reason  set search_path = public;
alter function public.cx_travel_intent_reason_label      set search_path = public;

alter function public.cx_messaging_cycle_bounds          set search_path = public;
alter function public.cx_count_user_active_threads       set search_path = public;
alter function public.cx_thread_message_unlocked         set search_path = public;

alter function public.event_legacy_visibility_for_access set search_path = public;
alter function public.event_chat_mode_for_access         set search_path = public;
alter function public.set_event_invitation_updated_at    set search_path = public;

alter function public.cx_normalize_profile_username      set search_path = public;
alter function public.cx_username_base_from_text         set search_path = public;
alter function public.cx_is_reserved_profile_username    set search_path = public;
alter function public.cx_can_use_profile_username        set search_path = public;
alter function public.cx_resolve_profile_username        set search_path = public;
alter function public.cx_profiles_apply_username         set search_path = public;
alter function public.cx_profiles_sync_username_history  set search_path = public;
alter function public.touch_privacy_requests_updated_at  set search_path = public;
alter function public.set_profile_media_updated_at       set search_path = public;
alter function public.profile_media_enforce_limits       set search_path = public;

-- Fix: restrict avatars bucket SELECT policy so clients cannot list all files.
-- Public buckets don't require a SELECT policy on storage.objects for direct
-- URL access — the bucket being public already allows reading individual objects
-- by URL. The broad policy only adds unwanted listing capability.
drop policy if exists "Read avatars" on storage.objects;
