# ConXion API Documentation

## Base URL
- Production: `https://conxion.app/api`
- Development: `http://localhost:3000/api`

## Authentication
All endpoints (except `/health`) require Bearer token authentication:
```
Authorization: Bearer <user_access_token>
```

## Standard Response Format

### Success Response
```json
{
  "ok": true,
  "data": { /* endpoint-specific data */ }
}
```

### Error Response
```json
{
  "ok": false,
  "error": "Human-readable error message"
}
```

### Headers
All responses include:
- `X-Correlation-ID` - Request correlation ID for tracing
- `X-Request-ID` - Unique request ID

## Pagination

All list endpoints support cursor-based pagination:

### Query Parameters
- `limit`: Number of items to return (default: 50, max: 500)
- `cursor`: Pagination cursor from previous response

### Response
```json
{
  "ok": true,
  "items": [ /* array of items */ ],
  "cursor": "base64_encoded_cursor_or_null",
  "hasMore": true
}
```

## Rate Limiting

All endpoints are rate-limited. When limit is approached:
- `RateLimit-Limit`: Remaining requests
- `RateLimit-Reset`: Unix timestamp when limit resets
- `Retry-After`: Seconds to wait before retrying (on 429)

Response status `429` indicates rate limit exceeded.

---

## Endpoints

### Authentication

#### POST /auth/register
Create new user account.
```
Request: { email, password, ageConfirmed }
Response: { userId, token }
Rate Limit: 5 per 15 minutes per IP
```

### Activities

#### GET /activities
List user's activities.
```
Query: ?filter=pending|accepted|declined|all&limit=50&cursor=...
Response: { items[], cursor, hasMore }
Rate Limit: 100 per hour
```

#### POST /activities
Create new activity request.
```
Body: {
  recipientUserId: string,
  activityType: string,
  note?: string,
  startAt?: ISO8601,
  endAt?: ISO8601,
  directInvite?: boolean
}
Response: { id, threadId }
Rate Limit: 50 per hour
Note: directInvite limited to 5 per 24h
```

#### POST /activities/{id}
Accept/decline/cancel activity.
```
Body: { action: "accept"|"decline"|"cancel" }
Response: { ok }
Rate Limit: 100 per hour
```

### Events

#### GET /events
List public events.
```
Query: ?filter=upcoming|past|my_events|all&limit=50&cursor=...
Response: { items[], cursor, hasMore }
Rate Limit: 500 per hour (read-heavy)
```

#### POST /events
Create new event.
```
Body: {
  title: string,
  description: string,
  startsAt: ISO8601,
  endsAt?: ISO8601,
  location: string,
  accessType: "public"|"request_join"|"private_group",
  chatMode: "discussion"|"broadcast"
}
Response: { eventId }
Rate Limit: 10 per day
```

### Groups

#### GET /groups
List user's groups.
```
Query: ?filter=member|admin|all&limit=50&cursor=...
Response: { items[], cursor, hasMore }
Rate Limit: 100 per hour
```

#### POST /groups
Create new group.
```
Body: {
  title: string,
  description: string,
  chatMode: "discussion"|"broadcast",
  memberIds?: string[]
}
Response: { groupId }
Rate Limit: 5 per day
```

### Service Inquiries

#### GET /service-inquiries
List professional inquiries.
```
Query: ?filter=received|sent|all&limit=50&cursor=...
Response: { items[], cursor, hasMore }
Rate Limit: 100 per hour
```

#### POST /service-inquiries
Create new professional inquiry.
```
Body: {
  recipientUserId: string,
  inquiryKind: string,
  requesterType: string,
  message: string
}
Response: { id }
Rate Limit: 10 per day
```

### References

#### GET /references
List references.
```
Query: ?filter=received|given|all&limit=50&cursor=...
Response: { items[], cursor, hasMore }
Rate Limit: 100 per hour
```

#### POST /references
Submit reference.
```
Body: {
  connectionId: string,
  contextTag: string,
  rating: 1-5,
  content: string,
  isPublic: boolean
}
Response: { id }
Rate Limit: 50 per day
```

### Teacher Bookings

#### GET /teacher-bookings
List user's bookings.
```
Query: ?limit=50&cursor=...
Response: { items[], cursor, hasMore }
Rate Limit: 100 per hour
```

#### POST /teacher-bookings
Create booking request.
```
Body: {
  teacherId: string,
  availabilityId: string,
  serviceType: string,
  note?: string
}
Response: { bookingId }
Rate Limit: 20 per day
```

### Health & Status

#### GET /health
Check API health status.
```
Response: {
  status: "healthy"|"degraded"|"unhealthy",
  checks: { database, environment },
  timestamp: ISO8601
}
Rate Limit: None (unlimited)
Status Code: 200 (healthy), 503 (unhealthy)
```

---

## Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| `not_authenticated` | 401 | Missing or invalid auth token |
| `not_authorized` | 403 | Insufficient permissions |
| `not_found` | 404 | Resource doesn't exist |
| `invalid_request` | 400 | Request body/params invalid |
| `duplicate` | 409 | Resource already exists (conflict) |
| `rate_limited` | 429 | Rate limit exceeded |
| `server_error` | 500 | Internal server error |

---

## Best Practices

### Error Handling
```typescript
const res = await fetch('/api/activities', {
  headers: { Authorization: `Bearer ${token}` }
});

if (!res.ok) {
  const error = await res.json();
  console.error(`[${res.headers.get('x-correlation-id')}] Error:`, error);
  
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    // Wait retryAfter seconds before retry
  }
}
```

### Pagination
```typescript
let cursor: string | null = null;
const allItems = [];

while (true) {
  const res = await fetch(`/api/activities?cursor=${cursor}`);
  const { items, cursor: nextCursor, hasMore } = await res.json();
  
  allItems.push(...items);
  
  if (!hasMore) break;
  cursor = nextCursor;
}
```

### Correlation Tracking
```typescript
const correlationId = response.headers.get('x-correlation-id');
// Log this ID with error reports for tracking
console.error('Error', { correlationId, /* ... */ });
```

---

## Deprecations

(None currently - all endpoints are active)

## Changelog

### 2026-05-22
- Added GET handlers for activities, events, groups with pagination
- Added `/health` endpoint
- Added correlation ID tracking to all endpoints
- Added comprehensive rate limiting
