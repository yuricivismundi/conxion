"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import { normalizePublicAppUrl } from "@/lib/public-app-url";
import Nav from "@/components/Nav";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import { buildOsmEmbedUrl, type OsmGeocodeResult } from "@/lib/maps/osm";
import { supabase } from "@/lib/supabase/client";
import {
  type EventMemberRecord,
  type EventRecord,
  type EventRequestRecord,
  type LiteProfile,
  buildMapsUrl,
  dayToken,
  formatEventRange,
  mapEventMemberRows,
  mapEventRequestRows,
  mapEventRows,
  mapProfileRows,
  monthToken,
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

function cleanParam(value: string | null | undefined) {
  return value?.trim() ?? "";
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
  if (key.includes("social")) return "border-[#3b4552] bg-[#23272f] text-[#d8e0ea]";
  if (key.includes("workshop") || key.includes("class") || key.includes("masterclass")) {
    return "border-[#365276] bg-[#1c2532] text-[#dbe8ff]";
  }
  if (key.includes("festival")) return "border-[#5e4b73] bg-[#272031] text-[#eedfff]";
  return "border-white/10 bg-white/[0.05] text-white/80";
}

const panelClass =
  "rounded-2xl border border-white/8 bg-[#1b1d21] shadow-[0_10px_24px_rgba(0,0,0,0.18)]";
const accentPanelClass =
  "rounded-2xl border border-white/8 bg-[#1b1d21] shadow-[0_10px_24px_rgba(0,0,0,0.18)]";

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
  const [heroSrc, setHeroSrc] = useState<string | null>(null);
  const [mapLocation, setMapLocation] = useState<OsmGeocodeResult | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  const shareUrl = useMemo(() => {
    const base =
      (typeof window !== "undefined" ? normalizePublicAppUrl(window.location.origin) : "") ||
      normalizePublicAppUrl(process.env.NEXT_PUBLIC_APP_URL) ||
      "";
    return event ? `${base}/events/${event.id}` : "";
  }, [event]);

  const shareDisplayUrl = useMemo(() => shareUrl.replace(/^https?:\/\//, ""), [shareUrl]);

  useEffect(() => {
    if (!shareDialogOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setShareDialogOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shareDialogOpen]);

  async function copyShareLink() {
    if (!shareUrl) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setActionInfo("Event link copied.");
        return;
      }
      if (typeof document !== "undefined") {
        const input = document.createElement("input");
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
        setActionInfo("Event link copied.");
        return;
      }
      setActionError("Copy is not supported on this device.");
    } catch {
      setActionError("Could not copy the event link.");
    }
  }

  async function shareEvent() {
    if (!event || !shareUrl) return;
    const prefersNativeShare =
      typeof window !== "undefined" &&
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
    try {
      if (prefersNativeShare) {
        await navigator.share({ title: event.title, url: shareUrl });
        return;
      }
      setShareDialogOpen(true);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setActionError("Could not share event. Try again.");
    }
  }

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
  const fallbackHeroUrl = event ? pickEventHeroUrl(event) : null;
  const preferredHeroUrl = event ? event.coverUrl || fallbackHeroUrl : null;
  const spotsLeft = event?.capacity === null ? null : Math.max((event?.capacity ?? 0) - counts.going, 0);

  useEffect(() => {
    setHeroSrc(preferredHeroUrl);
  }, [preferredHeroUrl]);

  useEffect(() => {
    let cancelled = false;

    async function loadMapLocation() {
      if (!event) {
        setMapLocation(null);
        return;
      }

      const venue = cleanParam(event.venueName);
      const address = cleanParam(event.venueAddress);
      const city = cleanParam(event.city);
      const country = cleanParam(event.country);
      const query = [venue, address, city, country].filter(Boolean).join(", ");
      if (query.trim().length < 5) {
        setMapLocation(null);
        return;
      }

      try {
        const searchParams = new URLSearchParams({
          q: query,
          venue,
          address,
          city,
          country,
        });
        const response = await fetch(`/api/geocode/search?${searchParams.toString()}`, { cache: "no-store" });
        const json = (await response.json().catch(() => null)) as { ok?: boolean; results?: OsmGeocodeResult[] } | null;
        if (!cancelled && response.ok && json?.ok && Array.isArray(json.results)) {
          setMapLocation(json.results[0] ?? null);
          return;
        }
        if (!cancelled) setMapLocation(null);
      } catch {
        if (!cancelled) setMapLocation(null);
      }
    }

    void loadMapLocation();
    return () => {
      cancelled = true;
    };
  }, [event]);

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
    return (
      <div className="min-h-screen bg-[#18191a] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[1320px] px-4 pb-12 pt-7 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-6">
            <div className="h-[310px] rounded-[24px] bg-white/[0.04] sm:h-[370px] lg:h-[420px]" />
            <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_360px]">
              <div className="space-y-6">
                <div className="h-72 rounded-2xl bg-white/[0.04]" />
                <div className="h-56 rounded-3xl bg-white/[0.04]" />
              </div>
              <div className="space-y-6">
                <div className="h-48 rounded-2xl bg-white/[0.04]" />
                <div className="h-44 rounded-3xl bg-white/[0.04]" />
                <div className="h-72 rounded-3xl bg-white/[0.04]" />
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-[#05070c] text-white">
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
    <div className="min-h-screen bg-[#18191a] text-slate-100">
      <Nav />

      <main className="pb-12">
        <section className="mx-auto w-full max-w-[1220px] px-4 pt-5 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-[24px] border border-white/8 bg-[#1b1d21] shadow-[0_20px_48px_rgba(0,0,0,0.24)]">
            <div className="mx-auto max-w-[980px] px-3 pt-3 sm:px-5 sm:pt-5">
              <div className="overflow-hidden rounded-[18px] bg-[#0f1113]">
                <div className="relative h-[200px] w-full bg-[#0c1118] sm:h-[250px] lg:h-[300px]">
                  {heroSrc ? (
                    <img
                      src={heroSrc}
                      alt={event.title}
                      className="h-full w-full object-contain sm:object-cover"
                      referrerPolicy="no-referrer"
                      onError={() => {
                        if (fallbackHeroUrl && heroSrc !== fallbackHeroUrl) {
                          setHeroSrc(fallbackHeroUrl);
                          return;
                        }
                        setHeroSrc(null);
                      }}
                    />
                  ) : (
                    <div className="h-full w-full bg-[#0f121a]" />
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-white/8 px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
              <div className="grid gap-4 lg:grid-cols-[84px_minmax(0,1fr)_auto] lg:items-start">
                <div className="hidden lg:block">
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#202327]">
                    <div className="bg-[#ef4444] px-4 py-1 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-white">
                      {monthToken(event.startsAt)}
                    </div>
                    <div className="px-4 py-3 text-center">
                      <div className="text-[34px] font-black leading-none text-white">{dayToken(event.startsAt)}</div>
                    </div>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 lg:hidden">
                    <div className="inline-flex items-center overflow-hidden rounded-xl border border-white/10 bg-[#202327]">
                      <span className="bg-[#ef4444] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
                        {monthToken(event.startsAt)}
                      </span>
                      <span className="px-3 py-1 text-sm font-black text-white">{dayToken(event.startsAt)}</span>
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#b8c7da]">
                      {new Intl.DateTimeFormat("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                      }).format(new Date(event.startsAt))}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={cx("rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]", typeBadge(event.eventType))}>
                      {event.eventType}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/65">
                      {event.visibility}
                    </span>
                    {event.styles.slice(0, 3).map((style) => (
                      <span
                        key={style}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/65"
                      >
                        {style}
                      </span>
                    ))}
                  </div>

                  <h1 className="mt-3 text-[26px] font-extrabold leading-tight tracking-tight text-white sm:text-[30px] lg:text-[34px]">
                    {event.title}
                  </h1>

                  <div className="mt-3 space-y-2 text-[15px] text-slate-300">
                    <p className="font-medium text-slate-200">{event.venueName || "Venue details"}</p>
                    <p className="inline-flex items-start gap-2">
                      <span className="material-symbols-outlined mt-0.5 text-[18px] text-slate-400">calendar_month</span>
                      <span>{formatEventRange(event.startsAt, event.endsAt)}</span>
                    </p>
                    <p className="inline-flex items-start gap-2">
                      <span className="material-symbols-outlined mt-0.5 text-[18px] text-slate-400">location_on</span>
                      <span>{[event.venueAddress || event.venueName, event.city, event.country].filter(Boolean).join(", ")}</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-2 lg:min-w-[250px] lg:items-end">
                  {actionError ? (
                    <div className="w-full rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 lg:max-w-[320px]">
                      {actionError}
                    </div>
                  ) : null}
                  {actionInfo ? (
                    <div className="w-full rounded-xl border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-sm text-sky-50 lg:max-w-[320px]">
                      {actionInfo}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => void shareEvent()}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.08]"
                    >
                      <span className="material-symbols-outlined text-[18px]">share</span>
                      Share
                    </button>
                    {isHost ? (
                      <>
                        {event.visibility === "private" && (
                          <Link
                            href={`/events/${event.id}/inbox`}
                            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2374e1] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#2d7ff0]"
                          >
                            Manage Requests
                          </Link>
                        )}
                        <Link
                          href={`/events/${event.id}/edit`}
                          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d3035] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#373a40]"
                        >
                          Edit Event
                        </Link>
                        <Link
                          href={`/events/new?from=${encodeURIComponent(JSON.stringify({
                            title: event.title,
                            eventType: event.eventType,
                            visibility: event.visibility,
                            city: event.city,
                            country: event.country,
                            venueName: event.venueName,
                            venueAddress: event.venueAddress,
                            description: event.description,
                            styles: event.styles,
                            capacity: event.capacity,
                          }))}`}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#2d3035] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#373a40]"
                        >
                          <span className="material-symbols-outlined text-[18px]">content_copy</span>
                          Duplicate
                        </Link>
                      </>
                    ) : !isAuthenticated ? (
                      <Link
                        href={`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`}
                        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2374e1] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#2d7ff0]"
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
                          "inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-bold transition",
                          cta.outline ? "bg-[#2d3035] text-white hover:bg-[#373a40]" : "bg-[#2374e1] text-white hover:bg-[#2d7ff0]",
                          actionBusy && "cursor-not-allowed opacity-60"
                        )}
                      >
                        {actionBusy ? "Saving..." : cta.label}
                      </button>
                    )}
                    {!isHost ? (
                      <button
                        type="button"
                        onClick={() => {
                          setReportModalOpen(true);
                          setActionError(null);
                        }}
                        disabled={actionBusy}
                        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d3035] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#373a40] disabled:opacity-60"
                      >
                        More
                      </button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400 lg:justify-end">
                    {isAuthenticated && myMembership ? (
                      <p>
                        Status: <span className="font-semibold text-white">{statusLabel(myMembership.status)}</span>
                      </p>
                    ) : null}
                    {isAuthenticated && !myMembership && myRequest ? (
                      <p>
                        Request: <span className="font-semibold text-white">{statusLabel(myRequest.status)}</span>
                      </p>
                    ) : null}
                    {isHost ? (
                      <p>
                        Pending requests: <span className="font-semibold text-white">{pendingRequestsCount}</span>
                      </p>
                    ) : null}
                    {spotsLeft !== null ? (
                      <p>
                        Spots left: <span className="font-semibold text-white">{spotsLeft}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-5 grid w-full max-w-[1220px] grid-cols-1 gap-5 px-4 sm:px-6 xl:grid-cols-[minmax(0,2fr)_360px] lg:px-8">
          <div className="order-2 space-y-6 xl:order-1">
            <article className={`${panelClass} overflow-hidden`}>
              <div className="border-b border-white/8 px-5 py-4 sm:px-6">
                <h2 className="text-[22px] font-bold text-white">Details</h2>
              </div>
              <div className="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
                <p className="text-[15px] leading-7 text-slate-200">
                  {event.description?.trim() || "The host has not added a detailed description yet."}
                </p>

                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl bg-[#202327] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Date & time</p>
                      <p className="mt-2 text-sm font-medium text-white">{formatEventRange(event.startsAt, event.endsAt)}</p>
                    </div>
                    <div className="rounded-xl bg-[#202327] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Location</p>
                      <p className="mt-2 text-sm font-medium text-white">{event.venueName || [event.city, event.country].filter(Boolean).join(", ")}</p>
                    </div>
                    <div className="rounded-xl bg-[#202327] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Access</p>
                      <p className="mt-2 text-sm font-medium capitalize text-white">{event.visibility}</p>
                    </div>
                    <div className="rounded-xl bg-[#202327] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Capacity</p>
                      <p className="mt-2 text-sm font-medium text-white">{event.capacity ?? "Open attendance"}</p>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-[#202327] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Hosted by</p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-14 w-14 overflow-hidden rounded-full bg-[#15171a]">
                        {host?.avatarUrl ? <img src={host.avatarUrl} alt={host.displayName} className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-lg font-bold text-white">{host?.displayName ?? "Event host"}</p>
                        <p className="text-sm text-slate-400">{[host?.city, host?.country].filter(Boolean).join(", ") || "ConXion organizer"}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {!isAuthenticated ? (
                  <div className="border-t border-white/8 pt-5">
                    <h3 className="mb-2 text-lg font-bold text-white">External Links</h3>
                    <p className="mb-4 text-sm text-slate-300">Links to tickets and socials are available for members only.</p>
                    <Link
                      href={`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`}
                      className="inline-flex rounded-full bg-[#2374e1] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2d7ff0]"
                    >
                      Sign in to unlock links
                    </Link>
                  </div>
                ) : event.links.length > 0 ? (
                  <div className="border-t border-white/8 pt-5">
                    <h3 className="mb-4 text-lg font-bold text-white">External Links</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {event.links.map((link, index) => (
                        <a
                          key={`${link.url}-${index}`}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between rounded-xl bg-[#202327] px-4 py-3 text-sm text-slate-200 hover:bg-[#262a2f] hover:text-white"
                        >
                          <span className="truncate">
                            <span className="font-semibold">{link.label}</span>
                            <span className="ml-1 text-slate-400">({link.type})</span>
                          </span>
                          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </article>

            <article id="feedback" className={`${panelClass} p-5 sm:p-6`}>
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
                    <div className="grid gap-2 text-sm md:grid-cols-3">
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
                      <div className="grid gap-3 lg:grid-cols-2">
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

          <aside className="order-1 space-y-6 xl:order-2">
            <article className={`${accentPanelClass} p-5`}>
              {isHost && event.coverUrl && event.coverStatus !== "approved" ? (
                <div className="mb-3 rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                  Cover review status: {event.coverStatus}.
                </div>
              ) : null}

              <div className="mb-4 flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Going</p>
                  <p className="mt-1 text-2xl font-black text-white">{isAuthenticated ? counts.going : "Locked"}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Capacity</p>
                  <p className="mt-1 text-lg font-semibold text-white">{event.capacity ?? "Open"}</p>
                </div>
              </div>

              <div className="rounded-2xl bg-[#202327] p-4">
                <p className="text-sm font-semibold text-white">Quick stats</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Capacity</p>
                    <p className="mt-1 text-2xl font-black text-white">{event.capacity ?? "Open"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Attendance</p>
                    <p className="mt-1 text-2xl font-black text-white">{isAuthenticated ? counts.going : "Locked"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Waitlist</p>
                    <p className="mt-1 text-xl font-bold text-white">{counts.waitlist}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Visibility</p>
                    <p className="mt-1 text-sm font-semibold capitalize text-white">{event.visibility}</p>
                  </div>
                </div>
              </div>
            </article>

            <article className={`${panelClass} p-5`}>
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
                      <div className="h-10 w-10 overflow-hidden rounded-full border border-white/20 bg-[#121722]">
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

            <article className={`overflow-hidden ${panelClass}`}>
              <div className="h-44 bg-[#202327]">
                {mapLocation ? (
                  <iframe
                    title="Event map"
                    src={buildOsmEmbedUrl(mapLocation.lat, mapLocation.lon)}
                    className="h-full w-full border-0"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <span className="material-symbols-outlined text-5xl text-cyan-300/45">location_on</span>
                  </div>
                )}
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
                    className="mt-3 inline-block text-sm font-semibold text-sky-300 hover:text-sky-200"
                  >
                    Sign in to unlock exact address
                  </Link>
                ) : mapsUrl ? (
                  <a href={mapsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-sky-300 hover:text-sky-200">
                    Get Directions
                  </a>
                ) : null}
              </div>
            </article>
          </aside>
        </section>

        <div className="mx-auto mt-8 w-full max-w-[1320px] px-4 sm:px-6 lg:px-8">
          <Link
            href="/events"
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-white/82 hover:bg-white/[0.07]"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to events
          </Link>
        </div>
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

      {shareDialogOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[141] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
              onClick={() => setShareDialogOpen(false)}
            >
              <div
                className="w-full max-w-sm rounded-2xl border border-white/12 bg-[#0f1419] p-4 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white/80">
                    {shareDisplayUrl}
                  </div>
                  <button
                    type="button"
                    onClick={() => { void copyShareLink(); setShareDialogOpen(false); }}
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-3 text-sm font-semibold text-[#06121a] hover:brightness-110"
                  >
                    <span className="material-symbols-outlined text-[16px]">content_copy</span>
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareDialogOpen(false)}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 text-white/50 hover:text-white"
                    aria-label="Close"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
