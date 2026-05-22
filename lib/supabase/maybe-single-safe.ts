// Safe handling of Supabase .maybeSingle() results

/**
 * .maybeSingle() returns data: T | null, not data: T
 * This utility helps prevent type errors
 */

export type MaybeSingleResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

/**
 * Type-safe wrapper for .maybeSingle() results
 * Ensures you handle the null case
 */
export function extractSingleResult<T>(
  result: MaybeSingleResult<T>,
  context: string
): { success: boolean; data?: T; error?: string } {
  if (result.error) {
    return {
      success: false,
      error: result.error.message || `Failed to fetch ${context}`,
    };
  }

  if (result.data === null) {
    return {
      success: false,
      error: `${context} not found`,
    };
  }

  return {
    success: true,
    data: result.data,
  };
}

/**
 * Assert .maybeSingle() result exists, throw if not found
 */
export function assertSingleResult<T>(result: MaybeSingleResult<T>, context: string): T {
  if (result.error) {
    throw new Error(result.error.message || `Failed to fetch ${context}`);
  }

  if (result.data === null) {
    throw new Error(`${context} not found`);
  }

  return result.data;
}

/**
 * Type casting pattern for .maybeSingle() with as unknown
 *
 * ❌ WRONG - TypeScript error: cannot assign null to T
 * const { data } = await supabase
 *   .from("profiles")
 *   .select()
 *   .eq("id", profileId)
 *   .maybeSingle();
 * const profile: Profile = data; // Type error!
 *
 * ✅ CORRECT - Cast through unknown
 * const { data } = await supabase
 *   .from("profiles")
 *   .select()
 *   .eq("id", profileId)
 *   .maybeSingle();
 * const profile: Profile = (data as unknown as Profile);
 *
 * ✅ BETTER - Use helper
 * const { data, error } = await supabase
 *   .from("profiles")
 *   .select()
 *   .eq("id", profileId)
 *   .maybeSingle();
 * const profile = assertSingleResult({ data, error }, "profile");
 */

/**
 * Verify all .maybeSingle() results in codebase
 *
 * Search pattern (IDE regex):
 * \.maybeSingle\(\)(?!.*as unknown)
 *
 * This finds all .maybeSingle() calls that don't have the "as unknown" cast
 * Each should be evaluated for proper null handling
 */

export const MAYBESINGLE_CHECKLIST = {
  description: "Verify all .maybeSingle() calls handle null properly",
  affectedFiles: [
    "app/api/activities/route.ts",
    "app/api/activities/[activityId]/route.ts",
    "app/api/teacher-bookings/route.ts",
    "app/api/references/route.ts",
    "app/api/service-inquiries/route.ts",
    "app/api/connections/action/route.ts",
    // ... add more as found
  ],
  checkItems: [
    {
      pattern: ".maybeSingle()",
      issue: "TypeScript null handling",
      solution: 'Use "as unknown as T" or assertSingleResult() helper',
    },
    {
      pattern: "const profile = (data as unknown as Profile)",
      issue: "Direct unsafe cast",
      solution: 'Use extractSingleResult() for proper null checking',
    },
    {
      pattern: "if (!result.data?.id)",
      issue: "Incomplete null check",
      solution: 'Use result.data?.id ?? null and handle null explicitly',
    },
  ],
};
