export const PROFILE_USERNAME_MIN_LENGTH = 3;
export const PROFILE_USERNAME_MAX_LENGTH = 30;
export const PROFILE_USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])?$/;

const RESERVED_PROFILE_USERNAMES = new Set([
  "about",
  "account",
  "account-settings",
  "admin",
  "api",
  "app",
  "auth",
  "blog",
  "careers",
  "connections",
  "contact",
  "dashboard",
  "discover",
  "edit",
  "events",
  "explore",
  "feed",
  "help",
  "home",
  "inbox",
  "login",
  "me",
  "messages",
  "network",
  "notifications",
  "onboarding",
  "pricing",
  "privacy",
  "profile",
  "references",
  "register",
  "search",
  "settings",
  "signin",
  "signup",
  "support",
  "terms",
  "travel",
  "trips",
  "u",
  "users",
]);

export function normalizeProfileUsernameInput(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "")
    .slice(0, PROFILE_USERNAME_MAX_LENGTH);
}

export function suggestProfileUsername(value: string) {
  const normalized = normalizeProfileUsernameInput(
    value
      .trim()
      .replace(/\s+/g, ".")
      .replace(/-+/g, ".")
  )
    .replace(/^[._]+/, "")
    .replace(/[._]+$/, "")
    .replace(/[._]{2,}/g, ".");

  if (!normalized) return "";
  return normalized.slice(0, PROFILE_USERNAME_MAX_LENGTH);
}

export function isReservedProfileUsername(value: string) {
  return RESERVED_PROFILE_USERNAMES.has(value.trim().toLowerCase());
}

export function validateProfileUsername(value: string) {
  const normalized = normalizeProfileUsernameInput(value).replace(/^[._]+|[._]+$/g, "");
  if (!normalized) return "Choose a username.";
  if (normalized.length < PROFILE_USERNAME_MIN_LENGTH) {
    return `Username must be at least ${PROFILE_USERNAME_MIN_LENGTH} characters.`;
  }
  if (!PROFILE_USERNAME_PATTERN.test(normalized)) {
    return "Use letters, numbers, dots, or underscores.";
  }
  if (isReservedProfileUsername(normalized)) {
    return "That username is reserved.";
  }
  return null;
}

export function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}
