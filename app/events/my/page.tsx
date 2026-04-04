"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
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
import { supabase } from "@/lib/supabase/client";

type MyEventsFilter = "all" | "created" | "drafts" | "joining" | "interested" | "pending" | "past";
type MyEventRelation = "created" | "joining" | "interested" | "pending" | null;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function summarize(text: string | null | undefined, max = 92) {
  const value = (text ?? "").trim();
  if (!value) return "No description provided yet.";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}...`;
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

function statusTone(status: EventRecord["status"]) {
  if (status === "draft") return "border-amber-300/35 bg-amber-300/12 text-amber-100";
  if (status === "cancelled") return "border-rose-300/35 bg-rose-500/12 text-rose-100";
  return "border-cyan-300/30 bg-cyan-300/12 text-cyan-100";
}

function relationLabel(relation: MyEventRelation, membership: EventMemberRecord | null | undefined) {
  if (relation === "created") return "Created";
  if (relation === "pending") return "Pending request";
  if (relation === "joining") return membership?.status === "waitlist" ? "Waitlist" : "Joining";
  if (relation === "interested") return "Interested";
  return "Related";
}

function relationTone(relation: MyEventRelation, membership: EventMemberRecord | null | undefined) {
  if (relation === "created") return "border-cyan-300/35 bg-cyan-300/14 text-cyan-100";
  if (relation === "pending") return "border-fuchsia-300/35 bg-fuchsia-400/14 text-fuchsia-100";
  if (relation === "joining") {
    return membership?.status === "waitlist"
      ? "border-amber-300/35 bg-amber-400/14 text-amber-100"
      : "border-emerald-300/35 bg-emerald-400/14 text-emerald-100";
  }
  if (relation === "interested") return "border-cyan-300/35 bg-[linear-gradient(90deg,rgba(34,211,238,0.16),rgba(217,70,239,0.14))] text-cyan-50";
  return "border-white/10 bg-white/[0.06] text-white/75";
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

function isActiveCreatedEvent(event: EventRecord, meId: string | null, nowMs: number) {
  return (
    Boolean(meId) &&
    event.hostUserId === meId &&
    event.status === "published" &&
    !event.hiddenByAdmin &&
    new Date(event.endsAt).getTime() >= nowMs
  );
}

function EventRelationshipCard({
  event,
  host,
  relation,
  membership,
  meId,
  nowMs,
}: {
  event: EventRecord;
  host: LiteProfile | null;
  relation: MyEventRelation;
  membership: EventMemberRecord | null | undefined;
  meId: string | null;
  nowMs: number;
}) {
  const isHost = Boolean(meId && event.hostUserId === meId);
  const isPast = new Date(event.endsAt).getTime() < nowMs;
  const hero = isHost && event.coverUrl ? event.coverUrl : pickEventHeroUrl(event);
  const fallbackHero = pickEventFallbackHeroUrl(event);
  const badge = eventDateBadgeParts(event.startsAt);
  const primaryHref = isHost && event.status === "draft" ? `/events/${event.id}/edit` : `/events/${event.id}`;

  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#121212] shadow-[0_6px_20px_rgba(0,0,0,0.3)] transition hover:-translate-y-0.5 hover:border-cyan-300/30">
      <div className="relative h-[150px] overflow-hidden bg-[#0d141a]">
        <EventHeroImage
          key={`${hero ?? ""}|${fallbackHero ?? ""}`}
          primarySrc={hero}
          fallbackSrc={fallbackHero}
          alt={event.title}
          className="h-full w-full object-cover transition duration-700 hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-transparent to-transparent" />

        <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
          {relation ? (
            <span className={cx("rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide", relationTone(relation, membership))}>
              {relationLabel(relation, membership)}
            </span>
          ) : null}
          <span className={cx("rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide", statusTone(event.status))}>
            {event.status}
          </span>
        </div>

        <div className="absolute right-3 top-3">
          <span className="rounded-full border border-white/20 bg-black/45 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-100">
            {event.visibility}
          </span>
        </div>
      </div>

      <div className="relative flex flex-1 flex-col p-3">
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
          <p className="mt-1 text-[12px] font-semibold text-cyan-200/90">{formatEventRange(event.startsAt, event.endsAt)}</p>
          <p className="mt-1 truncate text-[12px] text-slate-400">{[event.venueName, event.city, event.country].filter(Boolean).join(", ")}</p>
          {!isHost && host ? (
            <p className="mt-1 truncate text-[12px] text-slate-500">Hosted by {host.displayName}</p>
          ) : null}
        </div>

        <p className="mt-3 line-clamp-2 min-h-[38px] text-[13px] leading-[1.35] text-slate-400">
          {summarize(event.description)}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-slate-200">
            {event.eventType}
          </span>
          {event.styles.slice(0, 2).map((style) => (
            <span
              key={style}
              className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold capitalize text-slate-300"
            >
              {style}
            </span>
          ))}
          {isPast ? (
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-white/70">
              Past
            </span>
          ) : null}
        </div>

        <div className="mt-auto flex gap-2 border-t border-white/10 pt-3">
          <Link
            href={primaryHref}
            className={cx(
              "inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition",
              isHost
                ? "border-cyan-300/35 bg-cyan-300/16 text-cyan-50 hover:bg-cyan-300/24"
                : "border-white/12 bg-white/[0.05] text-white/90 hover:bg-white/[0.08]"
            )}
          >
            <span className="material-symbols-outlined text-[18px]">{isHost && event.status === "draft" ? "edit" : "open_in_new"}</span>
            {isHost && event.status === "draft" ? "Continue editing" : "View event"}
          </Link>
          {isHost ? (
            <Link
              href={`/events/${event.id}/edit`}
              className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.05] px-4 text-sm font-semibold text-white/90 transition hover:bg-white/[0.08]"
            >
              <span className="material-symbols-outlined text-[18px]">tune</span>
              Edit
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default function MyEventsPage() {
  const router = useRouter();
  const [nowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [actionBusyRequestId, setActionBusyRequestId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [createdEventLimit, setCreatedEventLimit] = useState<number | null>(2);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<MyEventsFilter>("all");
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
        router.replace("/auth?next=/events/my");
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
  }, [router]);

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
    return events.filter((event) => isActiveCreatedEvent(event, meId, nowMs)).length;
  }, [events, meId, nowMs]);

  const activeCreatedLimitReached = createdEventLimit !== null && activeCreatedCount >= createdEventLimit;

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

    setActionInfo(action === "accept" ? "Private event request accepted." : "Private event request declined.");
    await loadData();
    setActionBusyRequestId(null);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070c] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[1320px] px-4 pb-12 pt-7 sm:px-6 lg:px-8">
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
    <div className="min-h-screen bg-[#05070c] text-white">
      <Nav />

      <main className="mx-auto w-full max-w-[1320px] px-4 pb-12 pt-7 sm:px-6 lg:px-8">
        <section className="mb-5 overflow-hidden rounded-[28px] border border-cyan-300/15 bg-[radial-gradient(circle_at_top_left,rgba(0,245,255,0.08),transparent_40%),linear-gradient(180deg,rgba(11,16,22,0.98),rgba(8,10,14,0.99))] p-5 sm:p-6">
          <div className="mb-2 flex items-center justify-end gap-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40 sm:text-xs">
            <span>Events</span>
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
            <Link
              href="/events/new"
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cyan-300/35 bg-cyan-300/20 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-50 hover:bg-cyan-300/30 sm:px-4 sm:py-2 sm:text-sm"
            >
              <span className="material-symbols-outlined text-[14px] sm:text-[18px]">add</span>
              Create Event
            </Link>
          </div>
        </section>

        {error ? (
          <div className="mb-5 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}
        {actionError ? (
          <div className="mb-5 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{actionError}</div>
        ) : null}
        {actionInfo ? (
          <div className="mb-5 rounded-2xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">{actionInfo}</div>
        ) : null}

        <section className="mb-5 rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,18,24,0.98),rgba(9,11,15,0.98))] p-4 sm:p-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="group relative hidden w-full max-w-md sm:block">
                <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[18px] text-white/35 transition-colors group-focus-within:text-cyan-300">
                  search
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search your events..."
                  className="h-12 w-full rounded-2xl border border-white/10 bg-[#1B1B1B] pl-11 pr-4 text-sm text-white/90 outline-none placeholder:text-white/35 transition focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                />
              </label>

              <div className="w-full sm:w-[270px]">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Event type / category</p>
                <div className="relative">
                  <select
                    value={activeFilter}
                    onChange={(event) => setActiveFilter((event.target.value as MyEventsFilter) || "all")}
                    className="w-full appearance-none rounded-2xl border border-white/10 bg-[#1B1B1B] px-4 py-3 pr-10 text-sm font-semibold text-white/90 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
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
              <h2 className="text-2xl font-black tracking-tight text-white">Pending requests to join private events</h2>
              <p className="text-sm text-slate-400">Handle incoming private-event access requests here. Accepted members move into the event automatically.</p>
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
                          <p className="mt-1 text-sm font-semibold text-cyan-100">{event?.title ?? "Private event"}</p>
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
                  <span className="text-xs text-slate-500">Private event joins</span>
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
        ) : visibleEvents.length > 0 ? (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleEvents.map((event) => (
              <EventRelationshipCard
                key={event.id}
                event={event}
                host={profilesById[event.hostUserId] ?? null}
                relation={relationByEvent[event.id]}
                membership={membershipByEvent[event.id]}
                meId={meId}
                nowMs={nowMs}
              />
            ))}
          </section>
        ) : null}
      </main>
    </div>
  );
}
