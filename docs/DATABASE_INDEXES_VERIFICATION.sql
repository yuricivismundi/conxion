-- Pre-deployment Database Index Verification
-- Run these queries to verify all critical indexes exist
-- Status: ✅ READY FOR DEPLOYMENT CHECK

-- 1. Profiles table indexes
-- Used for: user lookups, profile searches, role filtering
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'profiles'
ORDER BY indexname;

-- Expected indexes:
-- - profiles_pkey (user_id PRIMARY KEY)
-- - profiles_username_idx (username unique/index)
-- - profiles_roles_idx (roles GIN index for array searches)

-- 2. Thread contexts indexes
-- Used for: message filtering by activity, booking, service inquiry
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'thread_contexts'
ORDER BY indexname;

-- Expected indexes:
-- - thread_contexts_pkey (id PRIMARY KEY)
-- - thread_contexts_thread_id_idx (thread_id for lookups)
-- - thread_contexts_context_tag_idx (context_tag for filtering)

-- 3. Activities table indexes
-- Used for: user activity lookups, status filtering, pagination
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'activities'
ORDER BY indexname;

-- Expected indexes:
-- - activities_pkey (id PRIMARY KEY)
-- - activities_requester_id_idx (requester filtering)
-- - activities_recipient_id_idx (recipient filtering)
-- - activities_thread_id_idx (thread lookups)
-- - activities_created_at_idx (pagination/sorting)

-- 4. Events table indexes
-- Used for: event browsing, filtering by date/status, pagination
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'events'
ORDER BY indexname;

-- Expected indexes:
-- - events_pkey (id PRIMARY KEY)
-- - events_host_user_id_idx (user's events lookup)
-- - events_starts_at_idx (date filtering)
-- - events_status_idx (visibility/status filtering)

-- 5. Groups table indexes
-- Used for: group lookups, member filtering, pagination
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'groups'
ORDER BY indexname;

-- Expected indexes:
-- - groups_pkey (id PRIMARY KEY)
-- - groups_host_user_id_idx (user's groups)
-- - groups_status_idx (active groups filtering)

-- 6. Group members indexes
-- Used for: member role checking, pagination
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'group_members'
ORDER BY indexname;

-- Expected indexes:
-- - group_members_pkey (group_id, user_id PRIMARY KEY)
-- - group_members_user_id_idx (user's groups lookup)
-- - group_members_role_idx (role filtering)

-- 7. Teacher session availability indexes
-- Used for: booking slot lookups, availability checking, date filtering
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'teacher_session_availability'
ORDER BY indexname;

-- Expected indexes:
-- - teacher_session_availability_pkey (id PRIMARY KEY)
-- - teacher_session_availability_teacher_id_idx (teacher's slots)
-- - teacher_session_availability_date_idx (date filtering)
-- - teacher_session_availability_is_available_idx (availability filtering)

-- 8. Teacher session bookings indexes
-- Used for: booking status lookups, user bookings filtering
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'teacher_session_bookings'
ORDER BY indexname;

-- Expected indexes:
-- - teacher_session_bookings_pkey (id PRIMARY KEY)
-- - teacher_session_bookings_teacher_id_idx (teacher's bookings)
-- - teacher_session_bookings_student_id_idx (student's bookings)
-- - teacher_session_bookings_status_idx (status filtering)

-- N+1 Query Detection
-- Check for queries that might fetch single rows in loops

-- ANTI-PATTERN: Fetching profiles one by one
-- ❌ for (const id of userIds) {
--      const profile = await fetchProfile(id); // N+1!
--    }
-- ✅ Instead: const profiles = await fetchProfiles(userIds); // Batch

-- ANTI-PATTERN: Fetching thread contexts one by one
-- ❌ for (const threadId of threadIds) {
--      const context = await getThreadContext(threadId); // N+1!
--    }
-- ✅ Instead: const contexts = await getThreadContexts(threadIds); // Batch

-- Query Performance Baselines
-- After deployment, monitor these metrics:
-- - Profile lookups: < 5ms
-- - Activity list (paginated): < 50ms
-- - Event list (paginated): < 75ms
-- - Group member list: < 50ms
-- - Booking availability check: < 10ms

-- Schema Check
-- Verify all required tables and columns exist
SELECT
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Constraint Check
-- Verify foreign keys are in place (RLS policies must still be enforced!)
SELECT
  constraint_name,
  constraint_type,
  table_name
FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND constraint_type = 'FOREIGN KEY'
ORDER BY table_name;
