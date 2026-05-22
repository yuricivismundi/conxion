// Null safety utilities and patterns

/**
 * Safe property access with default fallback
 */
export function safeGet<T, K extends keyof T>(obj: T | null | undefined, key: K, defaultValue?: T[K]): T[K] | undefined {
  if (!obj) return defaultValue;
  return obj[key] ?? defaultValue;
}

/**
 * Safe nested property access
 */
export function safeGetNested<T>(
  obj: any,
  path: string,
  defaultValue?: T
): T | undefined {
  try {
    const value = path.split(".").reduce((current, prop) => current?.[prop], obj);
    return value ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Assert value exists, throw if null/undefined
 */
export function assertNotNull<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

/**
 * Assert array is non-empty
 */
export function assertNonEmpty<T>(value: T[] | null | undefined, message: string): T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

/**
 * Safe array access
 */
export function safeArrayAccess<T>(arr: T[] | null | undefined, index: number, defaultValue?: T): T | undefined {
  if (!Array.isArray(arr) || index < 0 || index >= arr.length) {
    return defaultValue;
  }
  return arr[index];
}

/**
 * Safe type narrowing
 */
export function isNotNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

export function isArray<T = unknown>(value: unknown): value is T[] {
  return Array.isArray(value);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Critical null checks for common patterns
 *
 * CRITICAL PATTERNS TO CHECK:
 * 1. Thread operations - thread_id must exist
 * 2. User operations - user_id must exist
 * 3. Foreign keys - all FK references must be validated
 * 4. API responses - validate response structure before use
 * 5. Array operations - check length before accessing [0]
 */

export const CRITICAL_CHECKS = {
  threadId: (id: string | null | undefined, context: string): string => {
    return assertNotNull(id, `Missing thread_id in ${context}`);
  },

  userId: (id: string | null | undefined, context: string): string => {
    return assertNotNull(id, `Missing user_id in ${context}`);
  },

  eventId: (id: string | null | undefined, context: string): string => {
    return assertNotNull(id, `Missing event_id in ${context}`);
  },

  groupId: (id: string | null | undefined, context: string): string => {
    return assertNotNull(id, `Missing group_id in ${context}`);
  },

  activityId: (id: string | null | undefined, context: string): string => {
    return assertNotNull(id, `Missing activity_id in ${context}`);
  },

  responseArray: <T,>(arr: T[] | null | undefined, context: string): T[] => {
    return assertNonEmpty(arr, `Expected non-empty array in ${context}`);
  },
};

/**
 * Example safe operation pattern:
 *
 * ✅ GOOD
 * try {
 *   const userId = CRITICAL_CHECKS.userId(user?.id, "activity handler");
 *   const threadId = CRITICAL_CHECKS.threadId(activity?.thread_id, "activity handler");
 *   // Safe to use userId and threadId now
 * } catch (err) {
 *   return jsonError(err.message, 400);
 * }
 *
 * ❌ BAD
 * const userId = user?.id; // Could be undefined
 * await db.from("activities").insert({ user_id: userId }); // Might insert NULL
 */
