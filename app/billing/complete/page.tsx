"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import { getBillingAccountState } from "@/lib/billing/account-state";
import { supabase } from "@/lib/supabase/client";
import { appendQueryParam, sanitizeReturnTo } from "@/lib/verification";

type BillingCompleteState = "checking" | "active" | "pending" | "error";

function BillingCompleteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<BillingCompleteState>("checking");
  const [error, setError] = useState<string | null>(null);

  const returnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get("returnTo"), "/pricing"),
    [searchParams]
  );
  const sessionId = useMemo(() => searchParams.get("session_id")?.trim() || "", [searchParams]);
  const successDestination = useMemo(
    () => appendQueryParam(appendQueryParam(returnTo, "checkout", "success"), "plan", "pro"),
    [returnTo]
  );

  useEffect(() => {
    let active = true;

    function finishActive() {
      window.setTimeout(() => {
        if (active) router.replace(successDestination);
      }, 1200);
    }

    async function isPlusActive() {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (!user) return false;
      return getBillingAccountState({
        userMetadata: user.user_metadata,
        isVerified: false,
      }).currentPlanId === "pro";
    }

    async function run() {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user) {
          router.replace("/auth");
          return;
        }

        for (let attempt = 0; attempt < 15; attempt += 1) {
          if (!active) return;

          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData.session?.access_token ?? "";

          if (sessionId && accessToken) {
            const finalizeRes = await fetch("/api/billing/finalize", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ sessionId }),
            });
            const finalizeData = (await finalizeRes.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

            if (!active) return;

            if (finalizeRes.ok && finalizeData?.ok) {
              await supabase.auth.refreshSession();
              if (await isPlusActive()) {
                setState("active");
                finishActive();
                return;
              }
            } else if (finalizeRes.status !== 409) {
              throw new Error(finalizeData?.error ?? "Could not finalize Plus upgrade.");
            }
          }

          await supabase.auth.refreshSession();
          if (await isPlusActive()) {
            setState("active");
            finishActive();
            return;
          }

          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }

        if (active) setState("pending");
      } catch (completionError: unknown) {
        if (!active) return;
        setState("error");
        setError(completionError instanceof Error ? completionError.message : "Could not confirm your Plus upgrade.");
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
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-200/80">Plus membership</p>
          {state === "checking" ? (
            <>
              <h1 className="mt-3 text-3xl font-black text-white">Activating Plus</h1>
              <p className="mt-3 text-sm text-slate-300">
                We&apos;re confirming your checkout and updating your account limits.
              </p>
            </>
          ) : null}
          {state === "active" ? (
            <>
              <h1 className="mt-3 text-3xl font-black text-white">Plus is active</h1>
              <p className="mt-3 text-sm text-slate-300">
                Your account has been upgraded and your new limits are ready.
              </p>
            </>
          ) : null}
          {state === "pending" ? (
            <>
              <h1 className="mt-3 text-3xl font-black text-white">Still finalizing</h1>
              <p className="mt-3 text-sm text-slate-300">
                Your upgrade is still syncing. Stay on this page a moment longer or continue back and refresh again.
              </p>
            </>
          ) : null}
          {state === "error" ? (
            <>
              <h1 className="mt-3 text-3xl font-black text-white">Plus check failed</h1>
              <p className="mt-3 text-sm text-rose-200">{error ?? "Could not confirm your Plus upgrade."}</p>
            </>
          ) : null}

          <div className="mt-8 flex flex-col items-center gap-3">
            {state === "checking" ? (
              <div className="h-11 w-11 animate-spin rounded-full border-2 border-cyan-300/25 border-t-cyan-300" />
            ) : null}
            {state !== "checking" ? (
              <button
                type="button"
                onClick={() => router.replace(state === "active" ? successDestination : returnTo)}
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

function BillingCompleteFallback() {
  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <Nav />
      <main className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center px-4 py-12">
        <section className="w-full rounded-[32px] border border-white/10 bg-[#0b1418]/90 p-8 text-center shadow-[0_28px_90px_rgba(0,0,0,0.4)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-200/80">Plus membership</p>
          <h1 className="mt-3 text-3xl font-black text-white">Loading upgrade</h1>
          <p className="mt-3 text-sm text-slate-300">Preparing your Plus result.</p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <div className="h-11 w-11 animate-spin rounded-full border-2 border-cyan-300/25 border-t-cyan-300" />
          </div>
        </section>
      </main>
    </div>
  );
}

export default function BillingCompletePage() {
  return (
    <Suspense fallback={<BillingCompleteFallback />}>
      <BillingCompleteContent />
    </Suspense>
  );
}
