"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type NavProps = { title?: string };

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function Nav({ title }: NavProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id;
        if (!userId) {
          if (!cancelled) setIsAdmin(false);
          return;
        }

        const { data: admin, error: adminErr } = await supabase
          .from("admins")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();

        if (!cancelled) {
          setIsAdmin(Boolean(admin) && !adminErr);
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const tabs = [
    { href: "/connections", label: "Discover", icon: "groups" },
    { href: "/connections/requests", label: "Connections", icon: "handshake" },
    { href: "/messages", label: "Messages", icon: "chat" },
    { href: "/events", label: "Events", icon: "calendar_today" },
  ];

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore sign-out network errors and continue with local redirect.
    }
    window.location.assign("/auth");
  }

  const activeTab = (() => {
    if (pathname?.startsWith("/my-space")) return "/my-space";
    if (pathname?.startsWith("/messages")) return "/messages";
    if (pathname?.startsWith("/connections/requests")) return "/connections/requests";
    if (pathname?.startsWith("/connections")) return "/connections";
    if (pathname?.startsWith("/events")) return "/events";
    return "";
  })();

  return (
    <header className="sticky top-0 z-50 border-b border-[#2A2A2A] bg-[#0A0A0A]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-4">
        <div className="flex items-center gap-4 lg:gap-7">
          <Link href="/connections" className="flex items-center">
            <div className="relative h-12 w-16 overflow-hidden rounded-2xl bg-[#0A0A0A]">
              <Image src="/branding/conxion-nav-favicon-black-bg.png" alt="ConXion" fill className="object-cover" priority />
            </div>
          </Link>

          <nav className="hidden items-center gap-4 md:flex lg:gap-6">
            {tabs.map((tab) => {
              const active = activeTab === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cx(
                    "group relative flex items-center gap-2 rounded-full px-2 py-1.5 text-sm font-medium transition-colors",
                    active ? "text-white" : "text-gray-500 hover:text-white"
                  )}
                >
                  <span
                    className={cx(
                      "material-symbols-outlined text-[22px]",
                      active ? "text-[#22d3ee]" : "group-hover:text-[#22d3ee]"
                    )}
                  >
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                  {active ? (
                    <span className="absolute -bottom-[22px] left-0 right-0 h-[2px] bg-[#22d3ee] shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <Link
            href="/my-space"
            className={cx(
              "group relative flex items-center gap-2 rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors",
              activeTab === "/my-space" ? "text-white" : "text-gray-500 hover:text-white"
            )}
          >
            <span
              className={cx(
                "material-symbols-outlined text-[22px]",
                activeTab === "/my-space" ? "text-[#22d3ee]" : "group-hover:text-[#22d3ee]"
              )}
            >
              dashboard
            </span>
            <span className="hidden sm:inline">My Space</span>
            {activeTab === "/my-space" ? (
              <span className="absolute -bottom-[22px] left-0 right-0 h-[2px] bg-[#22d3ee] shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            ) : null}
          </Link>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="group flex items-center gap-2 rounded-full px-2.5 py-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-white"
            >
              <span className="material-symbols-outlined text-[22px] group-hover:text-[#22d3ee]">settings</span>
              <span className="hidden sm:inline">Settings</span>
              <span className="material-symbols-outlined text-lg">expand_more</span>
            </button>

            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-[46px] w-48 rounded-2xl border border-white/10 bg-[#121414] p-1 text-sm shadow-[0_20px_45px_rgba(0,0,0,0.35)]"
              >
                {isAdmin ? (
                  <Link
                    href="/admin/space"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
                  >
                    Admin Space
                  </Link>
                ) : null}
                <Link
                  href="/me/edit"
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
                >
                  Profile Settings
                </Link>
                <button
                  type="button"
                  onClick={signOut}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/70 hover:bg-white/5 hover:text-white"
                >
                  Log out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {title ? <div className="mx-auto w-full max-w-[1440px] px-6 pb-3 text-sm text-white/55">{title}</div> : null}
    </header>
  );
}
