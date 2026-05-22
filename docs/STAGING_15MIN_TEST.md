# 15-Minute Staging Test Plan

Run this before deploying production. Times are approximate — write down anything that fails.

**URL:** https://staging.conxion.social

---

## Pre-flight (1 min)

Open these tabs in your browser:
1. https://staging.conxion.social/ (landing)
2. https://staging.conxion.social/api/health (health check)
3. https://vercel.com/yuricivismundi/conxion/logs (errors in real-time)
4. DevTools → Console + Network tabs

**Pass criteria:**
- [ ] Landing page loads (no black screen)
- [ ] `/api/health` returns JSON — note if database is `healthy` or `unhealthy`
- [ ] No red errors in DevTools console (warnings OK)

---

## ✅ Auth Flows (4 min)

### Magic link login
1. Go to `/auth?mode=signin`
2. Enter `josh.bucio@gmail.com`
3. Click "Log in with magic link"

**Pass criteria:**
- [ ] No "CORS policy violation" error
- [ ] Success message shown ("Check your email")
- [ ] Magic link email received within 30s
- [ ] Click link → redirects to `/connections` or `/auth/callback` and you're logged in

### Google OAuth
1. Log out (if logged in)
2. Click "Continue with Google"
3. Choose your Google account

**Pass criteria:**
- [ ] Google consent screen appears
- [ ] After consent → redirects back to staging.conxion.social logged in
- [ ] No "redirect_uri_mismatch" error from Google

### Logout
1. Click Settings → Log out

**Pass criteria:**
- [ ] Redirected to landing/auth page
- [ ] Refresh → still logged out (no auto-login)

---

## ✅ Teacher Profile (3 min)

Visit your own teacher profile: https://staging.conxion.social/profile/[your-id]/teacher

**Pass criteria — Desktop:**
- [ ] Page loads with hero photo + name + headline + location
- [ ] **Settings + Switch Profile** buttons at top-right of hero (small, discrete)
- [ ] **Book Session** button (cyan→pink gradient)
- [ ] **Request Info** button (outlined)
- [ ] Click **Switch Profile** → goes to social profile
- [ ] Use browser back → returns to teacher profile

**Pass criteria — Mobile (resize browser to 375px or use DevTools mobile mode):**
- [ ] Settings (left) + Switch Profile (right) above the photo
- [ ] Photo, name, headline, CTAs stack vertically
- [ ] Bottom nav bar visible

### Settings menu
1. Click the **Settings** icon (gear)

**Pass criteria:**
- [ ] Dropdown opens with: Profile settings, Teacher profile settings, Account settings, Upgrade your plan, Notifications, Log out
- [ ] Click "Notifications" → goes to `/notifications` (don't return yet)

---

## ✅ Notifications (2 min)

You should now be on `/notifications`.

**Pass criteria:**
- [ ] **Header**: "Notifications" title + "X unread · Y total"
- [ ] **"Mark all as read"** button appears (if unread > 0)
- [ ] **Filter pills**: All, Unread (with badge if unread > 0), Requests, Trips, Hosting, Events, References, General
- [ ] Click "Unread" filter → only unread shown
- [ ] Click any notification card → opens it + marks as read
- [ ] Click 3-dot menu (⋯) on a card → shows "Mark as read" / "Open"
- [ ] Time-grouped sections: "New", "Earlier today", "Yesterday", "This week", "Earlier"

### Bell dropdown
1. Click the **bell icon** in the top nav

**Pass criteria:**
- [ ] Dropdown appears, 400px wide
- [ ] Shows up to 8 notifications
- [ ] Time groups: "New" / "Earlier"
- [ ] Footer link: "See all notifications →"

---

## ✅ Booking Flow (3 min)

Go to another teacher's profile (one you DIDN'T create), or the inline calendar on yours.

1. Click **Book Session**

**Pass criteria — Modal:**
- [ ] Modal opens with **teacher's avatar visible** (NOT a blank gradient)
- [ ] "Book a session with [Name]" header
- [ ] **Private class** option selected by default
- [ ] Calendar shows months with available dates
- [ ] Click a green-circled date → time slots appear
- [ ] Click a time slot → checkmark appears, "Send Booking Request" enabled
- [ ] Note field accepts up to 220 chars
- [ ] Click outside modal → modal closes

### On your own profile (Session Availability section)
- [ ] Yellow notice "This is your own teacher profile..." shows on inline section
- [ ] Calendar still functional for preview

---

## ✅ Performance & Errors (2 min)

### Open DevTools → Performance tab → Reload
- [ ] Page load < 4 seconds (acceptable on staging)
- [ ] No 500/503 errors in Network tab (other than maybe `/api/health` DB check)
- [ ] No 4xx errors except expected (404s for missing avatars are OK)

### Check Vercel logs (Vercel dashboard → Logs)
- [ ] No repeating errors in last 5 min
- [ ] No "CORS policy violation" entries
- [ ] No "fetch failed" entries (other than health check DB if env vars not set on staging too)

---

## 🚦 Go / No-Go

### ✅ GO TO PRODUCTION IF:
- All checkboxes above are green
- Magic link + Google OAuth both work
- Teacher profile loads & switches work
- Book session modal shows avatar correctly
- Notifications page works
- No console errors that aren't documented

### ❌ HOLD IF:
- Any auth flow fails
- "CORS policy violation" appears anywhere
- Avatar missing in booking modal
- Pages return 500 errors

---

## Quick smoke-test commands (copy-paste into terminal)

```bash
# Health check
curl -s https://staging.conxion.social/api/health | jq .

# Should be 403 (CORS protection working)
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://staging.conxion.social/api/syncs/action \
  -H "Origin: https://evil.com" -H "Content-Type: application/json"

# Should be 204 (preflight ok from allowed origin)
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS \
  https://staging.conxion.social/api/syncs/action \
  -H "Origin: https://staging.conxion.social"

# Should be 200 (landing works)
curl -s -o /dev/null -w "%{http_code}\n" https://staging.conxion.social/

# Notifications page (will redirect to /auth if not logged in)
curl -s -o /dev/null -w "%{http_code}\n" https://staging.conxion.social/notifications
```

Or use the automated script: `./scripts/smoke-test.sh staging`

---

**Total time:** ~15 minutes  
**Once complete:** Read `PRODUCTION_DEPLOYMENT_CHECKLIST.md` for production rollout steps.
