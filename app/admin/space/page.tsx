"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import { type EventRecord, mapEventRows } from "@/lib/events/model";
import { supabase } from "@/lib/supabase/client";

type TabKey = "overview" | "reports" | "logs" | "members" | "events";
type ReportStatusFilter = "all" | "open" | "resolved" | "dismissed";
type ModerateAction = "resolve" | "dismiss" | "reopen";
type EventModerateAction = "approve_cover" | "reject_cover" | "hide" | "unhide" | "cancel" | "publish";
type EventFilter = "all" | "pending_cover" | "hidden" | "cancelled" | "reported";
type EventModerationDialogState = {
  open: boolean;
  eventId: string;
  action: EventModerateAction;
};

type LiteProfile = {
  userId: string;
  displayName: string;
  city: string;
  country: string;
  avatarUrl: string | null;
};

type ReportItem = {
  id: string;
  reporterId: string;
  targetUserId: string;
  context: string;
  contextId: string | null;
  reason: string;
  note: string | null;
  status: string;
  createdAt: string;
};

type ModerationLogItem = {
  id: string;
  reportId: string | null;
  actorId: string;
  targetUserId: string | null;
  action: string;
  note: string | null;
  createdAt: string;
};

type EventModerationItem = {
  event: EventRecord;
  hostProfile: LiteProfile | null;
  openReports: number;
  totalReports: number;
};

