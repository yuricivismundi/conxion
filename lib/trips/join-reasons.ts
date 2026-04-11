export const TRAVEL_INTENT_REASON_OPTIONS = [
  {
    key: "dance_trip_holiday",
    label: "Dance trip / Holiday",
    icon: "nightlife",
  },
  {
    key: "training_classes",
    label: "Training & Classes",
    icon: "school",
  },
  {
    key: "festival_event",
    label: "Festival / Event",
    icon: "celebration",
  },
] as const;

export type TravelIntentReasonKey = (typeof TRAVEL_INTENT_REASON_OPTIONS)[number]["key"];
export type TripJoinReasonKey = TravelIntentReasonKey;

const TRAVEL_INTENT_REASON_ALIAS_MAP: Record<string, TravelIntentReasonKey> = {
  dance_trip_holiday: "dance_trip_holiday",
  "dance trip / holiday": "dance_trip_holiday",
  "dance trip": "dance_trip_holiday",
  holiday: "dance_trip_holiday",
  "holiday trip": "dance_trip_holiday",
  holiday_trip: "dance_trip_holiday",
  social_dancing: "dance_trip_holiday",
  "social dancing": "dance_trip_holiday",
  social_dance: "dance_trip_holiday",
  social: "dance_trip_holiday",
  training_classes: "training_classes",
  "training & classes": "training_classes",
  "training and classes": "training_classes",
  "training / classes": "training_classes",
  "training / workshops": "training_classes",
  training: "training_classes",
  workshop: "training_classes",
  workshops: "training_classes",
  class: "training_classes",
  classes: "training_classes",
  private_class: "training_classes",
  private_lesson: "training_classes",
  "private class": "training_classes",
  "private lesson": "training_classes",
  practice: "training_classes",
  festival_event: "festival_event",
  "festival / event": "festival_event",
  "festival / events": "festival_event",
  festival: "festival_event",
  event: "festival_event",
  events: "festival_event",
  event_festival: "festival_event",
  travel_events: "festival_event",
  "travel & events": "festival_event",
  "travel and events": "festival_event",
  travel: "festival_event",
  travelling: "festival_event",
  traveling: "festival_event",
  trip: "festival_event",
  "trip join request": "festival_event",
  collaborate: "festival_event",
  collaboration: "festival_event",
  request_hosting: "festival_event",
};

export function normalizeTravelIntentReason(value: unknown): TravelIntentReasonKey | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return TRAVEL_INTENT_REASON_ALIAS_MAP[normalized] ?? null;
}

export function normalizeTripJoinReason(value: unknown): TripJoinReasonKey | null {
  return normalizeTravelIntentReason(value);
}

export function isTravelIntentReasonKey(value: unknown): value is TravelIntentReasonKey {
  return typeof value === "string" && TRAVEL_INTENT_REASON_OPTIONS.some((option) => option.key === value);
}

export function isTripJoinReasonKey(value: unknown): value is TripJoinReasonKey {
  return isTravelIntentReasonKey(value);
}

export function travelIntentReasonLabel(value: unknown): string {
  const normalized = normalizeTravelIntentReason(value);
  if (normalized) {
    return TRAVEL_INTENT_REASON_OPTIONS.find((option) => option.key === normalized)?.label ?? "Festival / Event";
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return "Festival / Event";
}

export function tripJoinReasonLabel(value: unknown): string {
  return travelIntentReasonLabel(value);
}

export const TRIP_JOIN_REASON_OPTIONS = TRAVEL_INTENT_REASON_OPTIONS;
