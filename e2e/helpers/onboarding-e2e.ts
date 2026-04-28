import fs from "node:fs";
import path from "node:path";
import { createClient, type Session } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

type BootstrapResult =
  | { ready: true }
  | {
      ready: false;
      reason: string;
    };

type SeedContext =
  | {
      ready: true;
      supabaseUrl: string;
      anonKey: string;
      serviceRoleKey: string;
      email: string;
      password: string;
    }
  | {
      ready: false;
      reason: string;
    };

type OnboardingRuntime =
  | ({
      ready: true;
      session: Session;
      supabaseUrl: string;
    })
  | {
      ready: false;
      reason: string;
    };

const ONBOARDING_DRAFT_KEY = "onboarding_draft_v1";

let cachedDotenv: Record<string, string> | null = null;
let cachedRuntimePromise: Promise<OnboardingRuntime> | null = null;

function loadDotEnvLocal(): Record<string, string> {
  if (cachedDotenv) return cachedDotenv;

  const envPath = path.resolve(process.cwd(), ".env.local");
  const parsed: Record<string, string> = {};
  if (!fs.existsSync(envPath)) {
    cachedDotenv = parsed;
    return parsed;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  raw.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  });

  cachedDotenv = parsed;
  return parsed;
}

function env(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess.length > 0) return fromProcess;
  return loadDotEnvLocal()[name] ?? "";
}

function sanitizeNamespace(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 16);
}

function withNamespacedEmail(baseEmail: string) {
  const explicit = env("PLAYWRIGHT_E2E_NAMESPACE");
  const workerIndex = process.env.TEST_WORKER_INDEX?.trim();
  const localDaily = `p${process.pid.toString(36)}-m${new Date().toISOString().slice(0, 10).replace(/-/g, "")}${workerIndex ? `-w${workerIndex}` : ""}`;
  const namespace = sanitizeNamespace(explicit || localDaily);
  if (!namespace) return baseEmail;

  const at = baseEmail.indexOf("@");
  if (at <= 0) return baseEmail;
  const local = baseEmail.slice(0, at).split("+")[0];
  const domain = baseEmail.slice(at + 1);
  return `${local}+${namespace}@${domain}`;
}

function isLikelyAlreadyExistsError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("already registered") ||
    text.includes("already been registered") ||
    text.includes("already exists") ||
    text.includes("duplicate")
  );
}

