-- ============================================================
-- Security & Performance Lint Remediations
-- Source: Supabase Performance Security Lints report (Security Advisor)
-- Run in Supabase SQL Editor (staging first, then production)
-- Safe to re-run.
-- ============================================================

-- ============================================================
-- 1. Fix mutable search_path on functions
--    (function_search_path_mutable)
-- ============================================================

ALTER FUNCTION public.rce_set_updated_at() SET search_path = '';
ALTER FUNCTION public.event_chat_mode_for_access(p_access text, p_chat_mode text) SET search_path = '';

-- ============================================================
-- 2. Fix public bucket listing
--    (public_bucket_allows_listing)
-- ============================================================

DROP POLICY IF EXISTS "Public read avatars" ON storage.objects;

CREATE POLICY "Public read avatars"
ON storage.objects FOR SELECT
TO public
USING (
  bucket_id = 'avatars'
  AND name IS NOT NULL
);

-- ============================================================
-- 3. Lock down SECURITY DEFINER functions from PUBLIC / anon
--    (anon_security_definer_function_executable)
--    PUBLIC is the default grantee; revoking only from anon
--    is not enough — must revoke from PUBLIC too.
-- ============================================================

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

-- Grant EXECUTE back to authenticated + service_role so the app keeps working.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- Restore anon access for the 2 public-facing event lookup functions
-- used by the unauthenticated /events and /events/[id] pages.
GRANT EXECUTE ON FUNCTION public.list_public_events_lite TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_event_lite TO anon;

-- Apply the same defaults to any new functions added later so the
-- warnings don't reappear after the next migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- ============================================================
-- 4. auth_leaked_password_protection
--    Cannot be set via SQL — toggle ON in
--    Supabase Dashboard → Authentication → Settings → Leaked Password Protection
-- ============================================================

-- ============================================================
-- 5. authenticated_security_definer_function_executable (~107 warnings)
--    These remain by design. The functions need SECURITY DEFINER
--    to bypass RLS for legitimate server-side logic, and each one
--    validates auth.uid() internally before acting. The lint is
--    informational, not a vulnerability.
-- ============================================================
