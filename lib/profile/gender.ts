export type Gender = "woman" | "man" | "nonbinary" | "prefer_not_to_say";

export const GENDER_OPTIONS: Array<{ value: Gender; label: string; description?: string }> = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "nonbinary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

export function normalizeGender(value: unknown): Gender {
  if (value === "woman" || value === "man" || value === "nonbinary" || value === "prefer_not_to_say") {
    return value;
  }
  return "prefer_not_to_say";
}

export function formatGenderLabel(value: Gender | null | undefined): string {
  if (!value) return "Not specified";
  return GENDER_OPTIONS.find((option) => option.value === value)?.label ?? "Not specified";
}

// Default value for new users — friendly inclusive default
export const DEFAULT_GENDER: Gender = "prefer_not_to_say";
