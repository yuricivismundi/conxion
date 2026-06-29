"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/landing";

type Props = {
  current: Locale;
  className?: string;
};

const LABELS: Record<Locale, string> = {
  en: "EN",
  es: "ES",
  fr: "FR",
  de: "DE",
  it: "IT",
  nl: "NL",
  pl: "PL",
};

const FULL_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  nl: "Nederlands",
  pl: "Polski",
};

export default function LanguageSwitcher({ current, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const switchTo = useCallback(
    (loc: Locale) => {
      setOpen(false);
      if (loc === current) return;
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("lang", loc);
      try { document.cookie = `cx_lang=${loc}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`; } catch {}
      router.replace(`${pathname}?${params.toString()}`);
    },
    [current, pathname, router, searchParams]
  );

  return (
    <div ref={ref} className={["relative", className ?? ""].join(" ")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/55 transition hover:text-white"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        {LABELS[current]}
        <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <ul
            role="listbox"
            className="absolute bottom-full left-0 z-50 mb-2 min-w-[140px] overflow-hidden rounded-xl border border-white/10 bg-[#111] shadow-xl"
          >
            {SUPPORTED_LOCALES.map((loc) => (
              <li key={loc}>
                <button
                  type="button"
                  role="option"
                  aria-selected={loc === current}
                  onClick={() => switchTo(loc)}
                  className={[
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs transition",
                    loc === current
                      ? "bg-white/10 font-bold text-white"
                      : "text-white/55 hover:bg-white/5 hover:text-white",
                  ].join(" ")}
                >
                  <span className="w-6 font-bold">{LABELS[loc]}</span>
                  <span className="text-white/40">{FULL_LABELS[loc]}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
