"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppLanguage, type AppLanguage } from "@/components/AppLanguageProvider";
import { cx } from "@/lib/cx";


function shouldHideFooter(pathname: string) {
  if (!pathname) return false;
  if (pathname === "/") return true;
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return true;
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) return true;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  if (pathname === "/messages" || pathname.startsWith("/messages/")) return true;
  return false;
}

export default function AppFooter() {
  const pathname = usePathname() ?? "";
  const { language, setLanguage, t, options } = useAppLanguage();
  if (shouldHideFooter(pathname)) return null;

  const primaryLinks = [
    { href: "/about", label: t("footer.about") },
    { href: "/safety-center", label: t("footer.safetyCenter") },
    { href: "/support", label: t("footer.support") },
    { href: "/cookie-settings", label: t("footer.cookieSettings") },
  ];

  const legalLinks = [
    { href: "/terms", label: t("footer.terms") },
    { href: "/privacy", label: t("footer.privacy") },
  ];

  return (
    <footer className="border-t border-white/10 bg-[#0A0A0A]">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-4">
            <Link href="/connections" className="flex items-center">
              <div className="relative h-10 w-[154px] overflow-hidden">
                <Image src="/branding/CONXION-3-tight.png" alt="ConXion" fill className="object-contain object-left" />
              </div>
            </Link>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold uppercase tracking-wide text-white/65">
              {primaryLinks.map((item) => (
                <Link key={item.href} href={item.href} className="inline-flex min-h-10 items-center transition hover:text-white">
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-white/45" htmlFor="footer-language">
              {t("footer.language")}
            </label>
            <select
              id="footer-language"
              value={language}
              onChange={(event) => setLanguage(event.target.value as AppLanguage)}
              className="h-11 min-h-[44px] rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none transition hover:border-white/20"
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-white/45">{t("footer.rights")}</p>

          <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
            {legalLinks.map((item, idx) => (
              <div key={item.href} className="flex items-center gap-4">
                {idx > 0 ? <span className="text-white/25">·</span> : null}
                <Link href={item.href} className={cx("inline-flex min-h-10 items-center transition hover:text-white")}>
                  {item.label}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
