/**
 * Shared auth helper for smoke tests that require a logged-in user.
 * Uses the same env vars as the existing messages e2e helpers.
 */
import { createClient, type Session } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

function env(key: string): string {
  return process.env[key] ?? "";
}

function buildAuthContext() {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL") || env("SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY") || env("SUPABASE_ANON_KEY");
  const email = env("PLAYWRIGHT_E2E_EMAIL") || "conxion.e2e.messages.primary@local.test";
  const password = env("PLAYWRIGHT_E2E_PASSWORD") || "ConXionE2E!12345";

  if (!supabaseUrl || !anonKey) {
    return { ready: false as const, reason: "Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars" };
  }
  return { ready: true as const, supabaseUrl, anonKey, email, password };
}

let cachedSession: Session | null = null;

async function getSession(): Promise<Session | null> {
  if (cachedSession) return cachedSession;

  const ctx = buildAuthContext();
  if (!ctx.ready) return null;

  const client = createClient(ctx.supabaseUrl, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email: ctx.email,
    password: ctx.password,
  });

  if (error || !data.session) return null;
  cachedSession = data.session;
  return data.session;
}

/**
 * Inject auth session into page localStorage before navigation.
 * Call before page.goto().
 */
export async function injectAuthSession(page: Page): Promise<boolean> {
  const ctx = buildAuthContext();
  if (!ctx.ready) return false;

  const session = await getSession();
  if (!session) return false;

  const projectRef = new URL(ctx.supabaseUrl).hostname.split(".")[0];
  const storageKeys = [`sb-${projectRef}-auth-token`, "supabase.auth.token"];
  const payload = session;

  await page.addInitScript(
    ({ keys, p }: { keys: string[]; p: Session }) => {
      const serialized = JSON.stringify(p);
      keys.forEach((key) => {
        window.localStorage.setItem(key, serialized);
        window.sessionStorage.setItem(key, serialized);
      });
    },
    { keys: storageKeys, p: payload }
  );

  return true;
}

/**
 * Navigate to a page with auth injected. Returns false if auth not available.
 */
export async function gotoAuthed(page: Page, path: string): Promise<boolean> {
  const ok = await injectAuthSession(page);
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);

  // If still redirected to auth, the session didn't work
  if (page.url().includes("/auth")) return false;
  return ok;
}
