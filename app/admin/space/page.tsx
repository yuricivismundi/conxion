"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import Nav from "@/components/Nav";
import type {
  AdminDistributionItem,
  AdminLiteProfile,
  AdminOverviewResponse,
  AdminPhotoQueueItem,
  AdminReportQueueItem,
  AdminRequestQueueItem,
  AdminRequestQueueItemType,
  AdminTrendPoint,
} from "@/lib/admin/overview";
import { supabase } from "@/lib/supabase/client";
import { cx } from "@/lib/cx";

type TabKey = "dashboard" | "moderation" | "event-covers" | "privacy-claims" | "requests" | "members" | "logs";
type DateFilterKey = "7d" | "30d" | "90d" | "180d";
type ReportStatusFilter = "all" | "open" | "resolved" | "dismissed";
type ModerateAction = "resolve" | "dismiss" | "reopen";
type PhotoModerateAction = "approve" | "reject";
type EventModerateAction = "approve_cover" | "reject_cover" | "hide" | "unhide" | "cancel" | "publish";

type DanceSkill = { level?: string; verified?: boolean };
type DanceSkills = Record<string, DanceSkill>;

type MemberResult = {
  user_id: string;
  display_name: string;
  city: string | null;
  country: string | null;
  verified: boolean;
  verified_label: string | null;
  roles: string[];
  languages: string[];
  dance_skills: DanceSkills;
  avatar_url: string | null;
  avatar_status: string | null;
};

const MEMBER_ROLE_OPTIONS = ["Social Dancer", "Student", "Organiser", "DJ", "Artist", "Teacher"] as const;
const MEMBER_LANGUAGE_OPTIONS = ["English", "Spanish", "Italian", "Portuguese", "French", "German", "Estonian", "Russian"] as const;
const DANCE_STYLES = ["bachata", "salsa", "kizomba", "tango", "zouk"] as const;
const DANCE_LEVELS = ["beginner", "intermediate", "advanced"] as const;

function normalizeMember(r: Record<string, unknown>): MemberResult {
  const isStr = (v: unknown): v is string => typeof v === "string";
  return {
    user_id: isStr(r.user_id) ? r.user_id : "",
    display_name: isStr(r.display_name) ? r.display_name : "—",
    city: isStr(r.city) ? r.city : null,
    country: isStr(r.country) ? r.country : null,
    verified: Boolean(r.verified),
    verified_label: isStr(r.verified_label) ? r.verified_label : null,
    roles: Array.isArray(r.roles) ? r.roles.filter(isStr) : [],
    languages: Array.isArray(r.languages) ? r.languages.filter(isStr) : [],
    dance_skills: r.dance_skills && typeof r.dance_skills === "object" ? (r.dance_skills as DanceSkills) : {},
    avatar_url: isStr(r.avatar_url) ? r.avatar_url : null,
    avatar_status: isStr(r.avatar_status) ? r.avatar_status : null,
  };
}

const DATE_FILTERS: Array<{ key: DateFilterKey; label: string; days: number }> = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "180d", label: "6 months", days: 180 },
];

const TAB_OPTIONS: Array<{ key: TabKey; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "moderation", label: "Profile Photos" },
  { key: "event-covers", label: "Event Covers" },
  { key: "privacy-claims", label: "Privacy & Claims" },
  { key: "requests", label: "Requests" },
  { key: "members", label: "Members" },
  { key: "logs", label: "Logs" },
];

const REQUEST_TYPE_ORDER: AdminRequestQueueItemType[] = [
  "trip_request",
  "hosting_request",
  "service_inquiry",
  "event_request",
  "reference_request",
];

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatRelative(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function withinWindow(value: string, filter: DateFilterKey) {
  const days = DATE_FILTERS.find((option) => option.key === filter)?.days ?? 180;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function formatRequestTypeLabel(value: AdminRequestQueueItemType) {
  if (value === "trip_request") return "Trip requests";
  if (value === "hosting_request") return "Hosting requests";
  if (value === "service_inquiry") return "Service inquiries";
  if (value === "event_request") return "Event requests";
  return "Reference prompts";
}

function formatRequestTypeChip(value: AdminRequestQueueItemType) {
  if (value === "trip_request") return "Trip";
  if (value === "hosting_request") return "Hosting";
  if (value === "service_inquiry") return "Service";
  if (value === "event_request") return "Event";
  return "Reference";
}

function formatReportContextLabel(value: string) {
  if (!value) return "Other";
  return value.replace(/_/g, " ");
}

function statusChipClass(value: string) {
  const status = value.trim().toLowerCase();
  if (status === "open" || status === "pending") {
    return "border-amber-300/30 bg-amber-300/12 text-amber-100";
  }
  if (status === "resolved" || status === "accepted" || status === "approved" || status === "published") {
    return "border-emerald-300/30 bg-emerald-300/12 text-emerald-100";
  }
  if (status === "dismissed" || status === "declined" || status === "cancelled" || status === "rejected") {
    return "border-rose-300/30 bg-rose-300/12 text-rose-100";
  }
  if (status === "under_review" || status === "needs_info") {
    return "border-cyan-300/30 bg-cyan-300/12 text-cyan-100";
  }
  return "border-white/15 bg-white/[0.05] text-white/80";
}

function requestTypeChipClass(value: AdminRequestQueueItemType) {
  if (value === "trip_request") return "border-cyan-300/30 bg-cyan-300/12 text-cyan-100";
  if (value === "hosting_request") return "border-emerald-300/30 bg-emerald-300/12 text-emerald-100";
  if (value === "service_inquiry") return "border-fuchsia-300/30 bg-fuchsia-300/12 text-fuchsia-100";
  if (value === "event_request") return "border-indigo-300/30 bg-indigo-300/12 text-indigo-100";
  return "border-amber-300/30 bg-amber-300/12 text-amber-100";
}

function cardToneClass(tone: "emerald" | "cyan" | "amber" | "rose" | "slate") {
  if (tone === "emerald") return "from-emerald-300/18 to-emerald-500/5";
  if (tone === "cyan") return "from-cyan-300/18 to-cyan-500/5";
  if (tone === "amber") return "from-amber-300/18 to-amber-500/5";
  if (tone === "rose") return "from-rose-300/18 to-rose-500/5";
  return "from-white/10 to-white/[0.02]";
}

function buildDistribution(items: AdminRequestQueueItem[] | AdminReportQueueItem[], kind: "requests" | "reports") {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const key =
      kind === "requests"
        ? (item as AdminRequestQueueItem).type
        : (item as AdminReportQueueItem).context || "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([key, value]) => ({
      key,
      label: kind === "requests" ? formatRequestTypeLabel(key as AdminRequestQueueItemType) : formatReportContextLabel(key),
      value,
    }))
    .sort((left, right) => right.value - left.value);
}

