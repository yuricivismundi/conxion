/**
 * Hosting trust gate.
 *
 * Requesting to stay at someone's place requires a COMPLETE profile whose
 * photo has been APPROVED by an admin (profiles.avatar_status = 'approved'):
 *   - display name, home city and country
 *   - an uploaded profile photo that an admin approved
 *   - a bio of at least HOSTING_TRUST_MIN_BIO_CHARS characters
 *   - at least one dance style and one role
 *
 * Admins review photos in Admin → Moderation. If a photo or profile isn't good
 * enough they reject it or send feedback, which opens a support thread in the
 * member's Messages (see app/api/admin/photo-review/route.ts).
 *
 * The rule applies to everyone, Verified members included. Optional extra:
 * a minimum account age (off while HOSTING_TRUST_MIN_ACCOUNT_AGE_DAYS = 0).
 * Emergency switch: NEXT_PUBLIC_HOSTING_TRUST_GATE=false makes hosting
 * login-only (not recommended).
 */
import { isPaymentVerified } from "@/lib/verification";

/** On by default. Set NEXT_PUBLIC_HOSTING_TRUST_GATE=false to make hosting login-only. */
export const HOSTING_TRUST_GATE_ENABLED = process.env.NEXT_PUBLIC_HOSTING_TRUST_GATE !== "false";

/** 0 = no account-age requirement (admin photo approval is the human check). */
export const HOSTING_TRUST_MIN_ACCOUNT_AGE_DAYS = 0;
export const HOSTING_TRUST_MIN_BIO_CHARS = 40;

/** Columns to select from `profiles` to evaluate the gate. */
export const HOSTING_TRUST_PROFILE_COLUMNS =
  "verified,verified_label,display_name,avatar_path,avatar_url,avatar_status,bio,city,country,dance_skills,roles";

export type HostingTrustProfile = {
  verified?: unknown;
  verified_label?: unknown;
  display_name?: unknown;
  avatar_path?: unknown;
  avatar_url?: unknown;
  avatar_status?: unknown;
  bio?: unknown;
  city?: unknown;
  country?: unknown;
  dance_skills?: unknown;
  roles?: unknown;
};

export type HostingTrustRequirement =
  | "display_name"
  | "photo"
  | "photo_pending"
  | "photo_rejected"
  | "bio"
  | "city"
  | "country"
  | "dance_styles"
  | "roles"
  | "account_age";

/** Checklist rows, in display order. The three photo states share one row. */
export const HOSTING_TRUST_CHECKLIST: HostingTrustRequirement[] = [
  "display_name",
  "photo",
  "bio",
  "city",
  "country",
  "dance_styles",
  "roles",
  ...(HOSTING_TRUST_MIN_ACCOUNT_AGE_DAYS > 0 ? (["account_age"] as const) : []),
];

export const PHOTO_REQUIREMENTS: HostingTrustRequirement[] = ["photo", "photo_pending", "photo_rejected"];

export const HOSTING_TRUST_REQUIREMENT_LABELS: Record<HostingTrustRequirement, string> = {
  display_name: "Your name",
  photo: "A profile photo approved by our team",
  photo_pending: "Profile photo approved by our team (yours is waiting for review)",
  photo_rejected: "A new profile photo (the last one wasn't approved, see the admin message in Messages)",
  bio: `A short bio (at least ${HOSTING_TRUST_MIN_BIO_CHARS} characters)`,
  city: "Your home city",
  country: "Your country",
  dance_styles: "At least one dance style",
  roles: "Your role (e.g. Social Dancer, Teacher)",
  account_age: `An account at least ${HOSTING_TRUST_MIN_ACCOUNT_AGE_DAYS} days old`,
};

export type HostingTrustResult = {
  allowed: boolean;
  missing: HostingTrustRequirement[];
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function hasUploadedPhoto(profile: HostingTrustProfile) {
  if (text(profile.avatar_path)) return true;
  const url = text(profile.avatar_url);
  return url.startsWith("http") && !url.includes("pravatar.cc");
}

function countDanceStyles(value: unknown) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  return 0;
}

export function evaluateHostingTrust(
  profile: HostingTrustProfile | null | undefined,
  accountCreatedAt: string | null | undefined,
  now: Date = new Date(),
  options: { enforceGate?: boolean } = {}
): HostingTrustResult {
  const enforceGate = options.enforceGate ?? HOSTING_TRUST_GATE_ENABLED;

  // Emergency switch: login-only.
  if (!enforceGate) return { allowed: true, missing: [] };

  if (!profile) return { allowed: false, missing: [...HOSTING_TRUST_CHECKLIST] };

  const missing: HostingTrustRequirement[] = [];
  if (!text(profile.display_name)) missing.push("display_name");

  const avatarStatus = text(profile.avatar_status).toLowerCase();
  if (avatarStatus === "rejected") missing.push("photo_rejected");
  else if (!hasUploadedPhoto(profile)) missing.push("photo");
  else if (avatarStatus !== "approved") missing.push("photo_pending");

  if (text(profile.bio).length < HOSTING_TRUST_MIN_BIO_CHARS) missing.push("bio");
  if (!text(profile.city)) missing.push("city");
  if (!text(profile.country)) missing.push("country");
  if (countDanceStyles(profile.dance_skills) === 0) missing.push("dance_styles");
  if (!Array.isArray(profile.roles) || profile.roles.length === 0) missing.push("roles");

  if (HOSTING_TRUST_MIN_ACCOUNT_AGE_DAYS > 0) {
    const created = accountCreatedAt ? new Date(accountCreatedAt).getTime() : NaN;
    const minAgeMs = HOSTING_TRUST_MIN_ACCOUNT_AGE_DAYS * 24 * 60 * 60 * 1000;
    if (Number.isNaN(created) || now.getTime() - created < minAgeMs) missing.push("account_age");
  }

  return { allowed: missing.length === 0, missing };
}

/** Kept for reference: the old paid-verification rule. */
export function isPaidVerifiedForHosting(profile: HostingTrustProfile | null | undefined) {
  return isPaymentVerified(profile ?? null);
}

export function hostingTrustErrorMessage(result: HostingTrustResult) {
  if (result.allowed) return null;
  const items = result.missing.map((m) => HOSTING_TRUST_REQUIREMENT_LABELS[m].toLowerCase());
  return `To keep hosts safe, requesting hosting needs a complete profile with an approved photo. Still missing: ${items.join("; ")}.`;
}
