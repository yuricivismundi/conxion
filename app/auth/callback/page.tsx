"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildAccountReactivatedMetadata, getAccountDeactivatedAt } from "@/lib/auth/account-status";
import { supabase } from "@/lib/supabase/client";

const BRAND = {
  bg: "#060A10",
  surface: "rgba(14,18,27,0.88)",
  text: "#EAF0FF",
  muted: "rgba(234,240,255,0.58)",
  border: "rgba(255,255,255,0.12)",
  cyan: "#38E5D7",
  magenta: "#FF2BD6",
  danger: "#FF4D6D",
  dangerBg: "rgba(255,77,109,0.10)",
};

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Verifying secure link...");
  const [detail, setDetail] = useState<string | null>(null);
  const [progress, setProgress] = useState(20);
  const [redirectPath, setRedirectPath] = useState<string | null>(null);

  const hasError = useMemo(() => Boolean(detail), [detail]);

  useEffect(() => {
    if (hasError || redirectPath) return;
    if (progress >= 92) return;
    const timeout = window.setTimeout(() => {
      setProgress((value) => Math.min(value + 6, 92));
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [hasError, progress, redirectPath]);

  useEffect(() => {
    if (!redirectPath) return;
    const timeout = window.setTimeout(() => {
      router.replace(redirectPath);
    }, 420);
    return () => window.clearTimeout(timeout);
  }, [redirectPath, router]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- auth callback flow updates local UI state. */
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");
    const errorDesc = searchParams.get("error_description");
    const hash = typeof window !== "undefined" ? window.location.hash : "";

    if (errorParam) {
      setMessage("Sign-in failed.");
      setDetail(`${errorParam}${errorDesc ? `: ${errorDesc}` : ""}`);
      return;
    }

    (async () => {
      try {
        setMessage("Validating secure link...");
        setDetail(null);

        if (code) {
          const exchange = await supabase.auth.exchangeCodeForSession(code);
          if (exchange.error) {
            setMessage("Sign-in failed.");
            setDetail(exchange.error.message);
            return;
          }
        } else {
          const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");

          if (!accessToken || !refreshToken) {
            setMessage("Sign-in failed.");
            setDetail("Magic link token is missing or expired. Request a new link.");
            return;
          }

          const sessionResult = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionResult.error) {
            setMessage("Sign-in failed.");
            setDetail(sessionResult.error.message);
            return;
          }
        }

        setMessage("Loading your account...");
        setProgress(72);

        const sessionResult = await supabase.auth.getSession();
        if (sessionResult.error || !sessionResult.data.session) {
          setMessage("Sign-in failed.");
          setDetail(sessionResult.error?.message ?? "Session not found. Request a new link.");
          return;
        }

        const userId = sessionResult.data.session.user?.id;
        if (!userId) {
          setMessage("Sign-in failed.");
          setDetail("User ID missing from session.");
          return;
        }

        const deactivatedAt = getAccountDeactivatedAt(sessionResult.data.session.user?.user_metadata);
        if (deactivatedAt) {
          setMessage("Reactivating your account...");
          setProgress(78);
          const reactivateRes = await supabase.auth.updateUser({
            data: buildAccountReactivatedMetadata(new Date().toISOString()),
          });
          if (reactivateRes.error) {
            console.warn("[auth-callback] account reactivation metadata update failed", reactivateRes.error.message);
          }
        }

        setMessage("Preparing your workspace...");
        const profile = await supabase.from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
        if (profile.error) {
          setMessage("Signed in, but profile lookup failed.");
          setDetail(profile.error.message);
          return;
        }

        const ageConfirmed = Boolean(
          sessionResult.data.session.user?.user_metadata?.age_confirmed_at ||
            sessionResult.data.session.user?.user_metadata?.age_confirmed === true
        );
        const nextPath = profile.data ? "/connections" : ageConfirmed ? "/onboarding/profile" : "/onboarding/age";
        setMessage("You're in. Redirecting...");
        setProgress(100);
        setDetail(null);
        setRedirectPath(nextPath);
      } catch (err: unknown) {
        setMessage("Sign-in failed.");
        setDetail(err instanceof Error ? err.message : "Could not complete sign-in. Please try again.");
      }
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [searchParams]);

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

      <div className="relative z-10 w-full max-w-[460px] text-center">
        <div className="rounded-3xl border p-8" style={{ backgroundColor: BRAND.surface, borderColor: BRAND.border }}>
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-white/15 bg-black/25">
            <span className="material-symbols-outlined text-4xl" style={{ color: hasError ? BRAND.danger : BRAND.cyan }}>
              {hasError ? "error" : "check"}
            </span>
          </div>

          <h1 className="text-3xl font-black tracking-tight text-white">{hasError ? "Authentication error" : "You’re in"}</h1>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: hasError ? BRAND.danger : BRAND.muted }}>
            {hasError ? detail : message}
          </p>

          {!hasError ? (
            <div className="mt-8">
              <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider" style={{ color: BRAND.muted }}>
                <span>Securing session</span>
                <span className="font-bold text-white">{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progress}%`,
                    backgroundImage: `linear-gradient(90deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)`,
                  }}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => router.replace("/auth")}
              className="mt-7 w-full rounded-2xl py-3 text-base font-bold"
              style={{
                backgroundImage: `linear-gradient(90deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)`,
                color: "#05080c",
              }}
            >
              Back to auth
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AuthCallbackFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#060A10] text-white px-6">
      <p className="text-sm text-white/70">Finishing sign-in...</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthCallbackFallback />}>
      <AuthCallbackContent />
    </Suspense>
  );
}
