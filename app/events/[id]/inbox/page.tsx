"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";
import {
  type EventMemberRecord,
  type EventRecord,
  type EventRequestRecord,
  type LiteProfile,
  formatDateTime,
  mapEventMemberRows,
  mapEventRequestRows,
  mapEventRows,
  mapProfileRows,
  pickEventHeroUrl,
} from "@/lib/events/model";

type RequestTab = "pending" | "accepted" | "declined";
type RequestAction = "accept" | "decline";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function normalizeRoleSignals(roles: string[]) {
  const lower = roles.map((role) => role.toLowerCase());
  const isLead = lower.some((role) => role.includes("lead"));
  const isFollow = lower.some((role) => role.includes("follow") || role.includes("follower"));
  return { isLead, isFollow };
}

export default function EventInboxPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = typeof params?.id === "string" ? params.id : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [actionBusyRequestId, setActionBusyRequestId] = useState<string | null>(null);

  const [accessToken, setAccessToken] = useState<string | null>(null);

  const [event, setEvent] = useState<EventRecord | null>(null);
  const [members, setMembers] = useState<EventMemberRecord[]>([]);
  const [requests, setRequests] = useState<EventRequestRecord[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, LiteProfile>>({});
  const [rolesByUserId, setRolesByUserId] = useState<Record<string, string[]>>({});

  const [activeTab, setActiveTab] = useState<RequestTab>("pending");
  const [search, setSearch] = useState("");

  const loadData = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) {
      router.replace("/auth");
      return;
    }

    const userId = authData.user.id;

    const { data: sessionData } = await supabase.auth.getSession();
    setAccessToken(sessionData.session?.access_token ?? null);

    const eventRes = await supabase.from("events").select("*").eq("id", eventId).maybeSingle();
    if (eventRes.error) {
      setError(eventRes.error.message);
      setLoading(false);
      return;
    }

    if (!eventRes.data) {
      setError("Event not found.");
      setLoading(false);
      return;
    }

    const loadedEvent = mapEventRows([eventRes.data])[0] ?? null;
    if (!loadedEvent) {
      setError("Unable to load event.");
      setLoading(false);
      return;
    }

    if (loadedEvent.hostUserId !== userId) {
      setEvent(loadedEvent);
      setError("Only the event host can manage this inbox.");
      setLoading(false);
      return;
    }

    setEvent(loadedEvent);

    const [membersRes, requestsRes] = await Promise.all([
      supabase.from("event_members").select("*").eq("event_id", eventId),
      supabase.from("event_requests").select("*").eq("event_id", eventId).order("created_at", { ascending: false }).limit(400),
    ]);

    if (membersRes.error || requestsRes.error) {
      setError(membersRes.error?.message ?? requestsRes.error?.message ?? "Failed to load requests.");
      setLoading(false);
      return;
    }

    const memberRows = mapEventMemberRows((membersRes.data ?? []) as unknown[]);
    const requestRows = mapEventRequestRows((requestsRes.data ?? []) as unknown[]);
    setMembers(memberRows);
    setRequests(requestRows);

    const profileIds = new Set<string>([loadedEvent.hostUserId]);
    requestRows.forEach((row) => profileIds.add(row.requesterId));
    memberRows.forEach((row) => profileIds.add(row.userId));

    if (profileIds.size) {
      const profileRes = await supabase
        .from("profiles")
        .select("user_id,display_name,city,country,avatar_url,roles")
        .in("user_id", Array.from(profileIds));

      const rows = (profileRes.data ?? []) as Array<Record<string, unknown>>;
      setProfilesById(mapProfileRows(rows));

      const roleMap: Record<string, string[]> = {};
      rows.forEach((row) => {
        const userIdKey = typeof row.user_id === "string" ? row.user_id : "";
        if (!userIdKey) return;
        roleMap[userIdKey] = Array.isArray(row.roles)
          ? row.roles.filter((item): item is string => typeof item === "string")
          : [];
      });
      setRolesByUserId(roleMap);
    } else {
      setProfilesById({});
      setRolesByUserId({});
    }

    setLoading(false);
  }, [eventId, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  const requestCounts = useMemo(() => {
    const counts = { pending: 0, accepted: 0, declined: 0 };
    requests.forEach((request) => {
      if (request.status === "pending") counts.pending += 1;
      if (request.status === "accepted") counts.accepted += 1;
      if (request.status === "declined") counts.declined += 1;
    });
    return counts;
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    return requests.filter((request) => {
      if (activeTab !== request.status) return false;
      if (!query) return true;
      const profile = profilesById[request.requesterId];
      const haystack = [profile?.displayName ?? "", request.note ?? "", profile?.city ?? "", profile?.country ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [activeTab, profilesById, requests, search]);

  const counts = useMemo(() => {
    let going = 0;
    let pending = 0;
    const declined = requestCounts.declined;
    let leads = 0;
    let follows = 0;

    members.forEach((member) => {
      if (member.status === "host" || member.status === "going") {
        going += 1;
        const roles = rolesByUserId[member.userId] ?? [];
        const roleSignal = normalizeRoleSignals(roles);
        if (roleSignal.isLead) leads += 1;
        if (roleSignal.isFollow) follows += 1;
      }
    });

    pending = requestCounts.pending;

    return { going, pending, declined, leads, follows };
  }, [members, requestCounts.declined, requestCounts.pending, rolesByUserId]);

  const eventHero = useMemo(() => (event ? event.coverUrl || pickEventHeroUrl(event) : null), [event]);

  async function respondRequest(requestId: string, action: RequestAction) {
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

    setActionInfo(action === "accept" ? "Request accepted." : "Request declined.");
    await loadData();
    setActionBusyRequestId(null);
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#071316] text-white">Loading inbox...</div>;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#10272b,_#071316_45%,_#05090b_100%)] text-slate-100">
      <Nav />

      <main className="mx-auto w-full max-w-[1320px] px-4 pb-12 pt-7 sm:px-6 lg:px-8">
        <nav className="mb-5 text-sm text-slate-400">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/events" className="hover:text-cyan-100">
                Events
              </Link>
            </li>
            <li>/</li>
            <li>
              <Link href={event ? `/events/${event.id}` : "/events"} className="hover:text-cyan-100">
                {event?.title ?? "Event"}
              </Link>
            </li>
            <li>/</li>
            <li className="text-slate-200">Requests Inbox</li>
          </ol>
        </nav>

        {error ? (
          <div className="mb-5 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}
        {actionError ? (
          <div className="mb-5 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{actionError}</div>
        ) : null}
        {actionInfo ? (
          <div className="mb-5 rounded-2xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">{actionInfo}</div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <article className="overflow-hidden rounded-3xl border border-white/10 bg-[#0b1a1d]/75">
              <div className="relative h-48">
                {event ? (
                  eventHero ? (
                    <img src={eventHero} alt={event.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-[#12262b]" />
                  )
                ) : (
                  <div className="h-full w-full bg-[#12262b]" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#071316] via-transparent to-transparent" />
                <div className="absolute bottom-4 left-4">
                  <h2 className="text-3xl font-black text-white">{event?.title ?? "Event"}</h2>
                </div>
              </div>

              <div className="space-y-4 p-5">
                <div className="text-sm text-slate-300">
                  <p className="font-semibold text-white">{formatDateTime(event?.startsAt)}</p>
                  <p className="mt-1">{[event?.venueName, event?.city, event?.country].filter(Boolean).join(", ")}</p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-slate-300">Capacity</span>
                    <span className="font-semibold text-white">{event?.capacity ?? "Open"}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-900">
                    <div
                      className="h-full bg-cyan-300"
                      style={{
                        width:
                          event?.capacity && event.capacity > 0
                            ? `${Math.min(100, Math.round((counts.going / event.capacity) * 100))}%`
                            : "18%",
                      }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-2">
                    <p className="text-2xl font-bold text-white">{counts.going}</p>
                    <p className="text-xs text-slate-400">Going</p>
                  </div>
                  <div className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 p-2">
                    <p className="text-2xl font-bold text-cyan-50">{counts.pending}</p>
                    <p className="text-xs text-cyan-100/80">Pending</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-2">
                    <p className="text-2xl font-bold text-slate-300">{counts.declined}</p>
                    <p className="text-xs text-slate-400">Declined</p>
                  </div>
                </div>
              </div>
            </article>

            <article className="rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-5">
              <h3 className="mb-3 text-lg font-bold text-white">Role Balance</h3>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-blue-300">Leads ({counts.leads})</span>
                <span className="font-medium text-pink-300">Follows ({counts.follows})</span>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-[#0f1f24]">
                <div
                  className="bg-blue-400"
                  style={{
                    width: counts.leads + counts.follows > 0 ? `${Math.round((counts.leads / (counts.leads + counts.follows)) * 100)}%` : "50%",
                  }}
                />
                <div
                  className="bg-pink-400"
                  style={{
                    width: counts.leads + counts.follows > 0 ? `${Math.round((counts.follows / (counts.leads + counts.follows)) * 100)}%` : "50%",
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-400">Role split from attendee profile roles.</p>
            </article>
          </aside>

          <section className="rounded-3xl border border-white/10 bg-[#0b1a1d]/75">
            <div className="border-b border-white/10 p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h1 className="text-4xl font-black tracking-tight text-white">Requests Inbox</h1>
                <div className="relative">
                  <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                    search
                  </span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search members..."
                    className="w-full rounded-full border border-white/10 bg-black/25 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 sm:w-72"
                  />
                </div>
              </div>

              <div className="flex items-center gap-6 border-b border-white/10">
                {([
                  { key: "pending", label: "Pending", count: requestCounts.pending },
                  { key: "accepted", label: "Accepted", count: requestCounts.accepted },
                  { key: "declined", label: "Declined", count: requestCounts.declined },
                ] as const).map((tab) => {
                  const selected = activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={cx(
                        "relative pb-3 text-base font-semibold",
                        selected ? "text-cyan-200" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      {tab.label}
                      <span
                        className={cx(
                          "ml-2 rounded-full px-2 py-0.5 text-xs",
                          selected ? "bg-cyan-300/20 text-cyan-100" : "bg-black/25 text-slate-300"
                        )}
                      >
                        {tab.count}
                      </span>
                      {selected ? <span className="absolute inset-x-0 -bottom-px h-[2px] bg-cyan-300" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 p-5">
              {filteredRequests.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                  No {activeTab} requests found.
                </div>
              ) : (
                filteredRequests.map((request) => {
                  const profile = profilesById[request.requesterId];
                  const roles = rolesByUserId[request.requesterId] ?? [];
                  const roleLabel = roles.slice(0, 2).join(" • ");
                  const busy = actionBusyRequestId === request.id;

                  return (
                    <article
                      key={request.id}
                      className="rounded-2xl border border-white/10 bg-black/25 p-4 transition hover:border-cyan-300/25"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className="h-14 w-14 overflow-hidden rounded-full border border-white/20 bg-[#163036]">
                            {profile?.avatarUrl ? (
                              <img src={profile.avatarUrl} alt={profile.displayName} className="h-full w-full object-cover" />
                            ) : null}
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-2xl font-bold tracking-tight text-white">{profile?.displayName ?? "Member"}</p>
                              {roleLabel ? (
                                <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-xs text-slate-200">
                                  {roleLabel}
                                </span>
                              ) : null}
                              <span className="text-xs text-slate-400">{formatDateTime(request.createdAt)}</span>
                            </div>
                            <p className="mt-1 text-sm text-slate-300">{request.note?.trim() || "No note provided."}</p>
                          </div>
                        </div>

                        {request.status === "pending" ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void respondRequest(request.id, "decline")}
                              disabled={busy}
                              className="rounded-xl border border-rose-300/35 bg-rose-500/10 p-2 text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                              title="Decline"
                            >
                              <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void respondRequest(request.id, "accept")}
                              disabled={busy}
                              className="rounded-xl bg-cyan-300 px-4 py-2 text-base font-bold text-[#052328] hover:bg-cyan-200 disabled:opacity-60"
                            >
                              {busy ? "Saving..." : "Accept"}
                            </button>
                          </div>
                        ) : (
                          <div className="rounded-full border border-white/15 bg-black/20 px-3 py-1 text-xs font-semibold uppercase text-slate-200">
                            {request.status}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
