export type HostingPreferredGuestGender = "any" | "women" | "men" | "nonbinary";

export type HostingSleepingArrangement =
  | "not_specified"
  | "shared_room"
  | "private_room"
  | "sofa"
  | "floor_space"
  | "mixed";

export const HOSTING_GUEST_GENDER_OPTIONS: Array<{ value: HostingPreferredGuestGender; label: string }> = [
  { value: "any", label: "Any" },
  { value: "women", label: "Women" },
  { value: "men", label: "Men" },
  { value: "nonbinary", label: "Non-binary" },
];

export const HOSTING_SLEEPING_ARRANGEMENT_OPTIONS: Array<{ value: HostingSleepingArrangement; label: string }> = [
  { value: "not_specified", label: "Not specified" },
  { value: "shared_room", label: "Shared room" },
  { value: "private_room", label: "Private room" },
  { value: "sofa", label: "Sofa" },
  { value: "floor_space", label: "Floor space" },
  { value: "mixed", label: "Depends on dates" },
];

export function normalizeHostingPreferredGuestGender(value: unknown): HostingPreferredGuestGender {
  return value === "women" || value === "men" || value === "nonbinary" ? value : "any";
}

export function normalizeHostingSleepingArrangement(value: unknown): HostingSleepingArrangement {
  return value === "shared_room" ||
    value === "private_room" ||
    value === "sofa" ||
    value === "floor_space" ||
    value === "mixed"
    ? value
    : "not_specified";
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
