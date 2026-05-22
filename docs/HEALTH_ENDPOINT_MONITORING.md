# Health Endpoint Monitoring Setup

**Endpoint:** `GET /api/health`  
**Purpose:** Detect deployment failures and service degradation  
**Response Format:** JSON with status, checks, and timestamp

---

## Health Endpoint Response Format

```json
{
  "ok": true,
  "status": "healthy",
  "checks": {
    "database": {
      "status": "healthy",
      "latencyMs": 12
    },
    "environment": {
      "status": "healthy"
    }
  },
  "timestamp": "2026-05-22T16:30:00.000Z"
}
```

### Status Values

- `healthy` - All systems operational (HTTP 200)
- `degraded` - Some non-critical systems failing (HTTP 200)
- `unhealthy` - Critical systems down (HTTP 503)

---

## Monitoring Setup Options

### Option 1: Uptime.com (Recommended for MVP)

**Setup Time:** 5 minutes  
**Cost:** Free tier available  

1. Sign up at https://uptime.com
2. Create new monitor:
   - **Type:** HTTP(S)
   - **URL:** `https://conxion.app/api/health`
   - **Method:** GET
   - **Interval:** 30 seconds
   - **Timeout:** 10 seconds
3. Configure notifications:
   - Email alerts on failure
   - Slack integration (optional)
   - PagerDuty (if using on-call)
4. Set up dashboard
   - View uptime percentage
   - See response times over time
   - Alert history

**Alert Thresholds:**
- Failure after 2 consecutive failures (1 minute down)
- Response time > 5000ms (slow endpoint)

### Option 2: DataDog

**Setup Time:** 15 minutes  
**Cost:** $15-30/month  

1. Create API key in Heroku/hosting dashboard
2. Connect DataDog:
   ```bash
   # Set environment variable
   export DD_API_KEY=xxxxx
   export DD_SITE=datadoghq.com
   ```
3. Add monitor in DataDog UI:
   - **Type:** HTTP Endpoint
   - **URL:** `https://conxion.app/api/health`
   - **Assertion:** Response contains "healthy" or "degraded"
   - **Alert:** On failure after 2 failed checks
4. Create dashboard showing:
   - Health check status
   - Database latency trend
   - Error rate

### Option 3: Vercel Analytics (If hosting on Vercel)

Built-in, no extra setup needed:
1. View in Vercel dashboard
2. Check "Monitor" tab for endpoint status
3. Automatic alerts via email

---

## Monitoring Checklist

### During Deployment

- [ ] Monitor health endpoint every 30 seconds for 5 minutes
- [ ] Expected: Status = "healthy"
- [ ] Database latency < 50ms initially
- [ ] All checks report "healthy"

### After Deployment

- [ ] Health endpoint responsive within 1s
- [ ] Database latency stable (< 100ms average)
- [ ] No error spikes
- [ ] Alerts configured and tested
- [ ] Team notified of monitoring setup

### What to Do If Unhealthy

**Status: "degraded"**
- App is running but some systems slow
- Check database query performance
- Review recent code changes
- Safe to continue monitoring (not critical yet)

**Status: "unhealthy"**
- Critical systems down
- Immediate action required:
  1. Check database connection
  2. Review error logs with correlation IDs
  3. Check environment variables
  4. Initiate rollback if needed

---

## Integration with Sentry (Optional)

If using Sentry for error tracking:

```javascript
// In api/health/route.ts
import * as Sentry from "@sentry/nextjs";

export async function GET(req: Request) {
  try {
    // ... health checks ...
    
    // Report health check to Sentry
    Sentry.captureMessage("Health check: OK", "info");
    
    return NextResponse.json({
      ok: true,
      status: "healthy",
      checks: { /* ... */ }
    });
  } catch (err) {
    // Report failure to Sentry
    Sentry.captureException(err);
    
    return NextResponse.json(
      { ok: false, status: "unhealthy" },
      { status: 503 }
    );
  }
}
```

---

## Database Latency Baseline

Expected database latency by operation:

| Operation | Latency | Limit |
|-----------|---------|-------|
| SELECT (single row) | 5-15ms | 100ms |
| SELECT with filter | 10-30ms | 200ms |
| INSERT (single) | 5-20ms | 100ms |
| UPDATE (single) | 5-20ms | 100ms |
| Complex JOIN | 20-50ms | 300ms |

If health endpoint exceeds 100ms consistently:
- Check database indexes (run DATABASE_INDEXES_VERIFICATION.sql)
- Review slow query logs
- Scale database if needed

---

## Alerting Rules

### Critical (Page immediately)

- Health endpoint down (connection refused)
- Response time > 30 seconds
- Status = "unhealthy" for > 1 minute

### Warning (Email within 1 hour)

- Database latency > 500ms average
- Status = "degraded" for > 5 minutes
- Response time > 10 seconds

### Info (Dashboard only)

- Database latency > 200ms
- Status = "healthy" but slow
- Response time 1-10 seconds

---

## Post-Deployment Monitoring (First Week)

| Day | Action |
|-----|--------|
| Day 1 | Monitor constantly (24h watch) |
| Day 2 | Monitor every hour (check dashboard) |
| Day 3-5 | Monitor twice daily (morning + evening) |
| Day 6-7 | Monitor once daily (morning check) |
| Week 2+ | Monitor weekly (automated alerts) |

---

## Commands to Test

```bash
# Test health endpoint locally
curl http://localhost:3000/api/health

# Test in staging
curl https://staging.conxion.app/api/health

# Test in production
curl https://conxion.app/api/health

# Get response time
time curl https://conxion.app/api/health

# Monitor every 10 seconds
while true; do
  echo "$(date): $(curl -s https://conxion.app/api/health | jq '.status')"
  sleep 10
done
```

---

## Monitoring Success Criteria

✅ Setup complete when:
1. Health endpoint returns 200 for all checks
2. Alert configured and tested
3. Team receives test alert successfully
4. Dashboard showing endpoint status
5. Database latency < 100ms
6. Response time < 1000ms
7. No false positives after 24h of monitoring

✅ Healthy baseline established when:
1. 99.9% uptime over 7 days
2. Average response time < 500ms
3. Database latency consistently < 100ms
4. Zero unhealthy state occurrences
5. All team members can access monitoring dashboard