function isRetryableAuthError(error: unknown) {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message} ${String((error as { code?: unknown }).code ?? "")} ${String(
          (error as { cause?: { code?: unknown; message?: unknown } }).cause?.code ?? ""
        )} ${String((error as { cause?: { message?: unknown } }).cause?.message ?? "")}`
      : String(error ?? "");
  const text = message.toLowerCase();
  return (
    text.includes("fetch failed") ||
    text.includes("connect timeout") ||
    text.includes("und_err_connect_timeout") ||
    text.includes("etimedout") ||
    text.includes("econnreset") ||
    text.includes("socket hang up") ||
    text.includes("network") ||
    text.includes("rate limit reached") ||
    text.includes("too many requests")
  );
}

async function withAuthRetries<T>(fn: () => Promise<T>, attempts = 5, baseDelayMs = 500): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableAuthError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  throw lastError ?? new Error("auth_retry_failed");
}

function buildSeedContext(): SeedContext {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return {
      ready: false,
      reason: "Missing Supabase env vars for onboarding e2e bootstrap.",
    };
  }

  return {
    ready: true,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    email: withNamespacedEmail(env("PLAYWRIGHT_E2E_ONBOARDING_EMAIL") || "conxion.e2e.onboarding@local.test"),
    password: env("PLAYWRIGHT_E2E_PASSWORD") || "ConXionE2E!12345",
  };
}

async function ensureOnboardingUser(
  adminClient: ReturnType<typeof createClient>,
  signInClient: ReturnType<typeof createClient>,
  params: {
    email: string;
    password: string;
  }
) {
  let userId: string | null = null;

  try {
    const created = await withAuthRetries(() =>
      adminClient.auth.admin.createUser({
        email: params.email,
        password: params.password,
        email_confirm: true,
        user_metadata: {
          display_name: "Playwright Mobile Onboarding",
          age_confirmed: false,
          age_confirmed_at: null,
        },
      })
    );
    if (created.error && !isLikelyAlreadyExistsError(created.error.message)) throw created.error;
    if (!created.error) {
      userId = created.data.user.id;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isLikelyAlreadyExistsError(message)) throw error;
  }

  if (!userId) {
    const signedIn = await withAuthRetries(() =>
      signInClient.auth.signInWithPassword({
        email: params.email,
        password: params.password,
      })
    );
    if (signedIn.error || !signedIn.data.user?.id) {
      throw signedIn.error ?? new Error(`Unable to resolve onboarding user id for ${params.email}`);
    }
    userId = signedIn.data.user.id;
  }

  const updated = await withAuthRetries(() =>
    adminClient.auth.admin.updateUserById(userId, {
      email_confirm: true,
      password: params.password,
      user_metadata: {
        display_name: "Playwright Mobile Onboarding",
        age_confirmed: false,
        age_confirmed_at: null,
      },
    })
  );
  if (updated.error) throw updated.error;

  const deleteProfile = await adminClient.from("profiles").delete().eq("user_id", userId);
  if (deleteProfile.error) throw deleteProfile.error;

  return userId;
}

async function gotoWithRetry(page: Page, url: string, attempts = 4) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "commit", timeout: 45_000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await page.waitForTimeout(400 * attempt);
    }
  }
  throw lastError ?? new Error(`Failed to navigate to ${url}`);
}

async function loginPageWithSession(page: Page, supabaseUrl: string, session: Session) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const storageKeys = [`sb-${projectRef}-auth-token`, "supabase.auth.token"];
  const sessionPayload = session;

  await page.addInitScript(
    ({ keys, payload, onboardingDraftKey }) => {
      const serialized = JSON.stringify(payload);
      keys.forEach((key) => {
        window.localStorage.setItem(key, serialized);
        window.sessionStorage.setItem(key, serialized);
      });
      window.localStorage.removeItem(onboardingDraftKey);
      window.sessionStorage.removeItem(onboardingDraftKey);
    },
    {
      keys: storageKeys,
      payload: sessionPayload,
      onboardingDraftKey: ONBOARDING_DRAFT_KEY,
    }
  );
}

async function getOnboardingRuntime(): Promise<OnboardingRuntime> {
  if (cachedRuntimePromise) {
    return cachedRuntimePromise;
  }

  cachedRuntimePromise = (async () => {
    const context = buildSeedContext();
    if (!context.ready) return context;

    try {
      const adminClient = createClient(context.supabaseUrl, context.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signInClient = createClient(context.supabaseUrl, context.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      await ensureOnboardingUser(adminClient, signInClient, {
        email: context.email,
        password: context.password,
      });

      const signedIn = await withAuthRetries(() =>
        signInClient.auth.signInWithPassword({
          email: context.email,
          password: context.password,
        })
      );

      if (signedIn.error || !signedIn.data.session) {
        throw signedIn.error ?? new Error("Failed to sign in onboarding e2e user.");
      }

      return {
        ready: true,
        session: signedIn.data.session,
        supabaseUrl: context.supabaseUrl,
      };
    } catch (error) {
      cachedRuntimePromise = null;
      throw error;
    }
  })();

  return cachedRuntimePromise;
}

export async function bootstrapOnboardingE2E(
  page: Page,
  options?: {
    initialPath?: string;
  }
): Promise<BootstrapResult> {
  const runtime = await getOnboardingRuntime();
  if (!runtime.ready) {
    return runtime;
  }

  await loginPageWithSession(page, runtime.supabaseUrl, runtime.session);
  await gotoWithRetry(page, options?.initialPath ?? "/onboarding/age");
  await page.waitForLoadState("domcontentloaded");

  return { ready: true };
}
