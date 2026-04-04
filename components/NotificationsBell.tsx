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
          <span className="absolute right-0.5 top-0.5 text-[11px] font-black text-[#0df2f2] [text-shadow:0_0_8px_rgba(13,242,242,0.7)]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-[52px] z-[70] w-[360px] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl border border-white/10 bg-[#101216] shadow-[0_24px_50px_rgba(0,0,0,0.45)]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h3 className="text-sm font-bold text-white">Notifications</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={unreadCount === 0}
                className={cx(
                  "rounded-lg px-2 py-1 text-xs font-semibold",
                  unreadCount === 0
                    ? "cursor-not-allowed text-slate-600"
                    : "text-cyan-200 hover:bg-cyan-300/10 hover:text-cyan-100"
                )}
              >
                Mark all read
              </button>
              <Link href="/notifications" className="rounded-lg px-2 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-300/10">
                View all
              </Link>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto scrollbar-subtle">
            {error ? <p className="px-4 py-3 text-xs text-rose-300">{error}</p> : null}

            {loading ? <p className="px-4 py-8 text-sm text-slate-400">Loading notifications…</p> : null}

            {!loading && visibleItems.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-slate-300">No notifications yet.</p>
                <p className="mt-1 text-xs text-slate-500">New requests and updates will appear here.</p>
              </div>
            ) : null}

            {!loading
              ? visibleItems.map((item) => {
                  const category = notificationCategory(item.kind);
                  const { icon, colorClass, bgClass } = notificationIcon(item.kind);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void openNotification(item)}
                      className={cx(
                        "w-full border-b border-white/5 px-4 py-3 text-left transition",
                        item.is_read ? "bg-transparent hover:bg-white/[0.03]" : "bg-cyan-400/[0.06] hover:bg-cyan-400/[0.10]"
                      )}
                    >
                      <div className="flex gap-3">
                        <div className={cx("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border", bgClass)}>
                          <span className={cx("material-symbols-outlined text-[16px]", colorClass)}>{icon}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-start justify-between gap-2">
                            <p className={cx("text-sm font-semibold leading-snug", item.is_read ? "text-slate-200" : "text-white")}>{item.title}</p>
                            <span className="shrink-0 text-[11px] text-slate-500">{formatNotificationRelativeTime(item.created_at)}</span>
                          </div>
                          {item.body ? <p className="line-clamp-2 text-xs text-slate-400">{item.body}</p> : null}
                          <div className="mt-1.5 flex items-center justify-between">
                            <span className="rounded-full border border-white/12 bg-white/[0.02] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                              {notificationCategoryLabel(category)}
                            </span>
                            {!item.is_read ? <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.85)]" /> : null}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
