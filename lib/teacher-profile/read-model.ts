import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeTeacherProfileRow,
  normalizeTeacherRegularClassRow,
  normalizeTeacherEventTeachingRow,
  normalizeTeacherWeeklyAvailabilityRow,
  normalizeTeacherStudentRow,
  normalizeTeacherStudentSessionRow,
  sortByPositionThenCreatedAt,
  type TeacherProfileRecord,
  type TeacherRegularClass,
  type TeacherEventTeaching,
  type TeacherWeeklyAvailability,
  type TeacherStudent,
  type TeacherStudentSession,
} from "@/lib/teacher-profile/types";

// ─── Select column lists ──────────────────────────────────────────────────────

const TEACHER_PROFILE_SELECT = [
  "user_id",
  "teacher_profile_enabled",
  "teacher_profile_trial_started_at",
  "teacher_profile_trial_ends_at",
  "default_public_view",
  "headline",
  "bio",
  "base_city",
  "base_address",
  "base_school",
  "languages",
  "travel_available",
  "availability_summary",
  "is_public",
  "created_at",
  "updated_at",
].join(",");

const TEACHER_REGULAR_CLASS_SELECT = [
  "id",
  "user_id",
  "title",
  "short_summary",
  "location",
  "day_of_week",
  "time_text",
  "price_text",
  "is_active",
  "position",
  "created_at",
  "updated_at",
].join(",");

const TEACHER_EVENT_TEACHING_SELECT = [
  "id",
  "user_id",
  "title",
  "short_summary",
  "event_date",
  "location",
  "event_url",
  "is_active",
  "position",
  "created_at",
  "updated_at",
].join(",");

const TEACHER_WEEKLY_AVAILABILITY_SELECT = [
  "id",
  "user_id",
  "day_of_week",
  "start_time",
  "end_time",
  "notes",
  "position",
  "created_at",
].join(",");

const TEACHER_STUDENT_SELECT = [
  "id",
  "teacher_user_id",
  "student_user_id",
  "display_name",
  "notes",
  "is_active",
  "created_at",
  "updated_at",
].join(",");

const TEACHER_STUDENT_SESSION_SELECT = [
  "id",
  "teacher_student_id",
  "session_date",
  "duration_minutes",
  "notes",
  "created_at",
  "updated_at",
].join(",");

// ─── Fetch functions ──────────────────────────────────────────────────────────

export async function fetchTeacherProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<TeacherProfileRecord | null> {
  const { data, error } = await supabase
    .from("teacher_profiles")
    .select(TEACHER_PROFILE_SELECT)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return normalizeTeacherProfileRow(data);
}

export async function fetchTeacherRegularClasses(
  supabase: SupabaseClient,
  userId: string,
  options?: { activeOnly?: boolean }
): Promise<TeacherRegularClass[]> {
  let query = supabase
    .from("teacher_regular_classes")
    .select(TEACHER_REGULAR_CLASS_SELECT)
    .eq("user_id", userId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (options?.activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw error;

  return sortByPositionThenCreatedAt(
    ((data ?? []) as unknown[])
      .map(normalizeTeacherRegularClassRow)
      .filter((item): item is TeacherRegularClass => item !== null)
  );
}

export async function fetchTeacherEventTeaching(
  supabase: SupabaseClient,
  userId: string,
  options?: { activeOnly?: boolean }
): Promise<TeacherEventTeaching[]> {
  let query = supabase
    .from("teacher_event_teaching")
    .select(TEACHER_EVENT_TEACHING_SELECT)
    .eq("user_id", userId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (options?.activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw error;

  return sortByPositionThenCreatedAt(
    ((data ?? []) as unknown[])
      .map(normalizeTeacherEventTeachingRow)
      .filter((item): item is TeacherEventTeaching => item !== null)
  );
}

export async function fetchTeacherWeeklyAvailability(
  supabase: SupabaseClient,
  userId: string
): Promise<TeacherWeeklyAvailability[]> {
  const { data, error } = await supabase
    .from("teacher_weekly_availability")
    .select(TEACHER_WEEKLY_AVAILABILITY_SELECT)
    .eq("user_id", userId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  return sortByPositionThenCreatedAt(
    ((data ?? []) as unknown[])
      .map(normalizeTeacherWeeklyAvailabilityRow)
      .filter((item): item is TeacherWeeklyAvailability => item !== null)
  );
}

export async function fetchTeacherStudents(
  supabase: SupabaseClient,
  teacherUserId: string
): Promise<TeacherStudent[]> {
  const { data, error } = await supabase
    .from("teacher_students")
    .select(TEACHER_STUDENT_SELECT)
    .eq("teacher_user_id", teacherUserId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown[])
    .map(normalizeTeacherStudentRow)
    .filter((item): item is TeacherStudent => item !== null);
}

export async function fetchTeacherStudentSessions(
  supabase: SupabaseClient,
  teacherStudentId: string
): Promise<TeacherStudentSession[]> {
  const { data, error } = await supabase
    .from("teacher_student_sessions")
    .select(TEACHER_STUDENT_SESSION_SELECT)
    .eq("teacher_student_id", teacherStudentId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown[])
    .map(normalizeTeacherStudentSessionRow)
    .filter((item): item is TeacherStudentSession => item !== null);
}
