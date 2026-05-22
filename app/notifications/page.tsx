"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Nav from "@/components/Nav";
import PullToRefreshIndicator from "@/components/PullToRefreshIndicator";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { supabase } from "@/lib/supabase/client";
import {
  fetchNotifications,
  formatNotificationRelativeTime,
  markAllNotificationsRead,
  markNotificationRead,
  notificationCategory,
  notificationCategoryLabel,
  notificationIcon,
  type NotificationRow,
} from "@/lib/notifications/client";
import { cx } from "@/lib/cx";

type FilterKey = "all" | "unread" | "requests" | "trips" | "hosting" | "references" | "events" | "general";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "requests", label: "Requests" },
  { key: "trips", label: "Trips" },
  { key: "hosting", label: "Hosting" },
  { key: "events", label: "Events" },
  { key: "references", label: "References" },
  { key: "general", label: "General" },
];

type TimeGroup = "new" | "today" | "yesterday" | "thisWeek" | "earlier";

function bucketForDate(iso: string): TimeGroup {
  const created = new Date(iso).getTime();
  const now = Date.now();
  const diffH = (now - created) / 3_600_000;
  if (diffH < 4) return "new";
  if (diffH < 24) return "today";
  if (diffH < 48) return "yesterday";
  if (diffH < 24 * 7) return "thisWeek";
  return "earlier";
}

const GROUP_LABELS: Record<TimeGroup, string> = {
  new: "New",
  today: "Earlier today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  earlier: "Earlier",
};

