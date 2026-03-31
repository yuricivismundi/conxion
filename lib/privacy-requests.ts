export const PRIVACY_REQUEST_TYPE_OPTIONS = [
  { value: "access", label: "Access request", description: "Ask for a copy of the personal data ConXion holds about you." },
  { value: "portability", label: "Portability", description: "Ask for portable data where the right applies." },
  { value: "erasure", label: "Erasure", description: "Ask for deletion where ConXion no longer has a lawful basis to keep the data." },
  { value: "rectification", label: "Rectification", description: "Ask to correct inaccurate or incomplete data." },
  { value: "objection", label: "Object to processing", description: "Object to a processing activity, including certain legitimate-interest uses." },
  { value: "restriction", label: "Restriction", description: "Ask ConXion to limit processing while a request or dispute is reviewed." },
  { value: "consent_withdrawal", label: "Withdraw consent", description: "Withdraw consent for a consent-based activity where applicable." },
  { value: "other", label: "Other privacy issue", description: "Use this for privacy issues that do not fit the other categories." },
] as const;

export const PRIVACY_REQUEST_SCOPE_OPTIONS = [
  { value: "all_data", label: "All data" },
  { value: "account_profile", label: "Account & profile" },
  { value: "messages_connections", label: "Messages & connections" },
  { value: "trips_hosting", label: "Trips & hosting" },
  { value: "events", label: "Events" },
  { value: "billing_verification", label: "Billing & verification" },
  { value: "support_safety", label: "Support & safety" },
] as const;

export const PRIVACY_REQUEST_STATUS_OPTIONS = ["open", "under_review", "needs_info", "resolved", "dismissed"] as const;

export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPE_OPTIONS)[number]["value"];
export type PrivacyRequestScopeTag = (typeof PRIVACY_REQUEST_SCOPE_OPTIONS)[number]["value"];
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUS_OPTIONS)[number];

export const PRIVACY_REQUEST_TYPE_LABELS: Record<PrivacyRequestType, string> = Object.fromEntries(
  PRIVACY_REQUEST_TYPE_OPTIONS.map((option) => [option.value, option.label])
) as Record<PrivacyRequestType, string>;

const PRIVACY_REQUEST_SCOPE_LABELS: Record<PrivacyRequestScopeTag, string> = Object.fromEntries(
  PRIVACY_REQUEST_SCOPE_OPTIONS.map((option) => [option.value, option.label])
) as Record<PrivacyRequestScopeTag, string>;

export function isPrivacyRequestType(value: unknown): value is PrivacyRequestType {
  return PRIVACY_REQUEST_TYPE_OPTIONS.some((option) => option.value === value);
}

export function isPrivacyRequestScopeTag(value: unknown): value is PrivacyRequestScopeTag {
  return PRIVACY_REQUEST_SCOPE_OPTIONS.some((option) => option.value === value);
}

export function isPrivacyRequestStatus(value: unknown): value is PrivacyRequestStatus {
  return PRIVACY_REQUEST_STATUS_OPTIONS.some((option) => option === value);
}

export function normalizePrivacyRequestScopeTags(value: unknown): PrivacyRequestScopeTag[] {
  if (!Array.isArray(value)) return [];
  const tags = value.filter((item): item is PrivacyRequestScopeTag => isPrivacyRequestScopeTag(item));
  return Array.from(new Set(tags));
}

export function formatPrivacyRequestTypeLabel(value: string | null | undefined) {
  if (value && isPrivacyRequestType(value)) return PRIVACY_REQUEST_TYPE_LABELS[value];
  return "Privacy request";
}

export function formatPrivacyRequestScopeTags(value: unknown) {
  const tags = normalizePrivacyRequestScopeTags(value);
  if (tags.length === 0) return "No scope selected";
  return tags.map((tag) => PRIVACY_REQUEST_SCOPE_LABELS[tag]).join(" • ");
}

export function formatPrivacyRequestStatusLabel(value: string | null | undefined) {
  const key = (value ?? "").trim().toLowerCase();
  if (key === "resolved") return "Resolved";
  if (key === "dismissed") return "Dismissed";
  if (key === "needs_info") return "Needs info";
  if (key === "under_review") return "Under review";
  return "Open";
}

export function privacyRequestStatusChipClass(value: string | null | undefined) {
  const key = (value ?? "").trim().toLowerCase();
  if (key === "resolved") return "border-emerald-300/30 bg-emerald-300/12 text-emerald-100";
  if (key === "dismissed") return "border-rose-300/30 bg-rose-300/12 text-rose-100";
  if (key === "needs_info") return "border-amber-300/30 bg-amber-300/12 text-amber-100";
  if (key === "under_review") return "border-cyan-300/30 bg-cyan-300/12 text-cyan-100";
  return "border-white/15 bg-white/[0.05] text-white/85";
}
