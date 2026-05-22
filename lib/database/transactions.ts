// Transaction handling patterns for multi-step operations

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Multi-step operation with rollback support
 * Each step has a corresponding cleanup function
 */
export type TransactionStep<T = unknown> = {
  name: string;
  execute: () => Promise<T>;
  cleanup?: (data: T) => Promise<void>;
};

export type TransactionResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
  completedSteps: string[];
};

/**
 * Execute a multi-step operation with rollback on failure
 * Note: Supabase doesn't support true transactions, so this is logical rollback
 */
export async function executeTransaction<T>(
  steps: TransactionStep[],
  onRollback?: (completedSteps: string[]) => void
): Promise<TransactionResult<T>> {
  const completedSteps: Array<{ name: string; data: unknown }> = [];

  try {
    for (const step of steps) {
      console.log(`[transaction] Executing step: ${step.name}`);
      const data = await step.execute();
      completedSteps.push({ name: step.name, data });
      console.log(`[transaction] Completed step: ${step.name}`);
    }

    return {
      success: true,
      data: completedSteps[completedSteps.length - 1]?.data as T,
      completedSteps: completedSteps.map((s) => s.name),
    };
  } catch (error) {
    console.error(`[transaction] Failed at step, rolling back...`, error);

    // Execute cleanup in reverse order
    for (let i = completedSteps.length - 1; i >= 0; i--) {
      const step = steps.find((s) => s.name === completedSteps[i].name);
      if (step?.cleanup) {
        try {
          console.log(`[transaction] Rolling back step: ${step.name}`);
          await step.cleanup(completedSteps[i].data);
          console.log(`[transaction] Rolled back step: ${step.name}`);
        } catch (cleanupError) {
          console.error(`[transaction] Cleanup failed for ${step.name}:`, cleanupError);
          // Continue with other cleanups
        }
      }
    }

    onRollback?.(completedSteps.map((s) => s.name));

    return {
      success: false,
      error: error instanceof Error ? error.message : "Transaction failed",
      completedSteps: completedSteps.map((s) => s.name),
    };
  }
}

/**
 * Best practices for critical multi-step operations:
 *
 * 1. Activity Acceptance
 *    - Step 1: Validate chat entitlement can be created
 *    - Step 2: Create/upsert chat entitlement
 *    - Step 3: Update activity status (cleanup: revert status)
 *    - Step 4: Update thread context (best-effort)
 *    - Step 5: Create notification (best-effort)
 *
 * 2. Booking Creation
 *    - Step 1: Mark availability as unavailable (cleanup: restore availability)
 *    - Step 2: Insert booking (cleanup: delete booking)
 *    - Step 3: Ensure thread exists (best-effort)
 *    - Step 4: Create booking context (best-effort)
 *
 * 3. Group Creation
 *    - Step 1: Insert group (cleanup: delete group)
 *    - Step 2: Add host as member (cleanup: remove member)
 *    - Step 3: Add initial members (cleanup: remove all members)
 *    - Step 4: Create group thread (best-effort)
 *
 * For operations where cleanup is not possible (e.g., external API calls),
 * make that step best-effort (no cleanup function) and place it last.
 */

/**
 * Optimistic update pattern for better UX with rollback
 */
export async function optimisticUpdate<T>(
  currentValue: T,
  optimisticValue: T,
  updateFn: () => Promise<T>
): Promise<{ success: boolean; value: T }> {
  try {
    const result = await updateFn();
    return { success: true, value: result };
  } catch (error) {
    console.error("[optimistic-update] Update failed, reverting to current value", error);
    return { success: false, value: currentValue };
  }
}
