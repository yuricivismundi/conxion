"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LEGAL_PROFILE } from "@/lib/legal-profile";
import { resolveClientPublicAppUrl } from "@/lib/public-app-url";
import { supabase } from "@/lib/supabase/client";

type AuthMode = "signup" | "login";

type SentState = {
  email: string;
  mode: AuthMode;
};

type ExistingSessionState = {
  email: string;
  continuePath: "/onboarding/age" | "/onboarding/profile";
};

const BRAND = {
  bg: "#060A10",
  surface: "rgba(14,18,27,0.88)",
  text: "#EAF0FF",
  muted: "rgba(234,240,255,0.58)",
  border: "rgba(255,255,255,0.12)",
  borderStrong: "rgba(255,255,255,0.2)",
  cyan: "#38E5D7",
  magenta: "#FF2BD6",
  danger: "#FF4D6D",
  dangerBg: "rgba(255,77,109,0.10)",
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function extractRateLimitSeconds(message: string) {
  const text = message.toLowerCase();
  const looksLikeRateLimit =
    text.includes("rate limit") ||
    text.includes("too many requests") ||
    text.includes("too many") ||
    text.includes("over_email_send_rate_limit");
  if (!looksLikeRateLimit) return null;

  const secondsMatch = message.match(/(\d+)\s*(seconds?|secs?|s)\b/i);
  if (secondsMatch?.[1]) return Number(secondsMatch[1]);

  const minutesMatch = message.match(/(\d+)\s*(minutes?|mins?|m)\b/i);
  if (minutesMatch?.[1]) return Number(minutesMatch[1]) * 60;

  const afterMatch = message.match(/after\s+(\d+)/i);
  if (afterMatch?.[1]) return Number(afterMatch[1]);

  return 60;
}

function normalizeAuthError(err: unknown) {
  const rawMessage = err instanceof Error ? err.message : "Could not send secure link.";
  const waitSeconds = extractRateLimitSeconds(rawMessage);
  if (waitSeconds && waitSeconds > 0) {
    return {
      waitSeconds,
      message: `Email rate limit exceeded. Please wait ${waitSeconds}s and try again.`,
    };
  }

  const lowered = rawMessage.toLowerCase();
  if (
    lowered.includes("user not found") ||
    lowered.includes("email not found") ||
    lowered.includes("no account") ||
    lowered.includes("already registered") ||
    lowered.includes("already exists")
  ) {
    return {
      waitSeconds: 0,
      message: "Unable to send secure link with this mode. Try switching between Sign up and Log in.",
    };
  }

  return { waitSeconds: 0, message: rawMessage };
}

function getPublicAppUrl() {
  return resolveClientPublicAppUrl("");
}

async function runEmailPreflight(email: string) {
  let res: Response;
  try {
    res = await fetch("/api/auth/check-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    throw new Error("Network issue while checking account status. Please try again.");
  }

  const payload = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.error || "Could not verify account status right now.");
  }
}

async function requestMagicLink(email: string, mode: AuthMode) {
  const appUrl = getPublicAppUrl();
  if (!appUrl) throw new Error("App URL is not configured.");

  const response = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: mode === "signup",
      emailRedirectTo: `${appUrl}/auth/callback`,
    },
  });
  if (response.error) {
    throw new Error(response.error.message);
  }
}

function AuthPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<AuthMode>("signup");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentState, setSentState] = useState<SentState | null>(null);
  const [suggestedMode, setSuggestedMode] = useState<AuthMode | null>(null);
  const [resendIn, setResendIn] = useState(30);
  const [rateLimitIn, setRateLimitIn] = useState(0);
  const [existingSession, setExistingSession] = useState<ExistingSessionState | null>(null);
  const logoSrc = "/branding/CONXION-3-tight.png";
  const [logoFailed, setLogoFailed] = useState(false);
  const deactivatedNotice = searchParams.get("deactivated") === "1";

  const modeLabel = useMemo(() => (mode === "signup" ? "Sign up" : "Log in"), [mode]);

  useEffect(() => {
    if (!sentState || resendIn <= 0) return;
    const timeout = window.setTimeout(() => setResendIn((prev) => Math.max(prev - 1, 0)), 1000);
    return () => window.clearTimeout(timeout);
  }, [sentState, resendIn]);

  useEffect(() => {
    if (rateLimitIn <= 0) return;
    const timeout = window.setTimeout(() => setRateLimitIn((prev) => Math.max(prev - 1, 0)), 1000);
    return () => window.clearTimeout(timeout);
  }, [rateLimitIn]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const hash = window.location.hash ?? "";
    const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
    const hasAccessToken = Boolean(hashParams.get("access_token"));
    const hasRefreshToken = Boolean(hashParams.get("refresh_token"));
    const hasCode = Boolean(searchParams.get("code"));
    const hasCallbackError = Boolean(searchParams.get("error") || searchParams.get("error_description"));
    const query = searchParams.toString();

    if ((hasAccessToken && hasRefreshToken) || hasCode || hasCallbackError) {
      const queryPart = query ? `?${query}` : "";
      router.replace(`/auth/callback${queryPart}${hash}`);
      return;
    }

    (async () => {
      try {
        const sessionRes = await supabase.auth.getSession();
        if (cancelled) return;

        const userId = sessionRes.data.session?.user?.id ?? null;
        if (!userId) {
          setExistingSession(null);
          return;
        }

        const profileRes = await supabase.from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
        if (cancelled) return;

        if (profileRes.data) {
          router.replace("/connections");
          return;
        }
        const ageConfirmed = Boolean(
          sessionRes.data.session?.user?.user_metadata?.age_confirmed_at ||
            sessionRes.data.session?.user?.user_metadata?.age_confirmed === true
        );
        setExistingSession({
          email: normalizeEmail(sessionRes.data.session?.user?.email ?? ""),
          continuePath: ageConfirmed ? "/onboarding/profile" : "/onboarding/age",
        });
      } catch (err: unknown) {
        if (cancelled) return;
        setExistingSession(null);
        setError(err instanceof Error ? err.message : "Could not verify current session.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  async function switchAccount() {
    setLoading(true);
    setError(null);
    try {
      const signOut = await supabase.auth.signOut();
      if (signOut.error) throw signOut.error;
      setExistingSession(null);
      setSentState(null);
      setSuggestedMode(null);
      setRateLimitIn(0);
      setResendIn(30);
      setEmail("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not switch account.");
    } finally {
      setLoading(false);
    }
  }

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    if (rateLimitIn > 0) {
      setError(`Email rate limit exceeded. Please wait ${rateLimitIn}s and try again.`);
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestedMode(null);

    try {
      const normalized = normalizeEmail(email);
      if (!normalized) throw new Error("Please enter your email.");

      await runEmailPreflight(normalized);

      await requestMagicLink(normalized, mode);
      setSentState({ email: normalized, mode });
      setResendIn(30);
    } catch (err: unknown) {
      const normalized = normalizeAuthError(err);
      if (normalized.waitSeconds > 0) setRateLimitIn(normalized.waitSeconds);
      setError(normalized.message);
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (!sentState || resendIn > 0 || loading || rateLimitIn > 0) {
      if (rateLimitIn > 0) {
        setError(`Email rate limit exceeded. Please wait ${rateLimitIn}s and try again.`);
      }
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestedMode(null);

    try {
      await requestMagicLink(sentState.email, sentState.mode);
      setResendIn(30);
    } catch (err: unknown) {
      const normalized = normalizeAuthError(err);
      if (normalized.waitSeconds > 0) setRateLimitIn(normalized.waitSeconds);
      setError(normalized.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-6 sm:py-12" style={{ backgroundColor: BRAND.bg, color: BRAND.text }}>
      <div
        className="pointer-events-none absolute -top-48 -left-44 h-[620px] w-[620px] rounded-full blur-[120px]"
        style={{ background: "radial-gradient(circle, rgba(56,229,215,0.12) 0%, transparent 68%)" }}
      />
      <div
        className="pointer-events-none absolute -bottom-48 -right-44 h-[620px] w-[620px] rounded-full blur-[130px]"
        style={{ background: "radial-gradient(circle, rgba(255,43,214,0.11) 0%, transparent 68%)" }}
      />

      <div className="relative z-10 w-full max-w-md">
        {!sentState ? <div className="mb-3" /> : null}

        <div className="relative group">
          <div
            className="pointer-events-none absolute -inset-1 rounded-[1.6rem] opacity-25 blur transition duration-700 group-hover:opacity-45"
            style={{ backgroundImage: `linear-gradient(135deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)` }}
          />

          <div className="relative rounded-[1.5rem] border p-5 shadow-2xl sm:p-8" style={{ backgroundColor: "#121212", borderColor: BRAND.border }}>
            {error ? (
              <div
                className="mb-4 rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "rgba(255,77,109,0.35)", backgroundColor: BRAND.dangerBg, color: BRAND.danger }}
              >
                {error}
              </div>
            ) : null}

            {deactivatedNotice ? (
              <div className="mb-4 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100">
                Your account is deactivated. Sign in any time to reactivate it automatically.
              </div>
            ) : null}

            {!sentState ? (
              <form onSubmit={submitAuth} className="space-y-6">
                <Link href="/" className="mx-auto block w-max" aria-label="Go to landing page">
                  {!logoFailed ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoSrc}
                      alt="ConXion"
                      className="mx-auto h-14 w-auto select-none sm:h-16"
                      onError={() => {
                        setLogoFailed(true);
                      }}
                    />
                  ) : (
                    <h1 className="text-center text-4xl font-black italic tracking-tight text-white">
                      CON
                      <span
                        className="text-5xl not-italic"
                        style={{
                          backgroundImage: `linear-gradient(120deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)`,
                          WebkitBackgroundClip: "text",
                          backgroundClip: "text",
                          color: "transparent",
                        }}
                      >
                        X
                      </span>
                      ION
                    </h1>
                  )}
                </Link>

                <div className="mx-auto flex w-full max-w-[280px] items-center rounded-full border border-white/10 bg-[#1E1E1E] p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("signup");
                      setError(null);
                      setSuggestedMode(null);
                    }}
                    className="flex-1 rounded-full px-4 py-2 text-sm font-semibold transition"
                    style={{
                      backgroundColor: mode === "signup" ? "#2C2C2C" : "transparent",
                      color: mode === "signup" ? "#FFFFFF" : "rgba(234,240,255,0.56)",
                    }}
                  >
                    Sign up
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setError(null);
                      setSuggestedMode(null);
                    }}
                    className="flex-1 rounded-full px-4 py-2 text-sm font-semibold transition"
                    style={{
                      backgroundColor: mode === "login" ? "#2C2C2C" : "transparent",
                      color: mode === "login" ? "#FFFFFF" : "rgba(234,240,255,0.56)",
                    }}
                  >
                    Log in
                  </button>
                </div>

                <div className="text-center">
                  <h2 className="text-3xl font-bold text-white">{mode === "signup" ? "Create account" : "Welcome back"}</h2>
                </div>

                {existingSession ? (
                  <div className="rounded-xl border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm">
                    <p className="font-semibold" style={{ color: BRAND.text }}>
                      You are already signed in {existingSession.email ? `as ${existingSession.email}` : ""}.
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => router.push(existingSession.continuePath)}
                        className="rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white hover:border-white/25"
                      >
                        Continue onboarding
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void switchAccount();
                        }}
                        disabled={loading}
                        className="rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-xs font-bold uppercase tracking-wide hover:border-white/25 disabled:opacity-60"
                        style={{ color: BRAND.cyan }}
                      >
                        Use different account
                      </button>
                    </div>
                  </div>
                ) : null}

                <label className="block space-y-2 text-left" htmlFor="auth-email">
                  <span className="ml-1 block text-xs font-bold uppercase tracking-wider" style={{ color: BRAND.muted }}>
                    Email
                  </span>
                  <div className="relative">
                    <input
                      id="auth-email"
                      className="block w-full rounded-xl border border-white/10 bg-[#1E1E1E] px-4 py-3.5 pr-11 text-lg font-semibold text-white outline-none transition placeholder:text-white/30 focus:border-transparent focus:ring-2"
                      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)", ["--tw-ring-color" as string]: "rgba(56,229,215,0.45)" }}
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                    />
                    {email.includes("@") ? (
                      <span className="pointer-events-none absolute right-4 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-emerald-400">
                        <span className="material-icons text-[20px] leading-none">check_circle</span>
                      </span>
                    ) : null}
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={loading || rateLimitIn > 0 || !!existingSession}
                  className="group w-full rounded-xl px-6 py-3.5 text-lg font-black text-[#071018] shadow-[0_0_18px_rgba(56,229,215,0.22)] transition disabled:opacity-60"
                  style={{ backgroundImage: `linear-gradient(90deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)` }}
                >
                  <span className="inline-flex items-center justify-center gap-2">
                    {rateLimitIn > 0 ? `Wait ${rateLimitIn}s` : loading ? "Sending..." : `${modeLabel} with magic link`}
                    <span className="material-icons text-[18px] transition group-hover:translate-x-0.5">arrow_forward</span>
                  </span>
                </button>

                {mode === "login" ? (
                  <Link href="/auth/recovery" className="block text-center text-sm font-semibold hover:underline" style={{ color: BRAND.cyan }}>
                    Can’t access your account? Recover access
                  </Link>
                ) : null}

                {suggestedMode ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMode(suggestedMode);
                      setError(null);
                      setSuggestedMode(null);
                    }}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold transition hover:border-white/20"
                    style={{ color: BRAND.cyan }}
                  >
                    Switch to {suggestedMode === "signup" ? "Sign up" : "Log in"}
                  </button>
                ) : null}
              </form>
            ) : (
              <div className="text-center">
                <Link href="/" className="mx-auto block w-max" aria-label="Go to landing page">
                  {!logoFailed ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoSrc}
                      alt="ConXion"
                      className="mx-auto h-14 w-auto select-none sm:h-16"
                      onError={() => {
                        setLogoFailed(true);
                      }}
                    />
                  ) : (
                    <h1 className="text-center text-4xl font-black italic tracking-tight text-white">
                      CON
                      <span
                        className="text-5xl not-italic"
                        style={{
                          backgroundImage: `linear-gradient(120deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)`,
                          WebkitBackgroundClip: "text",
                          backgroundClip: "text",
                          color: "transparent",
                        }}
                      >
                        X
                      </span>
                      ION
                    </h1>
                  )}
                </Link>

                <h2 className="text-2xl font-bold text-white">Check your email</h2>
                <p className="mt-2 text-sm" style={{ color: BRAND.muted }}>
                  We emailed you a login link.
                </p>
                <div className="mx-auto mt-4 inline-flex rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5">
                  <span className="text-sm font-semibold" style={{ color: BRAND.cyan }}>
                    {sentState.email}
                  </span>
                </div>

                <div className="mt-7 flex items-center justify-center gap-3 text-xs" style={{ color: BRAND.muted }}>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: BRAND.cyan }} />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: BRAND.cyan, animationDelay: "120ms" }} />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: BRAND.cyan, animationDelay: "240ms" }} />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: BRAND.cyan, animationDelay: "360ms" }} />
                </div>

                <div className="mt-6 space-y-3">
                  <button
                    type="button"
                    disabled={resendIn > 0 || rateLimitIn > 0 || loading}
                    onClick={() => {
                      void resend();
                    }}
                    className="w-full rounded-xl border px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ borderColor: BRAND.borderStrong, color: BRAND.text, backgroundColor: "rgba(0,0,0,0.2)" }}
                  >
                    {rateLimitIn > 0
                      ? `Wait ${rateLimitIn}s`
                      : resendIn > 0
                        ? `Resend link in ${resendIn}s`
                        : loading
                          ? "Resending..."
                          : "Resend link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const params = new URLSearchParams({
                        email: sentState.email,
                        mode: sentState.mode,
                      });
                      router.push(`/auth/code?${params.toString()}`);
                    }}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold transition hover:border-white/20"
                    style={{ color: BRAND.text }}
                  >
                    Enter code instead
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSentState(null);
                      setError(null);
                      setSuggestedMode(null);
                    }}
                    className="w-full rounded-xl px-4 py-2 text-sm font-semibold transition"
                    style={{ color: BRAND.cyan }}
                  >
                    Use a different email
                  </button>
                </div>

                <div className="mt-8 border-t border-white/10 pt-5 text-[11px]" style={{ color: BRAND.muted }}>
                  This link expires shortly for your safety.
                </div>
                <a className="mt-3 block text-xs font-medium hover:underline" href={`mailto:${LEGAL_PROFILE.supportEmail}`} style={{ color: BRAND.muted }}>
                  Trouble accessing email?
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: BRAND.muted }}>
          <Link href="/privacy" className="hover:text-white transition-colors">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-white transition-colors">
            Terms
          </Link>
          <Link href="/support" className="hover:text-white transition-colors">
            Support
          </Link>
        </div>
      </div>
    </div>
  );
}

function AuthPageFallback() {
  return (
    <div className="min-h-screen bg-[#060A10] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto flex min-h-[80vh] w-full max-w-md items-center justify-center">
        <div className="w-full rounded-[1.5rem] border border-white/10 bg-[#121212] p-5 shadow-2xl sm:p-8">
          <div className="mx-auto h-20 w-40 animate-pulse rounded bg-white/10 sm:h-24 sm:w-48" />
          <div className="mt-6 h-10 w-36 animate-pulse rounded bg-white/10" />
          <div className="mt-6 h-14 animate-pulse rounded-xl bg-white/[0.06]" />
          <div className="mt-4 h-12 animate-pulse rounded-xl bg-white/[0.06]" />
          <div className="mt-6 h-12 animate-pulse rounded-xl bg-white/[0.08]" />
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthPageFallback />}>
      <AuthPageContent />
    </Suspense>
  );
}
