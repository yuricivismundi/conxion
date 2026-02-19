"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const PRIMARY_LINKS = [
  { href: "/about", label: "About" },
  { href: "/safety", label: "Safety" },
  { href: "/support", label: "Support" },
  { href: "/blog", label: "Blog" },
  { href: "/shop", label: "Shop" },
  { href: "/cookie-settings", label: "Cookie Settings" },
];

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

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
  if (shouldHideFooter(pathname)) return null;

  return (
    <footer className="border-t border-white/10 bg-[#0A0A0A]">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold uppercase tracking-wide text-white/65">
            {PRIMARY_LINKS.map((item) => (
              <Link key={item.href} href={item.href} className="transition hover:text-white">
                {item.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-white/45" htmlFor="footer-language">
              Language
            </label>
            <select
              id="footer-language"
              defaultValue="en"
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white/80 outline-none transition hover:border-white/20"
            >
              <option value="en">English</option>
              <option value="es">Espanol</option>
              <option value="pt">Portugues</option>
              <option value="fr">Francais</option>
              <option value="de">Deutsch</option>
              <option value="it">Italiano</option>
            </select>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-white/45">© 2026 ConXion. All rights reserved.</p>

          <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
            {LEGAL_LINKS.map((item, idx) => (
              <div key={item.href} className="flex items-center gap-4">
                {idx > 0 ? <span className="text-white/25">·</span> : null}
                <Link href={item.href} className={cx("transition hover:text-white")}>
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
