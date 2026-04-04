"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
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

export default function NotificationsPage() {
  const router = useRouter();
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

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

  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <Nav />
      <main className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
        <header className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-black text-white">Notifications</h1>
            <p className="mt-1 text-sm text-slate-400">Requests, travel updates, references, and account activity in one feed.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
              Unread: {unreadCount}
            </span>
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              disabled={busy || unreadCount === 0}
              className={cx(
                "rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
                busy || unreadCount === 0
                  ? "cursor-not-allowed border-white/10 bg-white/5 text-slate-600"
                  : "border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
              )}
            >
              Mark all read
            </button>
          </div>
        </header>

        <section className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {FILTERS.map((chip) => {
              const active = filter === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setFilter(chip.key)}
                  className={cx(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                    active
                      ? "border-cyan-300/45 bg-cyan-300/14 text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.2)]"
                      : "border-white/12 bg-black/20 text-slate-300 hover:border-white/30 hover:text-white"
                  )}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notifications..."
            className="w-full rounded-xl border border-white/12 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/40 focus:outline-none"
          />
        </section>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        <section className="rounded-2xl border border-white/10 bg-white/[0.03]">
          {loading ? (
            <div className="space-y-3 px-4 py-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <div className="h-5 w-20 animate-pulse rounded-full bg-white/10" />
                        <div className="h-3 w-12 animate-pulse rounded bg-white/10" />
                      </div>
                      <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
                      <div className="mt-2 h-4 w-64 animate-pulse rounded bg-white/10" />
                    </div>
                    <div className="h-8 w-24 animate-pulse rounded-lg bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-base font-semibold text-slate-200">No notifications for this filter.</p>
              <p className="mt-1 text-sm text-slate-500">New activity will appear here.</p>
              <Link
                href="/discover"
                className="mt-4 inline-flex rounded-full border border-white/15 bg-black/25 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-cyan-300/35 hover:text-cyan-100"
              >
                Explore
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-white/8">
              {visibleItems.map((item) => {
                const category = notificationCategory(item.kind);
                const { icon, colorClass, bgClass } = notificationIcon(item.kind);
                return (
                  <li key={item.id} className={cx("px-4 py-4", item.is_read ? "bg-transparent" : "bg-cyan-400/[0.04]")}>
                    <div className="flex gap-3">
                      <div className={cx("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border", bgClass)}>
                        <span className={cx("material-symbols-outlined text-[18px]", colorClass)}>{icon}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="mb-1 flex items-center gap-2">
                              <span className="rounded-full border border-white/12 bg-black/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                                {notificationCategoryLabel(category)}
                              </span>
                              <span className="text-[11px] text-slate-500">{formatNotificationRelativeTime(item.created_at)}</span>
                              {!item.is_read ? <span className="h-2 w-2 rounded-full bg-cyan-300" /> : null}
                            </div>
                            <p className="text-sm font-semibold text-white">{item.title}</p>
                            {item.body ? <p className="mt-1 text-sm text-slate-400">{item.body}</p> : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                            {item.link_url ? (
                              <button
                                type="button"
                                onClick={() => void handleOpen(item)}
                                className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                              >
                                Open
                              </button>
                            ) : null}
                            {!item.is_read ? (
                              <button
                                type="button"
                                onClick={() => void handleMarkRead(item.id)}
                                className="rounded-lg border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-white/30"
                              >
                                Mark read
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
