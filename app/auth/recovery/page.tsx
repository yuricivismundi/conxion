"use client";

import { useState } from "react";
import Link from "next/link";
import { resolveClientPublicAppUrl } from "@/lib/public-app-url";
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

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export default function AuthRecoveryPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submitRecovery(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const normalized = normalizeEmail(email);
      if (!normalized) throw new Error("Please enter your email.");

      const response = await supabase.auth.signInWithOtp({
        email: normalized,
        options: {
          emailRedirectTo: `${resolveClientPublicAppUrl("")}/auth/callback`,
        },
      });
      if (response.error) throw new Error(response.error.message);
      setSentTo(normalized);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send recovery link.");
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
            <img src="/branding/CONXION-3-tight.png" alt="ConXion" className="mx-auto h-20 w-auto select-none sm:h-24" />

            {error ? (
              <div
                className="mt-4 rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "rgba(255,77,109,0.35)", backgroundColor: BRAND.dangerBg, color: BRAND.danger }}
              >
                {error}
              </div>
            ) : null}

            {!sentTo ? (
              <form onSubmit={submitRecovery} className="mt-4 space-y-6">
                <div className="text-center">
                  <h1 className="text-3xl font-bold text-white">Recover access</h1>
                  <p className="mt-2 text-sm" style={{ color: BRAND.muted }}>
                    We’ll send you a secure link to regain access.
                  </p>
                </div>

                <label className="block space-y-2 text-left" htmlFor="recovery-email">
                  <span className="ml-1 block text-xs font-bold uppercase tracking-wider" style={{ color: BRAND.muted }}>
                    Email
                  </span>
                  <input
                    id="recovery-email"
                    className="block w-full rounded-xl border border-white/10 bg-[#1E1E1E] px-4 py-3.5 text-lg font-semibold text-white outline-none transition placeholder:text-white/30 focus:border-transparent focus:ring-2"
                    style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)", ["--tw-ring-color" as string]: "rgba(56,229,215,0.45)" }}
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                  />
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl px-6 py-3.5 text-lg font-black text-[#071018] shadow-[0_0_18px_rgba(56,229,215,0.22)] transition disabled:opacity-60"
                  style={{ backgroundImage: `linear-gradient(90deg, ${BRAND.cyan} 0%, ${BRAND.magenta} 100%)` }}
                >
                  {loading ? "Sending..." : "Send recovery link"}
                </button>
              </form>
            ) : (
              <div className="mt-4 text-center">
                <h1 className="text-3xl font-bold text-white">Check your email</h1>
                <p className="mt-2 text-sm" style={{ color: BRAND.muted }}>
                  We emailed a secure recovery link to:
                </p>
                <div className="mx-auto mt-4 inline-flex rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5">
                  <span className="text-sm font-semibold" style={{ color: BRAND.cyan }}>
                    {sentTo}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSentTo(null);
                    setError(null);
                  }}
                  className="mt-6 w-full rounded-xl px-4 py-2 text-sm font-semibold transition"
                  style={{ color: BRAND.cyan }}
                >
                  Use a different email
                </button>
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
