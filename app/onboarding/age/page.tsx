"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { readOnboardingDraft, writeOnboardingDraft } from "@/lib/onboardingDraft";

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

export default function OnboardingAgePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const authRes = await supabase.auth.getUser();
      const user = authRes.data.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      const draft = readOnboardingDraft();
      const draftConfirmed = draft.ageConfirmed === true;
      const metaConfirmed = Boolean(user.user_metadata?.age_confirmed_at || user.user_metadata?.age_confirmed === true);
      if (!cancelled && (draftConfirmed || metaConfirmed)) {
        router.replace("/onboarding/profile");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function confirmAge() {
    setLoading(true);
    setError(null);

    try {
      const authRes = await supabase.auth.getUser();
      const user = authRes.data.user;
      if (!user) {
        router.replace("/auth");
        return;
      }

      const confirmedAt = new Date().toISOString();
      writeOnboardingDraft({ ageConfirmed: true, ageConfirmedAt: confirmedAt });

      // Persist to auth user metadata; if this fails, continue with local draft so onboarding is not blocked.
      const updateRes = await supabase.auth.updateUser({
        data: { age_confirmed: true, age_confirmed_at: confirmedAt },
      });
      if (updateRes.error) {
        // Non-blocking: keep moving; local draft already marks confirmation.
        console.warn("[onboarding-age] metadata update failed", updateRes.error.message);
      }

      router.replace("/onboarding/profile");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not confirm age.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-10 sm:px-6 sm:py-12 flex items-center justify-center" style={{ backgroundColor: BRAND.bg, color: BRAND.text }}>
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

          <div className="relative rounded-[1.5rem] border p-7 sm:p-8 shadow-2xl text-center" style={{ backgroundColor: "#121212", borderColor: BRAND.border }}>
            {!logoFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/branding/CONXION-3-tight.png"
                alt="ConXion"
                className="mx-auto h-20 w-auto select-none sm:h-24"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <h1
                className="mx-auto text-4xl font-black italic tracking-tight"
                style={{
                  backgroundImage: `linear-gradient(120deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)`,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                CONXION
              </h1>
            )}

            <h2 className="mt-4 text-3xl font-bold text-white">Age confirmation</h2>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: BRAND.muted }}>
              You must be 18 years or older to use ConXion.
            </p>

            {error ? (
              <div
                className="mt-4 rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "rgba(255,77,109,0.35)", backgroundColor: BRAND.dangerBg, color: BRAND.danger }}
              >
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => {
                void confirmAge();
              }}
              disabled={loading}
              className="mt-8 w-full rounded-xl px-6 py-3.5 text-lg font-black text-[#071018] shadow-[0_0_18px_rgba(56,229,215,0.22)] transition disabled:opacity-60"
              style={{ backgroundImage: `linear-gradient(90deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)` }}
            >
              {loading ? "Confirming..." : "I am 18 or older"}
            </button>

            <Link href="/auth" className="mt-4 block text-sm font-semibold hover:underline" style={{ color: BRAND.muted }}>
              Back to website
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
