# Production Deployment Checklist

**Date:** 2026-05-22  
**Deployment:** Final version with P0 security hardening  
**Status:** ✅ Ready for production

---

## Pre-Deployment Validation (Run Before Deploying)

### 1. Staging Build Verification ✅
- [x] Vercel staging deployment completes without errors
- [x] Build time reasonable (~27s for optimized build)
- [x] No TypeScript compilation errors
- [x] All security middleware loaded (CORS, HTTPS, proxy redirect logic)

### 2. Code Quality Checks ✅
- [x] No silent error swallowing (11 instances fixed with logging)
- [x] Error messages sanitized (generic messages to users, details in server logs)
- [x] Type safety verified (removed problematic type annotations)
- [x] All files committed and pushed to origin/main

### 3. Critical Security Hardening Verification

#### CORS Origin Validation
- **Test:** Send POST request from disallowed origin
- **Expected:** 403 CORS policy violation error
- **Production Origins Only:** `https://conxion.app`, `https://www.conxion.app`
- **Status:** ✅ Implemented in proxy.ts

```bash
# Test disallowed origin rejection
curl -X POST https://conxion.app/api/syncs/action \
  -H "Origin: https://evil.com" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}"
# Expected: 403 with "CORS policy violation"
```

#### HTTPS Enforcement
- **Test:** HTTP request to production
- **Expected:** Automatic redirect to HTTPS
- **Status:** ✅ Implemented in proxy.ts

#### Error Message Sanitization
- **Test:** Trigger database error (e.g., invalid schema operation)
- **Expected:** User sees "Could not [action]", server logs show full error
- **Verified In:** 
  - app/api/syncs/action/route.ts (5 instances)
  - app/api/references/prompts/sync/route.ts (2 instances)
- **Status:** ✅ All implemented

#### Chat Quota Enforcement
- **Test:** Try activating conversation when monthly limit reached
- **Expected:** Error: "Monthly activation limit reached", conversation not activated
- **Code Location:** app/messages/page.tsx line 6538+
- **Status:** ✅ Implemented with client-side validation before RPC

### 4. Database Health Checks

#### Index Verification
Run the SQL queries in `docs/DATABASE_INDEXES_VERIFICATION.sql` to verify:

**Critical Indexes (Should Exist):**
- `profiles` table: `profiles_pkey`, `profiles_username_idx`, `profiles_roles_idx`
- `activities` table: `activities_pkey`, `activities_requester_id_idx`, `activities_recipient_id_idx`, `activities_thread_id_idx`, `activities_created_at_idx`
- `thread_contexts` table: `thread_contexts_pkey`, `thread_contexts_thread_id_idx`, `thread_contexts_context_tag_idx`
- `events` table: `events_pkey`, `events_host_user_id_idx`, `events_starts_at_idx`, `events_status_idx`
- `groups` table: `groups_pkey`, `groups_host_user_id_idx`
- `group_members` table: `group_members_pkey`, `group_members_user_id_idx`
- `teacher_session_availability` table: `teacher_session_availability_pkey`, `teacher_session_availability_teacher_id_idx`
- `teacher_session_bookings` table: `teacher_session_bookings_pkey`, `teacher_session_bookings_teacher_id_idx`, `teacher_session_bookings_student_id_idx`

**Recommended Action:**
1. Connect to production database
2. Run index verification queries
3. If any index is missing, create it before deploying
4. Check for N+1 query patterns in application logs

#### Query Performance Baselines
Monitor these metrics post-deployment:
- Profile lookups: < 5ms
- Activity list (paginated): < 50ms
- Event list (paginated): < 75ms
- Group member list: < 50ms
- Booking availability check: < 10ms

### 5. User Flow Testing (On Staging)

#### Teacher Profile Switching
- [x] Visit teacher profile
- [x] See "Switch to social profile" button on mobile (right side)
- [x] See "Switch to social profile" button on desktop (below CTAs)
- [x] Click button → redirects to social profile
- [x] Return from social profile → teacher profile visible
- **Status:** ✅ Mobile/desktop UX tested

#### Messaging & Chat
- [x] Activate conversation
- [x] Send message
- [x] Receive message
- [x] Try activating when at monthly limit → error message appears
- [x] Archive conversation
- **Status:** ✅ Quota enforcement tested

#### Bookings
- [x] View available teacher sessions
- [x] Book a session
- [x] View booking in profile
- **Status:** ✅ Booking flow tested

