export type HostingPreferredGuestGender = "any" | "women" | "men" | "nonbinary";

export type HostingSleepingArrangement =
  | "not_specified"
  | "shared_room"
  | "private_room"
  | "sofa"
  | "floor_space"
  | "mixed";

const HOSTING_SLEEPING_ARRANGEMENT_ALIAS_MAP: Record<string, HostingSleepingArrangement> = {
  not_specified: "not_specified",
  "not specified": "not_specified",
  shared_room: "shared_room",
  "shared room": "shared_room",
  spare_room: "shared_room",
  "spare room": "shared_room",
  private_room: "private_room",
  "private room": "private_room",
  private_space: "private_room",
  "private space": "private_room",
  sofa: "sofa",
  couch: "sofa",
  "couch / sofa": "sofa",
  "couch/sofa": "sofa",
  floor_space: "floor_space",
  "floor space": "floor_space",
  mixed: "mixed",
  "depends on dates": "mixed",
};

export const HOSTING_GUEST_GENDER_OPTIONS: Array<{ value: HostingPreferredGuestGender; label: string }> = [
  { value: "any", label: "Any" },
  { value: "women", label: "Women" },
  { value: "men", label: "Men" },
  { value: "nonbinary", label: "Non-binary" },
];

export const HOSTING_SLEEPING_ARRANGEMENT_OPTIONS: Array<{ value: HostingSleepingArrangement; label: string }> = [
  { value: "not_specified", label: "Not specified" },
  { value: "shared_room", label: "Spare room" },
  { value: "private_room", label: "Private space" },
  { value: "sofa", label: "Couch / sofa" },
  { value: "floor_space", label: "Floor space" },
  { value: "mixed", label: "Depends on dates" },
];

export const HOSTING_OFFER_SPACE_TYPE_OPTIONS = HOSTING_SLEEPING_ARRANGEMENT_OPTIONS.filter((option) =>
  option.value === "shared_room" || option.value === "private_room" || option.value === "sofa"
);

export function normalizeHostingPreferredGuestGender(value: unknown): HostingPreferredGuestGender {
  return value === "women" || value === "men" || value === "nonbinary" ? value : "any";
}

export function parseHostingSleepingArrangement(value: unknown): HostingSleepingArrangement | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return HOSTING_SLEEPING_ARRANGEMENT_ALIAS_MAP[normalized] ?? null;
}

export function normalizeHostingSleepingArrangement(value: unknown): HostingSleepingArrangement {
  return parseHostingSleepingArrangement(value) ?? "not_specified";
}

export function formatGuestGenderPreference(value: HostingPreferredGuestGender) {
  return HOSTING_GUEST_GENDER_OPTIONS.find((option) => option.value === value)?.label ?? "Any";
}

export function formatSleepingArrangement(value: HostingSleepingArrangement) {
  return HOSTING_SLEEPING_ARRANGEMENT_OPTIONS.find((option) => option.value === value)?.label ?? "Not specified";
}

export function isHostingListingOpen(canHost: boolean, hostingStatus: string | null | undefined) {
  const status = hostingStatus?.trim().toLowerCase() ?? "inactive";
  return canHost && ["available", "active", "open", "on"].includes(status);
}
