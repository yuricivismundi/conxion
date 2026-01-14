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
```

#### Important rules
- `NEXT_PUBLIC_*` variables are exposed to the browser.
- `SUPABASE_SERVICE_ROLE_KEY` must **never** be used in client components.
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

Only add `SUPABASE_SERVICE_ROLE_KEY` when you explicitly need server-only features.

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
