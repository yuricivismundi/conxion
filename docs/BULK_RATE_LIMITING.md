# Bulk Operation Rate Limiting Design

**Problem:** Bulk operations (10+ items) could bypass rate limits if charged per-request instead of per-item  
**Solution:** Design bulk endpoints to charge rate limit per item  
**Status:** No bulk endpoints currently exist, this is preventive design

---

## Design Principle

**Rule:** Any endpoint accepting arrays/bulk operations must charge rate limit based on NUMBER OF ITEMS, not number of requests.

```typescript
// ❌ WRONG - Charges 1 limit for 100 items
POST /api/activities/bulk
Body: { activities: [100 items] }
Rate limit: 1 charge

// ✅ CORRECT - Charges 100 limits for 100 items
POST /api/activities/bulk
Body: { activities: [100 items] }
Rate limit: 100 charges (1 per item)
```

---

## Implementation Pattern

### Example: Bulk Activity Creation

```typescript
// lib/security/comprehensive-rate-limit.ts
export async function checkBulkRateLimit(
  userId: string,
  operation: string,
  itemCount: number
): Promise<{ allowed: boolean; remaining: number }> {
  const limit = RATE_LIMITS[operation] || { max: 50, windowMs: 3600000 };
  
  // Check if user has enough capacity for ALL items
  const { allowed, remaining } = checkRateLimit(userId, operation);
  
  if (remaining < itemCount) {
    return { allowed: false, remaining };
  }
  
  // Charge for each item
  for (let i = 0; i < itemCount; i++) {
    checkRateLimit(userId, operation);
  }
  
  return { allowed: true, remaining: remaining - itemCount };
}
```

### API Endpoint Implementation

```typescript
// app/api/activities/bulk/route.ts
export async function POST(req: Request) {
  const auth = await requireServiceInquiryAuth(req);
  const body = await req.json();
  const activities = body.activities as Array<{ /* ... */ }>;
  
  // Validate array length
  if (!Array.isArray(activities)) {
    return jsonError("Activities must be an array", 400);
  }
  if (activities.length === 0) {
    return jsonError("At least 1 activity required", 400);
  }
  if (activities.length > 20) {
    return jsonError("Maximum 20 activities per request", 400);
  }
  
  // Check rate limit PER ITEM
  const rateCheck = await checkBulkRateLimit(
    auth.userId,
    "activity_create",
    activities.length
  );
  
  if (!rateCheck.allowed) {
    return jsonError(
      `Rate limit exceeded. You can create ${rateCheck.remaining} more activity(ies) this hour.`,
      429
    );
  }
  
  // Create activities
  const results = [];
  for (const activity of activities) {
    try {
      const result = await createActivity(auth, activity);
      results.push({ ok: true, id: result.id });
    } catch (err) {
      results.push({ ok: false, error: "Could not create activity" });
    }
  }
  
  // Return partial successes
  return NextResponse.json({
    ok: results.some(r => r.ok),
    results,
    charged: activities.length, // Show user what was charged
  });
}
```

---

## Response Format for Bulk Operations

```json
{
  "ok": true,
  "results": [
    { "ok": true, "id": "activity-123" },
    { "ok": true, "id": "activity-456" },
    { "ok": false, "error": "Invalid recipient" },
    { "ok": true, "id": "activity-789" }
  ],
  "charged": 4,
  "rateLimitRemaining": 46
}
```

**Fields:**
- `ok`: true if ANY items succeeded
- `results`: Array matching input (one result per item)
- `charged`: Number of rate limit charges applied
- `rateLimitRemaining`: Remaining capacity this hour

---

## Rate Limit Charge Table

| Operation | Charge | Max/Hour | Notes |
|-----------|--------|----------|-------|
| activity_create (single) | 1 | 50 | Per activity |
| activity_create (bulk) | 1 per item | 50 | Charge per item, max 20/request |
| event_create (single) | 1 | 10 | Per event |
| event_create (bulk) | 1 per item | 10 | Charge per item, max 5/request |
| message_send (single) | 1 | 500 | Per message |
| message_send (bulk) | 1 per item | 500 | Charge per item, max 50/request |

**Bulk limits are intentionally LOW to prevent circumvention**

---

## Prevention Checklist

When adding new endpoints:

- [ ] Single operation has rate limit?
- [ ] If bulk endpoint exists:
  - [ ] Charges per-item, not per-request?
  - [ ] Maximum array size enforced (< 20)?
  - [ ] Each item validated before charging?
  - [ ] User informed how many charges applied?
  - [ ] Partial success returns remaining capacity?

---

## Example: Prevent Abuse

**Without per-item charging:**
```typescript
POST /api/messages/send/bulk
{ messages: [100 items] }

User at 500/500 limit:
- Without per-item: ✅ Request succeeds (1 charge total)
- Result: User bypasses rate limit by 99 items!
```

**With per-item charging:**
```typescript
POST /api/messages/send/bulk
{ messages: [100 items] }

User at 500/500 limit:
- With per-item: ❌ Request rejected (would need 100 charges, only 0 remaining)
- Result: Rate limit enforced correctly
```

---

## Testing Rate Limit Bypass

Before deploying any bulk endpoint:

```bash
# Test 1: User at rate limit trying bulk operation
1. Set user to limit (e.g., 50/50 activities)
2. Try: POST /api/activities/bulk with 10 items
3. Expected: 429 "Rate limit exceeded"
4. Verify: User still at 50/50 (no partial charge)

# Test 2: User with partial capacity
1. Set user to 45/50 (5 remaining)
2. Try: POST /api/activities/bulk with 10 items
3. Expected: 429 "Rate limit exceeded, 5 remaining"
4. Verify: User still at 45/50

# Test 3: User with enough capacity
1. Set user to 40/50 (10 remaining)
2. Try: POST /api/activities/bulk with 5 items
3. Expected: 200 success
4. Verify: User now at 45/50 (charged 5)
```

---

## Current Status

✅ No bulk endpoints currently exist  
✅ Single operations all charge correctly  
✅ Design documented for future bulk operations  

**Action:** Review this design before implementing any bulk endpoint
