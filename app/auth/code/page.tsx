"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { buildAccountReactivatedMetadata, getAccountDeactivatedAt } from "@/lib/auth/account-status";
import { resolveClientPublicAppUrl } from "@/lib/public-app-url";
import { supabase } from "@/lib/supabase/client";

type AuthMode = "signup" | "login";

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

function maskEmail(email: string) {
  const normalized = normalizeEmail(email);
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return normalized;
  if (local.length <= 2) return `${local[0] ?? "*"}*@${domain}`;
  return `${local[0]}${"*".repeat(Math.max(local.length - 2, 1))}${local[local.length - 1]}@${domain}`;
}

function getPublicAppUrl() {
  return resolveClientPublicAppUrl("");
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
  const rawMessage = err instanceof Error ? err.message : "Request failed.";
  const waitSeconds = extractRateLimitSeconds(rawMessage);
  if (waitSeconds && waitSeconds > 0) {
    return {
      waitSeconds,
      message: `Email rate limit exceeded. Please wait ${waitSeconds}s and try again.`,
    };
  }
  return { waitSeconds: 0, message: rawMessage };
}

async function resendOtp(email: string, mode: AuthMode) {
  const appUrl = getPublicAppUrl();
  if (!appUrl) throw new Error("App URL is not configured.");
  const response = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: mode === "signup",
      emailRedirectTo: `${appUrl}/auth/callback`,
    },
  });
  if (response.error) throw new Error(response.error.message);
}

function AuthCodeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const email = useMemo(() => normalizeEmail(searchParams.get("email") ?? ""), [searchParams]);
  const mode = useMemo<AuthMode>(() => (searchParams.get("mode") === "signup" ? "signup" : "login"), [searchParams]);
  const masked = useMemo(() => maskEmail(email), [email]);

  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(30);
  const [rateLimitIn, setRateLimitIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timeout = window.setTimeout(() => setResendIn((prev) => Math.max(prev - 1, 0)), 1000);
    return () => window.clearTimeout(timeout);
  }, [resendIn]);

  useEffect(() => {
    if (rateLimitIn <= 0) return;
    const timeout = window.setTimeout(() => setRateLimitIn((prev) => Math.max(prev - 1, 0)), 1000);
    return () => window.clearTimeout(timeout);
  }, [rateLimitIn]);

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (!email) {
      setError("Email is missing. Go back and request a new code.");
      return;
    }

    const clean = token.replace(/\D/g, "");
    if (clean.length !== 8) {
      setError("Enter the 8-digit code from your email.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const verify = await supabase.auth.verifyOtp({
        email,
        token: clean,
        type: "email",
      });
      if (verify.error) throw new Error(verify.error.message);

      const sessionRes = await supabase.auth.getSession();
      const userId = sessionRes.data.session?.user?.id ?? null;
      if (!userId) throw new Error("Session could not be created. Request a new code.");

      const deactivatedAt = getAccountDeactivatedAt(sessionRes.data.session?.user?.user_metadata);
      if (deactivatedAt) {
        const reactivateRes = await supabase.auth.updateUser({
          data: buildAccountReactivatedMetadata(new Date().toISOString()),
        });
        if (reactivateRes.error) {
          console.warn("[auth-code] account reactivation metadata update failed", reactivateRes.error.message);
        }
      }

      const profileRes = await supabase.from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
      if (profileRes.error) throw new Error(profileRes.error.message);

      const ageConfirmed = Boolean(
        sessionRes.data.session?.user?.user_metadata?.age_confirmed_at ||
        sessionRes.data.session?.user?.user_metadata?.age_confirmed === true
      );
      const nextPath = profileRes.data ? "/connections" : ageConfirmed ? "/onboarding/profile" : "/onboarding/age";
      router.replace(`/auth/success?next=${encodeURIComponent(nextPath)}${profileRes.data ? "" : "&context=onboarding"}`);
    } catch (err: unknown) {
      const normalized = normalizeAuthError(err);
      if (normalized.waitSeconds > 0) setRateLimitIn(normalized.waitSeconds);
      setError(normalized.message.includes("expired") ? "Code is invalid or expired. Request a new code." : normalized.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!email || loading || resendIn > 0 || rateLimitIn > 0) return;
    setLoading(true);
    setError(null);
    try {
      await resendOtp(email, mode);
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
        <div className="relative group">
          <div
            className="pointer-events-none absolute -inset-1 rounded-[1.6rem] opacity-25 blur transition duration-700 group-hover:opacity-45"
            style={{ backgroundImage: `linear-gradient(135deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)` }}
          />
          <div className="relative rounded-[1.5rem] border p-5 sm:p-8 shadow-2xl" style={{ backgroundColor: "#121212", borderColor: BRAND.border }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/CONXION-3-tight.png" alt="ConXion" className="mx-auto h-14 w-auto select-none sm:h-16" />

            <div className="mt-4 text-center">
              <h1 className="text-3xl font-bold text-white">Enter your code</h1>
              <p className="mt-2 text-sm" style={{ color: BRAND.muted }}>
                Sent to <span style={{ color: BRAND.cyan }}>{masked}</span>
              </p>
            </div>

            {error ? (
              <div
                className="mt-5 rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "rgba(255,77,109,0.35)", backgroundColor: BRAND.dangerBg, color: BRAND.danger }}
              >
                {error}
              </div>
            ) : null}

            <form onSubmit={verifyCode} className="mt-5 space-y-4">
              <label className="block space-y-2 text-left" htmlFor="otp-code">
                <span className="ml-1 block text-xs font-bold uppercase tracking-wider" style={{ color: BRAND.muted }}>
                  8-digit code
                </span>
                <input
                  id="otp-code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  className="block w-full rounded-xl border border-white/10 bg-[#1E1E1E] px-4 py-3.5 text-center text-2xl font-semibold tracking-[0.3em] text-white outline-none transition placeholder:text-white/25 focus:border-transparent focus:ring-2"
                  style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)", ["--tw-ring-color" as string]: "rgba(56,229,215,0.45)" }}
                  value={token}
                  onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))}
                  placeholder="00000000"
                />
              </label>

              <button
                type="submit"
                disabled={loading || token.replace(/\D/g, "").length !== 8}
                className="group w-full rounded-xl px-6 py-3.5 text-lg font-black text-[#071018] shadow-[0_0_18px_rgba(56,229,215,0.22)] transition disabled:opacity-60"
                style={{ backgroundImage: `linear-gradient(90deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)` }}
              >
                {loading ? "Verifying..." : "Verify code"}
              </button>
            </form>

            <div className="mt-5 space-y-3">
              <button
                type="button"
                disabled={loading || resendIn > 0 || rateLimitIn > 0}
                onClick={() => {
                  void handleResend();
                }}
                className="w-full rounded-xl border px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                style={{ borderColor: BRAND.borderStrong, color: BRAND.text, backgroundColor: "rgba(0,0,0,0.2)" }}
              >
                {rateLimitIn > 0 ? `Wait ${rateLimitIn}s` : resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </button>

              <button
                type="button"
                onClick={() => router.replace("/auth")}
                className="w-full rounded-xl px-4 py-2 text-sm font-semibold transition"
                style={{ color: BRAND.cyan }}
              >
                Use a different email
              </button>
            </div>
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

function AuthCodeFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#060A10] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="w-full max-w-md">
        <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#121212] p-5 sm:p-8">
          <div className="mx-auto h-20 w-20 animate-pulse rounded-full bg-white/10 sm:h-24 sm:w-24" />
          <div className="mt-5 space-y-3 text-center">
            <div className="mx-auto h-8 w-52 animate-pulse rounded-full bg-white/10" />
            <div className="mx-auto h-4 w-40 animate-pulse rounded-full bg-white/10" />
          </div>
          <div className="mt-6 h-[58px] animate-pulse rounded-xl bg-white/10" />
          <div className="mt-4 h-14 animate-pulse rounded-xl bg-white/10" />
          <div className="mt-3 h-12 animate-pulse rounded-xl bg-white/5" />
        </div>
      </div>
    </div>
  );
}

export default function AuthCodePage() {
  return (
    <Suspense fallback={<AuthCodeFallback />}>
      <AuthCodeContent />
    </Suspense>
  );
}
