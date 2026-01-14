"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoSrc, setLogoSrc] = useState("/branding/conxion-logo.svg");
  const [logoFailed, setLogoFailed] = useState(false);
  const [shortLogoSrc, setShortLogoSrc] = useState("/branding/conxion-short-logo.png");
  const [shortLogoFailed, setShortLogoFailed] = useState(false);

  // ConXion brand tokens (kept inline for MVP speed)
  const brand = useMemo(
    () => ({
      bg: "#0B0D10",
      surface: "#12161D",
      text: "#EAF0FF",
      muted: "rgba(234,240,255,0.55)",
      border: "rgba(255,255,255,0.10)",
      borderStrong: "rgba(255,255,255,0.16)",
      cyan: "#38E5D7",
      magenta: "#FF2BD6",
      danger: "#FF4D6D",
      dangerBg: "rgba(255,77,109,0.10)",
    }),
    []
  );

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const emailClean = email.trim();
    if (!emailClean) {
      setLoading(false);
      setError("Please enter your email.");
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: emailClean,
      options: {
        // ✅ IMPORTANT: land on onboarding step 1 (profile)
        emailRedirectTo: `${window.location.origin}/onboarding/profile`,
      },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSent(true);
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-2 p-6"
      style={{ backgroundColor: brand.bg, color: brand.text }}
    >
      {/* Top Logo */}
      
      <div
        className="relative w-full max-w-md rounded-[28px] px-6 pt-5 pb-6 border"
        style={{
          backgroundColor: brand.surface,
          borderColor: brand.border,
          boxShadow: `0 0 40px rgba(56,229,215,0.06)`,
        }}
      >
        <div className="flex items-center justify-center">
        {!logoFailed ? (
          <img
            src={logoSrc}
            alt="ConXion"
            className="h-24 sm:h-28 md:h-42 w-auto select-none"
            onError={() => {
              if (logoSrc.endsWith(".svg")) {
                setLogoSrc("/branding/conxion-logo.png");
                return;
              }
              setLogoFailed(true);
            }}
          />
        ) : (
          <div
            className="text-3xl sm:text-4xl md:text-5xl font-black italic tracking-tight"
            style={{
              backgroundImage: `linear-gradient(90deg, ${brand.cyan} 0%, ${brand.magenta} 100%)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            CONXION
          </div>
        )}
      </div>
        

        {!sent ? (
          <form onSubmit={sendMagicLink} className="mt-3 space-y-2">
            <label className="block text-xs font-semibold tracking-wider uppercase" style={{ color: brand.muted }}>
              Email
              <input
                className="mt-1 w-full rounded-2xl px-4 py-3 outline-none border bg-transparent"
                style={{
                  borderColor: brand.borderStrong,
                  color: brand.text,
                }}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = brand.cyan;
                  (e.currentTarget.style as any).boxShadow = `0 0 0 4px rgba(56,229,215,0.12)`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = brand.borderStrong;
                  (e.currentTarget.style as any).boxShadow = "none";
                }}
              />
            </label>

            <div className="mt-2 flex items-center gap-2">
              <input
                id="remember"
                type="checkbox"
                defaultChecked
                className="h-4 w-4 rounded border"
                style={{ accentColor: brand.cyan }}
              />
              <label htmlFor="remember" className="text-[11px]" style={{ color: brand.muted }}>
                Remember this device
              </label>
            </div>

            {error && (
              <div
                className="rounded-2xl border p-3 text-sm"
                style={{
                  borderColor: "rgba(255,77,109,0.35)",
                  backgroundColor: brand.dangerBg,
                  color: brand.danger,
                }}
              >
                {error}
              </div>
            )}

            <button
              disabled={loading}
              className="w-full rounded-2xl py-3.5 font-black transition disabled:opacity-60"
              style={{
                backgroundImage: `linear-gradient(90deg, ${brand.cyan} 0%, ${brand.magenta} 100%)`,
                color: brand.bg,
                boxShadow: `0 0 22px rgba(56,229,215,0.18)`,
              }}
              type="submit"
            >
              {loading ? "Sending…" : "Send magic link"}
            </button>

            <p className="text-[11px] leading-relaxed" style={{ color: brand.muted }}>
              We’ll email you a secure sign-in link. Open it on this device to continue.
              <br />
              <span className="font-semibold" style={{ color: brand.muted }}>
                You’ll stay signed in on this device.
              </span>
            </p>
          </form>
        ) : (
          <div
            className="mt-6 rounded-2xl border p-4"
            style={{
              borderColor: brand.borderStrong,
              backgroundColor: "rgba(0,0,0,0.20)",
            }}
          >
            <p className="font-semibold" style={{ color: brand.text }}>
              Check your email
            </p>
            <p className="text-sm mt-1" style={{ color: brand.muted }}>
              We sent you a login link. Open it on this device to continue onboarding.
              <br />
              <span className="font-semibold" style={{ color: brand.muted }}>
                We’ll remember this device.
              </span>
            </p>

            <button
              type="button"
              onClick={() => {
                setSent(false);
                setError(null);
              }}
              className="mt-4 text-sm font-semibold"
              style={{
                color: brand.cyan,
              }}
            >
              Use a different email
            </button>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between">
          <span className="text-[10px] tracking-widest uppercase" style={{ color: "rgba(234,240,255,0.35)" }}>
            © {new Date().getFullYear()} ConXion
          </span>
          {!shortLogoFailed ? (
            <img
              src={shortLogoSrc}
              alt="ConXion"
              className="h-12 w-auto opacity-90"
              onError={() => {
                if (shortLogoSrc.endsWith(".svg")) {
                  setShortLogoSrc("/branding/conxion-short-logo.png");
                  return;
                }
                setShortLogoFailed(true);
              }}
            />
          ) : (
            <span
              className="text-[12px] font-black italic"
              style={{
                backgroundImage: `linear-gradient(90deg, ${brand.cyan} 0%, ${brand.magenta} 100%)`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              X
            </span>
          )}
        </div>
      </div>
    </div>
  );
}