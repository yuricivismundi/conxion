"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";
import { VERIFICATION_COMPLETE_MESSAGE } from "@/lib/verification-client";
import {
  VERIFICATION_SUCCESS_MESSAGE,
  appendQueryParam,
  isPaymentVerified,
  sanitizeReturnTo,
} from "@/lib/verification";

type VerificationState = "checking" | "verified" | "pending" | "error";

function VerificationCompleteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<VerificationState>("checking");
  const [error, setError] = useState<string | null>(null);

  const returnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get("returnTo"), "/my-space"),
    [searchParams]
  );
  const sessionId = useMemo(() => searchParams.get("session_id")?.trim() || "", [searchParams]);

  const successDestination = useMemo(
    () => appendQueryParam(returnTo, "verification", "success"),
    [returnTo]
  );

  useEffect(() => {
    let active = true;

    function finishVerified() {
      if (typeof window !== "undefined" && window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(
            { type: VERIFICATION_COMPLETE_MESSAGE, returnTo: successDestination },
            window.location.origin
          );
          window.close();
          window.setTimeout(() => {
            if (active) router.replace(successDestination);
          }, 250);
          return;
        } catch {
          // Fall through to normal redirect.
        }
      }

      window.setTimeout(() => {
        if (active) router.replace(successDestination);
      }, 1200);
    }

    async function run() {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData.user;
        if (!user) {
          router.replace("/auth");
          return;
        }

        if (sessionId) {
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData.session?.access_token ?? "";
          if (accessToken) {
            const finalizeRes = await fetch("/api/verification/finalize", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ sessionId }),
            });
            const finalizeData = (await finalizeRes.json().catch(() => null)) as { ok?: boolean } | null;
            if (finalizeRes.ok && finalizeData?.ok) {
              setState("verified");
              finishVerified();
              return;
            }
          }
        }

        for (let attempt = 0; attempt < 15; attempt += 1) {
          if (!active) return;

          const profileRes = await supabase
            .from("profiles")
            .select("verified,verified_label")
            .eq("user_id", user.id)
            .maybeSingle();

          if (profileRes.error) {
            throw new Error(profileRes.error.message);
          }

          if (isPaymentVerified((profileRes.data ?? null) as Record<string, unknown> | null)) {
            setState("verified");
            finishVerified();
            return;
          }

          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }

        if (active) setState("pending");
      } catch (err: unknown) {
        if (!active) return;
        setState("error");
        setError(err instanceof Error ? err.message : "Could not finalize verification.");
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, [router, sessionId, successDestination]);

  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <Nav />
      <main className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center px-4 py-12">
        <section className="w-full rounded-[32px] border border-white/10 bg-[#0b1418]/90 p-8 text-center shadow-[0_28px_90px_rgba(0,0,0,0.4)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-200/80">Verified via payment</p>
          {state === "checking" ? (
            <>
              <h1 className="mt-3 text-3xl font-black text-white">Finalizing your verification</h1>
              <p className="mt-3 text-sm text-slate-300">
                We’re confirming your payment and unlocking hosting requests.
              </p>
            </>
          ) : null}
          {state === "verified" ? (
            <>
              <h1 className="mt-3 text-3xl font-black text-white">Verified</h1>
              <p className="mt-3 text-sm text-slate-300">{VERIFICATION_SUCCESS_MESSAGE}</p>
            </>
          ) : null}
          {state === "pending" ? (
            <>
              <h1 className="mt-3 text-3xl font-black text-white">Still finalizing</h1>
              <p className="mt-3 text-sm text-slate-300">
                Your verification is not unlocked yet. Stay on this page a moment longer or continue back and try again.
              </p>
            </>
          ) : null}
          {state === "error" ? (
            <>
              <h1 className="mt-3 text-3xl font-black text-white">Verification check failed</h1>
              <p className="mt-3 text-sm text-rose-200">{error ?? "Could not finalize verification."}</p>
            </>
          ) : null}

          <div className="mt-8 flex flex-col items-center gap-3">
            {state === "checking" ? (
              <div className="h-11 w-11 animate-spin rounded-full border-2 border-cyan-300/25 border-t-cyan-300" />
            ) : null}
            {state !== "checking" ? (
              <button
                type="button"
                onClick={() => router.replace(state === "verified" ? successDestination : returnTo)}
                className="rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-500 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-[#06121a]"
              >
                Continue
              </button>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}

function VerificationCompleteFallback() {
  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <Nav />
      <main className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center px-4 py-12">
        <section className="w-full rounded-[32px] border border-white/10 bg-[#0b1418]/90 p-8 text-center shadow-[0_28px_90px_rgba(0,0,0,0.4)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-200/80">Verified via payment</p>
          <h1 className="mt-3 text-3xl font-black text-white">Loading verification</h1>
          <p className="mt-3 text-sm text-slate-300">Preparing your verification result.</p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <div className="h-11 w-11 animate-spin rounded-full border-2 border-cyan-300/25 border-t-cyan-300" />
          </div>
        </section>
      </main>
    </div>
  );
}

export default function VerificationCompletePage() {
  return (
    <Suspense fallback={<VerificationCompleteFallback />}>
      <VerificationCompleteContent />
    </Suspense>
  );
}
