"use client";

import Link from "next/link";
import Image from "next/image";

export default function OnboardingShell({
  step,
  title,
  subtitle,
  children,
  rightLinkLabel = "Already a member?",
  rightLinkHref = "/auth",
  rightLinkCta = "Sign in",
}: {
  step: 1 | 2 | 3;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  rightLinkLabel?: string;
  rightLinkHref?: string;
  rightLinkCta?: string;
}) {
  const pct = step === 1 ? 0.33 : step === 2 ? 0.66 : 1;

  return (
    <div className="min-h-screen bg-[#121212] text-[#E0E0E0]">
      {/* Top bar */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0A0A0A]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 h-19">
          {/* Logo (left-most, no extra padding) */}
          <Link href="/" className="select-none flex items-center">
            <Image
              src="/branding/conxion-logo.svg"
              alt="ConXion"
              width={160}
              height={40}
              priority
              className="h-25 w-auto block"
            />
          </Link>

          <div className="flex items-center gap-6 text-xs">
            {rightLinkLabel ? (
              <span className="hidden sm:inline text-[#808080]">{rightLinkLabel}</span>
            ) : null}
            {rightLinkCta ? (
              <Link
                href={rightLinkHref}
                className="font-bold text-[#E0E0E0] hover:text-[#00F5FF] transition-colors"
              >
                {rightLinkCta}
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-6 py-8">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-end justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-white/60">
              Step {step} of 3
            </span>
            <span className="text-xs font-medium text-white/40">
              {step === 1 ? "Core Profile" : step === 2 ? "Interests" : "Finalize"}
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct * 100}%`,
                backgroundImage: "linear-gradient(90deg, #00F5FF 0%, #FF00FF 100%)",
              }}
            />
          </div>
        </div>

        <div className="rounded-[32px] border border-white/5 bg-white/[0.04] p-6 sm:p-10 shadow-2xl">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-[#E0E0E0]">{title}</h1>
            {subtitle ? <p className="mt-2 text-white/50">{subtitle}</p> : null}
          </div>

          {children}
        </div>

        <footer className="mt-10 text-center text-[10px] uppercase tracking-[0.2em] text-white/30">
          © 2026 CONXION All rights reserved.
        </footer>
      </main>
    </div>
  );
}