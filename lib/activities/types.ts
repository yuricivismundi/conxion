export const ACTIVITY_TYPES = [
  "practice",
  "social_dance",
  "event",
  "festival",
  "travel_together",
  "hosting",
  "stay_as_guest",
  "private_class",
  "group_class",
  "workshop",
  "collaboration",
  "content_video",
  "competition",
] as const;

export const RANGE_ACTIVITY_TYPES = [
  "festival",
  "travel_together",
  "hosting",
  "stay_as_guest",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const REFERENCE_CONTEXT_TAGS = ACTIVITY_TYPES;

export type ReferenceContextTag = (typeof REFERENCE_CONTEXT_TAGS)[number];

export function isActivityType(value: unknown): value is ActivityType {
  return typeof value === "string" && (ACTIVITY_TYPES as readonly string[]).includes(value);
}

export function activityUsesDateRange(value: ActivityType | string) {
  return (RANGE_ACTIVITY_TYPES as readonly string[]).includes(String(value).trim());
}

export function activityTypeLabel(value: ActivityType | string) {
  switch (String(value).trim()) {
    case "practice":
      return "Practice";
    case "social_dance":
      return "Social Dance";
    case "event":
      return "Event";
    case "festival":
      return "Festival";
    case "travel_together":
      return "Travel Together";
    case "hosting":
      return "Offer Hosting";
    case "stay_as_guest":
      return "Request Hosting";
    case "private_class":
      return "Private Class";
    case "group_class":
      return "Group Class";
    case "workshop":
      return "Workshop";
    case "collaboration":
      return "Collaboration";
    case "content_video":
      return "Content / Video";
    case "competition":
      return "Competition";
    default:
      return "Activity";
  }
}

export function referenceContextLabel(value: ReferenceContextTag | string) {
  return activityTypeLabel(value);
}

export function referenceContextShortLabel(value: ReferenceContextTag | string) {
  switch (String(value).trim()) {
    case "travel_together":
      return "Travel";
    case "stay_as_guest":
      return "Guest";
    case "private_class":
      return "Private Class";
    case "group_class":
      return "Group Class";
    case "content_video":
      return "Content";
    default:
      return activityTypeLabel(value);
  }
}

export function normalizeReferenceContextTag(value: string): ReferenceContextTag {
  const key = value.trim().toLowerCase();
  if ((REFERENCE_CONTEXT_TAGS as readonly string[]).includes(key)) {
    return key as ReferenceContextTag;
  }
  if (key === "sync" || key === "practice_sync" || key.includes("practice")) return "practice";
  if (key === "trip" || key === "travel" || key === "traveling" || key === "travel_trip") return "travel_together";
  if (key === "host" || key === "hosting" || key === "offer_to_host") return "hosting";
  if (key === "guest" || key === "request_hosting" || key === "stay") return "stay_as_guest";
  if (key === "event" || key === "events") return "event";
  if (key === "festival" || key.includes("congress")) return "festival";
  if (key === "social" || key === "social_dancing" || key === "socialdance") return "social_dance";
  if (key === "competition" || key === "contest") return "competition";
  if (key === "private lesson" || key === "private_lesson" || key === "privateclass") return "private_class";
  if (key === "group lesson" || key === "group_lesson" || key === "groupclass") return "group_class";
  if (key === "content" || key === "video" || key === "content/video" || key === "content_video") return "content_video";
  if (key === "workshop") return "workshop";
  return "collaboration";
}

export function referenceContextFamily(value: ReferenceContextTag | string) {
  switch (normalizeReferenceContextTag(String(value))) {
    case "practice":
    case "private_class":
    case "group_class":
    case "workshop":
      return "practice";
    case "event":
    case "social_dance":
    case "competition":
      return "event";
    case "festival":
      return "festival";
    case "travel_together":
      return "travel";
    case "hosting":
    case "stay_as_guest":
      return "hosting";
    case "content_video":
    case "collaboration":
    default:
      return "collaboration";
  }
}

export function activityTypeToReferenceContext(activityType: ActivityType): ReferenceContextTag {
  return activityType;
}
