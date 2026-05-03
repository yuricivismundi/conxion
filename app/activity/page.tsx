"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import MyEventsPage from "@/app/events/my/page";
import TripsPage from "@/app/trips/page";
import ActivityLimitPill from "@/components/activity/ActivityLimitPill";
import {
  mapEventMemberRows,
  mapEventRows,
  type EventMemberRecord,
  type EventRecord,
} from "@/lib/events/model";
import { mapGroupMemberRows, mapGroupRows, type GroupMemberRecord, type GroupRecord } from "@/lib/groups/model";
import { formatSleepingArrangement, normalizeHostingSleepingArrangement } from "@/lib/hosting/preferences";
import { getBillingAccountState } from "@/lib/billing/account-state";
import { getPlanLimits } from "@/lib/billing/limits";
import { supabase } from "@/lib/supabase/client";
import { travelIntentReasonLabel } from "@/lib/trips/join-reasons";
import { cx } from "@/lib/cx";

type ActivityTab = "events" | "trips" | "groups" | "hosting";
type GroupFilter = "all" | "admin" | "member";
type HostingStatusFilter = "current" | "past" | "all";
type HostingSentView = "request_hosting" | "offer_hosting";

type HostingRequestRow = {
  id?: string;
  sender_user_id?: string | null;
  recipient_user_id?: string | null;
  request_type?: string | null;
  trip_id?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
  departure_flexible?: boolean | null;
  travellers_count?: number | null;
  max_travellers_allowed?: number | null;
  reason?: string | null;
  message?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ActivityHostingRow = {
  id?: string;
  thread_id?: string | null;
  requester_id?: string | null;
  recipient_id?: string | null;
  activity_type?: string | null;
  status?: string | null;
  title?: string | null;
  note?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type HostingRequestItem = {
  id: string;
  sourceKind: "hosting_request" | "activity";
  threadId: string | null;
  senderUserId: string;
  recipientUserId: string;
  requestType: "request_hosting" | "offer_to_host";
  tripId: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
  departureFlexible: boolean;
  travellersCount: number | null;
  maxTravellersAllowed: number | null;
  reason: string;
  message: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type LiteProfile = {
  userId: string;
  displayName: string;
  city: string;
  country: string;
  avatarUrl: string | null;
};

type TripSummary = {
  id: string;
  destinationCity: string;
  destinationCountry: string;
};

const ACTIVITY_TABS: Array<{ key: ActivityTab; label: string; icon: string }> = [
  { key: "events", label: "Events", icon: "calendar_month" },
  { key: "groups", label: "Groups", icon: "groups" },
  { key: "trips", label: "Trips", icon: "travel_explore" },
  { key: "hosting", label: "Hosting", icon: "bed" },
];

const HOSTING_SENT_VIEWS: Array<{ key: HostingSentView; label: string }> = [
  { key: "request_hosting", label: "Request Hosting" },
  { key: "offer_hosting", label: "Offer Hosting" },
];

function normalizeActivityTab(value: string | null): ActivityTab {
  if (value === "trips" || value === "groups" || value === "hosting") return value;
  return "events";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "TBD";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
  }
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
}

function mapHostingRequests(rows: HostingRequestRow[]): HostingRequestItem[] {
  return rows.flatMap((row) => {
      const id = row.id ?? "";
      const senderUserId = row.sender_user_id ?? "";
      const recipientUserId = row.recipient_user_id ?? "";
      const requestType = row.request_type === "offer_to_host" ? "offer_to_host" : "request_hosting";
      if (!id || !senderUserId || !recipientUserId) return [];
      return [{
        id,
        sourceKind: "hosting_request",
        threadId: null,
        senderUserId,
        recipientUserId,
        requestType,
        tripId: row.trip_id ?? null,
        arrivalDate: row.arrival_date ?? null,
        departureDate: row.departure_date ?? null,
        departureFlexible: row.departure_flexible === true,
        travellersCount: typeof row.travellers_count === "number" ? row.travellers_count : null,
        maxTravellersAllowed: typeof row.max_travellers_allowed === "number" ? row.max_travellers_allowed : null,
        reason: row.reason ?? "",
        message: row.message ?? "",
        status: row.status ?? "pending",
        createdAt: row.created_at ?? null,
        updatedAt: row.updated_at ?? null,
      } satisfies HostingRequestItem];
    });
}

function mapActivityHostingRows(rows: ActivityHostingRow[]): HostingRequestItem[] {
  return rows.flatMap((row) => {
      const id = row.id ?? "";
      const senderUserId = row.requester_id ?? "";
      const recipientUserId = row.recipient_id ?? "";
      const activityType = typeof row.activity_type === "string" ? row.activity_type : "";
      const requestType = activityType === "offer_hosting" ? "offer_to_host" : activityType === "request_hosting" ? "request_hosting" : null;
      if (!id || !senderUserId || !recipientUserId || !requestType) return [];
      return [{
        id,
        sourceKind: "activity",
        threadId: row.thread_id ?? null,
        senderUserId,
        recipientUserId,
        requestType,
        tripId: null,
        arrivalDate: row.start_at ?? null,
        departureDate: row.end_at ?? null,
        departureFlexible: false,
        travellersCount: null,
        maxTravellersAllowed: null,
        reason: typeof row.metadata?.reason === "string" ? row.metadata.reason : row.title ?? "",
        message: row.note ?? "",
        status: row.status ?? "pending",
        createdAt: row.created_at ?? null,
        updatedAt: row.updated_at ?? null,
      } satisfies HostingRequestItem];
    });
}

function profileName(profile: LiteProfile | undefined) {
  return profile?.displayName || "Member";
}

function profileLocation(profile: LiteProfile | undefined) {
  return [profile?.city, profile?.country].filter(Boolean).join(", ");
}

function formatRelativeTime(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const diffMs = Date.now() - parsed.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed);
}

function isThisMonth(value: string | null | undefined) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  return parsed.getUTCFullYear() === now.getUTCFullYear() && parsed.getUTCMonth() === now.getUTCMonth();
}

