// ─── Primitive helpers (module-private) ──────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  const text = asString(value).trim();
  return text ? text : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      // fall through
    }
  }
  return [];
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const TEACHER_PROFILE_DEFAULT_VIEWS = ["social", "teacher"] as const;

export const TEACHER_CLASS_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export const TEACHER_CLASS_CONFIRMATION_STATUSES = [
  "pending_confirmation",
  "confirmed",
  "declined",
  "cancelled",
  "completed",
] as const;

export type TeacherProfileDefaultView = (typeof TEACHER_PROFILE_DEFAULT_VIEWS)[number];
export type TeacherClassDay = (typeof TEACHER_CLASS_DAYS)[number];
export type TeacherClassConfirmationStatus = (typeof TEACHER_CLASS_CONFIRMATION_STATUSES)[number];

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isTeacherProfileDefaultView(value: unknown): value is TeacherProfileDefaultView {
  return typeof value === "string" && (TEACHER_PROFILE_DEFAULT_VIEWS as readonly string[]).includes(value);
}

export function isTeacherClassDay(value: unknown): value is TeacherClassDay {
  return typeof value === "string" && (TEACHER_CLASS_DAYS as readonly string[]).includes(value);
}

export function isTeacherClassConfirmationStatus(value: unknown): value is TeacherClassConfirmationStatus {
  return (
    typeof value === "string" &&
    (TEACHER_CLASS_CONFIRMATION_STATUSES as readonly string[]).includes(value)
  );
}

// ─── Domain types ─────────────────────────────────────────────────────────────

