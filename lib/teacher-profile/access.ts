// ─── Eligible roles ───────────────────────────────────────────────────────────

export const TEACHER_PROFILE_ELIGIBLE_ROLES = [
  "teacher",
  "artist",
  "instructor",
  "organizer",
] as const;

// ─── Eligibility check ────────────────────────────────────────────────────────

export function isTeacherProfileEligible(roles: string[]): boolean {
  const normalized = new Set(roles.map((r) => r.trim().toLowerCase()));
  return (TEACHER_PROFILE_ELIGIBLE_ROLES as readonly string[]).some((role) =>
    normalized.has(role)
  );
}

// ─── Access level ─────────────────────────────────────────────────────────────

export type TeacherProfileAccessLevel =
  | "ineligible"
  | "trial_active"
  | "trial_expired"
  | "verified"
  | "disabled";

export type GetTeacherProfileAccessLevelParams = {
  roles: string[];
  teacherProfileEnabled: boolean;
  trialEndsAt: string | null;
  isVerified: boolean;
};

export function getTeacherProfileAccessLevel(
  params: GetTeacherProfileAccessLevelParams
): TeacherProfileAccessLevel {
  const { roles, teacherProfileEnabled, trialEndsAt, isVerified } = params;

  if (!isTeacherProfileEligible(roles)) return "ineligible";
  if (!teacherProfileEnabled) return "disabled";
  if (isVerified) return "verified";

  if (trialEndsAt !== null) {
    const endsAt = new Date(trialEndsAt);
    if (Number.isNaN(endsAt.getTime())) return "trial_expired";
    return endsAt > new Date() ? "trial_active" : "trial_expired";
  }

  return "disabled";
}

// ─── Usage gate ───────────────────────────────────────────────────────────────

export type CanUseTeacherProfileParams = GetTeacherProfileAccessLevelParams;

export function canUseTeacherProfile(params: CanUseTeacherProfileParams): boolean {
  const level = getTeacherProfileAccessLevel(params);
  return level === "trial_active" || level === "verified";
}

// ─── Trial helpers ────────────────────────────────────────────────────────────

/**
 * Returns the number of whole days remaining in the trial, or `null` if no
 * `trialEndsAt` is set.  Returns `0` when the trial is already expired.
 */
export function teacherProfileTrialDaysRemaining(trialEndsAt: string | null): number | null {
  if (trialEndsAt === null) return null;
  const endsAt = new Date(trialEndsAt);
  if (Number.isNaN(endsAt.getTime())) return null;

  const msRemaining = endsAt.getTime() - Date.now();
  if (msRemaining <= 0) return 0;
  return Math.floor(msRemaining / (1000 * 60 * 60 * 24));
}

/**
 * Returns ISO timestamps for the start and end of a new 2-month trial
 * beginning right now.
 */
export function shouldStartTrial(): { trialStartedAt: string; trialEndsAt: string } {
  const now = new Date();
  const trialStartedAt = now.toISOString();

  const ends = new Date(now);
  ends.setMonth(ends.getMonth() + 2);
  const trialEndsAt = ends.toISOString();

  return { trialStartedAt, trialEndsAt };
}
