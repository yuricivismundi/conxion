"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type NavProps = { title?: string };

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function IconGlobe({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm7.93 9h-3.17a15.6 15.6 0 0 0-1.21-6.07A8.02 8.02 0 0 1 19.93 11ZM12 4c.98 0 2.47 2.4 3 7H9c.53-4.6 2.02-7 3-7ZM4.07 13h3.17c.24 2.21.7 4.26 1.21 6.07A8.02 8.02 0 0 1 4.07 13Zm3.17-2H4.07a8.02 8.02 0 0 1 4.38-6.07c-.51 1.81-.97 3.86-1.21 6.07ZM12 20c-.98 0-2.47-2.4-3-7h6c-.53 4.6-2.02 7-3 7Zm3.55-.93c.51-1.81.97-3.86 1.21-6.07h3.17a8.02 8.02 0 0 1-4.38 6.07ZM16.76 11c-.24-2.21-.7-4.26-1.21-6.07A8.02 8.02 0 0 1 19.93 11h-3.17Z" />
    </svg>
  );
}

function IconUsers({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M16 11a4 4 0 1 0-3.999-4A4 4 0 0 0 16 11Zm-8 0a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.33 0-6 1.34-6 4v1h12v-1c0-2.66-2.67-4-6-4Zm8 0c-.36 0-.71.03-1.05.08 1.77.79 3.05 2.16 3.05 3.92v1h6v-1c0-2.66-2.67-4-6-4Z" />
    </svg>
  );
}

function IconUser({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z" />
    </svg>
  );
}

export default function Nav({ title }: NavProps) {
  const pathname = usePathname();

  const tabs = [
    { href: "/discover", label: "Discover", icon: IconGlobe },
    // ✅ changed from /connections to /requests
    { href: "/requests", label: "Connections", icon: IconUsers },
    { href: "/me", label: "Me", icon: IconUser },
  ];

  async function signOut() {
    await supabase.auth.signOut();
    window.location.assign("/auth");
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3">
        {/* Optional brand/logo (put file in /public/logo.png) */}
        <Link href="/discover" className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-red-700 to-red-500 flex items-center justify-center text-white font-bold">
            ∞
          </div>
          {title ? <div className="text-lg font-semibold text-zinc-900">{title}</div> : null}
        </Link>

        <button onClick={signOut} className="text-sm font-medium text-red-700 hover:text-red-800 underline">
          Sign out
        </button>
      </div>

      {/* Tab bar */}
      <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-2 flex items-center gap-2">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname?.startsWith(t.href + "/");
          const Ico = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cx(
                "flex-1 rounded-xl px-3 py-2.5 flex items-center justify-center gap-2 text-sm font-medium transition",
                active
                  ? "bg-gradient-to-r from-red-700 to-red-600 text-white shadow-sm"
                  : "bg-white text-zinc-700 hover:bg-zinc-50"
              )}
            >
              <Ico className={cx("h-5 w-5", active ? "text-white" : "text-zinc-500")} />
              <span className="hidden sm:inline">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}