"use client";

/**
 * /book-session?token=<uuid>
 *
 * Landing page for the guest booking magic-link flow.
 * Supabase magic link auth happens automatically (session is set by the
 * Supabase JS client via the URL hash). Once the user is authenticated,
 * we consume the guest_booking_intent token and redirect to the teacher
 * profile with the booking modal pre-opened.
 */
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { Suspense } from "react";

function BookSessionInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "consuming" | "done" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setErrorMsg("Invalid or missing booking token.");
      setStatus("error");
      return;
    }

    let cancelled = false;

    async function consumeIntent() {
      setStatus("loading");

      // Wait for Supabase to process the magic link (sets session from URL hash)
      const { data: sessionData } = await supabase.auth.getSession();
      let session = sessionData.session;

      if (!session) {
        // Give Supabase a moment to process the hash-based token
        await new Promise((r) => setTimeout(r, 1500));
        const retry = await supabase.auth.getSession();
        session = retry.data.session;
      }

      if (!session) {
        if (!cancelled) {
          setErrorMsg("We couldn't verify your email. The link may have expired. Please request a new booking.");
          setStatus("error");
        }
        return;
      }

      if (!cancelled) setStatus("consuming");

      // Consume the intent via API
      const res = await fetch("/api/teacher-bookings/guest/consume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ token }),
      });

      const result = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        teacherId?: string;
        teacherSlug?: string;
      } | null;

      if (!res.ok || !result?.ok) {
        if (!cancelled) {
          setErrorMsg(result?.error ?? "Could not complete your booking. The link may have expired.");
          setStatus("error");
        }
        return;
      }

      if (!cancelled) {
        setStatus("done");
        // Redirect to teacher profile with booking modal open
        const dest = result.teacherSlug
          ? `/profile/${result.teacherSlug}?book=1`
          : result.teacherId
          ? `/profile/${result.teacherId}?book=1`
          : "/messages";
        router.replace(dest);
      }
    }

    void consumeIntent();
    return () => { cancelled = true; };
  }, [token, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0A0A0A] px-4 text-white">
      <div className="w-full max-w-sm text-center">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#0df2f2] to-[#ff00ff] opacity-90" />
        </div>

        {(status === "loading" || status === "consuming") && (
          <>
            <div className="mx-auto mb-6 h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-[#0df2f2]" />
            <h1 className="text-xl font-bold text-white">
              {status === "loading" ? "Verifying your email…" : "Completing your booking…"}
            </h1>
            <p className="mt-2 text-sm text-white/40">This will only take a moment.</p>
          </>
        )}

        {status === "done" && (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#0df2f2]/10">
              <span className="material-symbols-outlined text-[28px] text-[#0df2f2]">check_circle</span>
            </div>
            <h1 className="text-xl font-bold text-white">Booking confirmed!</h1>
            <p className="mt-2 text-sm text-white/40">Redirecting you to complete the details…</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10">
              <span className="material-symbols-outlined text-[28px] text-rose-400">error</span>
            </div>
            <h1 className="text-xl font-bold text-white">Something went wrong</h1>
            <p className="mt-2 text-sm text-white/50">{errorMsg}</p>
            <a
              href="/connections?mode=teachers"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/8 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/12"
            >
              Browse teachers
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export default function BookSessionPage() {
  return (
    <Suspense>
      <BookSessionInner />
    </Suspense>
  );
}
