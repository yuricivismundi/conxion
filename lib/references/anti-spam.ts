import { normalizeActivityType, normalizeReferenceContextTag, type ActivityType, type ReferenceContextTag } from "@/lib/activities/types";

export const REFERENCE_PUBLIC_CATEGORIES = [
  "Practice",
  "Social Dance",
  "Event / Festival",
  "Travelling",
  "Request Hosting",
  "Offer Hosting",
  "Collaborate",
  "Classes",
] as const;

export type PublicReferenceCategory = (typeof REFERENCE_PUBLIC_CATEGORIES)[number];

export const REFERENCE_FAMILIES = [
  "practice_social",
  "event_collab",
  "hosting_trip",
  "teaching",
] as const;

export type ReferenceFamily = (typeof REFERENCE_FAMILIES)[number];

export type ReferenceRule =
  | {
      category: PublicReferenceCategory;
      family: ReferenceFamily;
      mode: "per_activity";
      cooldownDays: null;
    }
  | {
      category: PublicReferenceCategory;
      family: ReferenceFamily;
      mode: "family_cooldown";
      cooldownDays: number;
    };

export type ReferenceSourceType =
  | "practice_activity"
  | "social_dance_activity"
  | "event_participation"
  | "travel_activity"
  | "hosting_stay"
  | "collaboration_activity"
  | "class_activity"
  | "legacy";

function normalizeCategoryKey(value: string) {
  return value.trim().toLowerCase();
}

export function normalizePublicReferenceCategory(value: string | null | undefined): PublicReferenceCategory | null {
  const key = normalizeCategoryKey(value ?? "");
  switch (key) {
    case "practice":
      return "Practice";
    case "social dance":
    case "social_dance":
      return "Social Dance";
    case "event / festival":
    case "event/festival":
    case "event_festival":
      return "Event / Festival";
    case "travelling":
    case "travel":
      return "Travelling";
    case "request hosting":
    case "request_hosting":
      return "Request Hosting";
    case "offer hosting":
    case "offer_hosting":
      return "Offer Hosting";
    case "collaborate":
    case "collaboration":
      return "Collaborate";
    case "classes":
    case "private class":
    case "private_class":
      return "Classes";
    default:
      return null;
  }
}

export function mapActivityTypeToPublicReferenceCategory(activityType: ActivityType | string): PublicReferenceCategory {
  switch (normalizeActivityType(activityType)) {
    case "practice":
      return "Practice";
    case "private_class":
      return "Classes";
    case "social_dance":
      return "Social Dance";
    case "event_festival":
      return "Event / Festival";
    case "travelling":
      return "Travelling";
    case "request_hosting":
      return "Request Hosting";
    case "offer_hosting":
      return "Offer Hosting";
    case "collaborate":
    default:
      return "Collaborate";
  }
}

export function mapReferenceContextTagToPublicCategory(contextTag: ReferenceContextTag | string): PublicReferenceCategory {
  return mapActivityTypeToPublicReferenceCategory(normalizeReferenceContextTag(String(contextTag)));
}

export function mapPublicActivityCategoryToReferenceFamily(category: PublicReferenceCategory | string): ReferenceFamily {
  switch (normalizePublicReferenceCategory(String(category)) ?? "Collaborate") {
    case "Practice":
    case "Social Dance":
      return "practice_social";
    case "Classes":
      return "teaching";
    case "Travelling":
    case "Request Hosting":
    case "Offer Hosting":
      return "hosting_trip";
    case "Event / Festival":
    case "Collaborate":
    default:
      return "event_collab";
  }
}

export function getReferenceCooldownDays(category: PublicReferenceCategory | string): number | null {
  switch (normalizePublicReferenceCategory(String(category)) ?? "Collaborate") {
    case "Practice":
    case "Social Dance":
      return 120;
    case "Classes":
      return 90;
    default:
      return null;
  }
}

export function getReferenceRuleForCategory(category: PublicReferenceCategory | string): ReferenceRule {
  const normalized = normalizePublicReferenceCategory(String(category)) ?? "Collaborate";
  const family = mapPublicActivityCategoryToReferenceFamily(normalized);
  const cooldownDays = getReferenceCooldownDays(normalized);
  if (cooldownDays !== null) {
    return {
      category: normalized,
      family,
      mode: "family_cooldown",
      cooldownDays,
    };
  }
  return {
    category: normalized,
    family,
    mode: "per_activity",
    cooldownDays: null,
  };
}

export function isPerActivityReferenceCategory(category: PublicReferenceCategory | string) {
  return getReferenceRuleForCategory(category).mode === "per_activity";
}

export function isCooldownReferenceCategory(category: PublicReferenceCategory | string) {
  return getReferenceRuleForCategory(category).mode === "family_cooldown";
}

export function referenceSourceTypeForOrigin(params: {
  contextTag: ReferenceContextTag | string;
  sourceTable?: string | null;
}): ReferenceSourceType {
  const contextTag = normalizeReferenceContextTag(String(params.contextTag));
  const sourceTable = (params.sourceTable ?? "").trim().toLowerCase();

  if (sourceTable === "trip_requests" || contextTag === "travelling") return "travel_activity";
  if (sourceTable === "hosting_requests" || contextTag === "request_hosting" || contextTag === "offer_hosting") {
    return "hosting_stay";
  }
  if (sourceTable === "events" || contextTag === "event_festival") return "event_participation";
  if (sourceTable === "connection_syncs" && contextTag === "social_dance") return "social_dance_activity";
  if (sourceTable === "connection_syncs" && contextTag === "private_class") return "class_activity";
  if (sourceTable === "connection_syncs" && contextTag === "practice") return "practice_activity";

  switch (contextTag) {
    case "practice":
      return "practice_activity";
    case "private_class":
      return "class_activity";
    case "social_dance":
      return "social_dance_activity";
    case "collaborate":
      return "collaboration_activity";
    default:
      return "legacy";
  }
}

export function addDaysIso(value: string, days: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
