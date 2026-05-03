"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const CreateEventModal = dynamic(() => import("@/components/events/CreateEventModal"), { ssr: false });
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import ActivityLimitPill from "@/components/activity/ActivityLimitPill";
import EventHeroImage from "@/components/events/EventHeroImage";
import { getBillingAccountState } from "@/lib/billing/account-state";
import { getPlanLimits } from "@/lib/billing/limits";
import {
  formatEventRange,
  mapEventMemberRows,
  mapEventRequestRows,
  mapEventRows,
  mapProfileRows,
  pickEventFallbackHeroUrl,
  pickEventHeroUrl,
  type EventMemberRecord,
  type EventRequestRecord,
  type EventRecord,
  type LiteProfile,
} from "@/lib/events/model";
import { eventAccessTypeShortLabel } from "@/lib/events/access";
import { supabase } from "@/lib/supabase/client";

type MyEventsFilter = "all" | "created" | "drafts" | "joining" | "interested" | "pending" | "past";
type MyEventRelation = "created" | "joining" | "interested" | "pending" | null;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function eventDateBadgeParts(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { weekday: "--", month: "--", day: "--" };
  return {
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(parsed),
    month: new Intl.DateTimeFormat("en-US", { month: "short" }).format(parsed).toUpperCase(),
    day: new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(parsed),
  };
}

function formatShortDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function relationLabel(relation: MyEventRelation, membership: EventMemberRecord | null | undefined) {
  if (relation === "created") return "Created";
  if (relation === "pending") return "Pending request";
  if (relation === "joining") return membership?.status === "waitlist" ? "Waitlist" : "Joining";
  if (relation === "interested") return "Interested";
  return "Related";
}

function filterLabel(filter: MyEventsFilter) {
  if (filter === "all") return "All";
  if (filter === "created") return "Created";
  if (filter === "drafts") return "Drafts";
  if (filter === "joining") return "Joining";
  if (filter === "interested") return "Interested";
  if (filter === "pending") return "Pending request";
  return "Past";
}

function relationForEvent(
  event: EventRecord,
  meId: string | null,
  membership: EventMemberRecord | null | undefined,
  request: EventRequestRecord | null | undefined
): MyEventRelation {
  if (meId && event.hostUserId === meId) return "created";
  if (request?.status === "pending") return "pending";
  if (membership?.status === "going" || membership?.status === "waitlist") return "joining";
  if (membership?.status === "interested") return "interested";
  return null;
}

function matchesFilter(
  filter: MyEventsFilter,
  event: EventRecord,
  relation: MyEventRelation,
  nowMs: number
) {
  const isPast = new Date(event.endsAt).getTime() < nowMs;
  if (filter === "all") return true;
  if (filter === "created") return relation === "created";
  if (filter === "drafts") return relation === "created" && event.status === "draft";
  if (filter === "joining") return relation === "joining";
  if (filter === "interested") return relation === "interested";
  if (filter === "pending") return relation === "pending";
  return isPast;
}

function sortEvents(a: EventRecord, b: EventRecord, filter: MyEventsFilter, nowMs: number) {
  if (filter === "drafts") {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  }

  if (filter === "past") {
    return new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime();
  }

  const aDraft = a.status === "draft";
  const bDraft = b.status === "draft";
  if (aDraft !== bDraft) return aDraft ? -1 : 1;

  const aPast = new Date(a.endsAt).getTime() < nowMs;
  const bPast = new Date(b.endsAt).getTime() < nowMs;
  if (aPast !== bPast) return aPast ? 1 : -1;

  if (aPast && bPast) {
    return new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime();
  }

  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}

function isThisUtcMonth(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  return parsed.getUTCFullYear() === now.getUTCFullYear() && parsed.getUTCMonth() === now.getUTCMonth();
}

function isCreatedThisMonthEvent(event: EventRecord, meId: string | null) {
  return Boolean(meId) && event.hostUserId === meId && event.status !== "draft" && isThisUtcMonth(event.createdAt);
}

