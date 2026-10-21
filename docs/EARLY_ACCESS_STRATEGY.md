# Conxion Early Access Strategy

_Last updated: 2026-10-20 · Branch: `feature/early-access-free`_

## The problem

Conxion's value today depends on other users: connections, chats, trips and
hosting only work once there are people to connect with. With no users, a new
signup sees an empty network, a pricing page and paywalls. They have no reason to
stay and nothing to share.

## The bet

**Single-player value first, network value second.** Give every new member
something useful on day one that doesn't need anyone else on the platform, and
make that thing *shareable*, so each member brings the next ones in.

That thing is the **Dance Page**.

## 1. Dance Page: the hook

The teacher page is now a public page any member can turn on, whatever their role.

- **One link for your dance life.** Bio, videos, upcoming events, competition
  history, stage presence and references. Built for an Instagram/TikTok bio,
  WhatsApp groups and festival chats.
- **Your label.** Teacher, Artist, Performer, Competitor, DJ, Organizer, Studio
  Owner or Social Dancer. Shown on the page and in the share preview.
- **Sections adapt to the label.** Teachers keep private-class booking, weekly
  classes and service inquiries. Everyone else gets a clean page with
  "Connect on ConXion" as the call to action.
- **Shareable by design.** Proper link previews (name · label, headline,
  avatar), a share button and copy-link on the profile.

Why it works: dancers already curate their identity on social media, but there
isn't a good "dance CV" link. Each shared page is free acquisition. Every
visitor lands on Conxion and sees a "Connect" button.

## 2. Free for everyone: remove the friction

| Before | Now (early access) |
|---|---|
| Starter / Plus €6.99 / Verified €9 | Everyone gets Plus-level features for free |
| Teacher page: teacher role + 2-month trial | Dance Page for anyone, no trial |
| Hosting requests: €9 verification | Free, but needs a complete profile + admin-approved photo |
| "Upgrade to Plus" prompts everywhere | Fair-use copy: "resets next month" |
| /pricing | Founding Member perks page |

**Limits stay.** They protect against spam, fake accounts and load. They are set
at the old Plus level: 60 connection requests, 30 chat activations, 5 trips,
5 events, 25 groups, 3 photos + 2 videos per month. The daily and hourly
anti-spam caps in the database are unchanged.

**Hosting: complete profile + admin-approved photo.** Requesting hosting is free,
but the member needs name, bio (40+ chars), city, country, at least one dance
style, a role, and a profile photo an admin approved (`avatar_status =
'approved'`). This applies to everyone, Verified members included.

Admin flow (Admin → Moderation): **Approve**, **Reject** (deletes the photo and
messages the member) or **Feedback** (keeps the photo in review and opens a
support thread in the member's Messages, e.g. "add a bio" or "show your face").
Members whose photo isn't approved also get a **Send feedback** button in the
admin members list.

DB protection (`scripts/sql/2026-10-21_protect_profile_moderation_fields.sql`):
members can't set `avatar_status` or verification fields themselves, and
uploading a new photo puts it back to `pending`. Emergency login-only switch:
`NEXT_PUBLIC_HOSTING_TRUST_GATE=false`.

## 3. Founding Members: a reason to join now

- Help Center: plan and verification articles are hidden, not deleted
  (`ALL_HELP_ARTICLES` keeps them). New articles: "Is ConXion free?" and
  "What is a Dance Page?".
- Everyone who joins during early access gets a **Founding Member** badge on
  their profile (cutoff: `NEXT_PUBLIC_FOUNDING_MEMBER_CUTOFF`, default
  2027-06-30).
- The perks page sells belonging and promises no money terms: "first access
  to new features; if paid plans come back, founding members hear first".
- Primary CTAs: **Build my Dance Page** and **Invite dancers**.

## 4. The loop

```
Sign up → build Dance Page (5 min) → share link on socials
        ↑                                        ↓
  Connect / chat / trips  ←  visitor lands on page → signs up to connect
```

Onboarding now puts "Create your Dance Page" first for every member. The
social profile shows a "Create your Dance Page" nudge until it's done.

## 5. What to measure (weekly)

1. **Activation:** % of new signups who enable a Dance Page within 7 days. Target: 40%+.
2. **Share rate:** Dance Page views from outside the app (referrer ≠ conxion).
3. **Viral coefficient:** signups whose first page view was someone else's Dance Page.
4. **Retention:** % of members back in week 2 and week 4.
5. **Limit hits:** how often each fair-use limit is reached. If a limit is often
   hit by real users, raise it.

Suggested next build: simple event tracking on `dance_page_enabled`,
`dance_page_shared`, `dance_page_view` (with referrer) and `signup` (with landing page).

## 6. Seeding playbook (first 100 members)

1. Personally onboard 10–20 teachers, artists and organizers in Tallinn/Baltics.
   Build their Dance Pages *with* them. They have audiences.
2. Ask each to put the link in their Instagram bio and post it once.
3. Organizers: create their upcoming events on Conxion so pages show
   "Where to find me next" and attendees have a reason to join.
4. Competitors: add competition history. It's the most shareable section.
5. Follow up on the founding-member angle in local WhatsApp/Telegram dance groups.

## 7. Turning monetisation back on later

Everything is behind one switch, and the Stripe code is untouched:

- App: `NEXT_PUBLIC_EARLY_ACCESS=false` brings back pricing, upgrade prompts and
  checkout.
- Database: redefine `public.is_early_access()` to return `false`. Limit
  functions fall back to Starter/Plus.
- Grandfather founding members (e.g. a discounted or free Plus tier) before
  flipping it.

Candidates to charge for later, once there is network value: boosted
visibility in Discover, featured events for organizers, teacher booking fees or
commission, and premium Dance Page themes or custom URLs.

## Implementation map

| Area | Files |
|---|---|
| Switch + copy helpers | `lib/billing/early-access.ts` |
| Plus limits for all | `lib/billing/limits.ts`, `lib/billing/account-state.ts` |
| Dance Page | `lib/dance-page.ts`, `lib/teacher-profile/access.ts`, `app/profile/[id]/teacher/page.tsx`, `app/me/edit/teacher-profile/page.tsx` |
| Hosting trust gate | `lib/hosting/trust-gate.ts`, `app/api/hosting/requests/route.ts`, `components/verification/VerificationRequiredDialog.tsx`, `app/api/admin/photo-review/route.ts`, `app/admin/space/page.tsx` |
| Founding Member page | `components/billing/EarlyAccessPerks.tsx`, `app/pricing/*` |
| Upsell removal | Nav, messages, activity, events, trips, groups, media manager, tours |
| Database | `scripts/sql/2026-10-20_early_access_free.sql`, `scripts/sql/2026-10-21_protect_profile_moderation_fields.sql` |
| Tests | `__tests__/early-access.test.ts` |