function MiniTrendChart({
  title,
  hint,
  series,
  tone,
}: {
  title: string;
  hint: string;
  series: AdminTrendPoint[];
  tone: "cyan" | "emerald" | "amber";
}) {
  const max = Math.max(1, ...series.map((item) => item.value));
  const barClass =
    tone === "emerald"
      ? "from-emerald-300 to-emerald-500"
      : tone === "amber"
        ? "from-amber-300 to-amber-500"
        : "from-cyan-300 to-blue-500";

  return (
    <div className="rounded-[24px] border border-white/10 bg-[#0f1922] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="mt-1 text-xs text-slate-400">{hint}</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-300">
          {series.reduce((sum, item) => sum + item.value, 0)}
        </span>
      </div>

      <div className="mt-5 flex h-40 items-end gap-2">
        {series.map((point) => (
          <div key={point.key} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="text-[11px] text-slate-500">{point.value}</div>
            <div className="flex h-28 w-full items-end">
              <div
                className={cx("w-full rounded-t-xl bg-gradient-to-t", barClass)}
                style={{ height: `${Math.max(8, Math.round((point.value / max) * 100))}%` }}
                title={`${point.label}: ${point.value}`}
              />
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{point.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DistributionList({
  items,
  emptyLabel,
}: {
  items: AdminDistributionItem[];
  emptyLabel: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.key}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-200">{item.label}</span>
            <span className="text-slate-400">{item.value}</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.06]">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-cyan-300 via-emerald-300 to-cyan-500"
              style={{ width: `${Math.max(8, Math.round((item.value / max) * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function KpiCard({
  label,
  value,
  detail,
  tone = "slate",
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "emerald" | "cyan" | "amber" | "rose" | "slate";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-2xl border border-white/10 bg-gradient-to-br p-3 text-left transition",
        cardToneClass(tone),
        onClick ? "cursor-pointer hover:brightness-125" : "cursor-default"
      )}
    >
      <p className="text-center text-[10px] uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-1 text-center text-xl font-bold text-white">{value}</p>
      <p className="mt-1 text-center text-xs text-slate-500">{detail}</p>
    </button>
  );
}

function QueueHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-slate-400">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

function ProfileIdentity({ profile, fallback }: { profile: AdminLiteProfile | null; fallback: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-white">{profile?.displayName || fallback}</p>
      <p className="truncate text-xs text-slate-500">
        {[profile?.city, profile?.country].filter(Boolean).join(", ") || "Location not set"}
      </p>
    </div>
  );
}

type OverviewPayload =
  | { ok?: true; overview?: AdminOverviewResponse }
  | { ok?: false; error?: string };

export default function AdminSpacePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [isAdminDenied, setIsAdminDenied] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [dateFilter, setDateFilter] = useState<DateFilterKey>("30d");
  const [requestTypeFilter, setRequestTypeFilter] = useState<"all" | AdminRequestQueueItemType>("all");
  const [reportContextFilter, setReportContextFilter] = useState<string>("all");
  const [reportStatusFilter, setReportStatusFilter] = useState<ReportStatusFilter>("all");

  const [moderationNoteByReportId, setModerationNoteByReportId] = useState<Record<string, string>>({});
  const [actionBusyReportId, setActionBusyReportId] = useState<string | null>(null);
  const [eventActionBusyId, setEventActionBusyId] = useState<string | null>(null);
  const [photoActionBusyId, setPhotoActionBusyId] = useState<string | null>(null);
  const [eventsOpsBusy, setEventsOpsBusy] = useState(false);
  const [avatarPage, setAvatarPage] = useState(0);
  const AVATAR_PAGE_SIZE = 30;
  const [avatarSearch, setAvatarSearch] = useState("");
  const [eventCoverPage, setEventCoverPage] = useState(0);
  const EVENT_COVER_PAGE_SIZE = 20;
  const [eventCoverSearch, setEventCoverSearch] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [requestStatusFilter, setRequestStatusFilter] = useState<"all" | "pending" | "accepted" | "declined">("all");
  const [requestCityFilter, setRequestCityFilter] = useState<string>("all");
  const [requestPage, setRequestPage] = useState(0);
  const REQUEST_PAGE_SIZE = 10;
  const [logPage, setLogPage] = useState(0);
  const LOG_PAGE_SIZE = 10;

  // Members search tab
  const [memberQ, setMemberQ] = useState("");
  const [memberVerifiedFilter, setMemberVerifiedFilter] = useState<"all" | "yes" | "no">("all");
  const [memberRoleFilter, setMemberRoleFilter] = useState("all");
  const [memberStyleFilter, setMemberStyleFilter] = useState("all");
  const [memberLevelFilter, setMemberLevelFilter] = useState("all");
  const [memberCityQ, setMemberCityQ] = useState("");
  const [memberCountryQ, setMemberCountryQ] = useState("");
  const [memberResults, setMemberResults] = useState<MemberResult[]>([]);
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [memberSearchError, setMemberSearchError] = useState<string | null>(null);
  const [memberSearchDone, setMemberSearchDone] = useState(false);
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null);
  const [memberMsg, setMemberMsg] = useState<string | null>(null);
  const [memberPage, setMemberPage] = useState(0);
  const MEMBER_PAGE_SIZE = 15;
  const DISABLE_SELF_EDIT = true;

  const [photoReviewDialog, setPhotoReviewDialog] = useState<{
    open: boolean;
    userId: string;
    displayName: string;
    action: PhotoModerateAction;
  }>({
    open: false,
    userId: "",
    displayName: "",
    action: "reject",
  });
  const [photoReviewMsg, setPhotoReviewMsg] = useState("");
  const [photoReviewBusy, setPhotoReviewBusy] = useState(false);

  const [eventModerationDialog, setEventModerationDialog] = useState<{
    open: boolean;
    eventId: string;
    action: EventModerateAction;
  }>({
    open: false,
    eventId: "",
    action: "hide",
  });
  const [eventModerationNote, setEventModerationNote] = useState("");
  const [eventModerationHideReason, setEventModerationHideReason] = useState("");

  async function fetchOverview(token: string, silent = false) {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch("/api/admin/overview", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      const json = (await response.json().catch(() => null)) as OverviewPayload | null;
      if (response.status === 401) {
        router.replace("/auth");
        return;
      }
      if (response.status === 403) {
        setIsAdminDenied(true);
        setOverview(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (!response.ok || !json?.ok || !json.overview) {
        const nextError = json && "error" in json ? json.error : null;
        setError(nextError ?? "Failed to load admin overview.");
        return;
      }

      setIsAdminDenied(false);
      setOverview(json.overview);
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load admin overview.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const [sessionRes, userRes] = await Promise.all([supabase.auth.getSession(), supabase.auth.getUser()]);
      const user = sessionRes.data.session?.user ?? userRes.data.user;
      const token = sessionRes.data.session?.access_token ?? null;

      if (!user || !token) {
        router.replace("/auth");
        return;
      }

      if (cancelled) return;
      setMeId(user.id);
      setAccessToken(token);
      await fetchOverview(token);
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const requestTypeOptions = useMemo(() => {
    const base: Array<{ key: "all" | AdminRequestQueueItemType; label: string }> = [{ key: "all", label: "All request types" }];
    return base.concat(
      REQUEST_TYPE_ORDER.map((type) => ({
        key: type,
        label: formatRequestTypeLabel(type),
      }))
    );
  }, []);

  const reportContextOptions = useMemo(() => {
    if (!overview) return [{ key: "all", label: "All contexts" }];
    return [
      { key: "all", label: "All contexts" },
      ...overview.distribution.reportsByContext.map((item) => ({
        key: item.key,
        label: item.label,
      })),
    ];
  }, [overview]);

  const filteredRequests = useMemo(() => {
    if (!overview) return [];
    const term = requestSearch.trim().toLowerCase();
    return overview.queues.requests.filter((item) => {
      if (!withinWindow(item.createdAt, dateFilter)) return false;
      if (requestTypeFilter !== "all" && item.type !== requestTypeFilter) return false;
      if (requestStatusFilter !== "all" && item.status !== requestStatusFilter) return false;
      if (requestCityFilter !== "all") {
        const city = (item.requester?.city ?? item.target?.city ?? "").toLowerCase();
        if (!city.includes(requestCityFilter.toLowerCase())) return false;
      }
      if (term) {
        const hay = [item.requester?.displayName, item.target?.displayName, item.title, item.subtitle]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [dateFilter, overview, requestTypeFilter, requestStatusFilter, requestCityFilter, requestSearch]);

  const topCities = useMemo(() => {
    if (!overview) return [];
    const counts = new Map<string, number>();
    overview.queues.requests.filter((item) => withinWindow(item.createdAt, dateFilter)).forEach((item) => {
      const city = item.requester?.city || item.target?.city || "";
      if (city) counts.set(city, (counts.get(city) ?? 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [overview, dateFilter]);

  const filteredReports = useMemo(() => {
    if (!overview) return [];
    return overview.queues.reports.filter((item) => {
      if (!withinWindow(item.createdAt, dateFilter)) return false;
      if (reportContextFilter !== "all" && item.context !== reportContextFilter) return false;
      if (reportStatusFilter !== "all" && item.status !== reportStatusFilter) return false;
      return true;
    });
  }, [dateFilter, overview, reportContextFilter, reportStatusFilter]);

  const filteredRequestDistribution = useMemo(
    () => buildDistribution(filteredRequests, "requests"),
    [filteredRequests]
  );
  const filteredReportDistribution = useMemo(
    () => buildDistribution(filteredReports, "reports"),
    [filteredReports]
  );

  const requestSummary = useMemo(() => {
    const pending = filteredRequests.filter((item) => item.status === "pending").length;
    const trip = filteredRequests.filter((item) => item.type === "trip_request").length;
    const hosting = filteredRequests.filter((item) => item.type === "hosting_request").length;
    const service = filteredRequests.filter((item) => item.type === "service_inquiry").length;
    const events = filteredRequests.filter((item) => item.type === "event_request").length;
    const references = filteredRequests.filter((item) => item.type === "reference_request").length;
    return { pending, trip, hosting, service, events, references };
  }, [filteredRequests]);

  async function searchMembers() {
    setMemberSearchLoading(true);
    setMemberSearchError(null);
    setMemberSearchDone(false);
    setMemberMsg(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase as any)
        .from("profiles")
        .select("user_id,display_name,city,country,verified,verified_label,roles,languages,dance_skills,avatar_url,avatar_status")
        .limit(60)
        .order("display_name", { ascending: true });

      const term = memberQ.trim();
      if (term) query = query.ilike("display_name", `%${term}%`);
      if (memberVerifiedFilter === "yes") query = query.eq("verified", true);
      if (memberVerifiedFilter === "no") query = query.eq("verified", false);
      if (memberRoleFilter !== "all") query = query.contains("roles", [memberRoleFilter]);
      const cityTerm = memberCityQ.trim();
      if (cityTerm) query = query.ilike("city", `%${cityTerm}%`);
      const countryTerm = memberCountryQ.trim();
      if (countryTerm) query = query.ilike("country", `%${countryTerm}%`);

      const { data, error: queryError } = await query;
      if (queryError) throw new Error(queryError.message);

      let results: MemberResult[] = ((data ?? []) as Record<string, unknown>[]).map(normalizeMember);

      // Client-side style/level filter
      if (memberStyleFilter !== "all") {
        results = results.filter((p) => {
          const skill = p.dance_skills[memberStyleFilter];
          if (!skill?.level) return false;
          if (memberLevelFilter !== "all" && skill.level !== memberLevelFilter) return false;
          return true;
        });
      }

      setMemberResults(results);
      setMemberPage(0);
      setMemberSearchDone(true);
    } catch (err: unknown) {
      setMemberSearchError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setMemberSearchLoading(false);
    }
  }

  async function updateMember(userId: string, patch: Partial<MemberResult>) {
    setMemberBusyId(userId);
    setMemberMsg(null);
    const payload: Record<string, unknown> = {};
    if (typeof patch.verified === "boolean") payload.verified = patch.verified;
    if (patch.verified_label !== undefined) payload.verified_label = patch.verified_label;
    if (patch.roles !== undefined) payload.roles = patch.roles;
    if (patch.languages !== undefined) payload.languages = patch.languages;
    if (patch.dance_skills !== undefined) payload.dance_skills = patch.dance_skills;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any).from("profiles").update(payload).eq("user_id", userId);
    setMemberBusyId(null);
    if (updateError) { setMemberMsg(updateError.message); return false; }
    setMemberResults((prev) => prev.map((p) => p.user_id === userId ? { ...p, ...patch } : p));
    return true;
  }

  function memberToggleInArray(arr: string[], value: string) {
    return arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
  }

  async function refreshOverview() {
    if (!accessToken) return;
    await fetchOverview(accessToken, true);
  }

  async function moderateReport(reportId: string, action: ModerateAction) {
    if (!accessToken) {
      setActionError("Missing auth session. Please sign in again.");
      return;
    }

    setActionBusyReportId(reportId);
    setActionError(null);
    setActionInfo(null);

    try {
      const response = await fetch("/api/moderation/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          reportId,
          action,
          note: moderationNoteByReportId[reportId] ?? null,
        }),
      });

      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; threadToken?: string | null; notificationWarning?: string | null }
        | null;
      if (!response.ok || !json?.ok) {
        setActionError(json?.error ?? "Failed to update report.");
        return;
      }

      setActionInfo(
        json?.threadToken
          ? `Report updated: ${action}. Reporter was notified in Messages.`
          : `Report updated: ${action}${json?.notificationWarning ? ` (${json.notificationWarning})` : ""}`
      );
      setModerationNoteByReportId((prev) => ({ ...prev, [reportId]: "" }));
      await refreshOverview();
    } catch (nextError: unknown) {
      setActionError(nextError instanceof Error ? nextError.message : "Failed to update report.");
    } finally {
      setActionBusyReportId(null);
    }
  }

  async function moderateEvent(
    eventId: string,
    action: EventModerateAction,
    payload?: { note?: string; hiddenReason?: string }
  ) {
    if (!accessToken) {
      setActionError("Missing auth session. Please sign in again.");
      return;
    }

    if (action === "hide" && !payload?.hiddenReason?.trim()) {
      setActionError("Hide action requires a reason.");
      return;
    }

    setEventActionBusyId(eventId);
    setActionError(null);
    setActionInfo(null);

    try {
      const response = await fetch("/api/moderation/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          eventId,
          action,
          note: payload?.note?.trim() || null,
          hiddenReason: payload?.hiddenReason?.trim() || null,
        }),
      });

      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; threadToken?: string | null; notificationWarning?: string | null }
        | null;
      if (!response.ok || !json?.ok) {
        setActionError(json?.error ?? "Failed to update event.");
        return;
      }

      setActionInfo(
        json?.threadToken
          ? `Event updated: ${action}. Host was notified in Messages.`
          : `Event updated: ${action}${json?.notificationWarning ? ` (${json.notificationWarning})` : ""}`
      );
      await refreshOverview();
    } catch (nextError: unknown) {
      setActionError(nextError instanceof Error ? nextError.message : "Failed to update event.");
    } finally {
      setEventActionBusyId(null);
    }
  }

  async function runEventsMaintenance(seedIfEmpty: boolean) {
    if (!accessToken) {
      setActionError("Missing auth session. Please sign in again.");
      return;
    }

    setEventsOpsBusy(true);
    setActionError(null);
    setActionInfo(null);

    try {
      const response = await fetch("/api/admin/events/maintenance", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          seedIfEmpty,
          archiveAfterDays: 0,
          deleteAfterDays: 30,
          keepArchiveDays: 30,
          batch: 1000,
        }),
      });

      const json = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            hint?: string;
            run?: {
              archivedCount: number;
              deletedCount: number;
              prunedArchiveCount: number;
              seededCount: number;
            };
          }
        | null;

      if (!response.ok || !json?.ok) {
        const hint = json?.hint ? ` ${json.hint}` : "";
        setActionError(`${json?.error ?? "Failed to run events maintenance."}${hint}`);
        return;
      }

      const run = json.run;
      setActionInfo(
        run
          ? `Events maintenance completed. Archived ${run.archivedCount}, deleted ${run.deletedCount}, pruned ${run.prunedArchiveCount}, seeded ${run.seededCount}.`
          : "Events maintenance completed."
      );
      await refreshOverview();
    } catch (nextError: unknown) {
      setActionError(nextError instanceof Error ? nextError.message : "Failed to run events maintenance.");
    } finally {
      setEventsOpsBusy(false);
    }
  }

  async function moderatePhoto(userId: string, action: PhotoModerateAction, message?: string) {
    if (!accessToken || !userId) return;

    if (action === "reject" && !message?.trim()) {
      setActionError("Rejecting a photo requires a note for the member.");
      return;
    }

    setPhotoActionBusyId(userId);
    setPhotoReviewBusy(action === "reject");
    setActionError(null);
    setActionInfo(null);

    try {
      const response = await fetch("/api/admin/photo-review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          userId,
          action,
          photoType: "profile",
          message: message?.trim() || "",
        }),
      });

      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; threadToken?: string | null; notificationWarning?: string | null }
        | null;
      if (!response.ok || !json?.ok) {
        setActionError(json?.error ?? "Failed to moderate photo.");
        return;
      }

      setActionInfo(
        action === "approve"
          ? `Profile photo approved${json?.threadToken ? ". Member notified in Messages." : json?.notificationWarning ? ` (${json.notificationWarning})` : "."}`
          : `Profile photo rejected${json?.threadToken ? ". Member notified in Messages." : json?.notificationWarning ? ` (${json.notificationWarning})` : "."}`
      );
      setPhotoReviewDialog({ open: false, userId: "", displayName: "", action: "reject" });
      setPhotoReviewMsg("");
      await refreshOverview();
    } catch (nextError: unknown) {
      setActionError(nextError instanceof Error ? nextError.message : "Failed to moderate photo.");
    } finally {
      setPhotoReviewBusy(false);
      setPhotoActionBusyId(null);
    }
  }

  function openPhotoReviewDialog(profile: AdminPhotoQueueItem, action: PhotoModerateAction) {
    setPhotoReviewDialog({
      open: true,
      userId: profile.userId,
      displayName: profile.displayName,
      action,
    });
    setPhotoReviewMsg("");
  }

  function openEventModerationDialog(eventId: string, action: EventModerateAction) {
    if (action === "reject_cover" || action === "hide" || action === "cancel") {
      setEventModerationDialog({ open: true, eventId, action });
      setEventModerationNote("");
      setEventModerationHideReason("");
      return;
    }
    void moderateEvent(eventId, action);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#081017] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="rounded-[30px] border border-white/10 bg-[#0d1720] p-6">
            <div className="h-5 w-32 animate-pulse rounded-full bg-white/10" />
            <div className="mt-4 h-10 w-72 animate-pulse rounded-full bg-white/10" />
            <div className="mt-3 h-4 w-96 animate-pulse rounded-full bg-white/10" />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="rounded-[24px] border border-white/10 bg-[#0d1720] p-4">
                <div className="h-3 w-20 animate-pulse rounded-full bg-white/10" />
                <div className="mt-4 h-8 w-24 animate-pulse rounded-full bg-white/10" />
                <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-white/10" />
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (isAdminDenied) {
    return (
      <div className="min-h-screen bg-[#081017] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[1080px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-[28px] border border-amber-300/30 bg-amber-500/10 p-6 text-amber-50">
            <h1 className="text-2xl font-semibold">Admin access required</h1>
            <p className="mt-2 text-sm text-amber-100/90">
              Your account is not in the <code className="rounded bg-black/25 px-2 py-1">admins</code> table.
            </p>
            {meId ? (
              <p className="mt-4 text-xs text-amber-100/70">
                Current user id: <code className="rounded bg-black/25 px-2 py-1">{meId}</code>
              </p>
            ) : null}
          </div>
        </main>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="min-h-screen bg-[#081017] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[1080px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-[28px] border border-rose-300/30 bg-rose-500/10 p-6 text-rose-50">
            <h1 className="text-2xl font-semibold">Could not load admin console</h1>
            <p className="mt-2 text-sm text-rose-100/90">{error ?? "Unknown error."}</p>
            <button
              type="button"
              onClick={() => {
                if (accessToken) void fetchOverview(accessToken);
              }}
              className="mt-4 rounded-full border border-white/20 bg-black/20 px-4 py-2 text-sm font-semibold text-white hover:bg-black/30"
            >
              Retry
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.08),transparent_20%),linear-gradient(180deg,#081017_0%,#09131c_100%)] text-slate-100">
      <Nav />

      <main className="mx-auto w-full max-w-[1440px] px-4 pb-14 pt-6 sm:px-6 lg:px-8">
        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}
        {actionError ? (
          <div className="mb-4 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {actionError}
          </div>
        ) : null}
        {actionInfo ? (
          <div className="mb-4 rounded-2xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
            {actionInfo}
          </div>
        ) : null}

        <section className="rounded-[32px] border border-white/10 bg-[#0d1720]/95 px-5 py-6 shadow-[0_30px_100px_rgba(0,0,0,0.35)] sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-300">Admin Console</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  if (accessToken) void fetchOverview(accessToken, true);
                }}
                className="rounded-full border border-white/15 bg-black/20 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-black/30"
              >
                {refreshing ? "Refreshing..." : "Refresh data"}
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-300">
              Updated {formatDateTime(overview.generatedAt)}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-300">
              Admin team {formatNumber(overview.stats.totalAdmins)}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-300">
              Profiles {formatNumber(overview.stats.totalProfiles)}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-300">
              Auth users {formatNumber(overview.stats.totalMembers)}
            </span>
          </div>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label="Members"
            value={formatNumber(overview.stats.totalMembers)}
            detail={`${formatNumber(overview.stats.newUsers30d)} joined in 30 days`}
            tone="cyan"
          />
          <KpiCard
            label="Verified"
            value={formatNumber(overview.stats.verifiedMembers)}
            detail={`${formatNumber(overview.stats.plusMembers)} active Plus members`}
            tone="emerald"
          />
          <KpiCard
            label="Active hosts"
            value={formatNumber(overview.stats.activeHosts)}
            detail="Profiles able to host"
            tone="slate"
          />
          <KpiCard
            label="Trust activity"
            value={formatNumber(overview.stats.references30d)}
            detail={`${formatNumber(overview.stats.events30d)} events · ${formatNumber(overview.stats.moderationActions30d)} mod actions`}
            tone="slate"
          />
          <KpiCard
            label="Pending requests"
            value={formatNumber(overview.stats.pendingRequests)}
            detail="Trip, hosting, service, event & reference"
            tone="amber"
            onClick={() => { setActiveTab("requests"); document.getElementById("admin-tabs")?.scrollIntoView({ behavior: "smooth" }); }}
          />
          <KpiCard
            label="Open reports"
            value={formatNumber(overview.stats.openReports)}
            detail={`${formatNumber(overview.stats.openReferenceClaims)} reference claims open`}
            tone="rose"
            onClick={() => { setActiveTab("moderation"); document.getElementById("admin-tabs")?.scrollIntoView({ behavior: "smooth" }); }}
          />
          <KpiCard
            label="Avatar reviews"
            value={formatNumber(overview.stats.pendingAvatarReviews)}
            detail="Pending avatar uploads"
            tone="amber"
            onClick={() => { setActiveTab("moderation"); document.getElementById("admin-tabs")?.scrollIntoView({ behavior: "smooth" }); }}
          />
          <KpiCard
            label="Pending event covers"
            value={formatNumber(overview.stats.pendingEventCovers)}
            detail={`${formatNumber(overview.stats.hiddenEvents)} hidden · ${formatNumber(overview.stats.upcomingEvents)} upcoming`}
            tone="cyan"
            onClick={() => { setActiveTab("moderation"); document.getElementById("admin-tabs")?.scrollIntoView({ behavior: "smooth" }); }}
          />
        </section>

        <div id="admin-tabs" className="mt-6 rounded-full border border-white/10 bg-[#0d1720]/90 p-1 shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
          <div className="flex flex-wrap gap-1">
            {TAB_OPTIONS.map((tab) => {
              const selected = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={cx(
                    "rounded-full px-4 py-2 text-sm font-semibold transition",
                    selected
                      ? "bg-emerald-300/18 text-emerald-100"
                      : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100"
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === "dashboard" ? (
          <section className="mt-6 space-y-5">
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.5fr_1fr]">
              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-3">
                <MiniTrendChart
                  title="Weekly signups"
                  hint={`New users. ${formatNumber(overview.stats.newUsers7d)} in the last 7 days.`}
                  series={overview.trends.signupsWeekly}
                  tone="cyan"
                />
                <MiniTrendChart
                  title="Weekly requests"
                  hint="All request surfaces combined."
                  series={overview.trends.requestsWeekly}
                  tone="emerald"
                />
                <MiniTrendChart
                  title="Weekly reports"
                  hint="Trust and moderation intake."
                  series={overview.trends.reportsWeekly}
                  tone="amber"
                />
              </div>

              <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
                <QueueHeader
                  title="Platform operations"
                  description="Feed health, retention state, and maintenance actions for old or empty event feeds."
                  actions={
                    <>
                      <button
                        type="button"
                        onClick={() => void runEventsMaintenance(false)}
                        disabled={eventsOpsBusy}
                        className="rounded-full border border-cyan-300/30 bg-cyan-300/12 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
                      >
                        {eventsOpsBusy ? "Running..." : "Archive old events"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void runEventsMaintenance(true)}
                        disabled={eventsOpsBusy}
                        className="rounded-full border border-emerald-300/30 bg-emerald-300/12 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/20 disabled:opacity-60"
                      >
                        {eventsOpsBusy ? "Running..." : "Archive + seed if empty"}
                      </button>
                    </>
                  }
                />

                <p className="-mt-1 mb-4 text-xs leading-5 text-slate-500">
                  <span className="font-semibold text-slate-400">Archive old events</span> removes expired events from the live feed and
                  refreshes retention state.
                  {" "}
                  <span className="font-semibold text-slate-400">Archive + seed if empty</span> does the same and adds sample upcoming
                  events only if the feed would otherwise be empty.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-center">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Upcoming events</p>
                    <p className="mt-2 text-2xl font-semibold text-white">
                      {formatNumber(overview.eventsHealth?.upcomingTotal ?? overview.stats.upcomingEvents)}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      Visible public {formatNumber(overview.eventsHealth?.upcomingPublicVisible ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-center">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Past in feed</p>
                    <p className="mt-2 text-2xl font-semibold text-white">
                      {formatNumber(overview.eventsHealth?.pastTotal ?? 0)}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      Archive rows {formatNumber(overview.eventsHealth?.archivedTotal ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-center">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Trust queue</p>
                    <p className="mt-2 text-2xl font-semibold text-white">
                      {formatNumber(
                        overview.stats.openReports +
                          overview.stats.openPrivacyRequests +
                          overview.stats.pendingAvatarReviews +
                          overview.stats.pendingEventCovers
                      )}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">Reports, privacy, avatars, and event covers</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-center">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Growth pulse</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{formatNumber(overview.stats.newUsers7d)}</p>
                    <p className="mt-2 text-xs text-slate-400">New users added this week</p>
                  </div>
                </div>

                {overview.eventsHealth ? (
                  <p className="mt-4 text-xs text-slate-500">
                    Snapshot generated {formatRelative(overview.eventsHealth.generatedAt)}
                  </p>
                ) : null}
              </article>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
                <QueueHeader
                  title="Request mix"
                  description="What people are asking for most across the app right now."
                />
                <DistributionList items={overview.distribution.requestsByType} emptyLabel="No request activity yet." />
              </article>

              <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
                <QueueHeader
                  title="Report contexts"
                  description="Which parts of the app generate the most moderation load."
                />
                <DistributionList items={overview.distribution.reportsByContext} emptyLabel="No reports received yet." />
              </article>

              <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
                <QueueHeader
                  title="Most reported members"
                  description="Members with the highest report volume in the recent moderation window."
                />
                <div className="space-y-3">
                  {overview.highlights.flaggedMembers.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-slate-500">
                      No flagged members in the recent window.
                    </div>
                  ) : (
                    overview.highlights.flaggedMembers.map((member) => (
                      <div key={member.userId} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                        <ProfileIdentity profile={member} fallback={member.userId} />
                        <span className="rounded-full border border-rose-300/30 bg-rose-300/12 px-3 py-1 text-xs font-semibold text-rose-100">
                          {member.reports} reports
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </article>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
                <QueueHeader
                  title="Needs attention now"
                  description="Live preview of the queues that usually need manual admin handling first."
                />

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-semibold text-white">Pending avatars</p>
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] text-slate-300">
                        {overview.queues.avatars.length}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {overview.queues.avatars.slice(0, 4).map((item) => (
                        <div key={item.userId} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                          <div className="h-12 w-12 overflow-hidden rounded-2xl border border-white/10 bg-[#14202b]">
                            {item.avatarUrl ? (
                              <img src={item.avatarUrl} alt={item.displayName} className="h-full w-full object-cover" />
                            ) : null}
                          </div>
                          <ProfileIdentity profile={item} fallback={item.userId} />
                        </div>
                      ))}
                      {overview.queues.avatars.length === 0 ? (
                        <p className="text-sm text-slate-500">No pending avatar reviews.</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-semibold text-white">Pending event covers</p>
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] text-slate-300">
                        {overview.queues.eventCovers.length}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {overview.queues.eventCovers.slice(0, 4).map((item) => (
                        <div key={item.eventId} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm font-semibold text-white">{item.title}</p>
                            <span className={cx("rounded-full border px-2 py-1 text-[11px] font-semibold", statusChipClass(item.coverStatus))}>
                              {item.coverStatus}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            {item.host?.displayName || "Host"} • {formatDate(item.startsAt)}
                          </p>
                        </div>
                      ))}
                      {overview.queues.eventCovers.length === 0 ? (
                        <p className="text-sm text-slate-500">No event cover queue.</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>

              <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
                <QueueHeader
                  title="Latest admin activity"
                  description="Recent moderation actions and operational moves across the app."
                />
                <div className="space-y-3">
                  {overview.queues.logs.slice(0, 8).map((log) => (
                    <div key={log.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-slate-200">
                          {log.action.replace(/_/g, " ")}
                        </span>
                        <span>{formatRelative(log.createdAt)}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">
                        {log.actor?.displayName || "Admin"}
                        {log.target ? ` → ${log.target.displayName}` : ""}
                        {log.reportId ? ` • report ${log.reportId.slice(0, 8)}` : ""}
                      </p>
                      {log.note ? <p className="mt-2 text-sm text-slate-400">{log.note}</p> : null}
                    </div>
                  ))}
                  {overview.queues.logs.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-slate-500">
                      No moderation logs yet.
                    </div>
                  ) : null}
                </div>
              </article>
            </div>
          </section>
        ) : null}

        {activeTab === "moderation" ? (
          <section className="mt-6">
            <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
              <QueueHeader
                title={`Moderation Profile Photo (${overview.queues.avatars.length})`}
                description="Approve clean photos or reject with a reason — rejection deletes the image from storage. Profiles with rejected photos are hidden from discovery."
              />
              <div className="mb-4">
                <input
                  type="text"
                  value={avatarSearch}
                  onChange={(e) => { setAvatarSearch(e.target.value); setAvatarPage(0); }}
                  placeholder="Search by name…"
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-300/30 focus:outline-none"
                />
              </div>
              {(() => {
                const term = avatarSearch.trim().toLowerCase();
                const filtered = term
                  ? overview.queues.avatars.filter((p) => p.displayName.toLowerCase().includes(term))
                  : overview.queues.avatars;
                if (filtered.length === 0) return (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-slate-500">
                    {term ? `No results for "${avatarSearch}".` : "No pending avatar reviews right now."}
                  </div>
                );
                const totalPages = Math.ceil(filtered.length / AVATAR_PAGE_SIZE);
                const paginated = filtered.slice(avatarPage * AVATAR_PAGE_SIZE, (avatarPage + 1) * AVATAR_PAGE_SIZE);
                return (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      {paginated.map((profile) => {
                        const busy = photoActionBusyId === profile.userId;
                        return (
                          <div key={profile.userId} className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
                            <div className="aspect-square w-full overflow-hidden bg-[#14202b]">
                              {profile.avatarUrl ? (
                                <img src={profile.avatarUrl} alt={profile.displayName} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-xs text-slate-600">No image</div>
                              )}
                            </div>
                            <div className="p-3">
                              <p className="truncate text-sm font-semibold text-white">{profile.displayName}</p>
                              <p className="truncate text-xs text-slate-500">
                                {[profile.city, profile.country].filter(Boolean).join(", ") || "—"}
                              </p>
                              {profile.uploadedAt ? (
                                <p className="mt-1 text-[10px] text-slate-600">Uploaded {formatDateTime(profile.uploadedAt)}</p>
                              ) : null}
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void moderatePhoto(profile.userId, "approve")}
                                  className="rounded-full border border-emerald-300/30 bg-emerald-300/12 px-2.5 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/20 disabled:opacity-60"
                                >
                                  {busy ? "…" : "Approve"}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => openPhotoReviewDialog(profile, "reject")}
                                  className="rounded-full border border-rose-300/30 bg-rose-300/12 px-2.5 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-300/20 disabled:opacity-60"
                                >
                                  {busy ? "…" : "Reject"}
                                </button>
                                <Link
                                  href={`/profile/${profile.userId}`}
                                  target="_blank"
                                  className="rounded-full border border-white/15 bg-black/20 px-2.5 py-1 text-xs font-semibold text-slate-400 hover:bg-black/30"
                                >
                                  View
                                </Link>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {totalPages > 1 ? (
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <span className="text-xs text-slate-500">
                          Page {avatarPage + 1} of {totalPages} · {filtered.length} total
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={avatarPage === 0}
                            onClick={() => setAvatarPage((p) => p - 1)}
                            className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-black/30 disabled:opacity-40"
                          >
                            ← Prev
                          </button>
                          <button
                            type="button"
                            disabled={avatarPage >= totalPages - 1}
                            onClick={() => setAvatarPage((p) => p + 1)}
                            className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-black/30 disabled:opacity-40"
                          >
                            Next →
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </article>
          </section>
        ) : null}

        {activeTab === "event-covers" ? (
          <section className="mt-6">
            <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
              <QueueHeader
                title={`Moderation Event Cover (${overview.queues.eventCovers.length})`}
                description="Approve event covers or reject with a reason. Rejection sends the organiser a message and the event stays as an incomplete draft until a new cover is uploaded."
              />
              <div className="mb-4">
                <input
                  type="text"
                  value={eventCoverSearch}
                  onChange={(e) => { setEventCoverSearch(e.target.value); setEventCoverPage(0); }}
                  placeholder="Search by event title…"
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-300/30 focus:outline-none"
                />
              </div>
              {(() => {
                const term = eventCoverSearch.trim().toLowerCase();
                const filtered = term
                  ? overview.queues.eventCovers.filter((e) => e.title.toLowerCase().includes(term))
                  : overview.queues.eventCovers;
                if (filtered.length === 0) return (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-slate-500">
                    {term ? `No results for "${eventCoverSearch}".` : "No pending event cover moderation."}
                  </div>
                );
                const totalPages = Math.ceil(filtered.length / EVENT_COVER_PAGE_SIZE);
                const paginated = filtered.slice(eventCoverPage * EVENT_COVER_PAGE_SIZE, (eventCoverPage + 1) * EVENT_COVER_PAGE_SIZE);
                return (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      {paginated.map((event) => {
                        const busy = eventActionBusyId === event.eventId;
                        return (
                          <div key={event.eventId} className="rounded-[24px] border border-white/10 bg-black/20 overflow-hidden">
                            <div className="aspect-video w-full overflow-hidden bg-[#14202b]">
                              {event.coverUrl ? (
                                <img src={event.coverUrl} alt={event.title} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-xs text-slate-500">No cover image</div>
                              )}
                            </div>
                            <div className="p-4">
                              <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                                <span className={cx("rounded-full border px-2 py-1 font-semibold", statusChipClass(event.coverStatus))}>
                                  cover {event.coverStatus}
                                </span>
                                <span className={cx("rounded-full border px-2 py-1 font-semibold", statusChipClass(event.status))}>
                                  {event.status}
                                </span>
                              </div>
                              <p className="mt-2 text-base font-semibold text-white">{event.title}</p>
                              <p className="mt-1 text-xs text-slate-400">
                                {event.host?.displayName || "Unknown"} · {[event.city, event.country].filter(Boolean).join(", ")} · {formatDate(event.startsAt)}
                              </p>
                              {event.coverReviewNote ? (
                                <p className="mt-2 text-xs text-amber-100">Note: {event.coverReviewNote}</p>
                              ) : null}
                              <div className="mt-3 flex flex-wrap gap-2">
                                {event.coverUrl && event.coverStatus !== "approved" ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => openEventModerationDialog(event.eventId, "approve_cover")}
                                    className="rounded-full border border-emerald-300/30 bg-emerald-300/12 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/20 disabled:opacity-60"
                                  >
                                    {busy ? "Saving..." : "Approve cover"}
                                  </button>
                                ) : null}
                                {event.coverUrl && event.coverStatus !== "rejected" ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => openEventModerationDialog(event.eventId, "reject_cover")}
                                    className="rounded-full border border-rose-300/30 bg-rose-300/12 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-300/20 disabled:opacity-60"
                                  >
                                    {busy ? "Saving..." : "Reject cover"}
                                  </button>
                                ) : null}
                                <Link
                                  href={`/events/${event.eventId}`}
                                  target="_blank"
                                  className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-black/30"
                                >
                                  View event
                                </Link>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {totalPages > 1 ? (
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <span className="text-xs text-slate-500">
                          Page {eventCoverPage + 1} of {totalPages} · {filtered.length} total
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={eventCoverPage === 0}
                            onClick={() => setEventCoverPage((p) => p - 1)}
                            className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-black/30 disabled:opacity-40"
                          >
                            ← Prev
                          </button>
                          <button
                            type="button"
                            disabled={eventCoverPage >= totalPages - 1}
                            onClick={() => setEventCoverPage((p) => p + 1)}
                            className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-black/30 disabled:opacity-40"
                          >
                            Next →
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </article>
          </section>
        ) : null}

        {activeTab === "privacy-claims" ? (
          <section className="mt-6 space-y-5">
            <div className="flex flex-col gap-3 rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Moderation filters</h2>
                <p className="mt-1 text-sm text-slate-400">Filter reports and claims by recent window, context, and status.</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {DATE_FILTERS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setDateFilter(option.key)}
                    className={cx(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold",
                      dateFilter === option.key
                        ? "border-emerald-300/30 bg-emerald-300/12 text-emerald-100"
                        : "border-white/10 bg-black/20 text-slate-400 hover:text-white"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <KpiCard
                label="Filtered reports"
                value={formatNumber(filteredReports.length)}
                detail={`${formatNumber(filteredReports.filter((item) => item.status === "open").length)} still open`}
                tone="rose"
              />
              <KpiCard
                label="Privacy cases"
                value={formatNumber(overview.queues.privacy.length)}
                detail="Open, under-review, or needs-info cases"
                tone="amber"
              />
            </div>

            <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
              <QueueHeader
                title="Privacy and data requests"
                description="Data access, deletion, and consent cases that still need admin handling."
              />
              <div className="space-y-3">
                {overview.queues.privacy.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-slate-500">
                    No open privacy cases.
                  </div>
                ) : (
                  overview.queues.privacy.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        <span className={cx("rounded-full border px-2 py-1 font-semibold", statusChipClass(item.status))}>
                          {item.status.replace(/_/g, " ")}
                        </span>
                        <span>{item.ticketCode}</span>
                        <span>{item.requestType.replace(/_/g, " ")}</span>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-white">{item.subject}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
                      <div className="mt-3 text-xs text-slate-500">
                        {item.requester?.displayName || item.requesterEmail || "Unknown requester"} • due {formatDate(item.dueAt)} •{" "}
                        {formatRelative(item.createdAt)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
              <QueueHeader
                title="Reports, claims, and disputes"
                description="Handle message reports, reference disputes, profile flags, and event reports from one queue."
                actions={
                  <>
                    <div className="flex flex-wrap gap-2">
                      {reportContextOptions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setReportContextFilter(option.key)}
                          className={cx(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold",
                            reportContextFilter === option.key
                              ? "border-cyan-300/30 bg-cyan-300/12 text-cyan-100"
                              : "border-white/10 bg-black/20 text-slate-400 hover:text-white"
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {([
                        { key: "all", label: "All statuses" },
                        { key: "open", label: "Open" },
                        { key: "resolved", label: "Resolved" },
                        { key: "dismissed", label: "Dismissed" },
                      ] as const).map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setReportStatusFilter(option.key)}
                          className={cx(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold",
                            reportStatusFilter === option.key
                              ? "border-emerald-300/30 bg-emerald-300/12 text-emerald-100"
                              : "border-white/10 bg-black/20 text-slate-400 hover:text-white"
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </>
                }
              />

              <div className="mb-5 grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Filtered context mix</p>
                  <div className="mt-4">
                    <DistributionList items={filteredReportDistribution} emptyLabel="No reports in this filter." />
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Queue summary</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-xs text-slate-500">Open</p>
                      <p className="mt-2 text-2xl font-semibold text-white">
                        {formatNumber(filteredReports.filter((item) => item.status === "open").length)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-xs text-slate-500">Reference claims</p>
                      <p className="mt-2 text-2xl font-semibold text-white">
                        {formatNumber(filteredReports.filter((item) => item.claimId).length)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-xs text-slate-500">Message / profile</p>
                      <p className="mt-2 text-2xl font-semibold text-white">
                        {formatNumber(
                          filteredReports.filter((item) => item.context.includes("message") || item.context.includes("profile")).length
                        )}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-xs text-slate-500">Event related</p>
                      <p className="mt-2 text-2xl font-semibold text-white">
                        {formatNumber(filteredReports.filter((item) => item.context.includes("event")).length)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {filteredReports.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-slate-500">
                    No reports match the current moderation filters.
                  </div>
                ) : (
                  filteredReports.map((report) => {
                    const busy = actionBusyReportId === report.id;
                    return (
                      <div key={report.id} className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          <span className={cx("rounded-full border px-2 py-1 font-semibold", statusChipClass(report.status))}>
                            {report.status}
                          </span>
                          <span>{formatReportContextLabel(report.context)}</span>
                          <span>{formatDateTime(report.createdAt)}</span>
                          {report.ticketCode ? (
                            <span className="rounded-full border border-cyan-300/30 bg-cyan-300/12 px-2 py-1 text-cyan-100">
                              {report.ticketCode}
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-white">{report.subject || report.reason}</p>
                            <p className="mt-2 text-sm text-slate-300">
                              Reporter: {report.reporter?.displayName || "Unknown"} • Target: {report.target?.displayName || "Unknown"}
                            </p>
                            {report.description ? (
                              <p className="mt-3 text-sm leading-6 text-slate-300">{report.description}</p>
                            ) : report.note ? (
                              <p className="mt-3 text-sm leading-6 text-slate-300">{report.note}</p>
                            ) : null}
                            {report.referenceExcerpt ? (
                              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Reported reference</p>
                                <p className="mt-2 text-sm italic leading-6 text-slate-300">
                                  &ldquo;{report.referenceExcerpt}&rdquo;
                                </p>
                              </div>
                            ) : null}
                            {report.evidenceLinks.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {report.evidenceLinks.map((url) => (
                                  <a
                                    key={url}
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-full border border-white/15 bg-black/20 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-black/30"
                                  >
                                    Evidence link
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </div>

                          <div className="w-full xl:max-w-[320px]">
                            <textarea
                              rows={3}
                              value={moderationNoteByReportId[report.id] ?? ""}
                              onChange={(event) =>
                                setModerationNoteByReportId((prev) => ({
                                  ...prev,
                                  [report.id]: event.target.value,
                                }))
                              }
                              placeholder="Optional reporter note"
                              className="w-full rounded-2xl border border-white/10 bg-[#101a24] px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                            />
                            <p className="mt-2 text-xs text-slate-500">
                              If you add a note, it is saved on the case and sent to the reporter in the admin Messages thread.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {report.status === "open" ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void moderateReport(report.id, "resolve")}
                                    className="rounded-full border border-emerald-300/30 bg-emerald-300/12 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/20 disabled:opacity-60"
                                  >
                                    {busy ? "Saving..." : "Resolve"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void moderateReport(report.id, "dismiss")}
                                    className="rounded-full border border-rose-300/30 bg-rose-300/12 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-300/20 disabled:opacity-60"
                                  >
                                    {busy ? "Saving..." : "Dismiss"}
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void moderateReport(report.id, "reopen")}
                                  className="rounded-full border border-cyan-300/30 bg-cyan-300/12 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
                                >
                                  {busy ? "Saving..." : "Reopen"}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </article>
          </section>
        ) : null}

        {activeTab === "requests" ? (
          <section className="mt-6 space-y-5">
            {/* Filters bar */}
            <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
              <div className="flex flex-wrap items-end gap-4">
                <input
                  type="search"
                  placeholder="Search name, event, trip..."
                  value={requestSearch}
                  onChange={(e) => { setRequestSearch(e.target.value); setRequestPage(0); }}
                  className="w-64 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  {DATE_FILTERS.map((option) => (
                    <button key={option.key} type="button" onClick={() => { setDateFilter(option.key); setRequestPage(0); }}
                      className={cx("rounded-full border px-3 py-1.5 text-xs font-semibold", dateFilter === option.key ? "border-emerald-300/30 bg-emerald-300/12 text-emerald-100" : "border-white/10 bg-black/20 text-slate-400 hover:text-white")}>
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {requestTypeOptions.map((option) => (
                    <button key={option.key} type="button" onClick={() => { setRequestTypeFilter(option.key); setRequestPage(0); }}
                      className={cx("rounded-full border px-3 py-1.5 text-xs font-semibold", requestTypeFilter === option.key ? "border-cyan-300/30 bg-cyan-300/12 text-cyan-100" : "border-white/10 bg-black/20 text-slate-400 hover:text-white")}>
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["all", "pending", "accepted", "declined"] as const).map((s) => (
                    <button key={s} type="button" onClick={() => { setRequestStatusFilter(s); setRequestPage(0); }}
                      className={cx("rounded-full border px-3 py-1.5 text-xs font-semibold capitalize", requestStatusFilter === s ? "border-amber-300/30 bg-amber-300/12 text-amber-100" : "border-white/10 bg-black/20 text-slate-400 hover:text-white")}>
                      {s === "all" ? "All statuses" : s}
                    </button>
                  ))}
                </div>
              </div>
            </article>

            {/* KPI row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              <KpiCard label="Pending" value={formatNumber(requestSummary.pending)} detail="Waiting on response" tone="amber" />
              <KpiCard label="Trip" value={formatNumber(requestSummary.trip)} detail="Travel join flows" tone="cyan" />
              <KpiCard label="Hosting" value={formatNumber(requestSummary.hosting)} detail="Stay requests" tone="emerald" />
              <KpiCard label="Service" value={formatNumber(requestSummary.service)} detail="Pro inquiries" tone="slate" />
              <KpiCard label="Event" value={formatNumber(requestSummary.events)} detail="Event access" tone="cyan" />
              <KpiCard label="References" value={formatNumber(requestSummary.references)} detail="Reference prompts" tone="amber" />
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
              {/* Left: mix + top cities */}
              <div className="space-y-5">
                <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
                  <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Request mix</p>
                  <DistributionList items={filteredRequestDistribution} emptyLabel="No requests for the current filter." />
                </article>
                <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
                  <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Top 5 cities</p>
                  {topCities.length === 0 ? (
                    <p className="text-sm text-slate-500">No city data.</p>
                  ) : (
                    <div className="space-y-2">
                      {topCities.map(([city, count]) => (
                        <button key={city} type="button"
                          onClick={() => { setRequestCityFilter(requestCityFilter === city ? "all" : city); setRequestPage(0); }}
                          className={cx("flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm transition",
                            requestCityFilter === city ? "border-cyan-300/30 bg-cyan-300/12 text-cyan-100" : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20")}>
                          <span>{city}</span>
                          <span className="text-xs text-slate-500">{count}</span>
                        </button>
                      ))}
                      {requestCityFilter !== "all" && (
                        <button type="button" onClick={() => setRequestCityFilter("all")}
                          className="mt-1 text-xs text-slate-500 hover:text-slate-300">
                          Clear city filter
                        </button>
                      )}
                    </div>
                  )}
                </article>
              </div>

              {/* Right: paginated inbox */}
              <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-white">Request inbox</p>
                    <p className="mt-0.5 text-xs text-slate-400">{filteredRequests.length} results</p>
                  </div>
                </div>
                {(() => {
                  const totalPages = Math.ceil(filteredRequests.length / REQUEST_PAGE_SIZE);
                  const paginated = filteredRequests.slice(requestPage * REQUEST_PAGE_SIZE, (requestPage + 1) * REQUEST_PAGE_SIZE);
                  return (
                    <>
                      <div className="space-y-3">
                        {paginated.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-slate-500">
                            No requests match the selected filters.
                          </div>
                        ) : paginated.map((item) => (
                          <div key={`${item.type}-${item.id}`} className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                              <span className={cx("rounded-full border px-2 py-1 font-semibold", requestTypeChipClass(item.type))}>
                                {formatRequestTypeChip(item.type)}
                              </span>
                              <span className={cx("rounded-full border px-2 py-1 font-semibold", statusChipClass(item.status))}>
                                {item.status.replace(/_/g, " ")}
                              </span>
                              {(item.requester?.city || item.target?.city) ? (
                                <span className="text-slate-600">{item.requester?.city || item.target?.city}</span>
                              ) : null}
                              <span>{formatDateTime(item.createdAt)}</span>
                            </div>
                            <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-white">{item.title}</p>
                                <p className="mt-1 text-sm text-slate-300">
                                  {item.requester?.displayName || "Unknown"} → {item.target?.displayName || "Unknown"}
                                </p>
                                <p className="mt-1 text-sm text-slate-400">{item.subtitle}</p>
                              </div>
                              <div className="shrink-0 text-right text-xs text-slate-500">
                                <p>{item.label}</p>
                                {item.meta ? <p className="mt-1">{item.meta}</p> : null}
                                <p className="mt-1">{formatRelative(item.createdAt)}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {totalPages > 1 ? (
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <span className="text-xs text-slate-500">Page {requestPage + 1} of {totalPages}</span>
                          <div className="flex gap-2">
                            <button type="button" disabled={requestPage === 0} onClick={() => setRequestPage((p) => p - 1)}
                              className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-black/30 disabled:opacity-40">
                              ← Prev
                            </button>
                            <button type="button" disabled={requestPage >= totalPages - 1} onClick={() => setRequestPage((p) => p + 1)}
                              className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-black/30 disabled:opacity-40">
                              Next →
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </article>
            </div>
          </section>
        ) : null}

        {activeTab === "members" ? (
          <section className="mt-6">
            <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
              <QueueHeader
                title="Member search"
                description="Search is query-on-demand — nothing loads until you hit Search. Results are capped at 60."
              />

              {/* Search + filters */}
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={memberQ}
                    onChange={(e) => setMemberQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void searchMembers(); }}
                    placeholder="Search by name…"
                    className="flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-300/30 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void searchMembers()}
                    disabled={memberSearchLoading}
                    className="rounded-full border border-emerald-300/30 bg-emerald-300/12 px-5 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-300/20 disabled:opacity-60"
                  >
                    {memberSearchLoading ? "Searching…" : "Search"}
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {/* Verified */}
                  {(["all", "yes", "no"] as const).map((v) => (
                    <button key={v} type="button"
                      onClick={() => setMemberVerifiedFilter(v)}
                      className={cx("rounded-full border px-3 py-1 text-xs font-semibold",
                        memberVerifiedFilter === v
                          ? "border-cyan-300/30 bg-cyan-300/12 text-cyan-100"
                          : "border-white/10 bg-black/20 text-slate-400 hover:text-white"
                      )}>
                      {v === "all" ? "All members" : v === "yes" ? "Verified only" : "Unverified only"}
                    </button>
                  ))}
                  {/* Role */}
                  <select
                    value={memberRoleFilter}
                    onChange={(e) => setMemberRoleFilter(e.target.value)}
                    className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-slate-300 focus:outline-none"
                  >
                    <option value="all">All roles</option>
                    {MEMBER_ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {/* City */}
                  <input
                    type="text"
                    value={memberCityQ}
                    onChange={(e) => setMemberCityQ(e.target.value)}
                    placeholder="City…"
                    className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-slate-300 placeholder:text-slate-600 focus:border-emerald-300/30 focus:outline-none w-28"
                  />
                  {/* Country */}
                  <input
                    type="text"
                    value={memberCountryQ}
                    onChange={(e) => setMemberCountryQ(e.target.value)}
                    placeholder="Country…"
                    className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-slate-300 placeholder:text-slate-600 focus:border-emerald-300/30 focus:outline-none w-28"
                  />
                  {/* Style */}
                  <select
                    value={memberStyleFilter}
                    onChange={(e) => { setMemberStyleFilter(e.target.value); setMemberLevelFilter("all"); }}
                    className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-slate-300 focus:outline-none"
                  >
                    <option value="all">All styles</option>
                    {DANCE_STYLES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </select>
                  {/* Level — only when style is set */}
                  {memberStyleFilter !== "all" ? (
                    <select
                      value={memberLevelFilter}
                      onChange={(e) => setMemberLevelFilter(e.target.value)}
                      className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-slate-300 focus:outline-none"
                    >
                      <option value="all">All levels</option>
                      {DANCE_LEVELS.map((l) => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}
                    </select>
                  ) : null}
                </div>
              </div>

              {/* Status / error */}
              {memberSearchError ? (
                <div className="mt-4 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {memberSearchError}
                </div>
              ) : null}
              {memberMsg ? (
                <div className="mt-4 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {memberMsg}
                </div>
              ) : null}

              {/* Results */}
              <div className="mt-5">
                {!memberSearchDone && !memberSearchLoading ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-slate-500">
                    Enter a name and press Search to find members.
                  </div>
                ) : memberSearchDone && memberResults.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-slate-500">
                    No members found for that search.
                  </div>
                ) : memberSearchDone ? (() => {
                  const memberTotalPages = Math.ceil(memberResults.length / MEMBER_PAGE_SIZE);
                  const memberPaged = memberResults.slice(memberPage * MEMBER_PAGE_SIZE, (memberPage + 1) * MEMBER_PAGE_SIZE);
                  return (
                  <>
                    <p className="mb-3 text-xs text-slate-500">{memberResults.length} member{memberResults.length !== 1 ? "s" : ""} found</p>
                    <div className="space-y-4">
                      {memberPaged.map((p) => {
                        const busy = memberBusyId === p.user_id;
                        const isMe = meId === p.user_id;
                        const locked = DISABLE_SELF_EDIT && isMe;
                        return (
                          <div key={p.user_id} className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                            {/* Header */}
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex min-w-0 items-center gap-3">
                                {p.avatar_url ? (
                                  <img src={p.avatar_url} alt={p.display_name} className="h-12 w-12 shrink-0 rounded-2xl object-cover border border-white/10" />
                                ) : (
                                  <div className="h-12 w-12 shrink-0 rounded-2xl bg-white/[0.05] border border-white/10" />
                                )}
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="truncate text-sm font-semibold text-white">{p.display_name}</span>
                                    {p.verified ? (
                                      <span className="rounded-full border border-cyan-300/30 bg-cyan-300/12 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">Verified</span>
                                    ) : null}
                                    {p.verified_label ? (
                                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] text-slate-400">{p.verified_label}</span>
                                    ) : null}
                                    {locked ? (
                                      <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-slate-500">You</span>
                                    ) : null}
                                    {p.avatar_status === "rejected" ? (
                                      <span className="rounded-full border border-rose-300/30 bg-rose-300/12 px-2 py-0.5 text-[10px] font-semibold text-rose-100">Photo rejected</span>
                                    ) : null}
                                  </div>
                                  <p className="mt-0.5 text-xs text-slate-500">
                                    {[p.city, p.country].filter(Boolean).join(", ") || "Location not set"}
                                  </p>
                                  <p className="mt-0.5 text-[10px] text-slate-600 truncate">{p.user_id}</p>
                                </div>
                              </div>

                              {/* Verify controls */}
                              <div className="flex shrink-0 flex-wrap items-center gap-2">
                                <input
                                  className="w-44 rounded-2xl border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-cyan-300/30 focus:outline-none disabled:opacity-50"
                                  placeholder="Verified label"
                                  defaultValue={p.verified_label ?? ""}
                                  disabled={!p.verified || busy || locked}
                                  onBlur={(e) => {
                                    const val = e.target.value.trim().slice(0, 40) || null;
                                    if (val !== p.verified_label) void updateMember(p.user_id, { verified_label: val });
                                  }}
                                />
                                {p.verified ? (
                                  <button type="button" disabled={busy || locked}
                                    onClick={() => void updateMember(p.user_id, { verified: false, verified_label: null })}
                                    className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-black/30 disabled:opacity-60">
                                    {busy ? "…" : "Remove badge"}
                                  </button>
                                ) : (
                                  <button type="button" disabled={busy || locked}
                                    onClick={() => void updateMember(p.user_id, { verified: true, verified_label: "Verified Member" })}
                                    className="rounded-full border border-cyan-300/30 bg-cyan-300/12 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60">
                                    {busy ? "…" : "Verify"}
                                  </button>
                                )}
                                <Link href={`/profile/${p.user_id}`} target="_blank"
                                  className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-black/30">
                                  View profile
                                </Link>
                              </div>
                            </div>

                            {/* Roles + Languages */}
                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">Roles</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {MEMBER_ROLE_OPTIONS.map((r) => {
                                    const active = p.roles.includes(r);
                                    return (
                                      <button key={r} type="button" disabled={busy || locked}
                                        onClick={() => void updateMember(p.user_id, { roles: memberToggleInArray(p.roles, r) })}
                                        className={cx("rounded-full border px-2.5 py-1 text-xs transition",
                                          active ? "border-emerald-300/30 bg-emerald-300/12 text-emerald-100" : "border-white/10 bg-black/20 text-slate-400 hover:text-white",
                                          (busy || locked) ? "opacity-60 cursor-not-allowed" : ""
                                        )}>
                                        {r}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">Languages</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {MEMBER_LANGUAGE_OPTIONS.map((l) => {
                                    const active = p.languages.includes(l);
                                    return (
                                      <button key={l} type="button" disabled={busy || locked}
                                        onClick={() => void updateMember(p.user_id, { languages: memberToggleInArray(p.languages, l) })}
                                        className={cx("rounded-full border px-2.5 py-1 text-xs transition",
                                          active ? "border-cyan-300/30 bg-cyan-300/12 text-cyan-100" : "border-white/10 bg-black/20 text-slate-400 hover:text-white",
                                          (busy || locked) ? "opacity-60 cursor-not-allowed" : ""
                                        )}>
                                        {l}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>

                            {/* Dance skills */}
                            <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                              <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">Dance skills</p>
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                                {DANCE_STYLES.map((style) => {
                                  const s = (p.dance_skills[style] ?? {}) as DanceSkill;
                                  const lvl = s.level ?? "";
                                  const verified = !!s.verified;
                                  return (
                                    <div key={style} className="rounded-xl border border-white/10 bg-black/20 p-2">
                                      <p className="mb-1.5 text-[10px] font-semibold capitalize text-slate-300">{style}</p>
                                      <select
                                        value={lvl}
                                        disabled={busy || locked}
                                        onChange={(e) => {
                                          const next: DanceSkills = { ...p.dance_skills, [style]: { ...s, level: e.target.value || undefined } };
                                          void updateMember(p.user_id, { dance_skills: next });
                                        }}
                                        className="w-full rounded-lg border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-white focus:outline-none disabled:opacity-50"
                                      >
                                        <option value="">—</option>
                                        {DANCE_LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
                                      </select>
                                      <label className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer">
                                        <input type="checkbox" checked={verified} disabled={busy || locked}
                                          onChange={(e) => {
                                            const next: DanceSkills = { ...p.dance_skills, [style]: { ...s, verified: e.target.checked } };
                                            void updateMember(p.user_id, { dance_skills: next });
                                          }}
                                          className="h-3 w-3" />
                                        Verified
                                      </label>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {memberTotalPages > 1 ? (
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <span className="text-xs text-slate-500">
                          Page {memberPage + 1} of {memberTotalPages} · {memberResults.length} total
                        </span>
                        <div className="flex gap-2">
                          <button type="button" disabled={memberPage === 0} onClick={() => setMemberPage((p) => p - 1)}
                            className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-black/30 disabled:opacity-40">
                            ← Prev
                          </button>
                          <button type="button" disabled={memberPage >= memberTotalPages - 1} onClick={() => setMemberPage((p) => p + 1)}
                            className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-black/30 disabled:opacity-40">
                            Next →
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                  );
                })() : null}
              </div>
            </article>
          </section>
        ) : null}

        {activeTab === "logs" ? (
          <section className="mt-6 space-y-5">
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
                <QueueHeader
                  title="Admin team"
                  description="Accounts currently listed in the admins table."
                />
                <div className="space-y-3">
                  {overview.highlights.adminTeam.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-slate-500">
                      No admin team rows found.
                    </div>
                  ) : (
                    overview.highlights.adminTeam.map((member) => (
                      <div key={member.userId} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                        <ProfileIdentity profile={member} fallback={member.userId} />
                      </div>
                    ))
                  )}
                </div>
              </article>

              <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
                <QueueHeader
                  title="Most reported members"
                  description="Useful for spotting repeat issues or accounts that may need closer monitoring."
                />
                <div className="space-y-3">
                  {overview.highlights.flaggedMembers.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-slate-500">
                      No flagged members in this window.
                    </div>
                  ) : (
                    overview.highlights.flaggedMembers.map((member) => (
                      <div key={member.userId} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                        <ProfileIdentity profile={member} fallback={member.userId} />
                        <span className="rounded-full border border-rose-300/30 bg-rose-300/12 px-3 py-1 text-xs font-semibold text-rose-100">
                          {member.reports} reports
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </article>
            </div>

            <article className="rounded-[28px] border border-white/10 bg-[#0d1720]/95 p-5">
              <QueueHeader
                title={`Moderation logs (${overview.queues.logs.length})`}
                description="Every admin action recorded through the current moderation flows."
              />
              {overview.queues.logs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-slate-500">
                  No moderation logs found.
                </div>
              ) : (() => {
                const totalLogPages = Math.ceil(overview.queues.logs.length / LOG_PAGE_SIZE);
                const paginatedLogs = overview.queues.logs.slice(logPage * LOG_PAGE_SIZE, (logPage + 1) * LOG_PAGE_SIZE);
                return (
                  <>
                    <div className="space-y-3">
                      {paginatedLogs.map((log) => (
                        <div key={log.id} className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                            <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-slate-200">
                              {log.action.replace(/_/g, " ")}
                            </span>
                            <span>{formatDateTime(log.createdAt)}</span>
                            <span>{formatRelative(log.createdAt)}</span>
                          </div>
                          <p className="mt-3 text-sm text-slate-300">
                            Actor: {log.actor?.displayName || "Admin"}
                            {log.target ? ` • Target: ${log.target.displayName}` : ""}
                            {log.reportId ? ` • Report ${log.reportId}` : ""}
                          </p>
                          {log.note ? <p className="mt-2 text-sm text-slate-400">{log.note}</p> : null}
                        </div>
                      ))}
                    </div>
                    {totalLogPages > 1 ? (
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <span className="text-xs text-slate-500">
                          Page {logPage + 1} of {totalLogPages} · {overview.queues.logs.length} total
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={logPage === 0}
                            onClick={() => setLogPage((p) => p - 1)}
                            className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-black/30 disabled:opacity-40"
                          >
                            ← Prev
                          </button>
                          <button
                            type="button"
                            disabled={logPage >= totalLogPages - 1}
                            onClick={() => setLogPage((p) => p + 1)}
                            className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-black/30 disabled:opacity-40"
                          >
                            Next →
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </article>
          </section>
        ) : null}
      </main>

      <ConfirmationDialog
        open={photoReviewDialog.open}
        title={
          photoReviewDialog.action === "approve"
            ? `Approve profile photo for ${photoReviewDialog.displayName || "member"}?`
            : `Reject profile photo for ${photoReviewDialog.displayName || "member"}?`
        }
        description={
          photoReviewDialog.action === "approve"
            ? "This marks the avatar as approved."
            : "Rejecting removes the current avatar and sends your note to the member in the admin Messages thread."
        }
        summary={
          photoReviewDialog.action === "reject" ? (
            <textarea
              rows={4}
              value={photoReviewMsg}
              onChange={(event) => setPhotoReviewMsg(event.target.value)}
              placeholder="Explain what needs to change in the photo."
              className="w-full rounded-2xl border border-white/10 bg-[#101a24] px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-rose-300/35 focus:outline-none"
            />
          ) : null
        }
        confirmLabel={photoReviewDialog.action === "approve" ? "Approve photo" : "Reject photo"}
        confirmVariant={photoReviewDialog.action === "approve" ? "primary" : "danger"}
        busy={photoReviewBusy}
        onCancel={() => {
          setPhotoReviewDialog({ open: false, userId: "", displayName: "", action: "reject" });
          setPhotoReviewMsg("");
        }}
        onConfirm={() =>
          void moderatePhoto(
            photoReviewDialog.userId,
            photoReviewDialog.action,
            photoReviewDialog.action === "reject" ? photoReviewMsg : undefined
          )
        }
      />

      <ConfirmationDialog
        open={eventModerationDialog.open}
        title={
          eventModerationDialog.action === "hide"
            ? "Hide this event?"
            : eventModerationDialog.action === "reject_cover"
              ? "Reject this event cover?"
              : "Cancel this event?"
        }
        description={
          eventModerationDialog.action === "hide"
            ? "Hidden events leave discover until an admin unhides them. The host receives the reason in Messages."
            : eventModerationDialog.action === "reject_cover"
              ? "You can add a cover note for the host. It will be delivered in Messages."
              : "Cancelled events can be published again later if needed. The host will be notified."
        }
        summary={
          <div className="space-y-3">
            {eventModerationDialog.action === "hide" ? (
              <input
                value={eventModerationHideReason}
                onChange={(event) => setEventModerationHideReason(event.target.value)}
                placeholder="Hide reason (required)"
                className="w-full rounded-2xl border border-white/10 bg-[#101a24] px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-rose-300/35 focus:outline-none"
              />
            ) : null}
            <textarea
              rows={4}
              value={eventModerationNote}
              onChange={(event) => setEventModerationNote(event.target.value)}
              placeholder={eventModerationDialog.action === "cancel" ? "Optional host note" : "Optional host note"}
              className="w-full rounded-2xl border border-white/10 bg-[#101a24] px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
            />
          </div>
        }
        confirmVariant="danger"
        confirmLabel={
          eventModerationDialog.action === "hide"
            ? "Hide event"
            : eventModerationDialog.action === "reject_cover"
              ? "Reject cover"
              : "Cancel event"
        }
        busy={Boolean(eventActionBusyId && eventActionBusyId === eventModerationDialog.eventId)}
        onCancel={() => {
          setEventModerationDialog({ open: false, eventId: "", action: "hide" });
          setEventModerationNote("");
          setEventModerationHideReason("");
        }}
        onConfirm={() => {
          const eventId = eventModerationDialog.eventId;
          const action = eventModerationDialog.action;
          if (!eventId) return;
          if (action === "hide" && !eventModerationHideReason.trim()) {
            setActionError("Hide action requires a reason.");
            return;
          }
          setEventModerationDialog({ open: false, eventId: "", action: "hide" });
          void moderateEvent(eventId, action, {
            note: eventModerationNote.trim() || undefined,
            hiddenReason: action === "hide" ? eventModerationHideReason.trim() : undefined,
          });
          setEventModerationNote("");
          setEventModerationHideReason("");
        }}
      />
    </div>
  );
}
