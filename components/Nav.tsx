"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAppLanguage } from "@/components/AppLanguageProvider";
import NotificationsBell from "@/components/NotificationsBell";
import { fetchUnreadThreadTokens } from "@/lib/messages/unread";
import { cx } from "@/lib/cx";

type NavProps = { title?: string };


const LOCAL_MANUAL_UNREAD_STORAGE_KEY = "cx_messages_manual_unread_v1";

function readManualUnreadThreadTokensFromStorage(): Set<string> {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(LOCAL_MANUAL_UNREAD_STORAGE_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return new Set<string>();
    const tokens = new Set<string>();
    Object.entries(parsed).forEach(([token, value]) => {
      if (value === true && token.trim().length > 0) tokens.add(token);
    });
    return tokens;
  } catch {
    return new Set<string>();
  }
}

export default function Nav({ title }: NavProps) {
  const pathname = usePathname();
  const { t } = useAppLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [unreadMessageThreads, setUnreadMessageThreads] = useState(0);
  const [unreadMessagesLoading, setUnreadMessagesLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refreshAuthState = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user?.id ?? null;
        if (!cancelled) {
          setCurrentUserId(userId);
          setIsAuthenticated(Boolean(userId));
          setAuthResolved(true);
          setUnreadMessagesLoading(Boolean(userId));
          if (!userId) setUnreadMessageThreads(0);
        }

        if (!userId) {
          if (!cancelled) setIsAdmin(false);
          return;
        }

        // Stamp last_seen_at on every page load (fire-and-forget)
        void supabase
          .from("profiles")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("user_id", userId);

        const { data: admin, error: adminErr } = await supabase
          .from("admins")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();

        if (!cancelled) {
          setIsAdmin(Boolean(admin) && !adminErr);
        }
      } catch {
        if (!cancelled) {
          setCurrentUserId(null);
          setIsAuthenticated(false);
          setIsAdmin(false);
          setAuthResolved(true);
        }
      }
    };

    void refreshAuthState();

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user?.id ?? null;
      setCurrentUserId(userId);
      setIsAuthenticated(Boolean(userId));
      setAuthResolved(true);
      setUnreadMessagesLoading(Boolean(userId));
      if (!userId) {
        setIsAdmin(false);
        setUnreadMessageThreads(0);
        return;
      }
      void refreshAuthState();
    });

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refreshUnreadMessages = async () => {
      if (!isAuthenticated || !currentUserId) {
        if (!cancelled) {
          setUnreadMessageThreads(0);
          setUnreadMessagesLoading(false);
        }
        return;
      }

      const unreadRes = await fetchUnreadThreadTokens(currentUserId);
      if (cancelled) return;
      if (!unreadRes.error) {
        const manualTokens = readManualUnreadThreadTokensFromStorage();
        const merged = new Set<string>([...unreadRes.tokens, ...manualTokens]);
        setUnreadMessageThreads(merged.size);
      }
      setUnreadMessagesLoading(false);
    };

    void refreshUnreadMessages();
    if (isAuthenticated) {
      timer = setInterval(() => {
        void refreshUnreadMessages();
      }, 10_000);
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== LOCAL_MANUAL_UNREAD_STORAGE_KEY) return;
      void refreshUnreadMessages();
    };
    const onManualUnreadChanged = () => {
      void refreshUnreadMessages();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("cx:manual-unread-changed", onManualUnreadChanged as EventListener);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("cx:manual-unread-changed", onManualUnreadChanged as EventListener);
    };
  }, [currentUserId, isAuthenticated, pathname]);

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
    { href: "/connections", label: t("nav.discover"), icon: "explore" },
    { href: "/messages", label: t("nav.messages"), icon: "chat" },
    { href: "/events", label: t("nav.events"), icon: "calendar_today" },
    { href: "/network", label: t("nav.network"), icon: "hub" },
    { href: "/activity", label: t("nav.trips"), icon: "travel_explore" },
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
    if (pathname?.startsWith("/discover")) return "/discover";
    if (pathname?.startsWith("/network")) return "/network";
    if (pathname?.startsWith("/connections/requests")) return "/network";
    if (pathname?.startsWith("/references")) return "/network";
    if (pathname?.startsWith("/connections")) return "/discover";
    if (pathname?.startsWith("/messages")) return "/messages";
    if (pathname?.startsWith("/events")) return "/events";
    if (pathname?.startsWith("/activity")) return "/activity";
    if (pathname?.startsWith("/trips")) return "/activity";
    if (pathname?.startsWith("/dashboard")) return "/account";
    if (pathname?.startsWith("/my-space")) return "/account";
    if (pathname?.startsWith("/dance-space")) return "/account";
    if (pathname?.startsWith("/me/edit")) return "/account";
    if (pathname?.startsWith("/control-center")) return "/account";
    if (pathname?.startsWith("/account-settings") || pathname?.startsWith("/settings")) return "/account";
    if (pathname?.startsWith("/profile/")) {
      return currentUserId && pathname.startsWith(`/profile/${currentUserId}`) ? "/account" : "";
    }
    return "";
  })();
  const accountHref = currentUserId ? `/profile/${currentUserId}` : "/account-settings";
  const myProfileActive = activeTab === "/account";
  const isPublicContext = authResolved ? !isAuthenticated : false;

  return (
    <header className="sticky top-0 z-50 border-b border-[#2A2A2A] bg-[#0A0A0A]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-4">
        <div className="flex items-center gap-4 lg:gap-7">
          <Link href={isPublicContext ? "/" : "/connections"} className="flex items-center">
            <div className="relative h-11 w-[132px] overflow-hidden sm:h-12 sm:w-[150px]">
              <Image src="/branding/CONXION-3-tight.png" alt="ConXion" fill className="object-contain object-left" priority />
            </div>
          </Link>

          {!isPublicContext ? (
            <nav className="hidden items-center gap-3 md:flex lg:gap-5">
              {tabs.map((tab) => {
                const active = activeTab === tab.href;
                const showMessagesLoading = tab.href === "/messages" && unreadMessagesLoading;
                const showMessagesBadge = tab.href === "/messages" && !unreadMessagesLoading && unreadMessageThreads > 0;
                const showMessagesDot = tab.href === "/messages" && !unreadMessagesLoading && unreadMessageThreads > 0;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={cx(
                      "group relative flex min-h-10 items-center gap-2 rounded-full px-2.5 py-2 text-sm font-medium transition-colors",
                      active ? "text-white" : "text-gray-500 hover:text-white"
                    )}
                  >
                    <span className="relative inline-flex">
                      <span
                        className={cx(
                          "material-symbols-outlined text-[22px]",
                          active ? "text-[#22d3ee]" : "group-hover:text-[#22d3ee]"
                        )}
                      >
                        {tab.icon}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      {tab.label}
                      {showMessagesDot ? (
                        <span className="h-2.5 w-2.5 rounded-full border border-[#0A0A0A] bg-[#db2777] shadow-[0_0_10px_rgba(219,39,119,0.75)]" />
                      ) : null}
                      {showMessagesLoading ? <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white/[0.16]" /> : null}
                    </span>
                    {showMessagesBadge ? (
                      <span className="rounded-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] px-1.5 py-[1px] text-[10px] font-black text-black shadow-[0_0_12px_rgba(0,245,255,0.42)]">
                        {unreadMessageThreads > 99 ? "99+" : unreadMessageThreads}
                      </span>
                    ) : null}
                    {showMessagesLoading ? <span className="h-4 w-7 animate-pulse rounded-full bg-white/[0.08]" /> : null}
                    {active ? (
                      <span className="absolute -bottom-[22px] left-0 right-0 h-[2px] bg-[#22d3ee] shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          ) : null}
        </div>

        {!authResolved ? (
          <div className="flex items-center gap-2">
            <div className="h-9 w-20 rounded-full border border-white/10 bg-white/[0.03] animate-pulse" />
            <div className="h-9 w-20 rounded-full border border-white/10 bg-white/[0.03] animate-pulse" />
          </div>
        ) : isPublicContext ? (
          <div className="flex items-center gap-2">
            <Link
              href="/auth"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:border-white/30 hover:text-white"
            >
              {t("nav.login")}
            </Link>
            <Link
              href="/auth"
              className="inline-flex min-h-10 items-center justify-center rounded-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] px-4 py-2 text-sm font-bold text-black shadow-[0_0_18px_rgba(0,245,255,0.22)] transition hover:opacity-90"
            >
              {t("nav.join")}
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link
              href={accountHref}
              className={cx(
                "group relative flex min-h-10 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors",
                myProfileActive ? "text-white" : "text-gray-500 hover:text-white"
              )}
            >
              <span
                className={cx(
                  "material-symbols-outlined text-[22px]",
                  myProfileActive ? "text-[#22d3ee]" : "group-hover:text-[#22d3ee]"
                )}
              >
                person
              </span>
              <span className="hidden sm:inline whitespace-nowrap">{t("nav.mySpace")}</span>
              {myProfileActive ? (
                <span className="absolute -bottom-[22px] left-0 right-0 h-[2px] bg-[#22d3ee] shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
              ) : null}
            </Link>
            <NotificationsBell />
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="group flex min-h-10 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-white"
              >
                <span className="material-symbols-outlined text-[22px] group-hover:text-[#22d3ee]">settings</span>
                <span className="hidden sm:inline">{t("nav.settings")}</span>
                <span className="material-symbols-outlined text-lg">expand_more</span>
              </button>

              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-[52px] w-48 rounded-2xl border border-white/10 bg-[#121414] p-1 text-sm shadow-[0_20px_45px_rgba(0,0,0,0.35)]"
                >
                  <Link
                    href="/me/edit"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
                  >
                    {t("nav.profileSettings")}
                  </Link>
                  <Link
                    href="/account-settings"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
                  >
                    {t("nav.accountSettings")}
                  </Link>
                  <Link
                    href="/pricing"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
                  >
                    Upgrade your plan
                  </Link>
                  <Link
                    href="/notifications"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
                  >
                    {t("nav.notifications")}
                  </Link>
                  {isAdmin ? (
                    <Link
                      href="/admin/space"
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
                    >
                      {t("nav.adminConsole")}
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={signOut}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/70 hover:bg-white/5 hover:text-white"
                  >
                    {t("nav.logout")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
      {title ? <div className="mx-auto w-full max-w-[1440px] px-4 pb-3 text-sm text-white/55 sm:px-6">{title}</div> : null}
      {!isPublicContext ? (
        <div className="md:hidden">
          <nav className="fixed inset-x-0 bottom-0 z-[60] border-t border-white/10 bg-[#0A0A0A]/96 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 backdrop-blur-md">
            <div className="mx-auto grid max-w-[520px] grid-cols-6 gap-1">
              {[...tabs, { href: accountHref, activeKey: "/account", label: t("nav.mySpace"), icon: "person" }].map((tab) => {
                const active = activeTab === ("activeKey" in tab ? tab.activeKey : tab.href);
                const showMessagesLoading = tab.href === "/messages" && unreadMessagesLoading;
                const showMessagesBadge = tab.href === "/messages" && !unreadMessagesLoading && unreadMessageThreads > 0;
                return (
                  <Link
                    key={`mobile-${tab.href}`}
                    href={tab.href}
                    className={cx(
                      "relative flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-medium transition-colors",
                      active ? "bg-cyan-300/10 text-white" : "text-gray-400 hover:text-white"
                    )}
                  >
                    <span className={cx("material-symbols-outlined text-[21px]", active ? "text-[#22d3ee]" : "")}>{tab.icon}</span>
                    <span className="max-w-full truncate text-[10px] leading-none">{tab.label}</span>
                    {showMessagesBadge ? (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] px-1.5 py-[1px] text-[9px] font-black text-black">
                        {unreadMessageThreads > 99 ? "99+" : unreadMessageThreads}
                      </span>
                    ) : null}
                    {showMessagesLoading ? <span className="absolute right-1.5 top-1.5 h-4 w-6 animate-pulse rounded-full bg-white/[0.08]" /> : null}
                    {active ? <span className="absolute inset-x-3 top-0 h-[2px] rounded-full bg-[#22d3ee]" /> : null}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
