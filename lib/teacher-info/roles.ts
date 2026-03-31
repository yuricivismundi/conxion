import { TEACHER_BADGE_ROLE, TEACHER_INFO_ROLE_TOKENS } from "@/lib/teacher-info/types";

function normalizeRole(value: string) {
  return value.trim().toLowerCase();
}

export function hasProfileRole(roles: string[] | null | undefined, role: string) {
  const needle = normalizeRole(role);
  return (roles ?? []).some((item) => normalizeRole(item) === needle);
}

export function hasTeacherBadgeRole(roles: string[] | null | undefined) {
  return hasProfileRole(roles, TEACHER_BADGE_ROLE);
}

export function canManageTeacherInfo(roles: string[] | null | undefined) {
  const normalized = new Set((roles ?? []).map(normalizeRole));
  return TEACHER_INFO_ROLE_TOKENS.some((role) => normalized.has(role));
}
