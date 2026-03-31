"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const BRAND = {
  bg: "#060A10",
  surface: "rgba(14,18,27,0.88)",
  text: "#EAF0FF",
  muted: "rgba(234,240,255,0.58)",
  border: "rgba(255,255,255,0.12)",
  cyan: "#38E5D7",
  magenta: "#FF2BD6",
};

function safeNextPath(value: string | null) {
  if (!value) return "/connections";
  if (!value.startsWith("/")) return "/connections";
  if (value.startsWith("//")) return "/connections";
  return value;
}

function AuthSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(25);

  const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);
  const context = useMemo(() => searchParams.get("context"), [searchParams]);

  useEffect(() => {
    const progressTimer = window.setInterval(() => {
      setProgress((value) => Math.min(100, value + 9));
    }, 140);
    const redirectTimer = window.setTimeout(() => {
      router.replace(nextPath);
    }, 1450);

    return () => {
      window.clearInterval(progressTimer);
      window.clearTimeout(redirectTimer);
    };
  }, [nextPath, router]);

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
            <span className="material-symbols-outlined text-4xl" style={{ color: BRAND.cyan }}>
              check
            </span>
          </div>

          <h1 className="text-3xl font-black tracking-tight text-white">You’re in</h1>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: BRAND.muted }}>
            {context === "onboarding" ? "Finalizing your profile and loading Discover..." : "Preparing your workspace..."}
          </p>

          <div className="mt-8">
            <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider" style={{ color: BRAND.muted }}>
              <span>Syncing workspace</span>
              <span className="font-bold text-white">{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${progress}%`,
                  backgroundImage: `linear-gradient(90deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthSuccessFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#060A10] text-white px-6">
      <p className="text-sm text-white/70">Preparing your workspace...</p>
    </div>
  );
}

export default function AuthSuccessPage() {
  return (
    <Suspense fallback={<AuthSuccessFallback />}>
      <AuthSuccessContent />
    </Suspense>
  );
}
