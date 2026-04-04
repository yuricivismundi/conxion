import { buildUsernameSuggestionBase, normalizeUsername, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from "@/lib/username/normalize";
import { isReservedUsername } from "@/lib/username/reserved";
import { validateUsernameFormat } from "@/lib/username/validate";

export const PROFILE_USERNAME_MIN_LENGTH = USERNAME_MIN_LENGTH;
export const PROFILE_USERNAME_MAX_LENGTH = USERNAME_MAX_LENGTH;
export const PROFILE_USERNAME_PATTERN = USERNAME_PATTERN;

export function normalizeProfileUsernameInput(value: string) {
  return normalizeUsername(value);
}

export function suggestProfileUsername(value: string) {
  return buildUsernameSuggestionBase(value);
}

export function isReservedProfileUsername(value: string) {
  return isReservedUsername(value);
}

export function validateProfileUsername(value: string) {
  const result = validateUsernameFormat(value);
  return result.valid ? null : result.error ?? "Username must be between 3 and 20 characters.";
}

export function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}
