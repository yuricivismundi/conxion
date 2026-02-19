"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import { supabase } from "@/lib/supabase/client";
import {
  type EventMemberRecord,
  type EventRecord,
  type EventRequestRecord,
  type LiteProfile,
  buildMapsUrl,
  formatEventRange,
  mapEventMemberRows,
  mapEventRequestRows,
  mapEventRows,
  mapProfileRows,
  pickEventHeroUrl,
} from "@/lib/events/model";

type EventAction = "join" | "request" | "cancel_request" | "leave";
type FeedbackSummary = {
  total_count: number;
  avg_quality: number | null;
  happened_yes: number;
  happened_no: number;
};
type FeedbackMine = {
  id: string;
  quality: number;
  happened_as_described: boolean;
  note: string | null;
  visibility: "private" | "public";
  created_at: string;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function statusLabel(status: string | null | undefined) {
  if (status === "host") return "Host";
  if (status === "going") return "Going";
  if (status === "waitlist") return "Waitlist";
  if (status === "pending") return "Pending";
  if (status === "accepted") return "Approved";
  if (status === "declined") return "Declined";
  return "";
}

function typeBadge(type: string) {
  const key = type.toLowerCase();
  if (key.includes("social")) return "bg-cyan-300 text-[#052328] border-cyan-200/40";
  if (key.includes("workshop") || key.includes("class")) return "bg-emerald-300 text-[#06291d] border-emerald-200/40";
  if (key.includes("festival")) return "bg-fuchsia-300 text-[#2e0930] border-fuchsia-200/40";
  return "bg-white/10 text-white border-white/20";
}

export default function EventDetailsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = typeof params?.id === "string" ? params.id : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [event, setEvent] = useState<EventRecord | null>(null);
  const [host, setHost] = useState<LiteProfile | null>(null);
  const [members, setMembers] = useState<EventMemberRecord[]>([]);
  const [myMembership, setMyMembership] = useState<EventMemberRecord | null>(null);
  const [myRequest, setMyRequest] = useState<EventRequestRecord | null>(null);
  const [profilesById, setProfilesById] = useState<Record<string, LiteProfile>>({});
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [hasEnded, setHasEnded] = useState(false);
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary | null>(null);
  const [feedbackMine, setFeedbackMine] = useState<FeedbackMine | null>(null);
  const [feedbackCanSubmit, setFeedbackCanSubmit] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackInfo, setFeedbackInfo] = useState<string | null>(null);
  const [feedbackQuality, setFeedbackQuality] = useState(5);
  const [feedbackHappened, setFeedbackHappened] = useState(true);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackVisibility, setFeedbackVisibility] = useState<"private" | "public">("private");
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestNote, setRequestNote] = useState("");
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportNote, setReportNote] = useState("");

  const loadData = useCallback(async () => {
    if (!eventId) return;

    setLoading(true);
    setError(null);
    setFeedbackError(null);
    setFeedbackInfo(null);

    const [{ data: sessionData }, { data: authData, error: authErr }] = await Promise.all([
      supabase.auth.getSession(),
      supabase.auth.getUser(),
    ]);

    const token = sessionData.session?.access_token ?? null;
    const userId = authErr || !authData.user ? null : authData.user.id;

    setAccessToken(token);
    setMeId(userId);
    setIsAuthenticated(Boolean(userId));

    const eventRes = userId
      ? await supabase.from("events").select("*").eq("id", eventId).maybeSingle()
      : await supabase.rpc("get_public_event_lite", { p_event_id: eventId });

    if (eventRes.error) {
      setError(eventRes.error.message);
      setLoading(false);
      return;
    }

    const eventSource = userId ? (eventRes.data ? [eventRes.data] : []) : ((eventRes.data ?? []) as unknown[]);
    const loadedEvent = mapEventRows(eventSource)[0] ?? null;
    if (!loadedEvent) {
      setError("Event not found or access denied.");
      setLoading(false);
      return;
    }

    setEvent(loadedEvent);
    const eventEndsAt = new Date(loadedEvent.endsAt).getTime();
    setHasEnded(!Number.isNaN(eventEndsAt) && eventEndsAt <= Date.now());

    if (!userId) {
      setMembers([]);
      setMyMembership(null);
      setMyRequest(null);
      setPendingRequestsCount(0);
      setProfilesById({});
      setHost(null);
      setFeedbackSummary(null);
      setFeedbackMine(null);
      setFeedbackCanSubmit(false);
      setLoading(false);
      return;
    }

    const [hostRes, membersRes, myMemberRes, myRequestRes, pendingRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id,display_name,city,country,avatar_url")
        .eq("user_id", loadedEvent.hostUserId)
        .maybeSingle(),
      supabase
        .from("event_members")
        .select("*")
        .eq("event_id", eventId)
        .in("status", ["host", "going", "waitlist"]),
      supabase.from("event_members").select("*").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
      supabase.from("event_requests").select("*").eq("event_id", eventId).eq("requester_id", userId).maybeSingle(),
      supabase.from("event_requests").select("id", { count: "exact", head: true }).eq("event_id", eventId).eq("status", "pending"),
    ]);

    const memberRows = mapEventMemberRows((membersRes.data ?? []) as unknown[]);
    setMembers(memberRows);
    setMyMembership(myMemberRes.data ? mapEventMemberRows([myMemberRes.data])[0] ?? null : null);
    setMyRequest(myRequestRes.data ? mapEventRequestRows([myRequestRes.data])[0] ?? null : null);
    setPendingRequestsCount(pendingRes.count ?? 0);

    if (hostRes.data) {
      const map = mapProfileRows([hostRes.data]);
      setHost(map[loadedEvent.hostUserId] ?? null);
    } else {
      setHost(null);
    }

    const attendeeIds = Array.from(new Set(memberRows.map((member) => member.userId))).filter(Boolean);
    if (attendeeIds.length) {
      const attendeeProfilesRes = await supabase
        .from("profiles")
        .select("user_id,display_name,city,country,avatar_url")
        .in("user_id", attendeeIds);
      setProfilesById(mapProfileRows((attendeeProfilesRes.data ?? []) as unknown[]));
    } else {
    setProfilesById({});
    }

    setFeedbackMine(null);
    setFeedbackCanSubmit(false);
    setFeedbackSummary(null);

    if (token) {
      const feedbackRes = await fetch(`/api/events/${encodeURIComponent(eventId)}/feedback`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      if (feedbackRes.ok) {
        const json = (await feedbackRes.json().catch(() => null)) as
          | { ok?: boolean; mine?: FeedbackMine | null; can_submit?: boolean; summary?: FeedbackSummary | null }
          | null;
        if (json?.ok) {
          setFeedbackMine(json.mine ?? null);
          setFeedbackCanSubmit(Boolean(json.can_submit));
          setFeedbackSummary(json.summary ?? null);
          if (json.mine) {
            setFeedbackQuality(json.mine.quality);
            setFeedbackHappened(Boolean(json.mine.happened_as_described));
            setFeedbackNote(json.mine.note ?? "");
            setFeedbackVisibility(json.mine.visibility ?? "private");
          } else {
            setFeedbackQuality(5);
            setFeedbackHappened(true);
            setFeedbackNote("");
            setFeedbackVisibility("private");
          }
        }
      }
    }

    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  const counts = useMemo(() => {
    let going = 0;
    let waitlist = 0;
    members.forEach((member) => {
      if (member.status === "host" || member.status === "going") going += 1;
      if (member.status === "waitlist") waitlist += 1;
    });
    return { going, waitlist, total: members.length };
  }, [members]);

  const visibleAttendees = useMemo(() => {
    return members
      .filter((member) => member.status === "host" || member.status === "going")
      .slice(0, 8)
      .map((member) => ({ member, profile: profilesById[member.userId] ?? null }));
  }, [members, profilesById]);

  const isHost = event && meId ? event.hostUserId === meId : false;
  const mapsUrl = event ? buildMapsUrl(event) : null;
  const heroUrl = event ? (isHost && event.coverUrl ? event.coverUrl : pickEventHeroUrl(event)) : null;
  const spotsLeft = event?.capacity === null ? null : Math.max((event?.capacity ?? 0) - counts.going, 0);

  const cta = useMemo(() => {
    if (!event) return { label: "Join", action: "join" as EventAction, outline: false };
    if (!isAuthenticated) {
      return {
        label: event.visibility === "private" ? "Sign in to Request" : "Sign in to Join",
        action: "join" as EventAction,
        outline: false,
      };
    }
    if (myMembership && (myMembership.status === "going" || myMembership.status === "waitlist")) {
      return { label: "Leave Event", action: "leave" as EventAction, outline: true };
    }
    if (event.visibility === "private") {
      if (myRequest?.status === "pending") {
        return { label: "Cancel Request", action: "cancel_request" as EventAction, outline: true };
      }
      return { label: "Request Invite", action: "request" as EventAction, outline: false };
    }
    return { label: "Join Event", action: "join" as EventAction, outline: false };
  }, [event, isAuthenticated, myMembership, myRequest]);

  async function handleAction(action: EventAction, requestNoteOverride?: string) {
    if (!event) return;
    if (!isAuthenticated || !accessToken) {
      router.push(`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`);
      return;
    }

    setActionBusy(true);
    setActionError(null);
    setActionInfo(null);

    const response = await fetch(`/api/events/${encodeURIComponent(event.id)}/join`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        action,
        note: action === "request" ? requestNoteOverride ?? null : null,
      }),
    });

    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !json?.ok) {
      setActionBusy(false);
      setActionError(json?.error ?? "Action failed.");
      return;
    }

    if (action === "join") setActionInfo("You joined this event.");
    if (action === "request") setActionInfo("Invite request sent.");
    if (action === "cancel_request") setActionInfo("Request cancelled.");
    if (action === "leave") setActionInfo("You left this event.");

    await loadData();
    setActionBusy(false);
  }

  async function handleReportEvent(reasonOverride?: string, noteOverride?: string) {
    if (!event) return;
    if (!isAuthenticated || !accessToken) {
      router.push(`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`);
      return;
    }
    const reason = reasonOverride?.trim() ?? "";
    if (!reason) {
      setActionError("Report reason is required.");
      return;
    }
    const note = noteOverride?.trim() ?? "";

    setActionBusy(true);
    setActionError(null);
    setActionInfo(null);

    const response = await fetch(`/api/events/${encodeURIComponent(event.id)}/report`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ reason, note: note || null }),
    });

    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !json?.ok) {
      setActionBusy(false);
      setActionError(json?.error ?? "Could not report event.");
      return;
    }

    setActionBusy(false);
    setActionInfo("Event reported. Our moderation team will review it.");
  }

  async function handleSubmitFeedback() {
    if (!event) return;
    if (!isAuthenticated || !accessToken) {
      router.push(`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`);
      return;
    }
    if (!hasEnded) {
      setFeedbackError("Feedback opens after the event ends.");
      return;
    }

    setFeedbackBusy(true);
    setFeedbackError(null);
    setFeedbackInfo(null);

    const response = await fetch(`/api/events/${encodeURIComponent(event.id)}/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        happenedAsDescribed: feedbackHappened,
        quality: feedbackQuality,
        note: feedbackNote.trim() || null,
        visibility: feedbackVisibility,
      }),
    });

    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !json?.ok) {
      setFeedbackBusy(false);
      setFeedbackError(json?.error ?? "Could not submit feedback.");
      return;
    }

    setFeedbackInfo("Feedback saved.");
    await loadData();
    setFeedbackBusy(false);
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#071316] text-white">Loading event...</div>;
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-[#071316] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[1100px] px-4 py-8">
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-5 text-rose-100">{error ?? "Event not found."}</div>
          <Link href="/events" className="mt-4 inline-flex rounded-full border border-cyan-300/35 px-4 py-2 text-cyan-100 hover:bg-cyan-300/15">
            Back to Events
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#10272b,_#071316_45%,_#05090b_100%)] text-slate-100">
      <Nav />

      <main className="pb-12">
        <section className="relative h-[420px] w-full overflow-hidden sm:h-[520px]">
          {heroUrl ? (
            <img src={heroUrl} alt={event.title} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-[#13262c]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#071316] via-[#071316]/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#071316]/85 via-transparent to-transparent" />

          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[1320px] px-4 pb-8 sm:px-6 lg:px-8">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className={cx("rounded-full border px-3 py-1 text-xs font-bold uppercase", typeBadge(event.eventType))}>
                {event.eventType}
              </span>
              <span className="rounded-full border border-white/20 bg-black/35 px-3 py-1 text-xs font-bold uppercase text-white/90">
                {event.visibility}
              </span>
              {event.styles.slice(0, 3).map((style) => (
                <span
                  key={style}
                  className="rounded-full border border-white/20 bg-black/35 px-3 py-1 text-xs font-bold uppercase text-white/90"
                >
                  {style}
                </span>
              ))}
              {spotsLeft !== null ? (
                <span className="rounded-full border border-fuchsia-300/35 bg-fuchsia-400/15 px-3 py-1 text-xs font-bold uppercase text-fuchsia-100">
                  {spotsLeft} spots left
                </span>
              ) : null}
            </div>

            <h1 className="text-4xl font-black uppercase tracking-tight text-white sm:text-6xl">{event.title}</h1>
            <div className="mt-3 flex flex-col gap-2 text-base text-slate-200 sm:flex-row sm:flex-wrap sm:items-center sm:gap-5">
              <p className="inline-flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-cyan-200">calendar_month</span>
                {formatEventRange(event.startsAt, event.endsAt)}
              </p>
              <p className="inline-flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-cyan-200">location_on</span>
                {[event.venueName, event.city, event.country].filter(Boolean).join(", ")}
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-6 grid w-full max-w-[1320px] grid-cols-1 gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,2fr)_360px] lg:px-8">
          <div className="space-y-6">
            <article className="rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-6">
              <h2 className="mb-4 text-2xl font-bold text-white">About the Event</h2>
              <p className="text-base leading-relaxed text-slate-200">
                {event.description?.trim() || "The host has not added a detailed description yet."}
              </p>
            </article>

            <article className="rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 overflow-hidden rounded-full border border-cyan-300/35 bg-[#163036]">
                    {host?.avatarUrl ? <img src={host.avatarUrl} alt={host.displayName} className="h-full w-full object-cover" /> : null}
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Hosted by</p>
                    <p className="text-xl font-bold text-white">{host?.displayName ?? "Event host"}</p>
                    <p className="text-sm text-slate-400">
                      {[host?.city, host?.country].filter(Boolean).join(", ") || "ConXion organizer"}
                    </p>
                  </div>
                </div>
                {isHost ? (
                  <Link
                    href={`/events/${event.id}/inbox`}
                    className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/25"
                  >
                    Open Request Inbox
                  </Link>
                ) : null}
              </div>
            </article>

            {!isAuthenticated ? (
              <article className="rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-6">
                <h3 className="mb-2 text-lg font-bold text-white">External Links</h3>
                <p className="mb-4 text-sm text-slate-300">Links to tickets and socials are available for members only.</p>
                <Link
                  href={`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`}
                  className="inline-flex rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/25"
                >
                  Sign in to unlock links
                </Link>
              </article>
            ) : event.links.length > 0 ? (
              <article className="rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-6">
                <h3 className="mb-4 text-lg font-bold text-white">External Links</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {event.links.map((link, index) => (
                    <a
                      key={`${link.url}-${index}`}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200 hover:border-cyan-300/30 hover:text-white"
                    >
                      <span className="truncate">
                        <span className="font-semibold">{link.label}</span>
                        <span className="ml-1 text-slate-400">({link.type})</span>
                      </span>
                      <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                    </a>
                  ))}
                </div>
              </article>
            ) : null}

            <article id="feedback" className="rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-6">
              <h3 className="mb-3 text-lg font-bold text-white">Post-event feedback</h3>
              {!hasEnded ? (
                <p className="text-sm text-slate-300">Feedback opens once the event ends.</p>
              ) : !isAuthenticated ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-300">Sign in to leave a quality check and reference after attending.</p>
                  <Link
                    href={`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`}
                    className="inline-flex rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/25"
                  >
                    Sign in
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {feedbackSummary ? (
                    <div className="grid gap-2 text-sm sm:grid-cols-3">
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-xs uppercase tracking-wide text-slate-400">Avg quality</p>
                        <p className="mt-1 font-bold text-white">{feedbackSummary.avg_quality ?? "-"}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-xs uppercase tracking-wide text-slate-400">As described</p>
                        <p className="mt-1 font-bold text-white">
                          {feedbackSummary.happened_yes} yes / {feedbackSummary.happened_no} no
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-xs uppercase tracking-wide text-slate-400">Total feedback</p>
                        <p className="mt-1 font-bold text-white">{feedbackSummary.total_count}</p>
                      </div>
                    </div>
                  ) : null}

                  {!isHost && (feedbackCanSubmit || Boolean(feedbackMine)) ? (
                    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                      {feedbackError ? (
                        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                          {feedbackError}
                        </div>
                      ) : null}
                      {feedbackInfo ? (
                        <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-50">
                          {feedbackInfo}
                        </div>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Quality (1-5)</span>
                          <input
                            type="number"
                            min={1}
                            max={5}
                            value={feedbackQuality}
                            onChange={(entry) => setFeedbackQuality(Math.min(5, Math.max(1, Number(entry.target.value) || 1)))}
                            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Visibility</span>
                          <select
                            value={feedbackVisibility}
                            onChange={(entry) => setFeedbackVisibility(entry.target.value === "public" ? "public" : "private")}
                            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                          >
                            <option value="private">Private (host/admin only)</option>
                            <option value="public">Public summary</option>
                          </select>
                        </label>
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          checked={feedbackHappened}
                          onChange={(entry) => setFeedbackHappened(entry.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-transparent accent-cyan-300"
                        />
                        Event happened as described
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Note (optional)</span>
                        <textarea
                          rows={3}
                          value={feedbackNote}
                          onChange={(entry) => setFeedbackNote(entry.target.value)}
                          className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                          placeholder="Share key details for trust scoring."
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void handleSubmitFeedback()}
                        disabled={feedbackBusy}
                        className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-bold text-[#052328] hover:bg-cyan-200 disabled:opacity-60"
                      >
                        {feedbackBusy ? "Saving..." : feedbackMine ? "Update Feedback" : "Submit Feedback"}
                      </button>
                    </div>
                  ) : isHost ? (
                    <p className="text-sm text-slate-300">Hosts can review attendee feedback here after the event.</p>
                  ) : (
                    <p className="text-sm text-slate-300">You can submit feedback after attending this event.</p>
                  )}
                </div>
              )}
            </article>
          </div>

          <aside className="space-y-6">
            <article className="rounded-3xl border border-cyan-300/25 bg-[#08161a]/90 p-5 shadow-[0_16px_45px_rgba(0,0,0,0.35)]">
              {actionError ? (
                <div className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{actionError}</div>
              ) : null}
              {actionInfo ? (
                <div className="mb-3 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-50">{actionInfo}</div>
              ) : null}
              {isHost && event.coverUrl && event.coverStatus !== "approved" ? (
                <div className="mb-3 rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                  Cover review status: {event.coverStatus}.
                </div>
              ) : null}

              <div className="mb-4 flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Capacity</p>
                  <p className="mt-1 text-2xl font-black text-white">{event.capacity ?? "Open"}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-fuchsia-300">Attendance</p>
                  <p className="mt-1 text-lg font-semibold text-white">{isAuthenticated ? `${counts.going} going` : "Locked"}</p>
                </div>
              </div>

              {isHost ? (
                <div className="space-y-2">
                  <Link
                    href={`/events/${event.id}/inbox`}
                    className="block w-full rounded-xl bg-cyan-300 py-3 text-center text-lg font-black text-[#052328] hover:bg-cyan-200"
                  >
                    Manage Requests
                  </Link>
                  <Link
                    href={`/events/${event.id}/edit`}
                    className="block w-full rounded-xl border border-cyan-300/35 bg-cyan-300/15 py-3 text-center text-sm font-semibold text-cyan-100 hover:bg-cyan-300/25"
                  >
                    Edit Event
                  </Link>
                </div>
              ) : !isAuthenticated ? (
                <Link
                  href={`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`}
                  className="block w-full rounded-xl bg-cyan-300 py-3 text-center text-lg font-black text-[#052328] hover:bg-cyan-200"
                >
                  Sign in to Join
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (cta.action === "request") {
                      setRequestModalOpen(true);
                      return;
                    }
                    void handleAction(cta.action);
                  }}
                  disabled={actionBusy}
                  className={cx(
                    "block w-full rounded-xl py-3 text-center text-lg font-black transition",
                    cta.outline
                      ? "border border-cyan-300/35 bg-transparent text-cyan-100 hover:bg-cyan-300/15"
                      : "bg-cyan-300 text-[#052328] hover:bg-cyan-200",
                    actionBusy && "cursor-not-allowed opacity-60"
                  )}
                >
                  {actionBusy ? "Saving..." : cta.label}
                </button>
              )}

              <div className="mt-4 space-y-2 text-sm text-slate-300">
                {isAuthenticated && myMembership ? (
                  <p>
                    Your status: <span className="font-semibold text-white">{statusLabel(myMembership.status)}</span>
                  </p>
                ) : null}
                {isAuthenticated && !myMembership && myRequest ? (
                  <p>
                    Request status: <span className="font-semibold text-white">{statusLabel(myRequest.status)}</span>
                  </p>
                ) : null}
                {isHost ? <p>Pending requests: <span className="font-semibold text-white">{pendingRequestsCount}</span></p> : null}
                {!isHost ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReportModalOpen(true);
                      setActionError(null);
                    }}
                    disabled={actionBusy}
                    className="rounded-full border border-rose-300/35 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-60"
                  >
                    Report Event
                  </button>
                ) : null}
              </div>
            </article>

            <article className="rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Attendees</h3>
                <p className="text-sm text-cyan-100">{isAuthenticated ? counts.going : "Locked"}</p>
              </div>
              <div className="space-y-3">
                {!isAuthenticated ? (
                  <p className="text-sm text-slate-400">Sign in to view attendee identities.</p>
                ) : visibleAttendees.length === 0 ? (
                  <p className="text-sm text-slate-400">No attendees yet.</p>
                ) : (
                  visibleAttendees.map((entry) => (
                    <div key={entry.member.id} className="flex items-center gap-3">
                      <div className="h-10 w-10 overflow-hidden rounded-full border border-white/20 bg-[#163036]">
                        {entry.profile?.avatarUrl ? (
                          <img src={entry.profile.avatarUrl} alt={entry.profile.displayName} className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{entry.profile?.displayName ?? "Member"}</p>
                        <p className="text-xs text-slate-400">{statusLabel(entry.member.status)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="overflow-hidden rounded-3xl border border-white/10 bg-[#0b1a1d]/75">
              <div className="h-44 bg-[linear-gradient(145deg,#1c3338,#0f1f24)]">
                <div className="flex h-full items-center justify-center">
                  <span className="material-symbols-outlined text-5xl text-cyan-300/60">location_on</span>
                </div>
              </div>
              <div className="p-4">
                <p className="text-lg font-bold text-white">{event.venueName || "Venue details"}</p>
                <p className="mt-1 text-sm text-slate-300">
                  {isAuthenticated
                    ? [event.venueAddress, event.city, event.country].filter(Boolean).join(", ")
                    : [event.city, event.country].filter(Boolean).join(", ")}
                </p>
                {!isAuthenticated ? (
                  <Link
                    href={`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`}
                    className="mt-3 inline-block text-sm font-semibold text-cyan-100 hover:text-cyan-50"
                  >
                    Sign in to unlock exact address
                  </Link>
                ) : mapsUrl ? (
                  <a href={mapsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-cyan-100 hover:text-cyan-50">
                    Get Directions
                  </a>
                ) : null}
              </div>
            </article>
          </aside>
        </section>
      </main>

      <ConfirmationDialog
        open={requestModalOpen}
        title="Request event access"
        description="Add an optional note to help the host review your request."
        summary={
          <div className="space-y-2">
            <textarea
              rows={3}
              value={requestNote}
              onChange={(entry) => setRequestNote(entry.target.value)}
              placeholder="Optional note for the host..."
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
            />
          </div>
        }
        confirmLabel="Send Request"
        onCancel={() => {
          setRequestModalOpen(false);
          setRequestNote("");
        }}
        onConfirm={() => {
          setRequestModalOpen(false);
          void handleAction("request", requestNote.trim() || undefined);
          setRequestNote("");
        }}
      />

      <ConfirmationDialog
        open={reportModalOpen}
        title="Report this event"
        description="Reports help moderation detect scams, fake listings, and safety issues."
        summary={
          <div className="space-y-2">
            <input
              value={reportReason}
              onChange={(entry) => setReportReason(entry.target.value)}
              placeholder="Reason (required)"
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
            />
            <textarea
              rows={3}
              value={reportNote}
              onChange={(entry) => setReportNote(entry.target.value)}
              placeholder="Optional moderation note"
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
            />
          </div>
        }
        confirmVariant="danger"
        confirmLabel="Submit Report"
        onCancel={() => {
          setReportModalOpen(false);
          setReportReason("");
          setReportNote("");
        }}
        onConfirm={() => {
          const reason = reportReason.trim();
          if (!reason) {
            setActionError("Report reason is required.");
            return;
          }
          setReportModalOpen(false);
          void handleReportEvent(reason, reportNote.trim() || undefined);
          setReportReason("");
          setReportNote("");
        }}
      />
    </div>
  );
}