export default function NotificationsPage() {
  const router = useRouter();
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchNotifications({ limit: 200 });
    if (res.error) {
      setError(res.error);
      setNotifications([]);
    } else {
      setNotifications(res.data);
    }
    setLoading(false);
  }, []);

  const { pullY, refreshing: ptr } = usePullToRefresh(refresh);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const { data: authData } = await supabase.auth.getUser();
      if (cancelled) return;
      const userId = authData.user?.id ?? null;
      if (!userId) {
        router.replace("/auth?next=/notifications");
        return;
      }
      setMeId(userId);
      await refresh();
    }

    void bootstrap();

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user?.id ?? null;
      if (!userId) {
        router.replace("/auth?next=/notifications");
        return;
      }
      setMeId(userId);
      void refresh();
    });

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
    };
  }, [refresh, router]);

  useEffect(() => {
    if (!meId) return;

    const channel = supabase
      .channel(`notifications-page-${meId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${meId}`,
        },
        () => {
          void refresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [meId, refresh]);

  // Close 3-dot menu when clicking outside
  useEffect(() => {
    if (!openMenuId) return;
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuId]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.is_read).length, [notifications]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return notifications.filter((item) => {
      if (filter === "unread" && item.is_read) return false;
      if (filter !== "all" && filter !== "unread") {
        const category = notificationCategory(item.kind);
        if (category !== filter) return false;
      }

      if (!needle) return true;
      const haystack = `${item.title} ${item.body ?? ""} ${item.kind}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [filter, notifications, query]);

  const groupedItems = useMemo(() => {
    const groups: Record<TimeGroup, NotificationRow[]> = {
      new: [],
      today: [],
      yesterday: [],
      thisWeek: [],
      earlier: [],
    };
    visibleItems.forEach((item) => {
      // Unread items always go to "new" group for emphasis
      const bucket = !item.is_read ? "new" : bucketForDate(item.created_at);
      groups[bucket].push(item);
    });
    return groups;
  }, [visibleItems]);

  async function handleMarkAllRead() {
    setBusy(true);
    const res = await markAllNotificationsRead();
    if (res.error) setError(res.error);
    await refresh();
    setBusy(false);
  }

  async function handleMarkRead(id: string) {
    setBusy(true);
    const res = await markNotificationRead(id);
    if (res.error) setError(res.error);
    await refresh();
    setBusy(false);
  }

  async function handleOpen(item: NotificationRow) {
    if (!item.is_read) {
      await handleMarkRead(item.id);
    }
    if (item.link_url) {
      window.location.assign(item.link_url);
    }
  }

  const orderedGroups: TimeGroup[] = ["new", "today", "yesterday", "thisWeek", "earlier"];

  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <PullToRefreshIndicator pullY={pullY} refreshing={ptr} />
      <Nav />
      <main className="mx-auto w-full max-w-[820px] px-4 pb-28 pt-7 sm:pb-16 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[28px] font-black tracking-tight text-white">Notifications</h1>
            <p className="mt-0.5 text-[13px] text-slate-500">
              {unreadCount > 0 ? (
                <>
                  <span className="font-semibold text-cyan-300">{unreadCount} unread</span>
                  <span className="text-slate-600"> · </span>
                  <span>{notifications.length} total</span>
                </>
              ) : (
                <span>{notifications.length} notifications</span>
              )}
            </p>
          </div>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              disabled={busy}
              className={cx(
                "inline-flex items-center gap-1.5 self-start rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition sm:self-auto",
                busy
                  ? "cursor-not-allowed bg-white/5 text-slate-600"
                  : "bg-white/[0.06] text-slate-200 hover:bg-white/10 hover:text-white"
              )}
            >
              <span className="material-symbols-outlined text-[15px]">done_all</span>
              Mark all as read
            </button>
          ) : null}
        </header>

        <div className="mb-5 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-hide">
          {FILTERS.map((chip) => {
            const active = filter === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setFilter(chip.key)}
                className={cx(
                  "shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition",
                  active
                    ? "bg-white text-slate-900 shadow-[0_4px_12px_rgba(255,255,255,0.1)]"
                    : "bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200"
                )}
              >
                {chip.label}
                {chip.key === "unread" && unreadCount > 0 ? (
                  <span className={cx("ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold", active ? "bg-slate-900 text-white" : "bg-cyan-400/90 text-slate-900")}>
                    {unreadCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="relative mb-6">
          <span className="material-symbols-outlined pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] text-slate-500">search</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notifications"
            className="w-full rounded-full border border-white/8 bg-white/[0.03] py-2.5 pl-10 pr-4 text-[13px] text-white placeholder:text-slate-500 transition focus:border-white/20 focus:bg-white/[0.06] focus:outline-none"
          />
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        {loading ? (
          <ul className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <li key={index} className="flex items-start gap-3 rounded-2xl bg-white/[0.02] p-3.5">
                <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
                </div>
              </li>
            ))}
          </ul>
        ) : visibleItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/8 px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.04]">
              <span className="material-symbols-outlined text-[26px] text-slate-500">notifications_none</span>
            </div>
            <p className="text-[15px] font-semibold text-white">You're all caught up</p>
            <p className="mt-1 text-[13px] text-slate-500">
              {filter === "unread" ? "No unread notifications." : "New activity will appear here."}
            </p>
            <Link
              href="/discover"
              className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-4 py-2 text-[12px] font-semibold text-slate-200 transition hover:bg-white/[0.1] hover:text-white"
            >
              Explore
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {orderedGroups.map((group) => {
              const items = groupedItems[group];
              if (items.length === 0) return null;
              return (
                <section key={group}>
                  <h2 className="mb-2 px-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                    {GROUP_LABELS[group]}
                  </h2>
                  <ul className="space-y-1">
                    {items.map((item) => {
                      const category = notificationCategory(item.kind);
                      const { icon, colorClass, bgClass } = notificationIcon(item.kind);
                      const isMenuOpen = openMenuId === item.id;
                      return (
                        <li key={item.id} className="relative">
                          <button
                            type="button"
                            onClick={() => void handleOpen(item)}
                            className={cx(
                              "group flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-all",
                              item.is_read
                                ? "hover:bg-white/[0.04]"
                                : "bg-cyan-400/[0.05] hover:bg-cyan-400/[0.08]"
                            )}
                          >
                            <div className={cx(
                              "relative mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition group-hover:scale-[1.03]",
                              bgClass,
                            )}>
                              <span className={cx("material-symbols-outlined text-[22px]", colorClass)}>{icon}</span>
                              {!item.is_read ? (
                                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#06070b] bg-cyan-400" />
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1 pr-8">
                              <p className={cx(
                                "text-[14px] leading-snug",
                                item.is_read ? "font-medium text-slate-300" : "font-bold text-white"
                              )}>
                                {item.title}
                              </p>
                              {item.body ? (
                                <p className={cx(
                                  "mt-0.5 line-clamp-2 text-[13px] leading-snug",
                                  item.is_read ? "text-slate-500" : "text-slate-300"
                                )}>
                                  {item.body}
                                </p>
                              ) : null}
                              <div className="mt-1 flex items-center gap-2 text-[11px]">
                                <span className={cx("font-semibold", item.is_read ? "text-slate-600" : "text-cyan-300")}>
                                  {formatNotificationRelativeTime(item.created_at)}
                                </span>
                                <span className="text-slate-700">·</span>
                                <span className="text-slate-500">{notificationCategoryLabel(category)}</span>
                              </div>
                            </div>
                          </button>
                          {/* 3-dot menu (top-right of card) */}
                          <div className="absolute right-2 top-3">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(isMenuOpen ? null : item.id);
                              }}
                              aria-label="More options"
                              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/[0.08] hover:text-white"
                            >
                              <span className="material-symbols-outlined text-[18px]">more_horiz</span>
                            </button>
                            {isMenuOpen ? (
                              <div
                                ref={menuRef}
                                role="menu"
                                className="absolute right-0 top-9 z-20 w-48 overflow-hidden rounded-xl border border-white/10 bg-[#15171c] py-1 shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
                              >
                                {!item.is_read ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenMenuId(null);
                                      void handleMarkRead(item.id);
                                    }}
                                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-slate-200 hover:bg-white/5"
                                  >
                                    <span className="material-symbols-outlined text-[16px] text-slate-400">check_circle</span>
                                    Mark as read
                                  </button>
                                ) : null}
                                {item.link_url ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenMenuId(null);
                                      void handleOpen(item);
                                    }}
                                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-slate-200 hover:bg-white/5"
                                  >
                                    <span className="material-symbols-outlined text-[16px] text-slate-400">open_in_new</span>
                                    Open
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