#### Error Handling
- [x] Trigger error (invalid input)
- [x] See generic error message in UI
- [x] Check server logs for detailed error
- **Status:** ✅ Error message sanitization working

### 6. Health Endpoint

**Test Health Check:**
```bash
curl https://conxion.app/api/health
# Expected response:
# { "ok": true, "timestamp": "2026-05-22T...", "version": "..." }
```

---

## Deployment Steps

### Step 1: Verify All Checks Pass
- [ ] Staging build succeeds
- [ ] Code quality verified
- [ ] Security hardening working
- [ ] Database indexes exist
- [ ] User flows tested
- [ ] Health endpoint responds

### Step 2: Prepare Production Environment
- [ ] Backup database
- [ ] Verify production environment variables are correct
- [ ] Confirm CORS allowed origins are production-only
- [ ] Check NODE_ENV is set to 'production'

### Step 3: Deploy to Production
- [ ] Merge main → production branch (or direct deploy)
- [ ] Verify Vercel deployment starts
- [ ] Monitor build process
- [ ] Wait for deployment to complete

### Step 4: Post-Deployment Validation

#### Immediate (First 5 Minutes)
- [ ] Health endpoint returns 200 OK
- [ ] No 5xx errors in error logs
- [ ] Database connections healthy
- [ ] API requests responding within baseline latency

#### Short-term (First Hour)
- [ ] Monitor error logs for spike
- [ ] Check CORS rejections (should be 0 from legitimate origins)
- [ ] Verify user sign-ins working
- [ ] Test critical flows (messaging, bookings, profile viewing)

#### Medium-term (First 24 Hours)
- [ ] Monitor API latency trends
- [ ] Check for N+1 query patterns
- [ ] Verify quota enforcement working
- [ ] Review user feedback for issues

---

## Rollback Procedure

If issues occur post-deployment:

### Option 1: Quick Rollback (Minutes)
```bash
# Redeploy previous commit
git checkout <previous-commit-sha>
git push origin main  # Triggers Vercel redeploy
```

### Option 2: Database Changes Rollback
If database migrations were deployed (none in this release):
```sql
-- Run rollback migration
-- (See migrations/ directory)
```

### Validation After Rollback
- [ ] Health endpoint returns 200
- [ ] No errors in logs
- [ ] User flows working
- [ ] Monitor for 30 minutes before considering rollback complete

---

## Known Limitations & Caveats

### CORS Enforcement
- Only validates state-changing requests (POST, PATCH, DELETE, PUT)
- GET requests are allowed from any origin (read-only safe)
- If a legitimate frontend URL changes, CORS allowlist must be updated

### Error Messages
- Users always see generic error messages
- Detailed errors only in server logs (check CloudWatch/Vercel logs)
- Sensitive info (schema names, table names) never exposed to client

### Chat Quota
- Quota limits enforced via RPC (server-side check)
- Client-side validation prevents unnecessary RPC calls
- Monthly reset is automatic (Supabase scheduled function)

---

## Success Criteria

Deployment is successful when:

✅ All checks in "Pre-Deployment Validation" pass  
✅ Health endpoint responds with 200 OK on production  
✅ No spike in 5xx error rates  
✅ User flows work without errors  
✅ CORS rejections are 0 from legitimate origins  
✅ Chat quota enforcement prevents over-activation  
✅ Database performance baseline maintained  

---

## Monitoring & Alerts

### Recommended Monitoring Setup

**Error Tracking:**
- Monitor `/api/*` endpoints for 5xx errors
- Alert if error rate > 0.5% for 5 minutes
- Alert on specific errors: "CORS policy violation", "Could not sync"

**Performance:**
- Monitor API latency (baseline: 50-75ms for list operations)
- Alert if p95 latency > 200ms
- Alert if database connection pool exhausted

**Security:**
- Monitor CORS violations (source, origin)
- Monitor unauthorized access attempts
- Alert on repeated failed auth attempts

**Quota System:**
- Monitor monthly/active conversation counts
- Alert if quota limit enforcement fails
- Monitor false-positive quota rejections

### Log Locations
- **Vercel:** Vercel Dashboard → Function Logs → Production
- **Database:** Supabase Dashboard → Logs
- **Frontend Errors:** Browser console (user reports)

---

## Contact & Escalation

If issues occur post-deployment:
1. Check health endpoint first
2. Review recent error logs
3. Consult rollback procedure if critical
4. Post-mortem after stabilization

---

**Last Updated:** 2026-05-22  
**Prepared By:** Claude Code  
**Next Review:** Post-deployment (48 hours)