function ActivityPageSkeleton() {
  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <Nav />
      <main className="flex flex-1 justify-center px-4 py-5 sm:px-6 md:py-6 lg:px-12 xl:px-20">
        <div className="flex w-full max-w-[1200px] flex-col gap-5">
          <section className="border-b border-white/[0.07] pb-0">
            <div className="flex flex-col gap-5 pb-5 md:flex-row md:items-center md:justify-between">
              <div className="h-9 w-52 animate-pulse rounded-2xl bg-white/[0.08]" />
              <div className="h-10 w-36 animate-pulse rounded-full bg-[linear-gradient(90deg,rgba(0,245,255,0.35),rgba(255,0,255,0.35))]" />
            </div>
            <div className="flex items-end gap-6 overflow-x-auto no-scrollbar">
              {ACTIVITY_TABS.map((tab, index) => (
                <div key={`activity-shell-tab-${tab.key}`} className="flex min-h-[44px] shrink-0 items-center border-b-2 border-transparent pb-3">
                  <div className={cx("h-4 animate-pulse rounded-full bg-white/[0.08]", index === 0 ? "w-16" : "w-20")} />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-7">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <div className="h-10 w-32 animate-pulse rounded-full bg-white/[0.06]" />
              <div className="h-10 w-full animate-pulse rounded-full bg-white/[0.06] sm:max-w-[320px]" />
            </div>
            {["Created", "Joining", "Pending", "Drafts"].map((section) => (
              <div key={`activity-skeleton-${section}`} className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-28 animate-pulse rounded-xl bg-white/[0.08]" />
                  <div className="h-6 w-10 animate-pulse rounded-full bg-white/[0.06]" />
                </div>
                <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={`activity-skeleton-card-${section}-${index}`} className="w-[286px] shrink-0 overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#121212] sm:w-[304px]">
                      <div className="h-[108px] animate-pulse bg-white/[0.06]" />
                      <div className="space-y-3 p-3">
                        <div className="h-5 w-4/5 animate-pulse rounded bg-white/[0.08]" />
                        <div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                        <div className="h-4 w-5/6 animate-pulse rounded bg-white/[0.06]" />
                        <div className="mt-5 flex gap-2 border-t border-white/10 pt-3">
                          <div className="h-10 flex-1 animate-pulse rounded-xl bg-white/[0.06]" />
                          <div className="h-10 flex-1 animate-pulse rounded-xl bg-white/[0.06]" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}

function ActivityPageContent() {
  const searchParams = useSearchParams();
  const activeTab = normalizeActivityTab(searchParams.get("tab"));
  const [canCreateAction, setCanCreateAction] = useState<boolean | null>(null);
  const [eventsSearch, setEventsSearch] = useState("");

  const primaryAction =
    activeTab === "trips"
      ? { href: "/activity?tab=trips&create=trip", icon: "add", label: "Create trip" }
      : activeTab === "groups"
        ? { href: "/groups/new", icon: "add", label: "Create group" }
      : activeTab === "hosting"
          ? null
          : { href: "/events/new", icon: "add", label: "Create event" };

  // Reset when tab changes so the button isn't locked prematurely
  const prevTab = useRef(activeTab);
  if (prevTab.current !== activeTab) {
    prevTab.current = activeTab;
    setCanCreateAction(null);
  }

  const isLocked = canCreateAction === false;

  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <Nav />
      <main className="flex flex-1 justify-center px-4 py-5 sm:px-6 md:py-6 lg:px-12 xl:px-20">
        <div className="flex w-full max-w-[1200px] flex-col gap-5">
          <section className="border-b border-white/[0.07] pb-0">
            <div className="flex flex-col gap-5 pb-5 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <h1 className="font-['Epilogue'] text-2xl font-extrabold tracking-tight text-white md:text-3xl">
                  My Activities
                </h1>
              </div>

              {primaryAction ? <div className="flex flex-wrap items-center gap-2">
                {isLocked ? (
                  <div className="group relative inline-flex">
                    <span
                      className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-black text-white/35 bg-white/10"
                    >
                      <span className="material-symbols-outlined text-[18px]">lock</span>
                      {primaryAction.label}
                    </span>
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-[200] mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#1a1a2e] border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                      Upgrade to Plus to create more
                    </span>
                  </div>
                ) : (
                  <Link
                    href={primaryAction.href}
                    className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-black text-[#071116] transition hover:opacity-90"
                    style={{ backgroundImage: "linear-gradient(90deg,#00F5FF 0%,#FF00FF 100%)" }}
                  >
                    <span className="material-symbols-outlined text-[18px]">{primaryAction.icon}</span>
                    {primaryAction.label}
                  </Link>
                )}
              </div> : null}
            </div>

            <div className="flex items-center gap-4">
              <div className="no-scrollbar flex flex-1 items-end gap-6 overflow-x-auto">
                {ACTIVITY_TABS.map((tab) => {
                  const selected = activeTab === tab.key;
                  return (
                    <Link
                      key={tab.key}
                      href={tab.key === "events" ? "/activity" : `/activity?tab=${tab.key}`}
                      className={cx(
                        "flex min-h-[44px] shrink-0 items-center gap-1.5 border-b-2 pb-3 text-[11px] font-bold uppercase tracking-widest transition-colors",
                        selected
                          ? "border-[#25d1f4] text-white"
                          : "border-transparent text-white/35 hover:text-white/60"
                      )}
                    >
                      <span>{tab.label}</span>
                    </Link>
                  );
                })}
              </div>
              {activeTab === "events" ? (
                <label className="group relative mb-1 shrink-0">
                  <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-white/35 transition-colors group-focus-within:text-cyan-300">search</span>
                  <input
                    type="text"
                    value={eventsSearch}
                    onChange={(e) => setEventsSearch(e.target.value)}
                    placeholder="Search events…"
                    className="h-9 w-72 rounded-full border border-white/10 bg-white/[0.05] pl-8 pr-3 text-[13px] text-white/90 outline-none placeholder:text-white/30 focus:border-[#00F5FF]/50"
                  />
                </label>
              ) : null}
            </div>
          </section>

          {activeTab === "events" ? <MyEventsPage onCanCreate={setCanCreateAction} searchQuery={eventsSearch} /> : null}
          {activeTab === "trips" ? <TripsPage onCanCreate={setCanCreateAction} /> : null}
          {activeTab === "groups" ? <GroupsPanel onCanCreate={setCanCreateAction} /> : null}
          {activeTab === "hosting" ? <HostingPanel /> : null}
        </div>
      </main>
    </div>
  );
}

function GroupsPanel({ onCanCreate }: { onCanCreate?: (can: boolean) => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [memberships, setMemberships] = useState<GroupMemberRecord[]>([]);
  const [groupQuery, setGroupQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [groupLimit, setGroupLimit] = useState<number | null>(5);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      router.replace("/auth?next=/activity?tab=groups");
      return;
    }

    const userId = authData.user.id;
    const billingState = getBillingAccountState({ userMetadata: authData.user.user_metadata });
    setMeId(userId);
    setGroupLimit(getPlanLimits(billingState.currentPlanId).privateGroupsPerMonth);

    // Fetch all group_members rows for this user to find which groups they belong to
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const [membershipsRes, hostedGroupsRes] = await Promise.all([
      db
        .from("group_members")
        .select("*")
        .eq("user_id", userId)
        .limit(300),
      db
        .from("groups")
        .select("*")
        .eq("host_user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(300),
    ]);

    if (membershipsRes.error) {
      setError(membershipsRes.error.message ?? "Could not load groups.");
      setLoading(false);
      return;
    }

    if (hostedGroupsRes.error) {
      setError((hostedGroupsRes.error as { message?: string }).message ?? "Could not load groups.");
      setLoading(false);
      return;
    }

    const memberRows = mapGroupMemberRows((membershipsRes.data ?? []) as unknown[]);
    const hostedGroups = mapGroupRows((hostedGroupsRes.data ?? []) as unknown[]).filter((group) => group.status !== "archived");
    const groupIds = [
      ...new Set([...memberRows.map((member) => member.groupId), ...hostedGroups.map((group) => group.id)].filter(Boolean)),
    ];

    let allGroups: GroupRecord[] = [];
    if (groupIds.length > 0) {
      const groupsRes = await db
        .from("groups")
        .select("*")
        .in("id", groupIds.slice(0, 300))
        .order("updated_at", { ascending: false });
      if (groupsRes.error) {
        setError((groupsRes.error as { message?: string }).message ?? "Could not load groups.");
        setLoading(false);
        return;
      }
      const groupsById = new Map<string, GroupRecord>();
      mapGroupRows((groupsRes.data ?? []) as unknown[])
        .filter((group) => group.status !== "archived")
        .forEach((group) => {
          groupsById.set(group.id, group);
        });
      hostedGroups.forEach((group) => {
        groupsById.set(group.id, group);
      });
      allGroups = Array.from(groupsById.values()).sort((left, right) => {
        const leftUpdated = left.updatedAt || left.createdAt || "";
        const rightUpdated = right.updatedAt || right.createdAt || "";
        return new Date(rightUpdated).getTime() - new Date(leftUpdated).getTime();
      });
    }

    // Fetch all members for the groups we belong to (for member counts)
    let allMemberships: GroupMemberRecord[] = memberRows;
    if (groupIds.length > 0) {
      const allMembersRes = await db
        .from("group_members")
        .select("*")
        .in("group_id", groupIds.slice(0, 300))
        .limit(2000);
      if (!allMembersRes.error) {
        allMemberships = mapGroupMemberRows((allMembersRes.data ?? []) as unknown[]);
      }
    }

    setGroups(allGroups);
    setMemberships(allMemberships);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    const frame = window.setTimeout(() => {
      void loadGroups();
    }, 0);
    return () => {
      window.clearTimeout(frame);
    };
  }, [loadGroups]);

  const memberCountByGroup = useMemo(() => {
    const map: Record<string, number> = {};
    memberships.forEach((member) => {
      map[member.groupId] = (map[member.groupId] ?? 0) + 1;
    });
    return map;
  }, [memberships]);

  const filteredGroups = useMemo(() => {
    const queryText = groupQuery.trim().toLowerCase();
    return groups.filter((group) => {
      const isHost = group.hostUserId === meId;
      if (groupFilter === "admin" && !isHost) return false;
      if (groupFilter === "member" && isHost) return false;
      if (!queryText) return true;
      return [group.title, group.city, group.country, group.chatMode].filter(Boolean).join(" ").toLowerCase().includes(queryText);
    });
  }, [groupFilter, groupQuery, groups, meId]);
  const activeGroupSlotsUsed = groups.length;
  const canCreateGroup = groupLimit === null || activeGroupSlotsUsed < groupLimit;
  useEffect(() => { onCanCreate?.(canCreateGroup); }, [canCreateGroup, onCanCreate]);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={`activity-group-sk-${index}`} className="h-44 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>;
  }

  return (
    <section className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {canCreateGroup ? (
          <Link
            href="/groups/new"
            className="inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#6ee7f9,#d946ef)] px-5 py-2.5 text-sm font-bold text-[#06121a] shadow-[0_4px_16px_rgba(217,70,239,0.25)] transition hover:brightness-110 shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Create Group
          </Link>
        ) : (
          <div className="group relative inline-flex shrink-0">
            <span className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-white/10 px-5 py-2.5 text-sm font-bold text-white/35">
              <span className="material-symbols-outlined text-[18px]">lock</span>
              Create Group
            </span>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-[200] mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#1a1a2e] border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              Leave a group or upgrade to Plus for more group slots
            </span>
          </div>
        )}
        <ActivityLimitPill
          label="Groups"
          current={activeGroupSlotsUsed}
          limit={groupLimit}
          compact
          upgradeHint="Leave a group or upgrade to Plus to have more group slots."
        />
        <div className="flex flex-1 gap-2 sm:justify-end">
          <label className="group relative flex-1 sm:max-w-[260px]">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-white/35 transition-colors group-focus-within:text-cyan-300">search</span>
            <input
              type="text"
              value={groupQuery}
              onChange={(e) => setGroupQuery(e.target.value)}
              placeholder="Search groups..."
              className="h-9 w-full rounded-full border border-white/10 bg-white/[0.05] pl-9 pr-3 text-[13px] text-white/90 outline-none placeholder:text-white/35 transition focus:border-[#00F5FF]/50"
            />
          </label>
          <div className="relative">
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter((e.target.value as GroupFilter) || "all")}
              className="h-9 appearance-none rounded-full border border-white/10 bg-white/[0.05] pl-3 pr-8 text-[13px] font-semibold text-white/90 outline-none focus:border-[#00F5FF]/50"
            >
              <option value="all">All</option>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
            <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-white/35">expand_more</span>
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-white/12 bg-white/[0.03] p-10 text-center">
          <span className="material-symbols-outlined text-5xl text-white/20">groups</span>
          <h3 className="mt-3 text-xl font-bold text-white">No groups yet</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-white/50">
            Create a private group or ask someone to share their invite link.
          </p>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-white/12 bg-white/[0.03] p-8 text-center">
          <span className="material-symbols-outlined text-5xl text-white/20">search_off</span>
          <h3 className="mt-3 text-xl font-bold text-white">No groups match</h3>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0d1117]">
          {filteredGroups.map((group, idx) => {
            const isHost = group.hostUserId === meId;
            const memberCount = Math.max(memberCountByGroup[group.id] ?? 0, isHost ? 1 : 0);
            const location = [group.city, group.country].filter(Boolean).join(", ");
            return (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className={`flex items-center gap-4 px-4 py-4 transition hover:bg-white/[0.04] ${idx !== 0 ? "border-t border-white/[0.06]" : ""}`}
              >
                {/* Thumbnail */}
                {group.coverUrl ? (
                  <img src={group.coverUrl} alt={group.title} className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,rgba(0,245,255,0.15),rgba(217,70,239,0.15))] text-cyan-300">
                    <span className="material-symbols-outlined text-[22px]">groups</span>
                  </span>
                )}

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-white">{group.title}</p>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-white/40">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">person</span>
                      {memberCount}/{group.maxMembers} members
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">forum</span>
                      {group.chatMode === "discussion" ? "Open discussion" : "Broadcast"}
                    </span>
                  </div>
                </div>

                {/* Last activity + arrow */}
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[11px] text-white/30">{formatRelativeTime(group.updatedAt)}</span>
                  <span className="material-symbols-outlined text-[20px] text-white/20">chevron_right</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function HostingPanel() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [requests, setRequests] = useState<HostingRequestItem[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, LiteProfile>>({});
  const [tripsById, setTripsById] = useState<Record<string, TripSummary>>({});
  const [hostingStatusFilter, setHostingStatusFilter] = useState<HostingStatusFilter>("current");
  const [hostingCityQuery, setHostingCityQuery] = useState("");
  const [sentHostingView, setSentHostingView] = useState<HostingSentView>("request_hosting");
  const [hostingRequestsLimit, setHostingRequestsLimit] = useState<number | null>(10);
  const [hostingOffersLimit, setHostingOffersLimit] = useState<number | null>(5);

  const loadHosting = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      router.replace("/auth?next=/activity?tab=hosting");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = authData.user.id;
    const billingState = getBillingAccountState({ userMetadata: authData.user.user_metadata });
    const limits = getPlanLimits(billingState.currentPlanId);
    setMeId(userId);
    setAccessToken(sessionData.session?.access_token ?? null);
    setHostingRequestsLimit(limits.hostingRequestsPerMonth);
    setHostingOffersLimit(limits.hostingOffersPerMonth);

    const [hostingRes, activityRes] = await Promise.all([
      supabase
        .from("hosting_requests")
        .select("id,sender_user_id,recipient_user_id,request_type,trip_id,arrival_date,departure_date,departure_flexible,travellers_count,max_travellers_allowed,reason,message,status,created_at,updated_at")
        .or(`sender_user_id.eq.${userId},recipient_user_id.eq.${userId}`)
        .order("updated_at", { ascending: false })
        .limit(200),
      supabase
        .from("activities")
        .select("id,thread_id,requester_id,recipient_id,activity_type,status,title,note,start_at,end_at,metadata,created_at,updated_at")
        .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
        .in("activity_type", ["request_hosting", "offer_hosting"])
        .order("updated_at", { ascending: false })
        .limit(200),
    ]);

    if (hostingRes.error || activityRes.error) {
      setError(hostingRes.error?.message ?? activityRes.error?.message ?? "Could not load hosting activity.");
      setLoading(false);
      return;
    }

    const mapped = [
      ...mapHostingRequests((hostingRes.data ?? []) as HostingRequestRow[]),
      ...mapActivityHostingRows((activityRes.data ?? []) as ActivityHostingRow[]),
    ].sort((left, right) => new Date(right.updatedAt ?? right.createdAt ?? 0).getTime() - new Date(left.updatedAt ?? left.createdAt ?? 0).getTime());
    const profileIds = Array.from(new Set(mapped.flatMap((request) => [request.senderUserId, request.recipientUserId])));
    const tripIds = Array.from(new Set(mapped.map((request) => request.tripId).filter((value): value is string => Boolean(value))));

    if (profileIds.length > 0) {
      const profilesRes = await supabase
        .from("profiles")
        .select("user_id,display_name,city,country,avatar_url")
        .in("user_id", profileIds.slice(0, 400));
      if (!profilesRes.error) {
        const nextProfiles: Record<string, LiteProfile> = {};
        ((profilesRes.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
          const userIdValue = typeof row.user_id === "string" ? row.user_id : "";
          if (!userIdValue) return;
          nextProfiles[userIdValue] = {
            userId: userIdValue,
            displayName: typeof row.display_name === "string" && row.display_name.trim() ? row.display_name : "Member",
            city: typeof row.city === "string" ? row.city : "",
            country: typeof row.country === "string" ? row.country : "",
            avatarUrl: typeof row.avatar_url === "string" && row.avatar_url.trim() ? row.avatar_url : null,
          };
        });
        setProfilesById(nextProfiles);
      }
    } else {
      setProfilesById({});
    }

    if (tripIds.length > 0) {
      const tripsRes = await supabase
        .from("trips")
        .select("id,destination_city,destination_country")
        .in("id", tripIds.slice(0, 400));
      if (!tripsRes.error) {
        const nextTrips: Record<string, TripSummary> = {};
        ((tripsRes.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
          const id = typeof row.id === "string" ? row.id : "";
          if (!id) return;
          nextTrips[id] = {
            id,
            destinationCity: typeof row.destination_city === "string" ? row.destination_city : "",
            destinationCountry: typeof row.destination_country === "string" ? row.destination_country : "",
          };
        });
        setTripsById(nextTrips);
      }
    } else {
      setTripsById({});
    }

    setRequests(mapped);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    const frame = window.setTimeout(() => {
      void loadHosting();
    }, 0);
    return () => {
      window.clearTimeout(frame);
    };
  }, [loadHosting]);

  async function cancelHostingRequest(request: HostingRequestItem, note: string) {
    if (!accessToken) { setError("Missing auth session."); return; }
    setBusyRequestId(request.id);
    setError(null);
    setInfo(null);
    const response = await fetch(
      `/api/hosting/requests/${encodeURIComponent(request.id)}/cancel`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ note }),
      }
    );
    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !json?.ok) {
      setBusyRequestId(null);
      setError(json?.error ?? "Failed to cancel hosting request.");
      return;
    }
    setInfo("Hosting request cancelled.");
    await loadHosting();
    setBusyRequestId(null);
  }

  async function respondToHostingRequest(request: HostingRequestItem, action: "accepted" | "declined") {
    if (!accessToken) {
      setError("Missing auth session. Please sign in again.");
      return;
    }
    setBusyRequestId(request.id);
    setError(null);
    setInfo(null);

    const response = await fetch(
      request.sourceKind === "activity"
        ? `/api/activities/${encodeURIComponent(request.id)}`
        : `/api/hosting/requests/${encodeURIComponent(request.id)}/respond`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: request.sourceKind === "activity" ? (action === "accepted" ? "accept" : "decline") : action,
        }),
      }
    );
    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !json?.ok) {
      setBusyRequestId(null);
      setError(json?.error ?? "Failed to update hosting request.");
      return;
    }

    setInfo(action === "accepted" ? "Hosting request accepted." : "Hosting request declined.");
    await loadHosting();
    setBusyRequestId(null);
  }

  const filteredRequests = useMemo(() => {
    const queryText = hostingCityQuery.trim().toLowerCase();
    return requests.filter((request) => {
      const status = request.status.toLowerCase();
      const isCurrent = status === "pending" || status === "accepted";
      if (hostingStatusFilter === "current" && !isCurrent) return false;
      if (hostingStatusFilter === "past" && isCurrent) return false;
      if (!queryText) return true;
      const senderProfile = profilesById[request.senderUserId];
      const recipientProfile = profilesById[request.recipientUserId];
      const trip = request.tripId ? tripsById[request.tripId] : null;
      return [
        senderProfile?.city,
        senderProfile?.country,
        recipientProfile?.city,
        recipientProfile?.country,
        trip?.destinationCity,
        trip?.destinationCountry,
      ].filter(Boolean).join(" ").toLowerCase().includes(queryText);
    });
  }, [hostingCityQuery, hostingStatusFilter, profilesById, requests, tripsById]);

  const incoming = filteredRequests.filter((request) => request.recipientUserId === meId);
  const sentRequestHosting = filteredRequests.filter((request) => request.senderUserId === meId && request.requestType === "request_hosting");
  const sentOfferHosting = filteredRequests.filter((request) => request.senderUserId === meId && request.requestType === "offer_to_host");
  const selectedSentHostingRequests = sentHostingView === "request_hosting" ? sentRequestHosting : sentOfferHosting;
  const selectedSentHostingLimit = sentHostingView === "request_hosting" ? hostingRequestsLimit : hostingOffersLimit;
  const sentHostingRequestsThisMonth = useMemo(
    () => requests.filter((request) => request.senderUserId === meId && request.requestType === "request_hosting" && isThisMonth(request.createdAt)).length,
    [meId, requests]
  );
  const sentHostingOffersThisMonth = useMemo(
    () => requests.filter((request) => request.senderUserId === meId && request.requestType === "offer_to_host" && isThisMonth(request.createdAt)).length,
    [meId, requests]
  );
  const selectedSentHostingUsage = sentHostingView === "request_hosting" ? sentHostingRequestsThisMonth : sentHostingOffersThisMonth;

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={`activity-hosting-sk-${index}`} className="h-32 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
        ))}
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-end">
        <label className="group relative w-full lg:max-w-[260px]">
          <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-white/35 transition-colors group-focus-within:text-cyan-300">
            location_on
          </span>
          <input
            type="text"
            value={hostingCityQuery}
            onChange={(event) => setHostingCityQuery(event.target.value)}
            placeholder="City or country..."
            className="h-10 w-full rounded-full border border-white/10 bg-white/[0.05] pl-9 pr-3 text-[13px] text-white/90 outline-none placeholder:text-white/35 transition focus:border-[#00F5FF]/50 focus:ring-1 focus:ring-[#00F5FF]/25"
          />
        </label>
        <div className="relative w-full lg:w-[150px]">
          <select
            value={hostingStatusFilter}
            onChange={(event) => setHostingStatusFilter((event.target.value as HostingStatusFilter) || "current")}
            className="h-10 w-full appearance-none rounded-full border border-white/10 bg-white/[0.05] px-4 pr-9 text-[13px] font-semibold text-white/90 outline-none focus:border-[#00F5FF]/50 focus:ring-1 focus:ring-[#00F5FF]/25"
          >
            <option value="current">Current</option>
            <option value="past">Past</option>
            <option value="all">All</option>
          </select>
          <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-white/35">
            expand_more
          </span>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}
      {info ? <div className="rounded-2xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">{info}</div> : null}

      {requests.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-white/12 bg-white/[0.03] p-8 text-center">
          <span className="material-symbols-outlined text-5xl text-white/20">bed</span>
          <h3 className="mt-3 text-xl font-bold text-white">No hosting activity yet</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-white/55">
            Hosting requests and host offers will appear here once you send or receive them.
          </p>
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-white/12 bg-white/[0.03] p-8 text-center">
          <span className="material-symbols-outlined text-5xl text-white/20">search_off</span>
          <h3 className="mt-3 text-xl font-bold text-white">No hosting matches</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-white/55">Try another status or city.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <HostingRequestList
            title="Incoming - Hosting Requests"
            emptyText="No incoming hosting requests or offers."
            meId={meId}
            requests={incoming}
            profilesById={profilesById}
            tripsById={tripsById}
            busyRequestId={busyRequestId}
            onRespond={respondToHostingRequest}
            onCancel={cancelHostingRequest}
          />
          <section className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black text-white">Sent</h3>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white/55">
                  {sentRequestHosting.length + sentOfferHosting.length}
                </span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {selectedSentHostingLimit !== null ? (
                  <ActivityLimitPill
                    label={sentHostingView === "request_hosting" ? "Request hosting" : "Offer hosting"}
                    current={selectedSentHostingUsage}
                    limit={selectedSentHostingLimit}
                    compact
                    upgradeHint={
                      sentHostingView === "request_hosting"
                        ? "Upgrade to Plus to send more Request Hosting messages this month."
                        : "Upgrade to Plus to send more Offer Hosting messages this month."
                    }
                  />
                ) : null}
                <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1 sm:pb-0">
                  {HOSTING_SENT_VIEWS.map((view) => {
                    const selected = sentHostingView === view.key;
                    const count = view.key === "request_hosting" ? sentRequestHosting.length : sentOfferHosting.length;
                    return (
                      <button
                        key={view.key}
                        type="button"
                        onClick={() => setSentHostingView(view.key)}
                        className={cx(
                          "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-[11px] font-black uppercase tracking-[0.12em] transition",
                          selected
                            ? "border-[#00F5FF]/45 bg-[#00F5FF]/14 text-cyan-50"
                            : "border-white/10 bg-white/[0.04] text-white/45 hover:text-white/75"
                        )}
                      >
                        {view.label}
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-white/65">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <HostingRequestList
              title={sentHostingView === "request_hosting" ? "Request Hosting" : "Offer Hosting"}
              emptyText={sentHostingView === "request_hosting" ? "No sent hosting requests." : "No sent host offers."}
              meId={meId}
              requests={selectedSentHostingRequests}
              profilesById={profilesById}
              tripsById={tripsById}
              busyRequestId={busyRequestId}
              onRespond={respondToHostingRequest}
              onCancel={cancelHostingRequest}
            />
          </section>
        </div>
      )}
    </section>
  );
}

const HOSTING_PAGE_SIZE = 6;

function HostingRequestList({
  title,
  emptyText,
  meId,
  requests,
  profilesById,
  tripsById,
  busyRequestId,
  onRespond,
  onCancel,
}: {
  title: string;
  emptyText: string;
  meId: string | null;
  requests: HostingRequestItem[];
  profilesById: Record<string, LiteProfile>;
  tripsById: Record<string, TripSummary>;
  busyRequestId: string | null;
  onRespond: (request: HostingRequestItem, action: "accepted" | "declined") => void;
  onCancel: (request: HostingRequestItem, note: string) => void;
}) {
  const [page, setPage] = useState(0);
  const [cancelTarget, setCancelTarget] = useState<HostingRequestItem | null>(null);
  const [cancelNote, setCancelNote] = useState("");

  const totalPages = Math.ceil(requests.length / HOSTING_PAGE_SIZE);
  const pageRequests = requests.slice(page * HOSTING_PAGE_SIZE, (page + 1) * HOSTING_PAGE_SIZE);

  function handleCancelSubmit() {
    if (!cancelTarget || !cancelNote.trim()) return;
    onCancel(cancelTarget, cancelNote.trim());
    setCancelTarget(null);
    setCancelNote("");
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-black text-white">{title}</h3>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white/55">
          {requests.length}
        </span>
      </div>

      {requests.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-white/50">{emptyText}</div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {pageRequests.map((request) => {
              const isIncoming = request.recipientUserId === meId;
              const otherProfile = profilesById[isIncoming ? request.senderUserId : request.recipientUserId];
              const trip = request.tripId ? tripsById[request.tripId] : null;
              const status = request.status.toLowerCase();
              const canRespond = isIncoming && status === "pending";
              const rawReason = request.reason.trim();
              const reasonLabel = rawReason
                ? request.sourceKind === "activity"
                  ? rawReason
                  : request.requestType === "offer_to_host"
                  ? formatSleepingArrangement(normalizeHostingSleepingArrangement(request.reason))
                  : travelIntentReasonLabel(request.reason)
                : "Not specified";

              // Can cancel an accepted request only before the arrival date
              const canCancel = status === "accepted" && (() => {
                if (!request.arrivalDate) return true;
                return Date.now() < new Date(`${request.arrivalDate}T00:00:00.000Z`).getTime();
              })();

              return (
                <article
                  key={request.id}
                  className="connections-card relative flex min-h-[246px] flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#121212] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(13,242,242,0.14),0_16px_42px_rgba(0,245,255,0.06)]"
                >
                  <div className="flex min-h-0 flex-1">
                    <div className="relative w-[38%] shrink-0 border-r border-white/10 bg-white/5">
                      {otherProfile?.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={otherProfile.avatarUrl} alt={profileName(otherProfile)} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,rgba(0,245,255,0.12),rgba(255,0,255,0.08))] text-3xl font-black text-white/70">
                          {profileName(otherProfile).slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#121212]/35" />
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col justify-between p-3">
                      <div className="min-w-0 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#00F5FF]">
                              {request.requestType === "offer_to_host" ? "Offer Hosting" : "Request Hosting"}
                            </p>
                            <h4 className="mt-1 truncate text-[18px] font-semibold tracking-tight text-white">
                              {isIncoming ? profileName(otherProfile) : `To ${profileName(otherProfile)}`}
                            </h4>
                            {profileLocation(otherProfile) ? (
                              <p className="mt-1 truncate text-[13px] font-medium text-white/55">{profileLocation(otherProfile)}</p>
                            ) : null}
                          </div>
                          {status !== "accepted" ? (
                            <span className={cx(
                              "rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wide",
                              status === "declined"
                                ? "border-rose-300/35 bg-rose-500/10 text-rose-100"
                                : status === "cancelled"
                                  ? "border-white/15 bg-white/[0.04] text-white/45"
                                  : "border-fuchsia-300/35 bg-fuchsia-400/10 text-fuchsia-100"
                            )}>
                              {status}
                            </span>
                          ) : null}
                        </div>

                        <div className="space-y-1.5 text-[12px] text-white/62">
                          <p className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[15px] text-[#00F5FF]">calendar_month</span>
                            <span className="truncate">{formatDate(request.arrivalDate)} - {request.departureFlexible ? "Flexible" : formatDate(request.departureDate)}</span>
                          </p>
                          <p className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[15px] text-[#00F5FF]">
                              {request.requestType === "offer_to_host" ? "chair" : "travel_explore"}
                            </span>
                            <span className="truncate">{reasonLabel || "Not specified"}</span>
                          </p>
                          {trip ? (
                            <p className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[15px] text-[#00F5FF]">flight</span>
                              <span className="truncate">{[trip.destinationCity, trip.destinationCountry].filter(Boolean).join(", ")}</span>
                            </p>
                          ) : null}
                        </div>

                        {request.message ? <p className="line-clamp-2 text-[12px] leading-5 text-white/55">{request.message}</p> : null}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-t border-white/10 p-3">
                    <Link
                      href={request.threadId ? `/messages?thread=${encodeURIComponent(request.threadId)}` : "/messages?tab=requests"}
                      className="inline-flex min-h-10 items-center justify-center gap-1 rounded-full px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#071116]"
                      style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#ff00ff)" }}
                    >
                      <span className="material-symbols-outlined text-[18px]">chat</span>
                      Message
                    </Link>
                    {canRespond ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onRespond(request, "declined")}
                          disabled={busyRequestId === request.id}
                          className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55 hover:bg-white/8 disabled:opacity-60"
                        >
                          Decline
                        </button>
                        <button
                          type="button"
                          onClick={() => onRespond(request, "accepted")}
                          disabled={busyRequestId === request.id}
                          className="inline-flex min-h-10 items-center justify-center rounded-full px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#071116] disabled:opacity-60"
                          style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#ff00ff)" }}
                        >
                          {busyRequestId === request.id ? "Saving..." : "Accept"}
                        </button>
                      </>
                    ) : canCancel ? (
                      <>
                        <span className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
                          {status}
                        </span>
                        <button
                          type="button"
                          onClick={() => { setCancelTarget(request); setCancelNote(""); }}
                          disabled={busyRequestId === request.id}
                          className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55 hover:bg-white/8 disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <span className="col-span-2 inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
                        {status}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/55 hover:text-white disabled:opacity-30"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
              <span className="text-xs text-white/45">
                {page + 1} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/55 hover:text-white disabled:opacity-30"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
            </div>
          ) : null}
        </>
      )}

      {/* Cancel modal */}
      {cancelTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/12 bg-[#0f1419] p-5 shadow-2xl">
            <h3 className="text-base font-bold text-white">Cancel hosting request</h3>
            <p className="mt-1 text-sm text-white/55">
              Please provide a reason. This will be visible to the other person.
            </p>
            <textarea
              rows={3}
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value.slice(0, 200))}
              placeholder="Reason for cancellation (required)"
              className="mt-3 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-amber-300/40 focus:outline-none"
            />
            <p className="mt-1 text-right text-[10px] text-white/35">
              {cancelNote.length}/200
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => { setCancelTarget(null); setCancelNote(""); }}
                className="flex-1 rounded-xl border border-white/10 py-2 text-sm text-white/55 hover:text-white"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={handleCancelSubmit}
                disabled={!cancelNote.trim() || busyRequestId === cancelTarget.id}
                className="flex-1 rounded-xl border border-amber-300/35 bg-amber-500/15 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/25 disabled:opacity-40"
              >
                {busyRequestId === cancelTarget.id ? "Cancelling…" : "Confirm cancel"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<ActivityPageSkeleton />}>
      <ActivityPageContent />
    </Suspense>
  );
}
