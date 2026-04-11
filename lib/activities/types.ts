export const ACTIVITY_TYPES = [
  "practice",
  "private_class",
  "social_dance",
  "event_festival",
  "travelling",
  "request_hosting",
  "offer_hosting",
  "collaborate",
] as const;

export const RANGE_ACTIVITY_TYPES = [
  "event_festival",
  "travelling",
  "request_hosting",
  "offer_hosting",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const REFERENCE_CONTEXT_TAGS = ACTIVITY_TYPES;

export type ReferenceContextTag = (typeof REFERENCE_CONTEXT_TAGS)[number];

const ACTIVITY_TYPE_ALIASES: Record<string, ActivityType> = {
  practice: "practice",
  practice_sync: "practice",
  private_class: "private_class",
  "private class": "private_class",
  "private lesson": "private_class",
  private_lesson: "private_class",
  privateclass: "private_class",
  social: "social_dance",
  social_dance: "social_dance",
  social_dancing: "social_dance",
  socialdance: "social_dance",
  event: "event_festival",
  events: "event_festival",
  festival: "event_festival",
  congress: "event_festival",
  workshop: "event_festival",
  competition: "event_festival",
  contest: "event_festival",
  event_festival: "event_festival",
  trip: "travelling",
  travel: "travelling",
  traveling: "travelling",
  travelling: "travelling",
  travel_trip: "travelling",
  travel_together: "travelling",
  request_hosting: "request_hosting",
  stay_as_guest: "request_hosting",
  guest: "request_hosting",
  stay: "request_hosting",
  offer_hosting: "offer_hosting",
  offer_to_host: "offer_hosting",
  hosting: "offer_hosting",
  host: "offer_hosting",
  group_class: "practice",
  "group lesson": "practice",
  group_lesson: "practice",
  groupclass: "practice",
  collaboration: "collaborate",
  collaborate: "collaborate",
  content: "collaborate",
  video: "collaborate",
  "content/video": "collaborate",
  content_video: "collaborate",
};

export function parseActivityType(value: unknown): ActivityType | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return ACTIVITY_TYPE_ALIASES[key] ?? null;
}

export function normalizeActivityType(value: unknown, fallback: ActivityType = "collaborate"): ActivityType {
  return parseActivityType(value) ?? fallback;
}

export function isActivityType(value: unknown): value is ActivityType {
  return typeof value === "string" && (ACTIVITY_TYPES as readonly string[]).includes(value.trim().toLowerCase());
}

export function activityUsesDateRange(value: ActivityType | string) {
  const type = normalizeActivityType(value);
  return (RANGE_ACTIVITY_TYPES as readonly string[]).includes(type);
}

export function activityTypeLabel(value: ActivityType | string) {
  switch (normalizeActivityType(value)) {
    case "practice":
      return "Practice";
    case "private_class":
      return "Private Class";
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

export function referenceContextLabel(value: ReferenceContextTag | string) {
  switch (normalizeReferenceContextTag(String(value))) {
    case "private_class":
      return "Classes";
    default:
      return activityTypeLabel(value);
  }
}

export function referenceContextShortLabel(value: ReferenceContextTag | string) {
  switch (normalizeReferenceContextTag(String(value))) {
    case "private_class":
      return "Classes";
    case "event_festival":
      return "Event";
    case "travelling":
      return "Travel";
    case "offer_hosting":
      return "Hosting";
    case "request_hosting":
      return "Request Hosting";
    default:
      return activityTypeLabel(value);
  }
}

export function normalizeReferenceContextTag(value: string): ReferenceContextTag {
  return normalizeActivityType(value);
}

export function referenceContextFamily(value: ReferenceContextTag | string) {
  switch (normalizeReferenceContextTag(String(value))) {
    case "practice":
    case "social_dance":
      return "practice_social";
    case "private_class":
      return "teaching";
    case "event_festival":
    case "collaborate":
      return "event_collab";
    case "travelling":
    case "request_hosting":
    case "offer_hosting":
      return "hosting_trip";
    default:
      return "event_collab";
  }
}

export function activityTypeToReferenceContext(activityType: ActivityType): ReferenceContextTag {
  return activityType;
}

export const ACTIVITY_TYPE_ICONS: Record<ActivityType, string> = {
  practice: "sports_gymnastics",
  private_class: "school",
  social_dance: "nightlife",
  event_festival: "celebration",
  travelling: "luggage",
  request_hosting: "bed",
  offer_hosting: "home",
  collaborate: "handshake",
};

export const LINKED_MEMBER_ACTIVITY_TYPES: ActivityType[] = [
  "practice",
  "private_class",
  "social_dance",
  "event_festival",
  "travelling",
  "request_hosting",
  "collaborate",
];

export const TRIP_JOIN_ACTIVITY_TYPES: ActivityType[] = [
  "practice",
  "private_class",
  "social_dance",
  "event_festival",
  "travelling",
  "request_hosting",
  "collaborate",
];
