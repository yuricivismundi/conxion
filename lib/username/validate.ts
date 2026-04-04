import { isReservedUsername } from "@/lib/username/reserved";
import { normalizeUsername, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from "@/lib/username/normalize";

export type UsernameValidationResult = {
  valid: boolean;
  normalizedUsername: string;
  error?: string;
};

export function validateUsernameFormat(input: string): UsernameValidationResult {
  const normalizedUsername = normalizeUsername(input);

  if (
    normalizedUsername.length < USERNAME_MIN_LENGTH ||
    normalizedUsername.length > USERNAME_MAX_LENGTH
  ) {
    return {
      valid: false,
      normalizedUsername,
      error: "Username must be between 3 and 20 characters.",
    };
  }

  if (!USERNAME_PATTERN.test(normalizedUsername)) {
    return {
      valid: false,
      normalizedUsername,
      error: "Use only letters, numbers, dots, or underscores.",
    };
  }

  if (
    normalizedUsername.startsWith(".") ||
    normalizedUsername.endsWith(".") ||
    normalizedUsername.startsWith("_") ||
    normalizedUsername.endsWith("_") ||
    normalizedUsername.includes("..")
  ) {
    return {
      valid: false,
      normalizedUsername,
      error: "Use only letters, numbers, dots, or underscores.",
    };
  }

  if (isReservedUsername(normalizedUsername)) {
    return {
      valid: false,
      normalizedUsername,
      error: "This username is reserved.",
    };
  }

  return { valid: true, normalizedUsername };
}

export function mapUsernameServerError(message: string | null | undefined) {
  const text = String(message ?? "").toLowerCase();
  if (!text) return "Could not save username right now.";
  if (text.includes("reserved")) return "This username is reserved.";
  if (text.includes("already taken") || text.includes("duplicate") || text.includes("unique")) {
    return "This username is already taken.";
  }
  if (text.includes("30 days") || text.includes("once every 30 days")) {
    return "You can change your username once every 30 days.";
  }
  if (text.includes("letters, numbers, dots, or underscores")) {
    return "Use only letters, numbers, dots, or underscores.";
  }
  if (text.includes("between 3 and 20")) {
    return "Username must be between 3 and 20 characters.";
  }
  return String(message);
}