function EventRelationshipCard({
  event,
  host,
  meId,
  nowMs,
  className,
  onDeleteRequest,
  onEditRequest,
}: {
  event: EventRecord;
  host: LiteProfile | null;
  meId: string | null;
  nowMs: number;
  className?: string;
  onDeleteRequest?: (event: EventRecord) => void;
  onEditRequest?: (eventId: string) => void;
}) {
  const isHost = Boolean(meId && event.hostUserId === meId);
  const isPast = new Date(event.endsAt).getTime() < nowMs;
  const hero = isHost && event.coverUrl ? event.coverUrl : pickEventHeroUrl(event);
  const fallbackHero = pickEventFallbackHeroUrl(event);
  const badge = eventDateBadgeParts(event.startsAt);
  const isEditableDraft = isHost && event.status === "draft";
  const primaryHref = isEditableDraft ? `/events/new?edit=${encodeURIComponent(event.id)}&returnTo=${encodeURIComponent("/events/my")}` : `/events/${event.id}`;

  return (
    <article className={cx("relative flex flex-col overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#121212] shadow-[0_6px_20px_rgba(0,0,0,0.3)] transition hover:-translate-y-0.5 hover:border-cyan-300/30 cursor-pointer", className)} style={{ height: "280px" }} onClick={(e) => { if ((e.target as HTMLElement).closest("a,button")) return; window.location.href = primaryHref; }}>
      <div className="relative h-[108px] overflow-hidden bg-[#0d141a]">
        <EventHeroImage
          key={`${hero ?? ""}|${fallbackHero ?? ""}`}
          primarySrc={hero}
          fallbackSrc={fallbackHero}
          alt={event.title}
          className="h-full w-full object-cover transition duration-700 hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-transparent to-transparent" />

      </div>

      <div className="relative flex flex-1 flex-col p-2">
        <div className="pointer-events-none absolute right-3 top-2">
          <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/14 px-2 py-1 text-center shadow-[0_8px_20px_rgba(34,211,238,0.12)]">
            <p className="text-[10px] font-semibold tracking-wide text-cyan-100">{badge.weekday}</p>
            <p className="text-[10px] font-semibold tracking-wide text-cyan-100">{badge.month}</p>
            <p className="text-[20px] font-extrabold leading-none text-white">{badge.day}</p>
          </div>
        </div>

        <div className="pr-[92px]">
          <Link href={primaryHref} className="block">
            <h2 className="line-clamp-2 min-h-[42px] text-[17px] font-bold leading-tight text-white">{event.title}</h2>
          </Link>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/30">{event.eventType}</p>
          <p className="mt-1 text-[12px] font-semibold text-cyan-200/90">{formatEventRange(event.startsAt, event.endsAt)}</p>
          <p className="mt-1 truncate text-[12px] text-slate-400">{[event.venueName, event.city, event.country].filter(Boolean).join(", ")}</p>
          {!isHost && host ? (
            <p className="mt-1 truncate text-[12px] text-slate-500">Hosted by {host.displayName}</p>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {isPast ? (
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-white/70">
              Past
            </span>
          ) : null}
        </div>

        {isHost ? (
          <div className="mt-auto flex gap-2 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => onEditRequest ? onEditRequest(event.id) : (window.location.href = `/events/new?edit=${encodeURIComponent(event.id)}&returnTo=${encodeURIComponent("/events/my")}`)}
              className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-300/16 px-4 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/24"
            >
              <span className="material-symbols-outlined text-[18px]">{event.status === "draft" ? "edit" : "tune"}</span>
              {event.status === "draft" ? "Continue editing" : "Edit"}
            </button>
            {onDeleteRequest ? (
              <button
                type="button"
                onClick={() => onDeleteRequest(event)}
                className="inline-flex min-h-[40px] w-10 shrink-0 items-center justify-center rounded-xl border border-red-400/20 bg-red-400/[0.07] text-red-400 transition hover:bg-red-400/15"
                title="Delete event"
              >
                <span className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function MyEventsPage({ onCanCreate, searchQuery: externalQuery }: { onCanCreate?: (can: boolean) => void; searchQuery?: string } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const embeddedInActivity = pathname?.startsWith("/activity") ?? false;
  const [nowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [actionBusyRequestId, setActionBusyRequestId] = useState<string | null>(null);
  const [editEventId, setEditEventId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventRecord | null>(null);
  const [deletebusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [createdEventLimit, setCreatedEventLimit] = useState<number | null>(2);
  const [myTab, setMyTab] = useState<"events" | "groups">("events");
  const [internalQuery, setQuery] = useState("");
  const query = externalQuery !== undefined ? externalQuery : internalQuery;
  const [activeFilter, setActiveFilter] = useState<MyEventsFilter>("all");
  const [activityJoinView, setActivityJoinView] = useState<"joining" | "interested">("joining");
  const [activityDraftView, setActivityDraftView] = useState<"drafts" | "past">("drafts");
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [memberships, setMemberships] = useState<EventMemberRecord[]>([]);
  const [requests, setRequests] = useState<EventRequestRecord[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<EventRequestRecord[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, LiteProfile>>({});

  const loadData = useCallback(async () => {
      setLoading(true);
      setError(null);
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData.user) {
        router.replace(embeddedInActivity ? "/auth?next=/activity" : "/auth?next=/events/my");
        return;
      }

      const userId = authData.user.id;
      const billingState = getBillingAccountState({ userMetadata: authData.user.user_metadata });
      const { data: sessionData } = await supabase.auth.getSession();
      setMeId(userId);
      setAccessToken(sessionData.session?.access_token ?? null);
      setCreatedEventLimit(getPlanLimits(billingState.currentPlanId).eventsPerMonth);

      const [hostedRes, membershipsRes, requestsRes] = await Promise.all([
        supabase.from("events").select("*").eq("host_user_id", userId).order("updated_at", { ascending: false }).limit(300),
        supabase
          .from("event_members")
          .select("*")
          .eq("user_id", userId)
          .in("status", ["going", "waitlist", "interested"])
          .limit(400),
        supabase
          .from("event_requests")
          .select("*")
          .eq("requester_id", userId)
          .eq("status", "pending")
          .limit(300),
      ]);

      if (hostedRes.error || membershipsRes.error || requestsRes.error) {
        setError(hostedRes.error?.message ?? membershipsRes.error?.message ?? requestsRes.error?.message ?? "Could not load your events.");
        setLoading(false);
        return;
      }

      const hostedEvents = mapEventRows((hostedRes.data ?? []) as unknown[]);
      const membershipRows = mapEventMemberRows((membershipsRes.data ?? []) as unknown[]);
      const requestRows = mapEventRequestRows((requestsRes.data ?? []) as unknown[]);
      let incomingRequestRows: EventRequestRecord[] = [];

      if (hostedEvents.length > 0) {
        const incomingRequestsRes = await supabase
          .from("event_requests")
          .select("*")
          .in("event_id", hostedEvents.map((event) => event.id).slice(0, 300))
          .in("status", ["pending", "accepted"])
          .order("updated_at", { ascending: false })
          .limit(400);

        if (incomingRequestsRes.error) {
          setError(incomingRequestsRes.error.message);
          setLoading(false);
          return;
        }

        incomingRequestRows = mapEventRequestRows((incomingRequestsRes.data ?? []) as unknown[]);
      }

      const hostedIds = new Set(hostedEvents.map((event) => event.id));
      const relatedIds = Array.from(
        new Set([
          ...membershipRows.map((membership) => membership.eventId),
          ...requestRows.map((request) => request.eventId),
        ])
      ).filter((eventId) => !hostedIds.has(eventId));

      let relatedEvents: EventRecord[] = [];
      if (relatedIds.length > 0) {
        const relatedRes = await supabase.from("events").select("*").in("id", relatedIds.slice(0, 400));
        if (relatedRes.error) {
          setError(relatedRes.error.message);
          setLoading(false);
          return;
        }
        relatedEvents = mapEventRows((relatedRes.data ?? []) as unknown[]);
      }

      const mergedEvents = Array.from(
        new Map([...hostedEvents, ...relatedEvents].map((event) => [event.id, event])).values()
      );
      const hostIds = Array.from(new Set(mergedEvents.map((event) => event.hostUserId)));
      const profileIds = new Set<string>(hostIds);
      requestRows.forEach((request) => profileIds.add(request.requesterId));
      incomingRequestRows.forEach((request) => profileIds.add(request.requesterId));

      if (profileIds.size > 0) {
        const profilesRes = await supabase
          .from("profiles")
          .select("user_id,display_name,city,country,avatar_url")
          .in("user_id", Array.from(profileIds).slice(0, 400));

        if (!profilesRes.error) {
          setProfilesById(mapProfileRows((profilesRes.data ?? []) as unknown[]));
        } else {
          setProfilesById({});
        }
      } else {
        setProfilesById({});
      }

      setEvents(mergedEvents);
      setMemberships(membershipRows);
      setRequests(requestRows);
      setIncomingRequests(incomingRequestRows);
      setLoading(false);
  }, [embeddedInActivity, router]);

  async function confirmDelete() {
    if (!deleteTarget || !accessToken) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/events/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) { setDeleteError(json.error ?? "Failed to delete event."); return; }
      setEvents((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch {
      setDeleteError("Something went wrong. Please try again.");
    } finally {
      setDeleteBusy(false);
    }
  }

  useEffect(() => {
    const frame = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => {
      window.clearTimeout(frame);
    };
  }, [loadData]);

  const membershipByEvent = useMemo(() => {
    const map: Record<string, EventMemberRecord> = {};
    memberships.forEach((membership) => {
      map[membership.eventId] = membership;
    });
    return map;
  }, [memberships]);

  const requestByEvent = useMemo(() => {
    const map: Record<string, EventRequestRecord> = {};
    requests.forEach((request) => {
      map[request.eventId] = request;
    });
    return map;
  }, [requests]);

  const relationByEvent = useMemo(() => {
    const map: Record<string, MyEventRelation> = {};
    events.forEach((event) => {
      map[event.id] = relationForEvent(event, meId, membershipByEvent[event.id], requestByEvent[event.id]);
    });
    return map;
  }, [events, meId, membershipByEvent, requestByEvent]);

  const activeCreatedCount = useMemo(() => {
    return events.filter((event) => isCreatedThisMonthEvent(event, meId)).length;
  }, [events, meId]);

  const activeCreatedLimitReached = createdEventLimit !== null && activeCreatedCount >= createdEventLimit;
  useEffect(() => { onCanCreate?.(!activeCreatedLimitReached); }, [activeCreatedLimitReached, onCanCreate]);

  const incomingPendingRequests = useMemo(
    () => incomingRequests.filter((request) => request.status === "pending"),
    [incomingRequests]
  );

  const incomingAcceptedRequests = useMemo(
    () => incomingRequests.filter((request) => request.status === "accepted").slice(0, 8),
    [incomingRequests]
  );

  const filterCounts = useMemo(() => {
    const counts: Record<MyEventsFilter, number> = {
      all: events.length,
      created: 0,
      drafts: 0,
      joining: 0,
      interested: 0,
      pending: 0,
      past: 0,
    };

    events.forEach((event) => {
      const relation = relationByEvent[event.id];
      if (relation === "created") counts.created += 1;
      if (relation === "created" && event.status === "draft") counts.drafts += 1;
      if (relation === "joining") counts.joining += 1;
      if (relation === "interested") counts.interested += 1;
      if (relation === "pending") counts.pending += 1;
      if (new Date(event.endsAt).getTime() < nowMs) counts.past += 1;
    });

    counts.pending += incomingPendingRequests.length;

    return counts;
  }, [events, incomingPendingRequests.length, nowMs, relationByEvent]);

  const visibleEvents = useMemo(() => {
    const queryText = query.trim().toLowerCase();

    return events
      .filter((event) => {
        const relation = relationByEvent[event.id];
        if (!matchesFilter(activeFilter, event, relation, nowMs)) return false;
        if (!queryText) return true;

        const host = profilesById[event.hostUserId];
        const haystack = [
          event.title,
          event.city,
          event.country,
          event.venueName ?? "",
          event.eventType,
          event.styles.join(" "),
          host?.displayName ?? "",
          relationLabel(relation, membershipByEvent[event.id]),
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(queryText);
      })
      .sort((left, right) => sortEvents(left, right, activeFilter, nowMs));
  }, [activeFilter, events, membershipByEvent, nowMs, profilesById, query, relationByEvent]);

  const activityEventRows = useMemo(() => {
    const queryText = query.trim().toLowerCase();
    const searched = events
      .filter((event) => {
        if (!queryText) return true;
        const host = profilesById[event.hostUserId];
        const relation = relationByEvent[event.id];
        const haystack = [
          event.title,
          event.city,
          event.country,
          event.venueName ?? "",
          event.eventType,
          event.styles.join(" "),
          host?.displayName ?? "",
          relationLabel(relation, membershipByEvent[event.id]),
        ].join(" ").toLowerCase();
        return haystack.includes(queryText);
      });

    const bySoonest = (left: EventRecord, right: EventRecord) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
    const byUpdated = (left: EventRecord, right: EventRecord) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();

    return {
      created: searched
        .filter((event) => relationByEvent[event.id] === "created" && event.status !== "draft" && new Date(event.endsAt).getTime() >= nowMs)
        .sort(bySoonest),
      joining: searched
        .filter((event) => relationByEvent[event.id] === "joining" && new Date(event.endsAt).getTime() >= nowMs)
        .sort(bySoonest),
      interested: searched
        .filter((event) => relationByEvent[event.id] === "interested" && new Date(event.endsAt).getTime() >= nowMs)
        .sort(bySoonest),
      pending: searched
        .filter((event) => relationByEvent[event.id] === "pending")
        .sort(bySoonest),
      drafts: searched
        .filter((event) => relationByEvent[event.id] === "created" && event.status === "draft")
        .sort(byUpdated),
      past: searched
        .filter((event) => new Date(event.endsAt).getTime() < nowMs)
        .sort((left, right) => new Date(right.endsAt).getTime() - new Date(left.endsAt).getTime()),
    };
  }, [events, membershipByEvent, nowMs, profilesById, query, relationByEvent]);

  async function respondIncomingRequest(requestId: string, eventId: string, action: "accept" | "decline") {
    if (!accessToken) {
      setActionError("Missing auth session. Please sign in again.");
      return;
    }

    setActionBusyRequestId(requestId);
    setActionError(null);
    setActionInfo(null);

    const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/respond`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ requestId, action }),
    });

    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !json?.ok) {
      setActionBusyRequestId(null);
      setActionError(json?.error ?? "Failed to process request.");
      return;
    }

    setActionInfo(action === "accept" ? "Request Event access accepted." : "Request Event access declined.");
    await loadData();
    setActionBusyRequestId(null);
  }

  function renderCardRow(rowEvents: EventRecord[], emptyText: string, prependCard?: React.ReactNode) {
    if (!prependCard && !rowEvents.length) {
      return <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-4 text-sm text-white/45">{emptyText}</div>;
    }
    let scrollEl: HTMLDivElement | null = null;
    const scroll = (dir: "left" | "right") => scrollEl?.scrollBy({ left: dir === "right" ? 300 : -300, behavior: "smooth" });
    return (
      <div className="relative">
        <div className="no-scrollbar flex items-stretch gap-3 overflow-x-auto pb-1" ref={(el) => { scrollEl = el; }}>
          {prependCard}
          {rowEvents.map((event) => (
            <EventRelationshipCard
              key={event.id}
              event={event}
              host={profilesById[event.hostUserId] ?? null}
              meId={meId}
              nowMs={nowMs}
              className="w-[286px] shrink-0 sm:w-[304px]"
              onDeleteRequest={setDeleteTarget}
              onEditRequest={setEditEventId}
            />
          ))}
        </div>
        <button type="button" onClick={() => scroll("left")} className="absolute -left-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#121212] text-white/50 shadow-lg transition hover:border-white/25 hover:text-white">
          <span className="material-symbols-outlined text-[18px]">chevron_left</span>
        </button>
        <button type="button" onClick={() => scroll("right")} className="absolute -right-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#121212] text-white/50 shadow-lg transition hover:border-white/25 hover:text-white">
          <span className="material-symbols-outlined text-[18px]">chevron_right</span>
        </button>
      </div>
    );
  }

  function renderActivityEventRow(title: string, rowEvents: EventRecord[], emptyText: string, prependCard?: React.ReactNode, headerTrailing?: React.ReactNode) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-black text-white">{title}</h2>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-white/55">
            {rowEvents.length}
          </span>
          {headerTrailing}
        </div>
        {renderCardRow(rowEvents, emptyText, prependCard)}
      </section>
    );
  }

  if (loading) {
    if (embeddedInActivity) {
      return (
        <div className="space-y-7 text-white">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="h-10 w-32 animate-pulse rounded-full bg-white/[0.06]" />
            <div className="h-10 w-full animate-pulse rounded-full bg-white/[0.06] sm:max-w-[320px]" />
          </div>
          {["Created", "Joining", "Pending", "Drafts"].map((section) => (
            <section key={`activity-events-loading-${section}`} className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-6 w-28 animate-pulse rounded-xl bg-white/[0.08]" />
                <div className="h-6 w-10 animate-pulse rounded-full bg-white/[0.06]" />
              </div>
              <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={`activity-events-card-loading-${section}-${index}`} className="w-[286px] shrink-0 overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#121212] sm:w-[304px]">
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
            </section>
          ))}
        </div>
      );
    }

    return (
      <div className={embeddedInActivity ? "text-white" : "min-h-screen bg-[#05070c] text-white"}>
        {embeddedInActivity ? null : <Nav />}
        <main className={embeddedInActivity ? "w-full" : "mx-auto w-full max-w-[1320px] px-4 pb-12 pt-7 sm:px-6 lg:px-8"}>
          <div className="animate-pulse space-y-5">
            <div className="h-20 rounded-[28px] bg-white/[0.04]" />
            <div className="h-28 rounded-[24px] bg-white/[0.04]" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={`my-events-sk-${index}`} className="overflow-hidden rounded-2xl border border-white/10 bg-[#121212]">
                  <div className="h-40 bg-white/5" />
                  <div className="space-y-3 p-4">
                    <div className="h-5 w-4/5 rounded bg-white/10" />
                    <div className="h-4 w-3/5 rounded bg-white/10" />
                    <div className="h-4 w-full rounded bg-white/10" />
                    <div className="h-4 w-5/6 rounded bg-white/10" />
                    <div className="flex gap-2 pt-2">
                      <div className="h-10 flex-1 rounded-xl bg-white/10" />
                      <div className="h-10 flex-1 rounded-xl bg-white/10" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={embeddedInActivity ? "text-white" : "min-h-screen bg-[#05070c] text-white"}>
      {embeddedInActivity ? null : <Nav />}

      <main className={embeddedInActivity ? "w-full" : "mx-auto w-full max-w-[1320px] px-4 pb-12 pt-7 sm:px-6 lg:px-8"}>
        {!embeddedInActivity ? <section className="mb-5 overflow-hidden rounded-[28px] border border-cyan-300/15 bg-[radial-gradient(circle_at_top_left,rgba(0,245,255,0.08),transparent_40%),linear-gradient(180deg,rgba(11,16,22,0.98),rgba(8,10,14,0.99))] p-5 sm:p-6">
          <div className="mb-2 flex items-center justify-end gap-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40 sm:text-xs">
            <span>Published this month</span>
            <span className={activeCreatedLimitReached ? "text-amber-300" : "text-cyan-300"}>{activeCreatedCount}</span>
            <span>/{createdEventLimit ?? "Unlimited"}</span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <h1 className="min-w-0 flex-1 truncate text-[28px] font-black tracking-tight text-white sm:text-[36px]">My Events</h1>
            <Link
              href="/events"
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-white/80 hover:text-white sm:px-4 sm:py-2 sm:text-sm"
            >
              <span className="material-symbols-outlined text-[14px] sm:text-[18px]">arrow_back</span>
              Explore Events
            </Link>
            {activeCreatedLimitReached ? (
              <div className="group relative inline-flex shrink-0">
                <span className="inline-flex cursor-not-allowed items-center gap-1 rounded-full bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white/35 sm:px-4 sm:py-2 sm:text-sm">
                  <span className="material-symbols-outlined text-[14px] sm:text-[18px]">lock</span>
                  Create Event
                </span>
                <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#1a1a2e] border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                  Upgrade to Plus to create more events
                </span>
              </div>
            ) : (
              <Link
                href="/events/new"
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cyan-300/35 bg-cyan-300/20 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-50 hover:bg-cyan-300/30 sm:px-4 sm:py-2 sm:text-sm"
              >
                <span className="material-symbols-outlined text-[14px] sm:text-[18px]">add</span>
                Create Event
              </Link>
            )}
          </div>
        </section> : null}

        {error ? (
          <div className="mb-5 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}
        {actionError ? (
          <div className="mb-5 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{actionError}</div>
        ) : null}
        {actionInfo ? (
          <div className="mb-5 rounded-2xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">{actionInfo}</div>
        ) : null}

        {embeddedInActivity ? (
          <div className="space-y-7">
            {renderActivityEventRow("Created", activityEventRows.created, "No created events yet.", undefined,
              <span className="text-[13px] font-semibold text-white/35">
                Monthly Events <span className={`font-bold ${activeCreatedLimitReached ? "text-amber-300" : "text-cyan-300"}`}>{activeCreatedCount}/{createdEventLimit ?? "∞"}</span>
              </span>
            )}

            <section className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-white">Joining</h2>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-white/55">
                    {activityJoinView === "joining" ? activityEventRows.joining.length : activityEventRows.interested.length}
                  </span>
                </div>
                <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
                  {(["joining", "interested"] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setActivityJoinView(view)}
                      className={cx(
                        "rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em]",
                        activityJoinView === view ? "bg-cyan-300/18 text-cyan-50" : "text-white/45 hover:text-white/75"
                      )}
                    >
                      {view === "joining" ? "Joining" : "Interested"}
                    </button>
                  ))}
                </div>
              </div>
              {renderCardRow(
                activityJoinView === "joining" ? activityEventRows.joining : activityEventRows.interested,
                activityJoinView === "joining" ? "No joining events yet." : "No interested events yet."
              )}
            </section>

            {renderActivityEventRow("Pending", activityEventRows.pending, "No pending event requests.")}

            <section className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-white">Drafts</h2>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-white/55">
                    {activityDraftView === "drafts" ? activityEventRows.drafts.length : activityEventRows.past.length}
                  </span>
                </div>
                <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
                  {(["drafts", "past"] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setActivityDraftView(view)}
                      className={cx(
                        "rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em]",
                        activityDraftView === view ? "bg-cyan-300/18 text-cyan-50" : "text-white/45 hover:text-white/75"
                      )}
                    >
                      {view === "drafts" ? "Drafts" : "Past"}
                    </button>
                  ))}
                </div>
              </div>
              {renderCardRow(
                activityDraftView === "drafts" ? activityEventRows.drafts : activityEventRows.past,
                activityDraftView === "drafts" ? "No draft events." : "No past events."
              )}
            </section>
          </div>
        ) : null}

        {/* Tab switch */}
        {!embeddedInActivity ? <div className="mb-5 border-b border-white/[0.07]">
          <div className="flex items-center gap-4 px-1">
          <div className="no-scrollbar flex flex-1 gap-6 overflow-x-auto">
            {(["events", "groups"] as const).map((tab) => {
              const selected = myTab === tab;
              const label = tab === "events" ? "Events" : "Groups";
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setMyTab(tab)}
                  className={cx(
                    "inline-flex shrink-0 items-center gap-1.5 border-b-2 pb-4 min-h-[44px] text-[11px] font-black uppercase tracking-[0.18em] transition",
                    selected ? "border-cyan-300 text-cyan-100" : "border-transparent text-slate-500 hover:text-white"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <label className="group relative shrink-0">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-white/35 transition-colors group-focus-within:text-cyan-300">search</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search events…"
              className="h-8 w-40 rounded-full border border-white/10 bg-white/[0.05] pl-8 pr-3 text-[12px] text-white/90 outline-none placeholder:text-white/30 transition focus:border-[#00F5FF]/50 focus:w-56"
            />
          </label>
          </div>
        </div> : null}

        {!embeddedInActivity && myTab === "groups" ? (() => {
          const groups = events.filter((e) => e.accessType === "private_group");
          const memberCountByEvent: Record<string, number> = {};
          memberships.forEach((m) => { memberCountByEvent[m.eventId] = (memberCountByEvent[m.eventId] ?? 0) + 1; });
          return (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-sm text-white/50">{groups.length} group{groups.length !== 1 ? "s" : ""}</p>
                <Link
                  href="/events/new?type=private_group"
                  className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/35 bg-cyan-300/20 px-4 py-2 text-[13px] font-semibold text-cyan-50 hover:bg-cyan-300/30"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Create Group
                </Link>
              </div>
              {groups.length === 0 ? (
                <section className="rounded-[28px] border border-white/10 bg-[#0c1117] p-7 text-center">
                  <span className="material-symbols-outlined text-4xl text-white/20">group</span>
                  <h2 className="mt-3 text-xl font-bold text-white">No groups yet</h2>
                  <p className="mt-2 text-sm text-slate-400">Create a private group to connect with your community.</p>
                  <Link
                    href="/events/new?type=private_group"
                    className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#00F5FF] px-5 py-2.5 text-sm font-bold text-[#071116] hover:opacity-90"
                  >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                    Create Group
                  </Link>
                </section>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {groups.map((group) => {
                    const isHost = group.hostUserId === meId;
                    const memberCount = (memberCountByEvent[group.id] ?? 0) + 1;
                    const lastActivity = new Date(group.updatedAt);
                    const lastActivityStr = lastActivity.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                    return (
                      <article key={group.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#121212] p-4 transition hover:border-cyan-300/25">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-300/10">
                                <span className="material-symbols-outlined text-[18px] text-cyan-300">group</span>
                              </span>
                              <h2 className="truncate text-[15px] font-bold text-white">{group.title}</h2>
                            </div>
                            {isHost ? (
                              <span className="mt-1.5 inline-block rounded-full border border-cyan-300/35 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-100">Admin</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-[12px] text-slate-400">
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px] text-white/30">person</span>
                            {memberCount} member{memberCount !== 1 ? "s" : ""}
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px] text-white/30">schedule</span>
                            {lastActivityStr}
                          </span>
                        </div>
                        <Link
                          href={`/events/${group.id}`}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.05] py-2.5 text-sm font-semibold text-white/90 transition hover:bg-white/[0.08]"
                        >
                          <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                          Open group
                        </Link>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })() : null}

        {!embeddedInActivity && myTab === "events" ? <>

        <section
          className="mb-5 rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,18,24,0.98),rgba(9,11,15,0.98))] p-4 sm:p-5 hidden"
        >
          <div className={cx("flex flex-col gap-3", embeddedInActivity && "sm:items-end")}>
            <div className={cx(
              "flex flex-col gap-3 sm:flex-row",
              embeddedInActivity ? "sm:items-center sm:justify-end" : "sm:items-end sm:justify-between"
            )}>
              <label className={cx("group relative w-full", embeddedInActivity ? "sm:max-w-[320px]" : "hidden max-w-md sm:block")}>
                <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[18px] text-white/35 transition-colors group-focus-within:text-cyan-300">
                  search
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search your events..."
                  className={cx(
                    "w-full border border-white/10 text-white/90 outline-none placeholder:text-white/35 transition focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30",
                    embeddedInActivity
                      ? "h-10 rounded-full bg-white/[0.05] pl-10 pr-3 text-[13px]"
                      : "h-12 rounded-2xl bg-[#1B1B1B] pl-11 pr-4 text-sm"
                  )}
                />
              </label>

              <div className={cx("w-full", embeddedInActivity ? "sm:w-[220px]" : "sm:w-[270px]")}>
                <p className={cx("mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45", embeddedInActivity && "sr-only")}>Event type / category</p>
                <div className="relative">
                  <select
                    value={activeFilter}
                    onChange={(event) => setActiveFilter((event.target.value as MyEventsFilter) || "all")}
                    className={cx(
                      "w-full appearance-none border border-white/10 px-4 pr-10 font-semibold text-white/90 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30",
                      embeddedInActivity
                        ? "h-10 rounded-full bg-white/[0.05] text-[13px]"
                        : "rounded-2xl bg-[#1B1B1B] py-3 text-sm"
                    )}
                  >
                    {([
                      "all",
                      "created",
                      "drafts",
                      "joining",
                      "interested",
                      "pending",
                      "past",
                    ] as MyEventsFilter[]).map((filter) => (
                      <option key={`event-filter-${filter}`} value={filter}>
                        {filterLabel(filter)} ({filterCounts[filter]})
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-white/40">
                    expand_more
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {activeFilter === "pending" && (incomingPendingRequests.length > 0 || incomingAcceptedRequests.length > 0) ? (
          <section className="mb-5 space-y-4 rounded-[28px] border border-white/10 bg-[#0c1117] p-5">
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-black tracking-tight text-white">Pending requests to join Request Events</h2>
              <p className="text-sm text-slate-400">Handle incoming Request Event access requests here. Accepted members move into the event automatically.</p>
            </div>

            {incomingPendingRequests.length > 0 ? (
              <div className="space-y-3">
                {incomingPendingRequests.map((request) => {
                  const event = events.find((item) => item.id === request.eventId) ?? null;
                  const profile = profilesById[request.requesterId] ?? null;
                  const busy = actionBusyRequestId === request.id;

                  return (
                    <article key={request.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-bold text-white">{profile?.displayName ?? "Member"}</p>
                            <span className="rounded-full border border-fuchsia-300/35 bg-fuchsia-300/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-fuchsia-100">
                              Pending
                            </span>
                            <span className="text-xs text-slate-500">{formatShortDateTime(request.createdAt)}</span>
                          </div>
                          <p className="mt-1 text-sm font-semibold text-cyan-100">{event?.title ?? "Request Event"}</p>
                          <p className="mt-1 text-sm text-slate-400">
                            {[event?.city ?? "", event?.country ?? "", event?.startsAt ? formatEventRange(event.startsAt, event.endsAt) : ""]
                              .filter(Boolean)
                              .join(" • ")}
                          </p>
                          <p className="mt-2 text-sm text-slate-300">{request.note?.trim() || "No note provided."}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void respondIncomingRequest(request.id, request.eventId, "decline")}
                            disabled={busy}
                            className="rounded-xl border border-rose-300/35 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/18 disabled:opacity-60"
                          >
                            Decline
                          </button>
                          <button
                            type="button"
                            onClick={() => void respondIncomingRequest(request.id, request.eventId, "accept")}
                            disabled={busy}
                            className="rounded-xl border border-cyan-300/35 bg-cyan-300/16 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/24 disabled:opacity-60"
                          >
                            {busy ? "Saving..." : "Accept"}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}

            {incomingAcceptedRequests.length > 0 ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">Accepted Log</h3>
                  <span className="text-xs text-slate-500">Request Event joins</span>
                </div>
                <div className="space-y-2">
                  {incomingAcceptedRequests.map((request) => {
                    const event = events.find((item) => item.id === request.eventId) ?? null;
                    const profile = profilesById[request.requesterId] ?? null;
                    return (
                      <div key={`accepted-${request.id}`} className="flex flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">
                            {profile?.displayName ?? "Member"} joined {event?.title ?? "your private event"}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {[event?.city ?? "", event?.country ?? ""].filter(Boolean).join(", ")}
                          </p>
                        </div>
                        <span className="text-xs text-slate-500">{formatShortDateTime(request.updatedAt)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {!events.length ? (
          <section className="rounded-[28px] border border-white/10 bg-[#0c1117] p-7 text-center">
            <h2 className="text-2xl font-bold text-white">No events yet</h2>
            <p className="mt-2 text-sm text-slate-400">Create your first event to start building your event space.</p>
            <Link
              href="/events/new"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#00F5FF] px-5 py-2.5 text-sm font-bold text-[#071116] hover:opacity-90"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Create Event
            </Link>
          </section>
        ) : visibleEvents.length === 0 && !(activeFilter === "pending" && (incomingPendingRequests.length > 0 || incomingAcceptedRequests.length > 0)) ? (
          <section className="rounded-[28px] border border-white/10 bg-[#0c1117] p-7 text-center">
            <h2 className="text-2xl font-bold text-white">No matches for this view</h2>
            <p className="mt-2 text-sm text-slate-400">Try another filter or clear your search.</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setActiveFilter("all");
                  setQuery("");
                }}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">filter_alt_off</span>
                Clear view
              </button>
            </div>
          </section>
        ) : (
          <div className="space-y-7">
            {renderActivityEventRow("Created", activityEventRows.created, "No created events yet.", undefined,
              <span className="text-[13px] font-semibold text-white/35">
                Monthly Events <span className={`font-bold ${activeCreatedLimitReached ? "text-amber-300" : "text-cyan-300"}`}>{activeCreatedCount}/{createdEventLimit ?? "∞"}</span>
              </span>
            )}
            <section className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-white">Joining</h2>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-white/55">
                    {activityJoinView === "joining" ? activityEventRows.joining.length : activityEventRows.interested.length}
                  </span>
                </div>
                <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
                  {(["joining", "interested"] as const).map((view) => (
                    <button key={view} type="button" onClick={() => setActivityJoinView(view)}
                      className={cx("rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em]",
                        activityJoinView === view ? "bg-cyan-300/18 text-cyan-50" : "text-white/45 hover:text-white/75")}>
                      {view === "joining" ? "Joining" : "Interested"}
                    </button>
                  ))}
                </div>
              </div>
              {renderCardRow(
                activityJoinView === "joining" ? activityEventRows.joining : activityEventRows.interested,
                activityJoinView === "joining" ? "No joining events yet." : "No interested events yet."
              )}
            </section>
            {renderActivityEventRow("Pending", activityEventRows.pending, "No pending event requests.")}
            <section className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-white">Drafts</h2>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-white/55">
                    {activityDraftView === "drafts" ? activityEventRows.drafts.length : activityEventRows.past.length}
                  </span>
                </div>
                <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
                  {(["drafts", "past"] as const).map((view) => (
                    <button key={view} type="button" onClick={() => setActivityDraftView(view)}
                      className={cx("rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em]",
                        activityDraftView === view ? "bg-cyan-300/18 text-cyan-50" : "text-white/45 hover:text-white/75")}>
                      {view === "drafts" ? "Drafts" : "Past"}
                    </button>
                  ))}
                </div>
              </div>
              {renderCardRow(
                activityDraftView === "drafts" ? activityEventRows.drafts : activityEventRows.past,
                activityDraftView === "drafts" ? "No draft events." : "No past events."
              )}
            </section>
          </div>
        )}

        </> : null}
      </main>

      {/* Delete confirmation modal */}
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col rounded-[28px] border border-white/10 bg-[#0d1117] shadow-2xl">
            <div className="flex items-start gap-3 border-b border-white/[0.07] px-5 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-400/10">
                <span className="material-symbols-outlined text-[20px] text-red-400">delete</span>
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-white">Delete event?</h2>
                <p className="mt-0.5 text-[12px] text-white/50">
                  &ldquo;{deleteTarget.title}&rdquo; will be permanently deleted.
                </p>
              </div>
            </div>
            {deleteError ? (
              <p className="mx-5 mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-[12px] text-red-300">{deleteError}</p>
            ) : null}
            <div className="flex gap-2 px-5 py-4">
              <button
                type="button"
                onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
                disabled={deletebusy}
                className="flex-1 rounded-2xl border border-white/10 py-2.5 text-sm font-semibold text-white/60 hover:bg-white/[0.04] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deletebusy}
                className="flex-1 rounded-2xl bg-red-500 py-2.5 text-sm font-bold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deletebusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editEventId ? (
        <CreateEventModal
          eventId={editEventId}
          onClose={() => setEditEventId(null)}
          onPublished={() => { setEditEventId(null); void loadData(); }}
          onSaved={() => { setEditEventId(null); void loadData(); }}
        />
      ) : null}
    </div>
  );
}