type AdminStats = {
  totalMembers: number | null;
  verifiedMembers: number | null;
  openReports: number | null;
  moderationActions: number | null;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function pickString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function pickNullableString(row: Record<string, unknown>, keys: string[]) {
  const value = pickString(row, keys);
  return value || null;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value: string | null | undefined) {
  const d = parseDate(value);
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

function formatRelative(value: string | null | undefined) {
  const d = parseDate(value);
  if (!d) return "-";

  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function mapReportRows(rows: unknown[]) {
  return rows
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const id = pickString(row, ["id"]);
      const reporterId = pickString(row, ["reporter_id", "created_by"]);
      const targetUserId = pickString(row, ["target_user_id", "reported_user_id"]);
      const createdAt = pickString(row, ["created_at", "inserted_at"]);
      if (!id || !reporterId || !targetUserId || !createdAt) return null;

      return {
        id,
        reporterId,
        targetUserId,
        context: pickString(row, ["context"]) || "connection",
        contextId: pickNullableString(row, ["context_id"]),
        reason: pickString(row, ["reason"]) || "No reason",
        note: pickNullableString(row, ["note"]),
        status: pickString(row, ["status"]) || "open",
        createdAt,
      } satisfies ReportItem;
    })
    .filter((item): item is ReportItem => Boolean(item))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function mapModerationLogRows(rows: unknown[]) {
  return rows
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const id = pickString(row, ["id"]);
      const actorId = pickString(row, ["actor_id", "admin_id", "created_by"]);
      const action = pickString(row, ["action"]);
      const createdAt = pickString(row, ["created_at", "inserted_at"]);
      if (!id || !actorId || !action || !createdAt) return null;

      return {
        id,
        reportId: pickNullableString(row, ["report_id"]),
        actorId,
        targetUserId: pickNullableString(row, ["target_user_id"]),
        action,
        note: pickNullableString(row, ["note"]),
        createdAt,
      } satisfies ModerationLogItem;
    })
    .filter((item): item is ModerationLogItem => Boolean(item))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function countProfiles(whereVerified: boolean | null) {
  let query = supabase.from("profiles").select("user_id", { count: "exact", head: true });
  if (whereVerified !== null) {
    query = query.eq("verified", whereVerified);
  }
  const { count, error } = await query;
  if (error) return null;
  return count ?? 0;
}

async function countReports(status: string | null) {
  let query = supabase.from("reports").select("id", { count: "exact", head: true });
  if (status) {
    query = query.eq("status", status);
  }
  const { count, error } = await query;
  if (error) return null;
  return count ?? 0;
}

async function countModerationLogs() {
  const { count, error } = await supabase.from("moderation_logs").select("id", { count: "exact", head: true });
  if (error) return null;
  return count ?? 0;
}

export default function AdminSpacePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myProfile, setMyProfile] = useState<LiteProfile | null>(null);

  const [stats, setStats] = useState<AdminStats>({
    totalMembers: null,
    verifiedMembers: null,
    openReports: null,
    moderationActions: null,
  });

  const [reports, setReports] = useState<ReportItem[]>([]);
  const [logs, setLogs] = useState<ModerationLogItem[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, LiteProfile>>({});
  const [adminTeam, setAdminTeam] = useState<string[]>([]);

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [reportFilter, setReportFilter] = useState<ReportStatusFilter>("all");
  const [eventFilter, setEventFilter] = useState<EventFilter>("pending_cover");

  const [actionBusyReportId, setActionBusyReportId] = useState<string | null>(null);
  const [eventActionBusyId, setEventActionBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [eventModerationDialog, setEventModerationDialog] = useState<EventModerationDialogState>({
    open: false,
    eventId: "",
    action: "hide",
  });
  const [eventModerationNote, setEventModerationNote] = useState("");
  const [eventModerationHideReason, setEventModerationHideReason] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setActionError(null);

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData.user) {
        router.replace("/auth");
        return;
      }

      const userId = authData.user.id;
      if (cancelled) return;
      setMeId(userId);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!cancelled) {
        setAccessToken(sessionData.session?.access_token ?? null);
      }

      const adminRes = await supabase.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
      if (adminRes.error || !adminRes.data) {
        if (!cancelled) {
          setIsAdmin(false);
          setLoading(false);
        }
        return;
      }

      const myProfileRes = await supabase
        .from("profiles")
        .select("user_id,display_name,city,country,avatar_url")
        .eq("user_id", userId)
        .maybeSingle();

      const myProfileRow = (myProfileRes.data ?? null) as Record<string, unknown> | null;
      const normalizedMe: LiteProfile | null = myProfileRow
        ? {
            userId: pickString(myProfileRow, ["user_id"]),
            displayName: pickString(myProfileRow, ["display_name", "name"]) || "Admin",
            city: pickString(myProfileRow, ["city"]),
            country: pickString(myProfileRow, ["country"]),
            avatarUrl: pickNullableString(myProfileRow, ["avatar_url"]),
          }
        : null;

      const [totalMembers, verifiedMembers, openReports, moderationActions, reportsRes, logsRes, adminsRes, eventsRes] =
        await Promise.all([
          countProfiles(null),
          countProfiles(true),
          countReports("open"),
          countModerationLogs(),
          supabase.from("reports").select("*").order("created_at", { ascending: false }).limit(200),
          supabase.from("moderation_logs").select("*").order("created_at", { ascending: false }).limit(200),
          supabase.from("admins").select("user_id").limit(100),
          supabase.from("events").select("*").order("created_at", { ascending: false }).limit(300),
        ]);

      const reportRows = reportsRes.error ? [] : mapReportRows((reportsRes.data ?? []) as unknown[]);
      const logRows = logsRes.error ? [] : mapModerationLogRows((logsRes.data ?? []) as unknown[]);
      const eventRows = eventsRes.error ? [] : mapEventRows((eventsRes.data ?? []) as unknown[]);

      const ids = new Set<string>();
      reportRows.forEach((row) => {
        ids.add(row.reporterId);
        ids.add(row.targetUserId);
      });
      logRows.forEach((row) => {
        ids.add(row.actorId);
        if (row.targetUserId) ids.add(row.targetUserId);
      });
      eventRows.forEach((row) => {
        ids.add(row.hostUserId);
      });

      const profileMap: Record<string, LiteProfile> = {};
      const userIds = Array.from(ids).filter(Boolean);
      if (userIds.length) {
        const { data: userProfiles } = await supabase
          .from("profiles")
          .select("user_id,display_name,city,country,avatar_url")
          .in("user_id", userIds);

        (userProfiles ?? []).forEach((raw) => {
          const row = (raw ?? {}) as Record<string, unknown>;
          const id = pickString(row, ["user_id"]);
          if (!id) return;
          profileMap[id] = {
            userId: id,
            displayName: pickString(row, ["display_name", "name"]) || "Member",
            city: pickString(row, ["city"]),
            country: pickString(row, ["country"]),
            avatarUrl: pickNullableString(row, ["avatar_url"]),
          };
        });
      }

      const team = ((adminsRes.data ?? []) as Array<Record<string, unknown>>)
        .map((row) => pickString(row, ["user_id"]))
        .filter(Boolean);

      if (cancelled) return;

      setIsAdmin(true);
      setMyProfile(normalizedMe);
      setStats({ totalMembers, verifiedMembers, openReports, moderationActions });
      setReports(reportRows);
      setLogs(logRows);
      setEvents(eventRows);
      setProfilesById(profileMap);
      setAdminTeam(team);
      setLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const filteredReports = useMemo(() => {
    if (reportFilter === "all") return reports;
    return reports.filter((row) => row.status === reportFilter);
  }, [reportFilter, reports]);

  const flaggedMembers = useMemo(() => {
    const counts = new Map<string, number>();
    reports.forEach((report) => {
      const current = counts.get(report.targetUserId) ?? 0;
      counts.set(report.targetUserId, current + 1);
    });

    return Array.from(counts.entries())
      .map(([userId, count]) => ({ userId, count, profile: profilesById[userId] ?? null }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [profilesById, reports]);

  const eventReportsById = useMemo(() => {
    const map = new Map<string, { open: number; total: number }>();
    reports.forEach((report) => {
      const context = report.context.toLowerCase();
      if (!context.includes("event") || !report.contextId) return;
      const current = map.get(report.contextId) ?? { open: 0, total: 0 };
      current.total += 1;
      if (report.status === "open") current.open += 1;
      map.set(report.contextId, current);
    });
    return map;
  }, [reports]);

  const eventModerationFeed = useMemo(() => {
    return events
      .map((event) => {
        const reportCounts = eventReportsById.get(event.id) ?? { open: 0, total: 0 };
        return {
          event,
          hostProfile: profilesById[event.hostUserId] ?? null,
          openReports: reportCounts.open,
          totalReports: reportCounts.total,
        } satisfies EventModerationItem;
      })
      .sort((a, b) => {
        const score = (item: EventModerationItem) => {
          if (item.event.coverStatus === "pending" && item.event.coverUrl) return 4;
          if (item.openReports > 0) return 3;
          if (item.event.hiddenByAdmin) return 2;
          if (item.event.status === "cancelled") return 1;
          return 0;
        };
        const scoreDiff = score(b) - score(a);
        if (scoreDiff !== 0) return scoreDiff;
        return b.event.createdAt.localeCompare(a.event.createdAt);
      });
  }, [eventReportsById, events, profilesById]);

  const eventModerationStats = useMemo(() => {
    let pendingCovers = 0;
    let hidden = 0;
    let cancelled = 0;
    let openEventReports = 0;

    eventModerationFeed.forEach((item) => {
      if (item.event.coverStatus === "pending" && item.event.coverUrl) pendingCovers += 1;
      if (item.event.hiddenByAdmin) hidden += 1;
      if (item.event.status === "cancelled") cancelled += 1;
      openEventReports += item.openReports;
    });

    return {
      pendingCovers,
      hidden,
      cancelled,
      openEventReports,
    };
  }, [eventModerationFeed]);

  const filteredEvents = useMemo(() => {
    if (eventFilter === "all") return eventModerationFeed;
    if (eventFilter === "pending_cover") {
      return eventModerationFeed.filter((item) => item.event.coverStatus === "pending" && item.event.coverUrl);
    }
    if (eventFilter === "hidden") {
      return eventModerationFeed.filter((item) => item.event.hiddenByAdmin);
    }
    if (eventFilter === "cancelled") {
      return eventModerationFeed.filter((item) => item.event.status === "cancelled");
    }
    return eventModerationFeed.filter((item) => item.openReports > 0);
  }, [eventFilter, eventModerationFeed]);

  async function moderateEvent(eventId: string, action: EventModerateAction, payload?: { note?: string; hiddenReason?: string }) {
    if (!accessToken) {
      setActionError("Missing auth session. Please sign in again.");
      return;
    }

    const note = payload?.note?.trim() ? payload.note.trim() : null;
    const hiddenReason = payload?.hiddenReason?.trim() ? payload.hiddenReason.trim() : null;

    if (action === "hide" && !hiddenReason) {
      setActionError("Hide action requires a reason.");
      return;
    }

    setEventActionBusyId(eventId);
    setActionError(null);
    setActionInfo(null);

    const response = await fetch("/api/moderation/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ eventId, action, note, hiddenReason }),
    });

    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !json?.ok) {
      setEventActionBusyId(null);
      setActionError(json?.error ?? "Failed to moderate event.");
      return;
    }

    const [eventsRes, logsRes, reportsRes] = await Promise.all([
      supabase.from("events").select("*").order("created_at", { ascending: false }).limit(300),
      supabase.from("moderation_logs").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("reports").select("*").order("created_at", { ascending: false }).limit(200),
    ]);

    const nextEventRows = eventsRes.error ? [] : mapEventRows((eventsRes.data ?? []) as unknown[]);
    const nextLogRows = logsRes.error ? [] : mapModerationLogRows((logsRes.data ?? []) as unknown[]);
    const nextReportRows = reportsRes.error ? [] : mapReportRows((reportsRes.data ?? []) as unknown[]);

    const ids = new Set<string>(Object.keys(profilesById));
    nextEventRows.forEach((row) => ids.add(row.hostUserId));
    nextReportRows.forEach((row) => {
      ids.add(row.reporterId);
      ids.add(row.targetUserId);
    });
    nextLogRows.forEach((row) => {
      ids.add(row.actorId);
      if (row.targetUserId) ids.add(row.targetUserId);
    });

    let nextProfiles = { ...profilesById };
    const profileIds = Array.from(ids).filter(Boolean);
    if (profileIds.length) {
      const profileRes = await supabase
        .from("profiles")
        .select("user_id,display_name,city,country,avatar_url")
        .in("user_id", profileIds);
      if (!profileRes.error) {
        const mapped: Record<string, LiteProfile> = {};
        ((profileRes.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
          const id = pickString(row, ["user_id"]);
          if (!id) return;
          mapped[id] = {
            userId: id,
            displayName: pickString(row, ["display_name", "name"]) || "Member",
            city: pickString(row, ["city"]),
            country: pickString(row, ["country"]),
            avatarUrl: pickNullableString(row, ["avatar_url"]),
          };
        });
        nextProfiles = mapped;
      }
    }

    setEvents(nextEventRows);
    setLogs(nextLogRows);
    setReports(nextReportRows);
    setProfilesById(nextProfiles);
    setEventActionBusyId(null);
    setActionInfo(`Event updated: ${action}`);
  }

  function openEventModerationDialog(eventId: string, action: EventModerateAction) {
    if (action === "reject_cover" || action === "hide" || action === "cancel") {
      setEventModerationNote("");
      setEventModerationHideReason("");
      setEventModerationDialog({ open: true, eventId, action });
      setActionError(null);
      return;
    }
    void moderateEvent(eventId, action);
  }

  function closeEventModerationDialog() {
    setEventModerationDialog({ open: false, eventId: "", action: "hide" });
    setEventModerationNote("");
    setEventModerationHideReason("");
  }

  async function moderateReport(reportId: string, action: ModerateAction) {
    if (!accessToken) {
      setActionError("Missing auth session. Please sign in again.");
      return;
    }

    setActionBusyReportId(reportId);
    setActionError(null);
    setActionInfo(null);

    const response = await fetch("/api/moderation/reports", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ reportId, action }),
    });

    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !json?.ok) {
      setActionBusyReportId(null);
      setActionError(json?.error ?? "Failed to update report status.");
      return;
    }

    const [reportsRes, logsRes, openReportsCount] = await Promise.all([
      supabase.from("reports").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("moderation_logs").select("*").order("created_at", { ascending: false }).limit(200),
      countReports("open"),
    ]);

    setReports(reportsRes.error ? [] : mapReportRows((reportsRes.data ?? []) as unknown[]));
    setLogs(logsRes.error ? [] : mapModerationLogRows((logsRes.data ?? []) as unknown[]));
    setStats((prev) => ({ ...prev, openReports: openReportsCount }));
    setActionBusyReportId(null);
    setActionInfo(`Report updated: ${action}`);
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#071316] text-white">Loading...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#071316] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[1100px] px-4 py-8">
          <div className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-5 text-amber-100">
            <h1 className="text-xl font-semibold">Admin access required</h1>
            <p className="mt-2 text-sm text-amber-100/90">
              Your account is not in the <code className="rounded bg-black/25 px-2 py-1">admins</code> table.
            </p>
            {meId ? (
              <p className="mt-3 text-xs text-amber-100/80">
                Current user id: <code className="rounded bg-black/25 px-2 py-1">{meId}</code>
              </p>
            ) : null}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#10272b,_#071316_45%,_#05090b_100%)] text-slate-100">
      <Nav />

      <main className="mx-auto w-full max-w-[1280px] px-4 pb-14 pt-6 sm:px-6 lg:px-8">
        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}
        {actionError ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{actionError}</div>
        ) : null}
        {actionInfo ? (
          <div className="mb-4 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">{actionInfo}</div>
        ) : null}

        <section className="overflow-hidden rounded-[28px] border border-cyan-200/10 bg-[#0b1a1d]/70 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="relative h-44 w-full sm:h-52">
            <div className="absolute inset-0 bg-[linear-gradient(125deg,rgba(17,113,127,0.48),rgba(164,41,187,0.35))]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.28),transparent_50%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(236,72,153,0.22),transparent_56%)]" />

            <div className="absolute bottom-4 right-4 flex items-center gap-2">
              <Link
                href="/admin"
                className="rounded-xl border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/25"
              >
                Profile Manager
              </Link>
              <Link
                href="/my-space"
                className="rounded-xl border border-white/20 bg-black/30 px-4 py-2 text-sm font-medium text-white/85 hover:bg-black/45"
              >
                My Space
              </Link>
            </div>
          </div>

          <div className="relative px-4 pb-6 sm:px-6 lg:px-8">
            <div className="-mt-16 flex flex-col gap-4 sm:-mt-20 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 items-end gap-4">
                <div className="h-28 w-28 overflow-hidden rounded-full border-4 border-[#071316] bg-[#11272b] shadow-[0_12px_36px_rgba(0,0,0,0.55)] sm:h-32 sm:w-32">
                  {myProfile?.avatarUrl ? (
                    <img src={myProfile.avatarUrl} alt="Admin avatar" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm text-white/55">Admin</div>
                  )}
                </div>

                <div className="min-w-0 pb-1">
                  <h1 className="truncate text-2xl font-bold text-white sm:text-3xl">
                    {myProfile?.displayName || "Admin"}
                  </h1>
                  <p className="mt-1 text-sm text-slate-300">
                    {[myProfile?.city, myProfile?.country].filter(Boolean).join(", ") || "Location not set"}
                  </p>
                  <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-100">
                    <span className="h-2 w-2 rounded-full bg-cyan-300" />
                    Moderation access active
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Members</p>
            <p className="mt-1 text-2xl font-bold text-white">{stats.totalMembers ?? "-"}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Verified</p>
            <p className="mt-1 text-2xl font-bold text-white">{stats.verifiedMembers ?? "-"}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Open Reports</p>
            <p className="mt-1 text-2xl font-bold text-white">{stats.openReports ?? "-"}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Moderation Actions</p>
            <p className="mt-1 text-2xl font-bold text-white">{stats.moderationActions ?? "-"}</p>
          </div>
        </section>

        <div className="mt-6 border-b border-white/10">
          <div className="no-scrollbar flex overflow-x-auto">
            {[
              { key: "overview", label: "Overview" },
              { key: "reports", label: "Reports" },
              { key: "events", label: "Events" },
              { key: "logs", label: "Moderation Logs" },
              { key: "members", label: "Members" },
            ].map((tab) => {
              const selected = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key as TabKey)}
                  className={cx(
                    "relative px-4 py-3 text-sm font-semibold",
                    selected ? "text-cyan-200" : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  {tab.label}
                  {selected ? (
                    <span className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-cyan-300" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <section className="mt-6 space-y-5">
          {activeTab === "overview" ? (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <h2 className="mb-3 text-lg font-bold text-white">Latest Reports</h2>
                <div className="space-y-3">
                  {reports.slice(0, 8).map((report) => {
                    const reporter = profilesById[report.reporterId];
                    const target = profilesById[report.targetUserId];
                    return (
                      <div key={report.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <span className="text-slate-400">{formatDate(report.createdAt)}</span>
                          <span className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-slate-200">
                            {report.status}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-white">{report.reason}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          Reporter: {reporter?.displayName || report.reporterId} • Target: {target?.displayName || report.targetUserId}
                        </p>
                      </div>
                    );
                  })}
                  {reports.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">No reports found.</div>
                  ) : null}
                </div>
              </article>

              <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <h2 className="mb-3 text-lg font-bold text-white">Latest Moderation Actions</h2>
                <div className="space-y-3">
                  {logs.slice(0, 8).map((log) => {
                    const actor = profilesById[log.actorId];
                    const target = log.targetUserId ? profilesById[log.targetUserId] : null;
                    return (
                      <div key={log.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-400">
                          <span>{formatDate(log.createdAt)}</span>
                          <span>{formatRelative(log.createdAt)}</span>
                        </div>
                        <p className="text-sm font-semibold text-white uppercase">{log.action}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          Actor: {actor?.displayName || log.actorId}
                          {target ? ` • Target: ${target.displayName}` : ""}
                        </p>
                        {log.note ? <p className="mt-1 text-xs text-slate-300">{log.note}</p> : null}
                      </div>
                    );
                  })}
                  {logs.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                      No moderation logs found.
                    </div>
                  ) : null}
                </div>
              </article>
            </div>
          ) : null}

          {activeTab === "reports" ? (
            <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-bold text-white">Reports Queue</h2>
                <div className="flex flex-wrap gap-2">
                  {([
                    { key: "all", label: "All" },
                    { key: "open", label: "Open" },
                    { key: "resolved", label: "Resolved" },
                    { key: "dismissed", label: "Dismissed" },
                  ] as const).map((option) => {
                    const selected = reportFilter === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setReportFilter(option.key)}
                        className={cx(
                          "rounded-full border px-3 py-1 text-xs font-semibold",
                          selected
                            ? "border-cyan-300/35 bg-cyan-300/15 text-cyan-100"
                            : "border-white/15 bg-black/25 text-slate-300 hover:text-white"
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                {filteredReports.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">No reports for this filter.</div>
                ) : (
                  filteredReports.map((report) => {
                    const reporter = profilesById[report.reporterId];
                    const target = profilesById[report.targetUserId];
                    const busy = actionBusyReportId === report.id;
                    return (
                      <div key={report.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span className="font-semibold text-slate-100">{report.reason}</span>
                          <span>•</span>
                          <span className="uppercase">{report.context}</span>
                          <span>•</span>
                          <span>{formatDate(report.createdAt)}</span>
                          <span className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-slate-200">
                            {report.status}
                          </span>
                        </div>

                        <p className="text-sm text-slate-300">
                          Reporter: {reporter?.displayName || report.reporterId} • Target: {target?.displayName || report.targetUserId}
                        </p>
                        {report.note ? <p className="mt-2 text-sm text-slate-200">{report.note}</p> : null}

                        <div className="mt-3 flex flex-wrap gap-2">
                          {report.status === "open" ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void moderateReport(report.id, "resolve")}
                                className="rounded-full border border-emerald-300/35 bg-emerald-300/15 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/25 disabled:opacity-60"
                              >
                                {busy ? "Saving..." : "Resolve"}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void moderateReport(report.id, "dismiss")}
                                className="rounded-full border border-rose-300/35 bg-rose-300/15 px-3 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-300/25 disabled:opacity-60"
                              >
                                {busy ? "Saving..." : "Dismiss"}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void moderateReport(report.id, "reopen")}
                              className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/25 disabled:opacity-60"
                            >
                              {busy ? "Saving..." : "Reopen"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </article>
          ) : null}

          {activeTab === "events" ? (
            <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-bold text-white">Events Moderation</h2>
                <div className="flex flex-wrap gap-2">
                  {([
                    { key: "pending_cover", label: "Pending Covers" },
                    { key: "reported", label: "Reported" },
                    { key: "hidden", label: "Hidden" },
                    { key: "cancelled", label: "Cancelled" },
                    { key: "all", label: "All" },
                  ] as const).map((option) => {
                    const selected = eventFilter === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setEventFilter(option.key)}
                        className={cx(
                          "rounded-full border px-3 py-1 text-xs font-semibold",
                          selected
                            ? "border-cyan-300/35 bg-cyan-300/15 text-cyan-100"
                            : "border-white/15 bg-black/25 text-slate-300 hover:text-white"
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Pending Covers</p>
                  <p className="mt-1 text-2xl font-bold text-white">{eventModerationStats.pendingCovers}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Open Event Reports</p>
                  <p className="mt-1 text-2xl font-bold text-white">{eventModerationStats.openEventReports}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Hidden Events</p>
                  <p className="mt-1 text-2xl font-bold text-white">{eventModerationStats.hidden}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Cancelled Events</p>
                  <p className="mt-1 text-2xl font-bold text-white">{eventModerationStats.cancelled}</p>
                </div>
              </div>

              <div className="space-y-3">
                {filteredEvents.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                    No events in this moderation filter.
                  </div>
                ) : (
                  filteredEvents.map((item) => {
                    const busy = eventActionBusyId === item.event.id;
                    return (
                      <div key={item.event.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex flex-col gap-4 lg:flex-row">
                          <div className="h-36 w-full shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#102127] lg:w-56">
                            {item.event.coverUrl ? (
                              <img src={item.event.coverUrl} alt={item.event.title} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">No cover image</div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                              <span className="rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-slate-100">
                                {item.event.visibility}
                              </span>
                              <span className="rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-slate-100">
                                {item.event.status}
                              </span>
                              <span className="rounded-full border border-amber-300/35 bg-amber-300/15 px-2 py-0.5 text-amber-100">
                                cover {item.event.coverStatus}
                              </span>
                              {item.event.hiddenByAdmin ? (
                                <span className="rounded-full border border-rose-300/35 bg-rose-300/15 px-2 py-0.5 text-rose-100">hidden</span>
                              ) : null}
                              {item.openReports > 0 ? (
                                <span className="rounded-full border border-fuchsia-300/35 bg-fuchsia-300/15 px-2 py-0.5 text-fuchsia-100">
                                  {item.openReports} open reports
                                </span>
                              ) : null}
                            </div>

                            <p className="truncate text-lg font-bold text-white">{item.event.title}</p>
                            <p className="text-sm text-slate-400">
                              Host: {item.hostProfile?.displayName || item.event.hostUserId} •{" "}
                              {[item.event.city, item.event.country].filter(Boolean).join(", ")} • {formatDate(item.event.startsAt)}
                            </p>
                            {item.event.hiddenReason ? (
                              <p className="mt-1 text-xs text-rose-100">Hidden reason: {item.event.hiddenReason}</p>
                            ) : null}
                            {item.event.coverReviewNote ? (
                              <p className="mt-1 text-xs text-amber-100">Cover note: {item.event.coverReviewNote}</p>
                            ) : null}

                            <div className="mt-3 flex flex-wrap gap-2">
                              {item.event.coverUrl && item.event.coverStatus !== "approved" ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => openEventModerationDialog(item.event.id, "approve_cover")}
                                  className="rounded-full border border-emerald-300/35 bg-emerald-300/15 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/25 disabled:opacity-60"
                                >
                                  {busy ? "Saving..." : "Approve Cover"}
                                </button>
                              ) : null}

                              {item.event.coverUrl && item.event.coverStatus !== "rejected" ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => openEventModerationDialog(item.event.id, "reject_cover")}
                                  className="rounded-full border border-amber-300/35 bg-amber-300/15 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-300/25 disabled:opacity-60"
                                >
                                  {busy ? "Saving..." : "Reject Cover"}
                                </button>
                              ) : null}

                              {item.event.hiddenByAdmin ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => openEventModerationDialog(item.event.id, "unhide")}
                                  className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/25 disabled:opacity-60"
                                >
                                  {busy ? "Saving..." : "Unhide"}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => openEventModerationDialog(item.event.id, "hide")}
                                  className="rounded-full border border-rose-300/35 bg-rose-300/15 px-3 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-300/25 disabled:opacity-60"
                                >
                                  {busy ? "Saving..." : "Hide"}
                                </button>
                              )}

                              {item.event.status === "cancelled" ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => openEventModerationDialog(item.event.id, "publish")}
                                  className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/25 disabled:opacity-60"
                                >
                                  {busy ? "Saving..." : "Publish"}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => openEventModerationDialog(item.event.id, "cancel")}
                                  className="rounded-full border border-rose-300/35 bg-rose-300/15 px-3 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-300/25 disabled:opacity-60"
                                >
                                  {busy ? "Saving..." : "Cancel"}
                                </button>
                              )}

                              <Link
                                href={`/events/${item.event.id}`}
                                className="rounded-full border border-white/20 bg-black/30 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-black/40"
                              >
                                Open Event
                              </Link>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </article>
          ) : null}

          {activeTab === "logs" ? (
            <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <h2 className="mb-4 text-lg font-bold text-white">Moderation Logs</h2>
              <div className="space-y-3">
                {logs.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">No logs found.</div>
                ) : (
                  logs.map((log) => {
                    const actor = profilesById[log.actorId];
                    const target = log.targetUserId ? profilesById[log.targetUserId] : null;
                    return (
                      <div key={log.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 uppercase text-slate-100">
                            {log.action}
                          </span>
                          <span>•</span>
                          <span>{formatDate(log.createdAt)}</span>
                          <span>•</span>
                          <span>{formatRelative(log.createdAt)}</span>
                        </div>
                        <p className="text-sm text-slate-300">
                          Actor: {actor?.displayName || log.actorId}
                          {target ? ` • Target: ${target.displayName}` : ""}
                          {log.reportId ? ` • Report: ${log.reportId}` : ""}
                        </p>
                        {log.note ? <p className="mt-2 text-sm text-slate-200">{log.note}</p> : null}
                      </div>
                    );
                  })
                )}
              </div>
            </article>
          ) : null}

          {activeTab === "members" ? (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <h2 className="mb-4 text-lg font-bold text-white">Most Reported Members</h2>
                <div className="space-y-2">
                  {flaggedMembers.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">No flagged members.</div>
                  ) : (
                    flaggedMembers.map((item) => (
                      <div key={item.userId} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                        <div>
                          <p className="text-sm font-semibold text-white">{item.profile?.displayName || item.userId}</p>
                          <p className="text-xs text-slate-400">
                            {[item.profile?.city, item.profile?.country].filter(Boolean).join(", ") || "Location not set"}
                          </p>
                        </div>
                        <span className="rounded-full border border-rose-300/35 bg-rose-300/15 px-3 py-1 text-xs font-semibold text-rose-100">
                          {item.count} reports
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </article>

              <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <h2 className="mb-4 text-lg font-bold text-white">Admin Team</h2>
                <div className="space-y-2">
                  {adminTeam.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">No admin rows found.</div>
                  ) : (
                    adminTeam.map((adminId) => {
                      const adminProfile = profilesById[adminId];
                      return (
                        <div key={adminId} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                          <p className="text-sm font-semibold text-white">{adminProfile?.displayName || adminId}</p>
                          <p className="text-xs text-slate-400">{adminProfile ? [adminProfile.city, adminProfile.country].filter(Boolean).join(", ") : adminId}</p>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="mt-4 border-t border-white/10 pt-4">
                  <Link
                    href="/admin"
                    className="inline-flex rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/25"
                  >
                    Open profile manager
                  </Link>
                </div>
              </article>
            </div>
          ) : null}
        </section>
      </main>

      <ConfirmationDialog
        open={eventModerationDialog.open}
        title={
          eventModerationDialog.action === "hide"
            ? "Hide this event?"
            : eventModerationDialog.action === "reject_cover"
              ? "Reject event cover?"
              : "Cancel this event?"
        }
        description={
          eventModerationDialog.action === "hide"
            ? "Hiding blocks this event from discovery until an admin unhides it."
            : eventModerationDialog.action === "reject_cover"
              ? "You can include an optional host note for the cover rejection."
              : "This marks the event as cancelled. You can publish it again later."
        }
        summary={
          <div className="space-y-2">
            {eventModerationDialog.action === "hide" ? (
              <input
                value={eventModerationHideReason}
                onChange={(entry) => setEventModerationHideReason(entry.target.value)}
                placeholder="Hide reason (required)"
                className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
              />
            ) : null}
            <textarea
              rows={3}
              value={eventModerationNote}
              onChange={(entry) => setEventModerationNote(entry.target.value)}
              placeholder={eventModerationDialog.action === "cancel" ? "Optional cancellation note" : "Optional host note"}
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
            />
          </div>
        }
        confirmVariant="danger"
        confirmLabel={
          eventModerationDialog.action === "hide"
            ? "Hide Event"
            : eventModerationDialog.action === "reject_cover"
              ? "Reject Cover"
              : "Cancel Event"
        }
        busy={Boolean(eventActionBusyId && eventActionBusyId === eventModerationDialog.eventId)}
        onCancel={closeEventModerationDialog}
        onConfirm={() => {
          const eventId = eventModerationDialog.eventId;
          const action = eventModerationDialog.action;
          if (!eventId) return;
          if (action === "hide" && !eventModerationHideReason.trim()) {
            setActionError("Hide action requires a reason.");
            return;
          }
          closeEventModerationDialog();
          void moderateEvent(eventId, action, {
            note: eventModerationNote.trim() || undefined,
            hiddenReason: action === "hide" ? eventModerationHideReason.trim() : undefined,
          });
        }}
      />
    </div>
  );
}
