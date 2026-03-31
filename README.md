# ConXion — MVP

ConXion is a **Next.js + Supabase** application focused on building trusted connections in the dance community.

This repository is currently in **MVP development mode** and optimized for:
- Local-first development
- Fast iteration
- Clear separation between client and backend responsibilities

---

## Tech Stack

- **Next.js (App Router)**
- **Supabase** (Auth, Database, Storage)
- **Tailwind CSS**
- **TypeScript**

---

## Requirements

- Node.js **18+**
- npm / pnpm / yarn
- A Supabase project

---

## Local Development Setup

### 1️⃣ Install dependencies
```bash
npm install
```

---

### 2️⃣ Environment variables

Create a file at the root of the project:

**`.env.local`**
```env
# Public (safe for browser)
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY

# Server-only (DO NOT expose to client)
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
NEXT_PUBLIC_APP_URL=http://localhost:3000
RESEND_API_KEY=re_xxxxxxxxx
RESEND_FROM_EMAIL=ConXion <notifications@YOUR_DOMAIN>
```

#### Important rules
- `NEXT_PUBLIC_*` variables are exposed to the browser.
- `SUPABASE_SERVICE_ROLE_KEY` must **never** be used in client components.
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are only used by server routes for transactional emails.
- Service role key is reserved for:
  - Admin scripts
  - Seed data
  - Moderation tooling
  - Server-only API routes

---

### 3️⃣ Run the app
```bash
npm run dev
```

Open:
- http://localhost:3000

---

## Supabase Client Setup

### Browser-safe client
`/lib/supabase/client.ts`
```ts
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
```

---

## Deployment (Vercel – recommended)

### Environment variables in Vercel
Add the following in **Vercel → Project → Settings → Environment Variables**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`

Only add `SUPABASE_SERVICE_ROLE_KEY` when you explicitly need server-only features.
Add `RESEND_API_KEY` and `RESEND_FROM_EMAIL` when you want transactional emails enabled.

---

## One-Project MVP Mode (Recommended on Free Tier)

If you only have one hosted Supabase project, use this model:

- Hosted Supabase project = production data
- Local development = `localhost` app
- Cloud E2E workflows = disabled by default (safety), enable only when you intentionally want them

### 1) Supabase Auth URL Configuration

In Supabase Dashboard -> Authentication -> URL Configuration:

- `Site URL`:
  - your real app domain (or current Vercel preview domain for MVP)
- `Redirect URLs`:
  - `http://localhost:3000/auth/callback`
  - `https://*.vercel.app/auth/callback`
  - `https://YOUR_DOMAIN/auth/callback`

### 2) Vercel Environment Variables

Set these in Vercel (Development / Preview / Production as needed):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### 3) GitHub Actions Safety Gate

All E2E workflows in this repo respect repository variable:

- `RUN_CLOUD_E2E`

Behavior:

- unset / `0`: cloud E2E jobs are skipped safely and pass quickly
- `1`: cloud E2E jobs run fully (including seed reset scripts)

Set it at:

- GitHub -> Settings -> Secrets and variables -> Actions -> Variables -> New repository variable
- Name: `RUN_CLOUD_E2E`
- Value: `0` (default MVP safe mode)

Turn on only when you want cloud E2E:

- set `RUN_CLOUD_E2E=1`, run checks, then set back to `0`.

### 4) E2E Data Safety

- Keep all `PLAYWRIGHT_E2E_*` accounts isolated from real users.
- Never run destructive reset scripts against real user accounts.

---

## Git Safety

Make sure these files are **never committed**:

`.gitignore`
```gitignore
.env.local
.env.*
```

Always verify before committing:
```bash
git status
```

---

## MVP Notes

- Supabase Row Level Security (RLS) is mandatory for all client-accessible tables
- Demo / seed profiles should use `profiles.is_test = true`
- No free DMs — all chats must be contextual (member / trip / event)

---

## Status

🚧 Active MVP development  
Not production-ready yet

---

If you are joining the project:
1. Ask for Supabase project access
2. Copy `.env.local` values
3. Run locally first — do not deploy without approval
