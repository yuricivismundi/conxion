/**
 * Dance Page — the public, shareable page every member can turn on
 * (formerly "Teacher page"). Data still lives in `teacher_profiles` and the
 * route stays /profile/[id]/teacher so existing links keep working.
 */
import { hasTeacherBadgeRole } from "@/lib/teacher-info/roles";

export const DANCE_PAGE_NAME = "Dance Page";

export const DANCE_PAGE_LABELS = [
  "Teacher",
  "Artist",
  "Performer",
  "Competitor",
  "DJ",
  "Organizer",
  "Studio Owner",
  "Social Dancer",
] as const;

export type DancePageLabel = (typeof DANCE_PAGE_LABELS)[number];

export function isDancePageLabel(value: unknown): value is DancePageLabel {
  return typeof value === "string" && (DANCE_PAGE_LABELS as readonly string[]).includes(value);
}

const ROLE_TO_LABEL: Array<[string, DancePageLabel]> = [
  ["teacher", "Teacher"],
  ["instructor", "Teacher"],
  ["artist", "Artist"],
  ["dj", "DJ"],
  ["organizer", "Organizer"],
  ["studio owner", "Studio Owner"],
  ["promoter", "Organizer"],
];

/** The label shown on the page: the one the user picked, else derived from their roles. */
export function resolveDancePageLabel(pageLabel: unknown, roles: string[] | null | undefined): DancePageLabel {
  if (isDancePageLabel(pageLabel)) return pageLabel;
  const normalized = new Set((roles ?? []).map((r) => r.trim().toLowerCase()));
  for (const [role, label] of ROLE_TO_LABEL) {
    if (normalized.has(role)) return label;
  }
  return "Social Dancer";
}

/** Teaching sections (private-class booking, weekly classes, service inquiries). */
export function showsTeachingSections(label: DancePageLabel, roles: string[] | null | undefined) {
  return label === "Teacher" || hasTeacherBadgeRole(roles);
}

/**
 * The shareable Dance Page link. The social profile (/u/username) is always the
 * default; the Dance Page lives on its own URL and is only opened explicitly.
 */
export function dancePagePath(params: { username?: string | null; userId: string }) {
  const username = (params.username ?? "").trim();
  return username ? `/u/${encodeURIComponent(username)}/dance` : `/profile/${encodeURIComponent(params.userId)}/teacher`;
}