export type TeacherProfileRecord = {
  userId: string;
  teacherProfileEnabled: boolean;
  teacherProfileTrialStartedAt: string | null;
  teacherProfileTrialEndsAt: string | null;
  defaultPublicView: TeacherProfileDefaultView;
  headline: string | null;
  bio: string | null;
  baseCity: string | null;
  baseSchool: string | null;
  languages: string[];
  travelAvailable: boolean;
  availabilitySummary: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TeacherRegularClass = {
  id: string;
  userId: string;
  title: string;
  shortSummary: string | null;
  location: string | null;
  dayOfWeek: TeacherClassDay | null;
  timeText: string | null;
  priceText: string | null;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type TeacherEventTeaching = {
  id: string;
  userId: string;
  title: string;
  shortSummary: string | null;
  eventDate: string | null;
  location: string | null;
  eventUrl: string | null;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type TeacherWeeklyAvailability = {
  id: string;
  userId: string;
  dayOfWeek: TeacherClassDay;
  startTime: string;
  endTime: string;
  notes: string | null;
  position: number;
  createdAt: string;
};

export type TeacherStudent = {
  id: string;
  teacherUserId: string;
  studentUserId: string | null;
  displayName: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TeacherStudentSession = {
  id: string;
  teacherStudentId: string;
  sessionDate: string | null;
  durationMinutes: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TeacherClassConfirmation = {
  id: string;
  teacherUserId: string;
  studentUserId: string;
  classTitle: string;
  scheduledAt: string | null;
  durationMinutes: number | null;
  location: string | null;
  notes: string | null;
  status: TeacherClassConfirmationStatus;
  confirmedAt: string | null;
  declinedAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ─── Normalizers ──────────────────────────────────────────────────────────────

export function normalizeTeacherProfileRow(row: unknown): TeacherProfileRecord | null {
  const record = asRecord(row);
  const userId = asString(record.user_id ?? record.userId).trim();
  if (!userId) return null;

  const defaultPublicViewRaw = asString(
    record.default_public_view ?? record.defaultPublicView
  ).trim();

  return {
    userId,
    teacherProfileEnabled: asBoolean(
      record.teacher_profile_enabled ?? record.teacherProfileEnabled,
      false
    ),
    teacherProfileTrialStartedAt: asNullableString(
      record.teacher_profile_trial_started_at ?? record.teacherProfileTrialStartedAt
    ),
    teacherProfileTrialEndsAt: asNullableString(
      record.teacher_profile_trial_ends_at ?? record.teacherProfileTrialEndsAt
    ),
    defaultPublicView: isTeacherProfileDefaultView(defaultPublicViewRaw)
      ? defaultPublicViewRaw
      : "social",
    headline: asNullableString(record.headline),
    bio: asNullableString(record.bio),
    baseCity: asNullableString(record.base_city ?? record.baseCity),
    baseSchool: asNullableString(record.base_school ?? record.baseSchool),
    languages: asStringArray(record.languages),
    travelAvailable: asBoolean(record.travel_available ?? record.travelAvailable, false),
    availabilitySummary: asNullableString(
      record.availability_summary ?? record.availabilitySummary
    ),
    isPublic: asBoolean(record.is_public ?? record.isPublic, false),
    createdAt: asString(record.created_at ?? record.createdAt) || new Date(0).toISOString(),
    updatedAt: asString(record.updated_at ?? record.updatedAt) || new Date(0).toISOString(),
  };
}

export function normalizeTeacherRegularClassRow(row: unknown): TeacherRegularClass | null {
  const record = asRecord(row);
  const id = asString(record.id).trim();
  const userId = asString(record.user_id ?? record.userId).trim();
  const title = asString(record.title).trim();
  if (!id || !userId || !title) return null;

  const dayRaw = asString(record.day_of_week ?? record.dayOfWeek).trim();

  return {
    id,
    userId,
    title,
    shortSummary: asNullableString(record.short_summary ?? record.shortSummary),
    location: asNullableString(record.location),
    dayOfWeek: isTeacherClassDay(dayRaw) ? dayRaw : null,
    timeText: asNullableString(record.time_text ?? record.timeText),
    priceText: asNullableString(record.price_text ?? record.priceText),
    isActive: asBoolean(record.is_active ?? record.isActive, true),
    position: Math.max(0, Math.round(asNumber(record.position, 0))),
    createdAt: asString(record.created_at ?? record.createdAt) || new Date(0).toISOString(),
    updatedAt: asString(record.updated_at ?? record.updatedAt) || new Date(0).toISOString(),
  };
}

export function normalizeTeacherEventTeachingRow(row: unknown): TeacherEventTeaching | null {
  const record = asRecord(row);
  const id = asString(record.id).trim();
  const userId = asString(record.user_id ?? record.userId).trim();
  const title = asString(record.title).trim();
  if (!id || !userId || !title) return null;

  return {
    id,
    userId,
    title,
    shortSummary: asNullableString(record.short_summary ?? record.shortSummary),
    eventDate: asNullableString(record.event_date ?? record.eventDate),
    location: asNullableString(record.location),
    eventUrl: asNullableString(record.event_url ?? record.eventUrl),
    isActive: asBoolean(record.is_active ?? record.isActive, true),
    position: Math.max(0, Math.round(asNumber(record.position, 0))),
    createdAt: asString(record.created_at ?? record.createdAt) || new Date(0).toISOString(),
    updatedAt: asString(record.updated_at ?? record.updatedAt) || new Date(0).toISOString(),
  };
}

export function normalizeTeacherWeeklyAvailabilityRow(row: unknown): TeacherWeeklyAvailability | null {
  const record = asRecord(row);
  const id = asString(record.id).trim();
  const userId = asString(record.user_id ?? record.userId).trim();
  const dayRaw = asString(record.day_of_week ?? record.dayOfWeek).trim();
  const startTime = asString(record.start_time ?? record.startTime).trim();
  const endTime = asString(record.end_time ?? record.endTime).trim();
  if (!id || !userId || !isTeacherClassDay(dayRaw) || !startTime || !endTime) return null;

  return {
    id,
    userId,
    dayOfWeek: dayRaw,
    startTime,
    endTime,
    notes: asNullableString(record.notes),
    position: Math.max(0, Math.round(asNumber(record.position, 0))),
    createdAt: asString(record.created_at ?? record.createdAt) || new Date(0).toISOString(),
  };
}

export function normalizeTeacherStudentRow(row: unknown): TeacherStudent | null {
  const record = asRecord(row);
  const id = asString(record.id).trim();
  const teacherUserId = asString(record.teacher_user_id ?? record.teacherUserId).trim();
  const displayName = asString(record.display_name ?? record.displayName).trim();
  if (!id || !teacherUserId || !displayName) return null;

  const studentUserIdRaw = asString(record.student_user_id ?? record.studentUserId).trim();

  return {
    id,
    teacherUserId,
    studentUserId: studentUserIdRaw || null,
    displayName,
    notes: asNullableString(record.notes),
    isActive: asBoolean(record.is_active ?? record.isActive, true),
    createdAt: asString(record.created_at ?? record.createdAt) || new Date(0).toISOString(),
    updatedAt: asString(record.updated_at ?? record.updatedAt) || new Date(0).toISOString(),
  };
}

export function normalizeTeacherStudentSessionRow(row: unknown): TeacherStudentSession | null {
  const record = asRecord(row);
  const id = asString(record.id).trim();
  const teacherStudentId = asString(record.teacher_student_id ?? record.teacherStudentId).trim();
  if (!id || !teacherStudentId) return null;

  const durationRaw = record.duration_minutes ?? record.durationMinutes;
  const duration =
    typeof durationRaw === "number" && Number.isFinite(durationRaw) && durationRaw > 0
      ? durationRaw
      : null;

  return {
    id,
    teacherStudentId,
    sessionDate: asNullableString(record.session_date ?? record.sessionDate),
    durationMinutes: duration,
    notes: asNullableString(record.notes),
    createdAt: asString(record.created_at ?? record.createdAt) || new Date(0).toISOString(),
    updatedAt: asString(record.updated_at ?? record.updatedAt) || new Date(0).toISOString(),
  };
}

export function normalizeTeacherClassConfirmationRow(row: unknown): TeacherClassConfirmation | null {
  const record = asRecord(row);
  const id = asString(record.id).trim();
  const teacherUserId = asString(record.teacher_user_id ?? record.teacherUserId).trim();
  const studentUserId = asString(record.student_user_id ?? record.studentUserId).trim();
  const classTitle = asString(record.class_title ?? record.classTitle).trim();
  const statusRaw = asString(record.status).trim();
  if (!id || !teacherUserId || !studentUserId || !classTitle || !isTeacherClassConfirmationStatus(statusRaw)) {
    return null;
  }

  const durationRaw = record.duration_minutes ?? record.durationMinutes;
  const duration =
    typeof durationRaw === "number" && Number.isFinite(durationRaw) && durationRaw > 0
      ? durationRaw
      : null;

  return {
    id,
    teacherUserId,
    studentUserId,
    classTitle,
    scheduledAt: asNullableString(record.scheduled_at ?? record.scheduledAt),
    durationMinutes: duration,
    location: asNullableString(record.location),
    notes: asNullableString(record.notes),
    status: statusRaw,
    confirmedAt: asNullableString(record.confirmed_at ?? record.confirmedAt),
    declinedAt: asNullableString(record.declined_at ?? record.declinedAt),
    cancelledAt: asNullableString(record.cancelled_at ?? record.cancelledAt),
    completedAt: asNullableString(record.completed_at ?? record.completedAt),
    createdAt: asString(record.created_at ?? record.createdAt) || new Date(0).toISOString(),
    updatedAt: asString(record.updated_at ?? record.updatedAt) || new Date(0).toISOString(),
  };
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────

export function sortByPositionThenCreatedAt<T extends { position: number; createdAt: string }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
