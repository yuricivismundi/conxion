"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  fetchNotifications,
  fetchNotificationsUnreadCount,
  formatNotificationRelativeTime,
  markAllNotificationsRead,
  markNotificationRead,
  notificationCategory,
  notificationCategoryLabel,
  notificationIcon,
  type NotificationRow,
} from "@/lib/notifications/client";
import { cx } from "@/lib/cx";

type TimeGroup = "new" | "earlier";

function bucketForItem(item: NotificationRow): TimeGroup {
  if (!item.is_read) return "new";
  const created = new Date(item.created_at).getTime();
  const now = Date.now();
  const diffH = (now - created) / 3_600_000;
  return diffH < 24 ? "new" : "earlier";
}

const GROUP_LABELS: Record<TimeGroup, string> = {
  new: "New",
  earlier: "Earlier",
};

export default function NotificationsBell() {
  const [userId, setUserId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const refreshRequestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestIdRef.current;
    setLoading(true);
    setError(null);
    const [listRes, countRes] = await Promise.all([fetchNotifications({ limit: 10 }), fetchNotificationsUnreadCount()]);

    if (refreshRequestIdRef.current !== requestId) {
      return;
    }

    if (listRes.error) {
      setError(listRes.error);
      setItems([]);
    } else {
      setItems(listRes.data);
    }

    if (!countRes.error) {
      setUnreadCount(countRes.count);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const { data: authData } = await supabase.auth.getUser();
      if (cancelled) return;
      const nextUserId = authData.user?.id ?? null;
      setUserId(nextUserId);
      if (nextUserId) {
        await refresh();
        if (cancelled) return;
      }
      setReady(true);
    }

    async function handleAuthChange(nextUserId: string | null) {
      if (cancelled) return;
      setUserId(nextUserId);
      if (!nextUserId) {
        setItems([]);
        setUnreadCount(0);
        setError(null);
        setOpen(false);
        setReady(true);
        return;
      }
      setReady(false);
      await refresh();
      if (cancelled) return;
      setReady(true);
    }

    void bootstrap();

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user?.id ?? null;
      void handleAuthChange(nextUserId);
    });

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-bell-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void refresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  useEffect(() => {
    if (!open) return;

    const onPointer = (event: PointerEvent) => {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(event.target as Node)) setOpen(false);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visibleItems = useMemo(() => items.slice(0, 8), [items]);

  const groupedItems = useMemo(() => {
    const groups: Record<TimeGroup, NotificationRow[]> = { new: [], earlier: [] };
    visibleItems.forEach((item) => {
      groups[bucketForItem(item)].push(item);
    });
    return groups;
  }, [visibleItems]);

  if (!ready) {
    return (
      <div className="relative">
        <button
          type="button"
          disabled
          className="group relative flex min-h-10 min-w-10 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-gray-500"
          aria-label="Notifications"
        >
          <span className="material-symbols-outlined text-[22px]">notifications</span>
        </button>
      </div>
    );
  }

  if (!userId) return null;

  async function handleMarkAllRead() {
    const res = await markAllNotificationsRead();
    if (res.error) {
      setError(res.error);
      return;
    }
    await refresh();
  }

  async function openNotification(item: NotificationRow) {
    if (!item.is_read) {
      const res = await markNotificationRead(item.id);
      if (res.error) {
        setError(res.error);
      } else {
        await refresh();
      }
    }

    setOpen(false);
    if (item.link_url) {
      window.location.assign(item.link_url);
      return;
    }
    window.location.assign("/notifications");
  }

  const orderedGroups: TimeGroup[] = ["new", "earlier"];

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="group relative flex min-h-10 min-w-10 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-white"
        aria-label="Open notifications"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="material-symbols-outlined text-[22px] group-hover:text-[#22d3ee]">notifications</span>
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-black text-slate-900 shadow-[0_0_10px_rgba(34,211,238,0.4)]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-[52px] z-[70] w-[400px] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl border border-white/10 bg-[#101216] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <div>
              <h3 className="text-[18px] font-black tracking-tight text-white">Notifications</h3>
              {unreadCount > 0 ? (
                <p className="mt-0.5 text-[11px] text-slate-500">
                  <span className="font-semibold text-cyan-300">{unreadCount} unread</span>
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  title="Mark all as read"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
                >
                  <span className="material-symbols-outlined text-[18px]">done_all</span>
                </button>
              ) : null}
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                title="View all"
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">open_in_full</span>
              </Link>
            </div>
          </div>

          {/* Scroll content */}
          <div className="max-h-[460px] overflow-y-auto scrollbar-subtle pb-1">
            {error ? <p className="px-4 py-3 text-xs text-rose-300">{error}</p> : null}

            {loading ? (
              <ul className="space-y-1 px-2 py-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <li key={index} className="flex items-start gap-3 rounded-xl px-2 py-2.5">
                    <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                    <div className="flex-1 space-y-1.5 py-1">
                      <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                      <div className="h-2.5 w-1/2 animate-pulse rounded bg-white/[0.04]" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {!loading && visibleItems.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.04]">
                  <span className="material-symbols-outlined text-[22px] text-slate-500">notifications_none</span>
                </div>
                <p className="text-[13px] font-semibold text-white">You're all caught up</p>
                <p className="mt-1 text-[11px] text-slate-500">New activity will appear here.</p>
              </div>
            ) : null}

            {!loading && visibleItems.length > 0 ? (
              <div className="space-y-2 pt-1">
                {orderedGroups.map((group) => {
                  const groupItems = groupedItems[group];
                  if (groupItems.length === 0) return null;
                  return (
                    <section key={group}>
                      <h4 className="px-4 pb-1 pt-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                        {GROUP_LABELS[group]}
                      </h4>
                      <ul>
                        {groupItems.map((item) => {
                          const category = notificationCategory(item.kind);
                          const { icon, colorClass, bgClass } = notificationIcon(item.kind);
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                onClick={() => void openNotification(item)}
                                className={cx(
                                  "group/item w-full px-3 py-2.5 text-left transition",
                                  item.is_read
                                    ? "hover:bg-white/[0.04]"
                                    : "bg-cyan-400/[0.05] hover:bg-cyan-400/[0.08]"
                                )}
                              >
                                <div className="flex gap-3">
                                  <div className={cx(
                                    "relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition group-hover/item:scale-[1.03]",
                                    bgClass,
                                  )}>
                                    <span className={cx("material-symbols-outlined text-[19px]", colorClass)}>{icon}</span>
                                    {!item.is_read ? (
                                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#101216] bg-cyan-400" />
                                    ) : null}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className={cx(
                                      "text-[13px] leading-snug",
                                      item.is_read ? "font-medium text-slate-300" : "font-bold text-white"
                                    )}>
                                      {item.title}
                                    </p>
                                    {item.body ? (
                                      <p className={cx(
                                        "mt-0.5 line-clamp-2 text-[12px] leading-snug",
                                        item.is_read ? "text-slate-500" : "text-slate-300"
                                      )}>
                                        {item.body}
                                      </p>
                                    ) : null}
                                    <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                                      <span className={cx("font-semibold", item.is_read ? "text-slate-600" : "text-cyan-300")}>
                                        {formatNotificationRelativeTime(item.created_at)}
                                      </span>
                                      <span className="text-slate-700">·</span>
                                      <span className="text-slate-500">{notificationCategoryLabel(category)}</span>
                                    </div>
                                  </div>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* Footer - See all */}
          {!loading && visibleItems.length > 0 ? (
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 border-t border-white/8 bg-white/[0.02] px-4 py-2.5 text-[12px] font-semibold text-cyan-300 transition hover:bg-cyan-400/[0.05]"
            >
              See all notifications
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
