export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_PATTERN = /^[a-z0-9._]{3,20}$/;

function stripDiacritics(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeUsername(input: string) {
  return stripDiacritics(input).trim().toLowerCase();
}

export function buildUsernameSuggestionBase(input: string) {
  const normalized = stripDiacritics(input)
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/[.]{2,}/g, ".")
    .replace(/^[._]+|[._]+$/g, "");

  return normalized.slice(0, USERNAME_MAX_LENGTH).replace(/^[._]+|[._]+$/g, "");
}
