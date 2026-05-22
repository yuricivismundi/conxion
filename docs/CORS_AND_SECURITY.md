# CORS and Security Configuration Review

## CORS Configuration Check

### Current Setup
Next.js handles CORS through request headers and response configuration in `next.config.js`.

### Security Review Checklist

**Q: Are we too permissive?**
- [ ] Check if `Access-Control-Allow-Origin` allows `*` (should not in production)
- [ ] Verify CORS only allows frontend domain
- [ ] Check if credentials are allowed (should only be from same origin)

**Q: What origins should be allowed?**
```
Development:  http://localhost:3000
Staging:      https://staging.conxion.app
Production:   https://conxion.app
Mobile:       capacitor://localhost (iOS), http://localhost (Android)
```

### Recommended CORS Headers

```typescript
// next.config.js or middleware.ts
const ALLOWED_ORIGINS = process.env.NODE_ENV === "production" 
  ? ["https://conxion.app", "https://www.conxion.app"]
  : ["http://localhost:3000", "http://localhost:3001"];

// Add to API responses
response.headers.set("Access-Control-Allow-Origin", origin);
response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
response.headers.set("Access-Control-Allow-Credentials", "true");
response.headers.set("Access-Control-Max-Age", "86400");
```

## Authentication Security

### Bearer Token Validation

**Current Implementation:**
- Tokens are passed in `Authorization: Bearer <token>` header
- Validated via `supabase.auth.getUser(token)`

**Security Checks:**
- [ ] Verify tokens are validated on EVERY request (no caching untrusted tokens)
- [ ] Verify expired tokens are rejected
- [ ] Verify token format is correct (should fail if malformed)
- [ ] Verify tokens cannot be used across projects

### Token Refresh

**Check if needed:**
- [ ] Do we handle token refresh? (Supabase should, but verify client-side)
- [ ] Are there tokens with indefinite expiry?
- [ ] Do we have logout that invalidates tokens?

## HTTPS/TLS

**Production Checks:**
- [ ] All traffic is HTTPS-only (no HTTP fallback)
- [ ] HSTS headers are set
- [ ] Certificates are valid and non-expired
- [ ] TLS version is 1.2+ (1.3 recommended)

## Header Security

### Add These Security Headers

```typescript
// Recommended middleware
const securityHeaders = {
  "X-Content-Type-Options": "nosniff", // Prevent MIME sniffing
  "X-Frame-Options": "SAMEORIGIN", // Prevent clickjacking
  "X-XSS-Protection": "1; mode=block", // XSS protection
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
};
```

## SQL Injection Prevention

**Check:**
- [ ] All user input goes through Supabase parameterized queries (not raw SQL)
- [ ] No string concatenation in SQL
- [ ] Using `.eq()`, `.in()`, etc. not `.filter()` with user input

## XSS Prevention

**Check:**
- [ ] No `dangerouslySetInnerHTML` in components
- [ ] Next.js automatically escapes by default (good)
- [ ] No user input rendered without sanitization

## CSRF Prevention

**Current Implementation:**
- Using `validateCsrfOrigin()` utility in some endpoints
- Check which endpoints need it

**Review:**
- [ ] All POST/PATCH/DELETE endpoints validate CSRF origin
- [ ] CSRF tokens are validated per-request (not cached)
- [ ] Origin header is checked, not just Referer

## Rate Limiting Security

**Current Implementation:**
- Rate limits exist for: auth, directInvite, group creation, booking creation

**Review:**
- [ ] All write endpoints are rate limited
- [ ] Rate limits prevent brute force attacks
- [ ] Limits are appropriate for use case
- [ ] IP addresses are logged (for ban-listing abusers)

## Sensitive Data Handling

**Audit Trail:**
- [ ] Passwords are never logged
- [ ] Tokens are never logged (except correlation IDs)
- [ ] API keys are environment variables (not in code)
- [ ] Database credentials are not exposed in errors

**Error Messages:**
- [ ] Don't reveal system internals
- [ ] Don't reveal whether username/email exists
- [ ] Do include correlation ID for support

## Environment Variables

**Check:**
- [ ] All secrets are in `.env.local` (git-ignored)
- [ ] No secrets in `next.config.js` or public files
- [ ] Required env vars are validated at startup (see `env-validation.ts`)
- [ ] Test environment uses different credentials than production

## Deployment Secrets

**Pre-deployment:**
- [ ] Verify Supabase JWT secret is strong
- [ ] Verify API rate limit thresholds are set
- [ ] Verify database backups are enabled
- [ ] Verify monitoring/alerting is configured

---

## Security Audit Checklist Summary

- [ ] CORS only allows intended origins
- [ ] HTTPS enforced, TLS 1.2+
- [ ] Security headers set
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (no raw HTML)
- [ ] CSRF validation on state-changing endpoints
- [ ] Rate limiting on all write endpoints
- [ ] Sensitive data not logged
- [ ] Error messages don't leak system info
- [ ] Environment variables properly managed
- [ ] Authentication tokens validated every request
- [ ] Monitoring/alerting configured

## Incident Response

If security issue found:
1. Isolate affected systems
2. Review logs (use correlation IDs)
3. Notify affected users if necessary
4. Deploy fix
5. Monitor for continued attacks
6. Post-incident review

Use correlation IDs from X-Correlation-ID header to trace attacker's actions.
