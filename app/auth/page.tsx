"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type AuthMode = "signup" | "login";

type SentState = {
  email: string;
  mode: AuthMode;
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

function getPublicAppUrl() {
  const envValue = process.env.NEXT_PUBLIC_APP_URL;
  if (envValue && /^https?:\/\//i.test(envValue.trim())) {
    return envValue.trim().replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

async function checkEmailExists(email: string) {
  const res = await fetch("/api/auth/check-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });

  const payload = (await res.json().catch(() => null)) as { exists?: boolean; error?: string } | null;
  if (!res.ok || !payload || typeof payload.exists !== "boolean") {
    throw new Error(payload?.error || "Could not verify account status right now.");
  }
  return payload.exists;
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
  const [logoSrc, setLogoSrc] = useState("/branding/conxion-logo.svg");
  const [logoFailed, setLogoFailed] = useState(false);

  const modeLabel = useMemo(() => (mode === "signup" ? "Sign up" : "Log in"), [mode]);

  useEffect(() => {
    if (!sentState || resendIn <= 0) return;
    const timeout = window.setTimeout(() => setResendIn((prev) => Math.max(prev - 1, 0)), 1000);
    return () => window.clearTimeout(timeout);
  }, [sentState, resendIn]);

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
      const sessionRes = await supabase.auth.getSession();
      if (cancelled) return;

      const userId = sessionRes.data.session?.user?.id ?? null;
      if (!userId) return;

      const profileRes = await supabase.from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
      if (cancelled) return;

      if (profileRes.data) {
        router.replace("/connections");
        return;
      }
      router.replace("/onboarding/profile");
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();

    setLoading(true);
    setError(null);
    setSuggestedMode(null);

    try {
      const normalized = normalizeEmail(email);
      if (!normalized) throw new Error("Please enter your email.");

      const exists = await checkEmailExists(normalized);
      if (mode === "signup" && exists) {
        setSuggestedMode("login");
        throw new Error("This email already has an account. Log in instead.");
      }
      if (mode === "login" && !exists) {
        setSuggestedMode("signup");
        throw new Error("No account found for this email. Sign up first.");
      }

      await requestMagicLink(normalized, mode);
      setSentState({ email: normalized, mode });
      setResendIn(30);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send secure link.");
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (!sentState || resendIn > 0 || loading) return;

    setLoading(true);
    setError(null);
    setSuggestedMode(null);

    try {
      await requestMagicLink(sentState.email, sentState.mode);
      setResendIn(30);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not resend secure link.");
    } finally {
      setLoading(false);
    }
  }

  const waitingMode = sentState?.mode ?? mode;
  const waitingActionText = waitingMode === "signup" ? "sign-up" : "login";

  return (
    <div className="relative min-h-screen overflow-hidden px-6 py-12 flex items-center justify-center" style={{ backgroundColor: BRAND.bg, color: BRAND.text }}>
      <div
        className="pointer-events-none absolute -top-48 -left-44 h-[620px] w-[620px] rounded-full blur-[120px]"
        style={{ background: "radial-gradient(circle, rgba(56,229,215,0.12) 0%, transparent 68%)" }}
      />
      <div
        className="pointer-events-none absolute -bottom-48 -right-44 h-[620px] w-[620px] rounded-full blur-[130px]"
        style={{ background: "radial-gradient(circle, rgba(255,43,214,0.11) 0%, transparent 68%)" }}
      />

      <div className="relative z-10 w-full max-w-[460px]">
        <div className="mb-8 flex flex-col items-center text-center">
          {!logoFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoSrc}
              alt="ConXion"
              className="h-28 w-auto select-none"
              onError={() => {
                if (logoSrc.endsWith(".svg")) {
                  setLogoSrc("/branding/conxion-short-logo.png");
                  return;
                }
                setLogoFailed(true);
              }}
            />
          ) : (
            <div
              className="text-4xl font-black italic tracking-tight"
              style={{
                backgroundImage: `linear-gradient(90deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              CONXION
            </div>
          )}
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white">Welcome to ConXion</h1>
        </div>

        <div className="rounded-3xl border p-7 sm:p-8" style={{ backgroundColor: BRAND.surface, borderColor: BRAND.border }}>
          {error ? (
            <div
              className="mb-4 rounded-xl border px-3 py-2 text-sm"
              style={{ borderColor: "rgba(255,77,109,0.35)", backgroundColor: BRAND.dangerBg, color: BRAND.danger }}
            >
              {error}
            </div>
          ) : null}

          {!sentState ? (
            <form onSubmit={submitAuth} className="space-y-6">
              <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                    setSuggestedMode(null);
                  }}
                  className="rounded-lg px-4 py-2 transition"
                  style={{
                    backgroundColor: mode === "signup" ? "rgba(56,229,215,0.18)" : "transparent",
                    color: mode === "signup" ? BRAND.text : BRAND.muted,
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
                  className="rounded-lg px-4 py-2 transition"
                  style={{
                    backgroundColor: mode === "login" ? "rgba(255,43,214,0.16)" : "transparent",
                    color: mode === "login" ? BRAND.text : BRAND.muted,
                  }}
                >
                  Log in
                </button>
              </div>

              <div>
                <h2 className="text-xl font-bold text-white">{mode === "signup" ? "Create your account" : "Welcome back"}</h2>
                <p className="mt-1 text-sm" style={{ color: BRAND.muted }}>
                  {mode === "signup"
                    ? "Use your email to get a secure sign-up link."
                    : "Use your email to get a secure login link."}
                </p>
              </div>

              <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: BRAND.muted }}>
                Email
                <input
                  className="mt-2 w-full rounded-2xl border bg-transparent px-4 py-3.5 text-base outline-none placeholder:text-white/35"
                  style={{ borderColor: BRAND.borderStrong, color: BRAND.text }}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                />
              </label>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl py-3.5 text-lg font-black transition disabled:opacity-60"
                style={{
                  backgroundImage: `linear-gradient(90deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)`,
                  color: "#05080c",
                  boxShadow: "0 0 24px rgba(56,229,215,0.2)",
                }}
              >
                {loading ? "Sending..." : `${modeLabel} with magic link`}
              </button>

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
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-black/20">
                <span className="material-symbols-outlined text-3xl" style={{ color: BRAND.cyan }}>
                  mark_email_unread
                </span>
              </div>

              <h2 className="text-2xl font-bold text-white">Check your email</h2>
              <p className="mt-2 text-sm" style={{ color: BRAND.muted }}>
                We sent your secure {waitingActionText} link to:
              </p>
              <div className="mx-auto mt-3 inline-flex rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5">
                <span className="text-sm font-semibold" style={{ color: BRAND.cyan }}>
                  {sentState.email}
                </span>
              </div>

              <div className="mt-7 flex items-center justify-center gap-2 text-xs" style={{ color: BRAND.muted }}>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: BRAND.cyan }} />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: BRAND.cyan, animationDelay: "120ms" }} />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: BRAND.cyan, animationDelay: "240ms" }} />
                <span>Waiting for confirmation...</span>
              </div>

              <div className="mt-6 space-y-3">
                <button
                  type="button"
                  disabled={resendIn > 0 || loading}
                  onClick={() => {
                    void resend();
                  }}
                  className="w-full rounded-xl border px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: BRAND.borderStrong, color: BRAND.text, backgroundColor: "rgba(0,0,0,0.2)" }}
                >
                  {resendIn > 0 ? `Resend link in ${resendIn}s` : loading ? "Resending..." : "Resend link"}
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
                <a className="block text-xs font-medium hover:underline" href="mailto:support@conxion.social" style={{ color: BRAND.muted }}>
                  Trouble accessing email?
                </a>
              </div>

              <div className="mt-8 border-t border-white/10 pt-5 text-[11px]" style={{ color: BRAND.muted }}>
                This link expires shortly for your safety.
              </div>
            </div>
          )}
        </div>

        <div className="mt-7 flex items-center justify-center gap-6 text-[11px] uppercase tracking-wider" style={{ color: BRAND.muted }}>
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
    <div className="min-h-screen flex items-center justify-center bg-[#060A10] text-white">
      <p className="text-sm text-white/70">Loading...</p>
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
