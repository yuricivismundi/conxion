// Common validation utilities for API request bodies

export function asString(value: unknown, trim = true): string {
  if (typeof value !== "string") return "";
  return trim ? value.trim() : value;
}

export function asOptionalString(value: unknown, trim = true): string | null {
  const str = asString(value, trim);
  return str || null;
}

export function asNumber(value: unknown, fallback = 0): number {
  const num = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isNaN(num) ? fallback : num;
}

export function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
}

export function asArray<T = unknown>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value as T[];
}

export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isValidIsoDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  return !Number.isNaN(date.getTime()) && dateStr.match(/^\d{4}-\d{2}-\d{2}/);
}

export function parseIsoDateOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !isValidIsoDate(trimmed)) return null;
  const date = new Date(trimmed);
  return date.toISOString();
}

export function validateStringLength(
  value: string,
  minLength?: number,
  maxLength?: number,
  fieldName = "value"
): { valid: boolean; error?: string } {
  if (minLength !== undefined && value.length < minLength) {
    return { valid: false, error: `${fieldName} must be at least ${minLength} characters` };
  }
  if (maxLength !== undefined && value.length > maxLength) {
    return { valid: false, error: `${fieldName} must be at most ${maxLength} characters` };
  }
  return { valid: true };
}

export function validateOneOf<T>(
  value: T,
  allowed: T[],
  fieldName = "value"
): { valid: boolean; error?: string } {
  if (!allowed.includes(value)) {
    return { valid: false, error: `${fieldName} must be one of: ${allowed.join(", ")}` };
  }
  return { valid: true };
}
