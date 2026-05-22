# Comprehensive `.catch()` Error Audit

## Problem Statement
Silent error swallowing makes bugs invisible and production issues undetectable:

```typescript
// ❌ BAD - User never sees error, no logs
promise.catch(() => {});

// ❌ BAD - Error silenced, operation fails silently
operation().catch(() => { console.log('oops'); });

// ✅ GOOD - Error logged with context
operation().catch(err => {
  console.error('[operation-name]', err instanceof Error ? err.message : err);
});
```

## Search Pattern

In your IDE, search for these patterns:

### Pattern 1: Empty catch blocks
```
Search: \.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)
Regex: true
Context: "// silent error"
```

### Pattern 2: Silent console.log in catch
```
Search: \.catch\(\s*\(\)\s*=>\s*console\.log\(['"]\s*['"]?\)
Regex: true
Action: Replace with proper error logging
```

### Pattern 3: Void-prefixed promises
```
Search: void\s+(await\s+)?\w+\([^)]*\)
Regex: true
Context: Check if error handling is needed
```

## Categories of `.catch()` Usage

### Category A: Best-Effort Operations (OK to fail silently)

**Definition:** Operations that enhance UX but aren't critical

**Examples:**
- Tracking analytics
- Refreshing cached data
- Sending notifications
- Loading cover images
- Creating background records

**Acceptable pattern:**
```typescript
// Non-critical - OK to fail silently with warning
createNotificationBestEffort({ /* ... */ }).catch(err => {
  console.warn('[notification] Non-critical failure:', err);
});
```

**Where this is used:**
- `createActivityNotificationBestEffort()` - Notification creation
- `ensureGroupThread()` - Thread creation after group setup
- `upsertThreadContext()` - Metadata update
- `emitEvent()` - Event broadcasting

### Category B: Retryable Operations (Should retry, not silent)

**Definition:** Operations that should work and might be transient failures

**Examples:**
- Database queries
- API calls
- Chat entitlement creation
- Batch operations

**Acceptable pattern:**
```typescript
// Retryable - Try multiple times
for (let i = 0; i < 3; i++) {
  try {
    return await operation();
  } catch (err) {
    if (i === 2) throw err; // Fail after retries
    await sleep(100 * (i + 1));
  }
}
```

**Where this should be used:**
- `cx_upsert_request_chat_entitlement()` - Already fixed (3 retries)
- `cx_upsert_thread_context()` - Should retry
- Database inserts - Should retry
- Supabase RPC calls - Should retry

### Category C: Critical Operations (MUST NOT fail silently)

**Definition:** Operations that must succeed or the user transaction is broken

**Examples:**
- Activity status update
- Booking creation
- Payment processing
- Authentication
- Authorization checks

**Acceptable pattern:**
```typescript
// Critical - Must fail explicitly
try {
  const result = await criticalOperation();
} catch (error) {
  console.error('[critical-op] Failed:', error);
  return jsonError('Could not complete operation', 500);
}
// Never use .catch(() => {})
```

**Where this is used:**
- Activity acceptance - Activity marked accepted in DB
- Booking confirmation - Booking inserted to DB
- Payment processing - Money handled
- Profile updates - User data changes

## Audit Checklist

### High Priority `.catch()` to Review

```bash
# Find all .catch() in API routes
grep -r "\.catch" app/api/ --include="*.ts" -n

# Find .catch(() => {})
grep -r "\.catch\(\s*()\s*=>\s*{}" app/ --include="*.ts" -n

# Find void promises
grep -r "void " app/ --include="*.ts" -n
```

### Specific Files to Audit

**Critical APIs:**
- `app/api/activities/[activityId]/route.ts`
  - Line ~315: cx_upsert_request_chat_entitlement (should verify success)
  - Line ~335: cx_cancel_request_chat_entitlement (best-effort OK)

- `app/api/activities/route.ts`
  - Notification creation (best-effort OK)
  - Thread creation (best-effort OK)

- `app/api/teacher-bookings/route.ts`
  - Thread creation (should wrap in try/catch with rollback)

- `app/messages/page.tsx`
  - Batch operations (should handle partial failures)
  - Profile fetching (should log errors)

**Medium Priority:**
- `app/api/groups/route.ts`
- `app/api/service-inquiries/route.ts`
- `app/api/references/route.ts`

## Fix Examples

### Example 1: Silent Error Catch

**Before:**
```typescript
promise.catch(() => {});
```

**After:**
```typescript
// If best-effort, add context
promise.catch(err => {
  console.warn('[context]', err instanceof Error ? err.message : err);
});

// If critical, don't catch or add explicit error
```

### Example 2: Void Promise

**Before:**
```typescript
void createNotification(/* ... */);
```

**After:**
```typescript
// If best-effort:
createNotification(/* ... */).catch(err => {
  console.warn('[notification]', err);
});

// If critical:
await createNotification(/* ... */).catch(err => {
  console.error('[notification-critical]', err);
  throw err;
});
```

### Example 3: Empty Try-Catch

**Before:**
```typescript
try {
  await operation();
} catch {
  // Silently ignored
}
```

**After:**
```typescript
try {
  await operation();
} catch (err) {
  console.warn('[operation-name] Non-critical failure:', err);
  // Only use if truly non-critical
}
```

## Implementation Steps

1. **Run search pattern** to find all `.catch()` calls
2. **Categorize each** as A (best-effort), B (retryable), or C (critical)
3. **For Category A:**  Add console.warn() with context
4. **For Category B:**  Add retry logic with exponential backoff
5. **For Category C:**  Add console.error() and proper error response
6. **Test** that errors are now logged and visible
7. **Monitor logs** in production for new error patterns

## Validation

After audit, ensure:
- [ ] All API endpoints log errors to console
- [ ] No silent `.catch(() => {})` blocks remain
- [ ] Critical operations fail loudly
- [ ] Best-effort operations log warnings
- [ ] Retryable operations have retry logic
- [ ] Error logs include context (endpoint name, operation name)
- [ ] Correlation IDs tie errors to user requests

## Example Error Logging Pattern

```typescript
const correlationId = getCorrelationIdFromRequest(req);
const logger = createApiLogger(req, 'activity-create');

try {
  const result = await criticalOperation();
  logger.info('Operation succeeded', { resultId: result.id });
  return jsonSuccess(result);
} catch (err) {
  logger.error('Operation failed', err, { 
    correlationId,
    operationType: 'activity-create'
  });
  return jsonError(err instanceof Error ? err.message : 'Operation failed', 500);
}
```

## Continuous Monitoring

Add to your pre-commit hook:
```bash
# Warn on new .catch(() => {})
if git diff --cached | grep -q "\.catch\s*(\s*()\s*=>\s*{}"; then
  echo "⚠️  New silent error catch found. Please add logging."
fi
```
