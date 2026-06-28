"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
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

export default function LanguageSwitcher({ current, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const switchTo = useCallback(
    (loc: Locale) => {
      if (loc === current) return;
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("lang", loc);
      try { document.cookie = `cx_lang=${loc}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`; } catch {}
      router.replace(`${pathname}?${params.toString()}`);
    },
    [current, pathname, router, searchParams]
  );

  return (
    <div
      className={[
        "inline-flex items-center gap-0.5 rounded-full border border-white/15 bg-white/[0.04] p-0.5",
        className ?? "",
      ].join(" ")}
      role="group"
      aria-label="Language"
    >
      {SUPPORTED_LOCALES.map((loc) => {
        const active = loc === current;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => switchTo(loc)}
            className={[
              "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors",
              active ? "bg-white/15 text-white" : "text-white/55 hover:text-white",
            ].join(" ")}
            aria-pressed={active}
          >
            {LABELS[loc]}
          </button>
        );
      })}
    </div>
  );
}
