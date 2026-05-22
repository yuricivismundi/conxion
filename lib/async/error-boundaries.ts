// Error boundary patterns for async operations

/**
 * Safe async operation execution with error handling
 * Prevents unhandled promise rejections
 */

export type AsyncResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; retry: boolean };

/**
 * Execute async operation with automatic error handling
 */
export async function safeAsync<T>(
  operation: () => Promise<T>,
  context: string,
  retryOnError = false
): Promise<AsyncResult<T>> {
  try {
    const data = await operation();
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[async-error] ${context}: ${message}`, error);

    // Determine if error is retryable
    const isRetryable =
      retryOnError &&
      (message.includes("timeout") ||
        message.includes("ECONNREFUSED") ||
        message.includes("ENOTFOUND") ||
        message.includes("temporarily unavailable"));

    return { ok: false, error: message, retry: isRetryable };
  }
}

/**
 * Retry with exponential backoff
 */
export async function retryAsync<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 100
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts - 1) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[retry] Attempt ${attempt + 1} failed, retrying in ${delayMs}ms`, lastError.message);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

/**
 * Promise.all with partial failure tolerance
 */
export async function allSettledSafe<T>(
  promises: Promise<T>[],
  context: string
): Promise<{ results: T[]; failures: Error[] }> {
  try {
    const settled = await Promise.allSettled(promises);
    const results: T[] = [];
    const failures: Error[] = [];

    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        const error = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
        failures.push(error);
        console.warn(`[${context}] Promise ${index} failed:`, error.message);
      }
    });

    return { results, failures };
  } catch (error) {
    console.error(`[${context}] allSettledSafe failed:`, error);
    throw error;
  }
}

/**
 * Timeout wrapper for long-running operations
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  context: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${context} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

/**
 * Critical async error patterns to avoid
 *
 * ❌ WRONG - Unhandled promise rejection
 * void supabase.from("activities").insert(...);
 * // If this fails, error is lost!
 *
 * ❌ WRONG - Silently swallowing errors
 * await operation().catch(() => {});
 * // We don't even know what failed!
 *
 * ❌ WRONG - No error context
 * try {
 *   await operation();
 * } catch {
 *   // Which operation failed? Why?
 * }
 *
 * ✅ CORRECT - Explicit error handling
 * try {
 *   await operation();
 * } catch (error) {
 *   console.error("[operation-name] Failed:", error instanceof Error ? error.message : error);
 *   // Handle or return error
 * }
 *
 * ✅ CORRECT - For best-effort operations
 * try {
 *   await bestEffortOperation();
 * } catch (error) {
 *   console.warn("[operation-name] Non-fatal failure:", error);
 *   // Continue, operation was not critical
 * }
 */

export const ASYNC_ERROR_CHECKLIST = {
  description: "Verify all async operations have proper error handling",
  patterns: [
    {
      bad: "void operation(); // Fire and forget with no error handling",
      good: "await operation(); // or .catch(err => console.error())",
    },
    {
      bad: "promise.catch(() => {}); // Silent error swallow",
      good: "promise.catch(err => console.error('context:', err))",
    },
    {
      bad: "try { await op() } catch { } // No error info",
      good: "try { await op() } catch (err) { console.error('op failed:', err) }",
    },
    {
      bad: "Promise.all(promises) // Fails if any rejects",
      good: "Promise.allSettled(promises) // Gets all results even if some fail",
    },
  ],
  criticalPaths: [
    {
      location: "Thread/message creation",
      operation: "ensureTeacherBookingThread()",
      handling: "Best-effort try/catch, log but don't fail booking",
    },
    {
      location: "Activity acceptance",
      operation: "cx_upsert_request_chat_entitlement()",
      handling: "3-retry with backoff, fail if all fail",
    },
    {
      location: "Notification sending",
      operation: "createActivityNotificationBestEffort()",
      handling: "Try/catch multiple payloads, continue on individual failures",
    },
    {
      location: "Batch profile loading",
      operation: "batchFetchProfiles()",
      handling: "Return partial results on error, log which failed",
    },
  ],
};
