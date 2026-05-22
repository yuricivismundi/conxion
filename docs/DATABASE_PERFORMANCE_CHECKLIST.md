# Database Performance Audit Checklist

## Critical Indexes to Verify in Supabase

Run these queries in Supabase SQL editor to verify indexes exist:

### User & Profile Indexes
```sql
-- Check profiles indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'profiles' AND indexname LIKE '%user_id%';
SELECT indexname FROM pg_indexes WHERE tablename = 'profiles' AND indexname LIKE '%created_at%';
SELECT indexname FROM pg_indexes WHERE tablename = 'profiles' AND indexname LIKE '%updated_at%';

-- Should see indexes on: user_id, created_at, updated_at
```

### Messaging/Thread Indexes
```sql
-- Check thread_contexts indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'thread_contexts' WHERE indexname LIKE '%thread_id%';
SELECT indexname FROM pg_indexes WHERE tablename = 'thread_contexts' WHERE indexname LIKE '%user_id%';

-- Check threads indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'threads' WHERE indexname LIKE '%user_id%';
SELECT indexname FROM pg_indexes WHERE tablename = 'threads' WHERE indexname LIKE '%created_at%';
```

### Activity Indexes
```sql
-- Check activities indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'activities' WHERE indexname LIKE '%requester_id%';
SELECT indexname FROM pg_indexes WHERE tablename = 'activities' WHERE indexname LIKE '%recipient_id%';
SELECT indexname FROM pg_indexes WHERE tablename = 'activities' WHERE indexname LIKE '%created_at%';
SELECT indexname FROM pg_indexes WHERE tablename = 'activities' WHERE indexname LIKE '%status%';
```

### Hosting/Trips Indexes
```sql
-- Check trips indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'trips' WHERE indexname LIKE '%user_id%';
SELECT indexname FROM pg_indexes WHERE tablename = 'trips' WHERE indexname LIKE '%created_at%';

-- Check hosting_requests indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'hosting_requests' WHERE indexname LIKE '%sender_user_id%';
SELECT indexname FROM pg_indexes WHERE tablename = 'hosting_requests' WHERE indexname LIKE '%recipient_user_id%';
SELECT indexname FROM pg_indexes WHERE tablename = 'hosting_requests' WHERE indexname LIKE '%status%';
```

### Events/Groups Indexes
```sql
-- Check events indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'events' WHERE indexname LIKE '%host_user_id%';
SELECT indexname FROM pg_indexes WHERE tablename = 'events' WHERE indexname LIKE '%created_at%';
SELECT indexname FROM pg_indexes WHERE tablename = 'events' WHERE indexname LIKE '%status%';

-- Check groups indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'groups' WHERE indexname LIKE '%host_user_id%';
SELECT indexname FROM pg_indexes WHERE tablename = 'groups' WHERE indexname LIKE '%created_at%';

-- Check group_members indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'group_members' WHERE indexname LIKE '%user_id%';
SELECT indexname FROM pg_indexes WHERE tablename = 'group_members' WHERE indexname LIKE '%group_id%';
```

## Query Pattern Audit

### ✅ Already Optimized (Verified)
- Profile batch loading: `batchFetchProfiles()` uses IN clause (not N+1)
- Pagination endpoints: All use cursor-based pagination with proper ordering
- Activity list: Uses `.in()` for batch queries
- Group member lookup: Uses `.in()` for batch queries

### ⚠️ Potential Areas to Check
1. **Messages page** - Check if there are any sequential profile lookups in loops
2. **Discovery/search** - Verify filters don't cause full table scans
3. **Teacher bookings** - Verify availability slot checks use indexed columns
4. **References** - Check for any user-by-user lookups

### Common N+1 Patterns to Avoid
```typescript
// ❌ BAD - N+1 query per item
for (const thread of threads) {
  const profile = await supabase.from("profiles").select().eq("user_id", thread.userId).single();
}

// ✅ GOOD - Single batch query
const userIds = threads.map(t => t.userId);
const profiles = await batchFetchProfiles(supabase, userIds);
```

## Limit Audit

Current `.limit()` usage:
- events: 500 (OK for pagination)
- activities: 500 (OK for pagination)
- profiles: 2000 in sitemap (OK - background job)
- connections: 50 GET endpoint (OK)
- threads: 200+ in messages page (consider pagination if slow)

**Action**: If messages page feels slow, consider:
- Reducing default thread fetch to 50-100
- Adding pagination to thread list
- Caching thread list for 5 minutes per user

## Performance Metrics to Monitor

After deployment, watch:
1. **Slow query logs** - Enable in Supabase settings
2. **Query timeout errors** - Indicates queries taking >30s
3. **RPC execution time** - Monitor `cx_*` stored procedures
4. **Response times** - Track API endpoint latencies
5. **Database connection count** - Alert if approaching limits

## Optimization Opportunities (Post-MVP)

1. Denormalization of frequently accessed fields:
   - Cache display_name + avatar_url in threads table
   - Cache host info in events/groups tables

2. Read replicas for heavy queries:
   - Search endpoints could use read replica
   - Analytics/reporting queries

3. Full-text search indexes:
   - Events/trips/groups title/description search
   - Profile bio search

4. Materialized views:
   - User activity summary
   - Monthly stats for dashboard
