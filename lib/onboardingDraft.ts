export const ONBOARDING_DRAFT_KEY = "onboarding_draft_v1";

export type OnboardingDraft = {
  displayName?: string;
  country?: string;
  city?: string;
  roles?: string[];

  interests?: string[];
  styles?: string[];

  // Structured interests/styles (step 2)
  interestsByRole?: Record<string, string[]>;
  styleLevels?: Record<string, string>;
  otherStyleEnabled?: boolean;
  otherStyleName?: string;

  langs?: string[];
  avail?: Record<string, boolean>;

  // Photo preview persisted across steps
  avatarDataUrl?: string;

  // Photo review workflow
  avatarPath?: string;
  avatarStatus?: "pending" | "approved" | "rejected";
};

export function readOnboardingDraft(): OnboardingDraft {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ONBOARDING_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as OnboardingDraft) : {};
  } catch {
    return {};
  }
}

export function writeOnboardingDraft(patch: Partial<OnboardingDraft>) {
  if (typeof window === "undefined") return;
  try {
    const current = readOnboardingDraft();
    const next = { ...current, ...patch };
    localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function clearOnboardingDraft() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ONBOARDING_DRAFT_KEY);
  } catch {
    // ignore
  }
}
