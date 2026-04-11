"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import { normalizePublicAppUrl } from "@/lib/public-app-url";
import Nav from "@/components/Nav";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import { fetchVisibleConnections } from "@/lib/connections/read-model";
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
  getEventMemberLimit,
  mapEventMemberRows,
  mapEventRequestRows,
  mapEventRows,
  mapProfileRows,
  monthToken,
  pickEventFallbackHeroUrl,
  pickEventHeroUrl,
} from "@/lib/events/model";
import { eventAccessTypeShortLabel, eventThreadTabLabel } from "@/lib/events/access";
import { cx } from "@/lib/cx";

type EventAction = "join" | "request" | "cancel_request" | "leave" | "interested" | "not_interested";
type EventResponseState = "interested" | "going" | "waitlist" | "request_sent";
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
type InviteConnection = {
  connectionId: string;
  userId: string;
  displayName: string;
  subtitle: string;
  avatarUrl: string | null;
};

const ACTION_TOAST_MS = 3000;


function cleanParam(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function statusLabel(status: string | null | undefined) {
  if (status === "host") return "Host";
  if (status === "going") return "Joining";
  if (status === "waitlist") return "Waitlist";
  if (status === "interested") return "Interested";
  if (status === "not_interested") return "Not interested";
  if (status === "pending") return "Pending";
  if (status === "accepted") return "Approved";
  if (status === "declined") return "Declined";
  return "";
}

function responseStateFromMembership(membership: EventMemberRecord | null | undefined): EventResponseState | null {
  if (!membership) return null;
  if (membership.status === "going") return "going";
  if (membership.status === "waitlist") return "waitlist";
  if (membership.status === "interested") return "interested";
  return null;
}

function responseStateFromParticipation(
  membership: EventMemberRecord | null | undefined,
  request: EventRequestRecord | null | undefined
): EventResponseState | null {
  if (request?.status === "pending") return "request_sent";
  const membershipState = responseStateFromMembership(membership);
  if (membershipState) return membershipState;
  return null;
}

function responseLabel(state: EventResponseState | null) {
  if (state === "going") return "Joining";
  if (state === "waitlist") return "Waitlist";
  if (state === "request_sent") return "Request sent";
  return "Interested";
}

function responseToneClass(state: EventResponseState | null) {
  if (state === "going") return "border-emerald-300/35 bg-emerald-400/18 text-emerald-50 hover:bg-emerald-400/24";
  if (state === "waitlist") return "border-amber-300/35 bg-amber-400/18 text-amber-50 hover:bg-amber-400/24";
  if (state === "request_sent") return "border-fuchsia-300/35 bg-fuchsia-400/18 text-fuchsia-50 hover:bg-fuchsia-400/24";
  if (state === "interested") {
    return "border-cyan-300/35 bg-[linear-gradient(90deg,rgba(34,211,238,0.16),rgba(217,70,239,0.14))] text-cyan-50 hover:brightness-110";
  }
  return "border-white/12 bg-white/[0.05] text-white/92 hover:bg-white/[0.08]";
}

function responseIcon(state: EventResponseState | null) {
  if (state === "going") return "check_circle";
  if (state === "waitlist") return "schedule";
  if (state === "request_sent") return "mail";
  return "star";
}

function buildLocalMembershipRecord(
  existing: EventMemberRecord | null | undefined,
  params: { eventId: string; userId: string; status: EventMemberRecord["status"] }
): EventMemberRecord {
  const nowIso = new Date().toISOString();
  return {
    id: existing?.id ?? `local-${params.eventId}-${params.userId}`,
    eventId: params.eventId,
    userId: params.userId,
    memberRole: existing?.memberRole ?? "guest",
    status: params.status,
    joinedAt:
      params.status === "going" || params.status === "waitlist"
        ? existing?.joinedAt ?? nowIso
        : null,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

function upsertLocalMembership(records: EventMemberRecord[], nextRecord: EventMemberRecord) {
  const hasExisting = records.some(
    (record) => record.eventId === nextRecord.eventId && record.userId === nextRecord.userId
  );
  if (!hasExisting) return [...records, nextRecord];
  return records.map((record) =>
    record.eventId === nextRecord.eventId && record.userId === nextRecord.userId ? nextRecord : record
  );
}

function removeLocalMembership(records: EventMemberRecord[], params: { eventId: string; userId: string }) {
  return records.filter(
    (record) => !(record.eventId === params.eventId && record.userId === params.userId)
  );
}

function buildLocalRequestRecord(
  existing: EventRequestRecord | null | undefined,
  params: { eventId: string; requesterId: string; requestId?: string | null; status: EventRequestRecord["status"] }
): EventRequestRecord {
  const nowIso = new Date().toISOString();
  return {
    id: params.requestId ?? existing?.id ?? `local-request-${params.eventId}-${params.requesterId}`,
    eventId: params.eventId,
    requesterId: params.requesterId,
    note: existing?.note ?? null,
    status: params.status,
    decidedBy: existing?.decidedBy ?? null,
    decidedAt: existing?.decidedAt ?? null,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
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
  const [inviteConnections, setInviteConnections] = useState<InviteConnection[]>([]);
  const [acceptedConnectionUserIds, setAcceptedConnectionUserIds] = useState<string[]>([]);
  const [sentInviteUserIds, setSentInviteUserIds] = useState<Record<string, true>>({});
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
  const [requestLinkedMemberUserId, setRequestLinkedMemberUserId] = useState("");
  const [requestLinkedPickerOpen, setRequestLinkedPickerOpen] = useState(false);
  const [requestLinkedMemberQuery, setRequestLinkedMemberQuery] = useState("");
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportNote, setReportNote] = useState("");
  const [heroSrc, setHeroSrc] = useState<string | null>(null);
  const [mapLocation, setMapLocation] = useState<OsmGeocodeResult | null>(null);
  const [mapDialogOpen, setMapDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [responseMenuOpen, setResponseMenuOpen] = useState(false);
  const [inviteBusyUserId, setInviteBusyUserId] = useState<string | null>(null);
  const [activeEventTab, setActiveEventTab] = useState<"details" | "people" | "thread">("details");
  const loadRequestIdRef = useRef(0);

  const shareUrl = useMemo(() => {
    const base =
      (typeof window !== "undefined" ? normalizePublicAppUrl(window.location.origin) : "") ||
      normalizePublicAppUrl(process.env.NEXT_PUBLIC_APP_URL) ||
      "";
    return event ? `${base}/events/${event.id}` : "";
  }, [event]);

  const shareDisplayUrl = useMemo(() => shareUrl.replace(/^https?:\/\//, ""), [shareUrl]);
  const filteredRequestLinkedConnections = useMemo(() => {
    const query = requestLinkedMemberQuery.trim().toLowerCase();
    const options = inviteConnections.filter((connection) => connection.userId !== host?.userId);
    if (!query) return options;
    return options.filter((connection) =>
      [connection.displayName, connection.subtitle].join(" ").toLowerCase().includes(query)
    );
  }, [host?.userId, inviteConnections, requestLinkedMemberQuery]);

  useEffect(() => {
    if (!shareDialogOpen && !mapDialogOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShareDialogOpen(false);
        setMapDialogOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mapDialogOpen, shareDialogOpen]);

  useEffect(() => {
    if (!actionInfo) return;
    const timer = window.setTimeout(() => setActionInfo(null), ACTION_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [actionInfo]);

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

    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    const isStale = () => loadRequestIdRef.current !== requestId;

    setLoading(true);
    setError(null);
    setFeedbackError(null);
    setFeedbackInfo(null);

    try {
      const [{ data: sessionData }, { data: authData, error: authErr }] = await Promise.all([
        supabase.auth.getSession(),
        supabase.auth.getUser(),
      ]);

      if (isStale()) return;

      const token = sessionData.session?.access_token ?? null;
      const userId = authErr || !authData.user ? null : authData.user.id;

      setAccessToken(token);
      setMeId(userId);
      setIsAuthenticated(Boolean(userId));

      const eventRes = userId
        ? await supabase.from("events").select("*").eq("id", eventId).maybeSingle()
        : await supabase.rpc("get_public_event_lite", { p_event_id: eventId });

      if (isStale()) return;

      if (eventRes.error) {
        setError(eventRes.error.message);
        return;
      }

      const eventSource = userId ? (eventRes.data ? [eventRes.data] : []) : ((eventRes.data ?? []) as unknown[]);
      const loadedEvent = mapEventRows(eventSource)[0] ?? null;
      if (!loadedEvent) {
        setError("Event not found or access denied.");
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
        setInviteConnections([]);
        setAcceptedConnectionUserIds([]);
        setHost(null);
        setFeedbackSummary(null);
        setFeedbackMine(null);
        setFeedbackCanSubmit(false);
        return;
      }

      const [hostRes, membersRes, myMemberRes, myRequestRes, pendingRes, visibleConnections] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id,display_name,city,country,avatar_url")
          .eq("user_id", loadedEvent.hostUserId)
          .maybeSingle(),
        supabase
          .from("event_members")
          .select("*")
          .eq("event_id", eventId)
          .in("status", ["host", "going", "waitlist", "interested", "not_interested"]),
        supabase.from("event_members").select("*").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
        supabase.from("event_requests").select("*").eq("event_id", eventId).eq("requester_id", userId).maybeSingle(),
        supabase.from("event_requests").select("id", { count: "exact", head: true }).eq("event_id", eventId).eq("status", "pending"),
        fetchVisibleConnections(supabase, userId).catch(() => []),
      ]);

      if (isStale()) return;

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

      const acceptedConnections = visibleConnections.filter(
        (connection) => connection.is_accepted_visible && connection.other_user_id
      );
      setAcceptedConnectionUserIds(acceptedConnections.map((connection) => connection.other_user_id));
      const respondedUserIds = new Set(
        memberRows
          .filter((member) => member.status !== "left")
          .map((member) => member.userId)
          .filter(Boolean)
      );
      const inviteCandidates = acceptedConnections.filter(
        (connection) => connection.other_user_id !== loadedEvent.hostUserId && !respondedUserIds.has(connection.other_user_id)
      );
      const attendeeIds = Array.from(
        new Set([...memberRows.map((member) => member.userId), ...inviteCandidates.map((connection) => connection.other_user_id)]).values()
      ).filter(Boolean);

      if (attendeeIds.length) {
        const attendeeProfilesRes = await supabase
          .from("profiles")
          .select("user_id,display_name,city,country,avatar_url")
          .in("user_id", attendeeIds);

        if (isStale()) return;

        const nextProfilesById = mapProfileRows((attendeeProfilesRes.data ?? []) as unknown[]);
        setProfilesById(nextProfilesById);
        setInviteConnections(
          inviteCandidates
            .map((connection) => {
              const profile = nextProfilesById[connection.other_user_id];
              if (!profile) return null;
              return {
                connectionId: connection.id,
                userId: connection.other_user_id,
                displayName: profile.displayName,
                subtitle: [profile.city, profile.country].filter(Boolean).join(", ") || "Connection",
                avatarUrl: profile.avatarUrl,
              } satisfies InviteConnection;
            })
            .filter((connection): connection is InviteConnection => Boolean(connection))
        );
      } else {
        setProfilesById({});
        setInviteConnections([]);
        setAcceptedConnectionUserIds(acceptedConnections.map((connection) => connection.other_user_id));
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

        if (isStale()) return;

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
    } catch (loadError) {
      if (isStale()) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load event.");
    } finally {
      if (!isStale()) {
        setLoading(false);
      }
    }
  }, [eventId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const counts = useMemo(() => {
    let going = 0;
    let waitlist = 0;
    let interested = 0;
    members.forEach((member) => {
      if (member.status === "host" || member.status === "going") going += 1;
      if (member.status === "waitlist") waitlist += 1;
      if (member.status === "interested") interested += 1;
    });
    return { going, waitlist, interested, total: members.length };
  }, [members]);

  const visibleAttendees = useMemo(() => {
    return members
      .filter((member) => member.status === "host" || member.status === "going")
      .sort((a, b) => {
        const leftRank = a.status === "host" ? 0 : 1;
        const rightRank = b.status === "host" ? 0 : 1;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, 5)
      .map((member) => ({ member, profile: profilesById[member.userId] ?? null }));
  }, [members, profilesById]);

  const popularWithFriends = useMemo(() => {
    const connectionUserIdSet = new Set(acceptedConnectionUserIds);
    return members
      .filter((member) => (member.status === "host" || member.status === "going" || member.status === "interested") && connectionUserIdSet.has(member.userId))
      .sort((a, b) => {
        const leftRank = a.status === "host" || a.status === "going" ? 0 : 1;
        const rightRank = b.status === "host" || b.status === "going" ? 0 : 1;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .map((member) => ({
        member,
        profile: profilesById[member.userId] ?? null,
      }))
      .filter((entry) => Boolean(entry.profile))
      .slice(0, 5);
  }, [acceptedConnectionUserIds, members, profilesById]);

  const isHost = event && meId ? event.hostUserId === meId : false;
  const mapsUrl = event ? buildMapsUrl(event) : null;
  const mapEmbedUrl = mapLocation ? buildOsmEmbedUrl(mapLocation.lat, mapLocation.lon) : null;
  const fallbackHeroUrl = event ? pickEventFallbackHeroUrl(event) : null;
  const preferredHeroUrl = event ? (isHost && event.coverUrl ? event.coverUrl : pickEventHeroUrl(event)) : null;
  const eventMemberLimit = event ? getEventMemberLimit(event) : null;
  const spotsLeft = eventMemberLimit === null ? null : Math.max(eventMemberLimit - counts.going, 0);
  const currentResponseState = responseStateFromParticipation(myMembership, myRequest);
  const respondedCount = counts.going + counts.interested + counts.waitlist;
  const requiresApproval = event?.accessType === "request";
  const isPrivateGroup = event?.accessType === "private_group";
  const threadTabLabel = event ? eventThreadTabLabel(event.accessType) : "Updates";

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
        label: event.accessType === "request" ? "Sign in to Request" : "Sign in to Join",
        action: "join" as EventAction,
        outline: false,
      };
    }
    if (myMembership && (myMembership.status === "going" || myMembership.status === "waitlist")) {
      return { label: event.accessType === "private_group" ? "Leave group" : "Leave event", action: "leave" as EventAction, outline: true };
    }
    if (event.accessType === "request") {
      if (myRequest?.status === "pending") {
        return { label: "Cancel request", action: "cancel_request" as EventAction, outline: true };
      }
      return { label: "Request invite", action: "request" as EventAction, outline: false };
    }
    return { label: event.accessType === "private_group" ? "Join group" : "Join event", action: "join" as EventAction, outline: false };
  }, [event, isAuthenticated, myMembership, myRequest]);

  async function handleAction(action: EventAction | "request_sent_to_interested", requestNoteOverride?: string) {
    if (!event) return;
    const currentEventId = event.id;
    if (!isAuthenticated || !accessToken) {
      router.push(`/auth?next=${encodeURIComponent(`/events/${currentEventId}`)}`);
      return;
    }

    setActionBusy(true);
    setActionError(null);
    setActionInfo(null);

    async function postEventAction(nextAction: EventAction, nextNote?: string) {
      const response = await fetch(`/api/events/${encodeURIComponent(currentEventId)}/join`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: nextAction,
          note: nextAction === "request" ? nextNote ?? null : null,
          linkedMemberUserId: nextAction === "request" ? requestLinkedMemberUserId || null : null,
        }),
      });

      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        status?: string | null;
        request_id?: string | null;
      } | null;
      if (!response.ok || !json?.ok) {
        setActionBusy(false);
        setActionError(json?.error ?? "Action failed.");
        return null;
      }
      return json;
    }

    const json =
      action === "request_sent_to_interested"
        ? ((await postEventAction("cancel_request")) ? await postEventAction("interested") : null)
        : await postEventAction(action, requestNoteOverride);
    if (!json) return;

    const nextMembershipStatus: EventMemberRecord["status"] | null =
      action === "join"
        ? json?.status === "waitlist"
          ? "waitlist"
          : "going"
        : action === "leave" || action === "request" || action === "cancel_request"
          ? null
          : action === "not_interested"
            ? "not_interested"
            : "interested";

    if (meId) {
      if (action === "request") {
        const nextRequest = buildLocalRequestRecord(myRequest, {
          eventId: currentEventId,
          requesterId: meId,
          requestId: typeof json.request_id === "string" ? json.request_id : null,
          status: "pending",
        });
        setMyRequest(nextRequest);
        setMyMembership(null);
        setMembers((prev) => removeLocalMembership(prev, { eventId: currentEventId, userId: meId }));
      } else if (action === "cancel_request") {
        setMyRequest(null);
        setMyMembership(null);
        setMembers((prev) => removeLocalMembership(prev, { eventId: currentEventId, userId: meId }));
      } else if (action === "leave") {
        setMyMembership(null);
        setMembers((prev) => removeLocalMembership(prev, { eventId: currentEventId, userId: meId }));
      } else if (nextMembershipStatus) {
        const nextMembership = buildLocalMembershipRecord(myMembership, {
          eventId: currentEventId,
          userId: meId,
          status: nextMembershipStatus,
        });
        setMyMembership(nextMembership);
        setMembers((prev) => upsertLocalMembership(prev, nextMembership));
        if (action === "join" || action === "request_sent_to_interested") {
          setMyRequest(null);
        }
      }
    }

    if (action === "join") {
      setActionInfo(json?.status === "waitlist" ? "You're on the waitlist for this event." : "You're joining this event.");
    }
    if (action === "request") setActionInfo("Invite request sent.");
    if (action === "cancel_request") setActionInfo("Request cancelled.");
    if (action === "leave") setActionInfo("You left this event.");
    if (action === "interested") setActionInfo("Marked as interested.");
    if (action === "request_sent_to_interested") setActionInfo("Marked as interested.");
    if (action === "not_interested") setActionInfo("Selection cleared.");

    setResponseMenuOpen(false);
    setRequestLinkedMemberUserId("");
    setRequestLinkedPickerOpen(false);
    setRequestLinkedMemberQuery("");
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

  async function sendConnectionInvite(connection: InviteConnection) {
    if (!event || inviteBusyUserId || sentInviteUserIds[connection.userId]) return;
    if (!isAuthenticated) {
      router.push(`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`);
      return;
    }

    setInviteBusyUserId(connection.userId);
    setActionError(null);
    setActionInfo(null);

    try {
      const rpc = await supabase.rpc("send_event_invitation", {
        p_event_id: event.id,
        p_recipient_id: connection.userId,
        p_note: null,
      });
      if (rpc.error) {
        const message = rpc.error.message.toLowerCase();
        if (message.includes("invite_requires_connection")) {
          throw new Error("You can only invite accepted connections.");
        }
        if (message.includes("cannot_invite_self")) {
          throw new Error("You cannot invite yourself.");
        }
        if (message.includes("event_not_found")) {
          throw new Error("Event not found.");
        }
        if (message.includes("event_not_open")) {
          throw new Error("Only published events can be invited.");
        }
        throw rpc.error;
      }

      setSentInviteUserIds((prev) => ({ ...prev, [connection.userId]: true }));
      setActionInfo(`Invite sent to ${connection.displayName}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not send invite.");
    } finally {
      setInviteBusyUserId(null);
    }
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
            <div className="mx-auto max-w-[920px] px-3 pt-3 sm:px-5 sm:pt-5">
              <div className="overflow-hidden rounded-[18px] bg-[#0f1113]">
                <div
                  className="relative w-full bg-[#0c1118]"
                  style={{ aspectRatio: String(1920 / 1005) }}
                >
                  {heroSrc ? (
                    <>
                      <img
                        src={heroSrc}
                        alt={event.title}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={() => {
                          if (fallbackHeroUrl && heroSrc !== fallbackHeroUrl) {
                            setHeroSrc(fallbackHeroUrl);
                            return;
                          }
                          setHeroSrc(null);
                        }}
                      />
                    </>
                  ) : (
                    <div className="h-full w-full bg-[#0f121a]" />
                  )}
                </div>
              </div>
            </div>

            <div className="relative border-t border-white/8 px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
              {heroSrc ? (
                <>
                  <div
                    className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-[0.18] blur-2xl scale-110"
                    style={{ backgroundImage: `url('${heroSrc.replace(/'/g, "\\'")}')` }}
                  />
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(10,16,24,0.92)_0%,rgba(16,23,31,0.88)_42%,rgba(30,18,38,0.9)_100%)]" />
                </>
              ) : null}
              <div className="relative grid gap-4 lg:grid-cols-[84px_minmax(0,1fr)_auto] lg:items-start">
                <div className="hidden lg:block">
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#202327]">
                    <div className="bg-[linear-gradient(90deg,#22d3ee,#d946ef)] px-4 py-1 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-[#06121a]">
                      {monthToken(event.startsAt)}
                    </div>
                    <div className="bg-[linear-gradient(180deg,rgba(34,211,238,0.14),rgba(217,70,239,0.08))] px-4 py-3 text-center">
                      <div className="text-[34px] font-black leading-none text-white">{dayToken(event.startsAt)}</div>
                    </div>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="hidden flex-wrap items-center gap-2 sm:flex lg:hidden">
                    <div className="inline-flex items-center overflow-hidden rounded-xl border border-white/10 bg-[#202327]">
                      <span className="bg-[linear-gradient(90deg,#22d3ee,#d946ef)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#06121a]">
                        {monthToken(event.startsAt)}
                      </span>
                      <span className="bg-[linear-gradient(180deg,rgba(34,211,238,0.14),rgba(217,70,239,0.08))] px-3 py-1 text-sm font-black text-white">{dayToken(event.startsAt)}</span>
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
                      {eventAccessTypeShortLabel(event.accessType)}
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
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setResponseMenuOpen(false);
                        void shareEvent();
                      }}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.08]"
                    >
                      <span className="material-symbols-outlined text-[18px]">share</span>
                      Share
                    </button>
                    {!isHost ? (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            if (!isAuthenticated) {
                              router.push(`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`);
                              return;
                            }
                            if (!currentResponseState && myRequest?.status !== "pending") {
                              void handleAction("interested");
                              return;
                            }
                            setResponseMenuOpen((open) => !open);
                            setActionError(null);
                          }}
                          disabled={actionBusy}
                          className={cx(
                            "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition",
                            responseToneClass(currentResponseState),
                            actionBusy && "cursor-not-allowed opacity-60"
                          )}
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {responseIcon(currentResponseState)}
                          </span>
                          {responseLabel(currentResponseState)}
                          {currentResponseState === "interested" || currentResponseState === "request_sent" ? (
                            <span className="material-symbols-outlined text-[16px]">expand_more</span>
                          ) : null}
                        </button>

                        {responseMenuOpen ? (
                          <div className="absolute right-0 top-[52px] z-20 w-[260px] rounded-2xl border border-white/10 bg-[#202327] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
                            <button
                              type="button"
                              onClick={() => {
                                setResponseMenuOpen(false);
                                void handleAction(
                                  requiresApproval && myRequest?.status === "pending"
                                    ? "request_sent_to_interested"
                                    : "interested"
                                );
                              }}
                              className={cx(
                                "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm",
                                currentResponseState === "interested" ? "bg-cyan-400/14 text-cyan-100" : "text-white hover:bg-white/6"
                              )}
                            >
                              <span className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">star</span>
                                Interested
                              </span>
                              {currentResponseState === "interested" ? <span className="text-cyan-200">●</span> : null}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setResponseMenuOpen(false);
                                if (cta.action === "request") {
                                  setRequestModalOpen(true);
                                  return;
                                }
                                if (cta.action === "cancel_request") {
                                  void handleAction("cancel_request");
                                  return;
                                }
                                void handleAction("join");
                              }}
                              className={cx(
                                "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm",
                                currentResponseState === "going" || currentResponseState === "waitlist"
                                  ? "bg-emerald-400/14 text-emerald-100"
                                  : currentResponseState === "request_sent"
                                    ? "bg-fuchsia-400/14 text-fuchsia-100"
                                  : "text-white hover:bg-white/6"
                              )}
                            >
                              <span className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">
                                  {cta.action === "request" ? "mail" : cta.action === "cancel_request" ? "close" : "check_circle"}
                                </span>
                                {cta.action === "request"
                                  ? "Request joining"
                                  : cta.action === "cancel_request"
                                    ? "Cancel request"
                                    : isPrivateGroup
                                      ? "Join group"
                                      : "Joining"}
                              </span>
                              {currentResponseState === "going" || currentResponseState === "waitlist" ? (
                                <span className="text-emerald-200">●</span>
                              ) : currentResponseState === "request_sent" ? (
                                <span className="text-fuchsia-200">●</span>
                              ) : null}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setResponseMenuOpen(false);
                                void handleAction(
                                  requiresApproval && myRequest?.status === "pending"
                                    ? "cancel_request"
                                    : "not_interested"
                                );
                              }}
                              className={cx(
                                "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm",
                                "text-white hover:bg-white/6"
                              )}
                            >
                              <span className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">cancel</span>
                                Not interested
                              </span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {isHost ? (
                      <>
                        {event.accessType === "request" && (
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
                            eventAccessType: event.accessType,
                            chatMode: event.chatMode,
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
                    ) : null}
                    {!isHost ? (
                      <button
                        type="button"
                        onClick={() => {
                          setResponseMenuOpen(false);
                          setReportModalOpen(true);
                          setActionError(null);
                        }}
                        disabled={actionBusy}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/12 bg-[#2d3035] text-white hover:bg-[#373a40] disabled:opacity-60"
                        aria-label="Report event"
                        title="Report event"
                      >
                        <span className="material-symbols-outlined text-[18px]">flag</span>
                      </button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400 lg:justify-end">
                    {isAuthenticated && myMembership && myMembership.status !== "not_interested" ? (
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

        <section className="mx-auto mt-5 w-full max-w-[1220px] px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap gap-2 rounded-2xl border border-white/8 bg-[#1b1d21] p-2">
            {[
              { key: "details" as const, label: "Details", icon: "info" },
              { key: "people" as const, label: "People", icon: "groups" },
              { key: "thread" as const, label: threadTabLabel, icon: threadTabLabel === "Chat" ? "forum" : "campaign" },
            ].map((tab) => {
              const selected = activeEventTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveEventTab(tab.key)}
                  className={cx(
                    "inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition sm:flex-none sm:px-4",
                    selected
                      ? "bg-[linear-gradient(90deg,#00F5FF_0%,#FF00FF_100%)] text-[#071116]"
                      : "border border-white/10 bg-white/[0.03] text-white/72 hover:bg-white/[0.07] hover:text-white"
                  )}
                >
                  <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="mx-auto mt-5 grid w-full max-w-[1220px] grid-cols-1 gap-5 px-4 sm:px-6 xl:grid-cols-[minmax(0,2fr)_360px] lg:px-8">
          <div className="order-1 space-y-6 xl:order-1">
            {activeEventTab === "thread" ? (
              <article className={`${panelClass} p-5 sm:p-6`}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">{threadTabLabel}</p>
                    <h2 className="mt-2 text-[22px] font-bold text-white">
                      {threadTabLabel === "Chat" ? "Private Group chat" : "Event updates"}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      {threadTabLabel === "Chat"
                        ? "Plan your dance life together with the members of this private group."
                        : "Organisers post broadcast updates for this event thread."}
                    </p>
                  </div>
                  <Link
                    href={`/messages?thread=${encodeURIComponent(`event:${event.id}`)}`}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(90deg,#00F5FF_0%,#FF00FF_100%)] px-4 py-2.5 text-sm font-bold text-[#071116] hover:brightness-110"
                  >
                    <span className="material-symbols-outlined text-[18px]">{threadTabLabel === "Chat" ? "forum" : "campaign"}</span>
                    Open {threadTabLabel}
                  </Link>
                </div>
                {event.chatMode === "broadcast" ? (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                    Broadcast mode: only organisers can post here.
                  </div>
                ) : null}
              </article>
            ) : null}

            {activeEventTab === "people" ? (
              <article className={`${panelClass} p-5 sm:p-6`}>
                <h2 className="text-[22px] font-bold text-white">People</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-[#202327] px-4 py-4 text-center">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Joining</p>
                    <p className="mt-2 text-2xl font-black text-white">{counts.going}</p>
                  </div>
                  <div className="rounded-2xl bg-[#202327] px-4 py-4 text-center">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Interested</p>
                    <p className="mt-2 text-2xl font-black text-white">{counts.interested}</p>
                  </div>
                  <div className="rounded-2xl bg-[#202327] px-4 py-4 text-center">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Waitlist</p>
                    <p className="mt-2 text-2xl font-black text-white">{counts.waitlist}</p>
                  </div>
                </div>
              </article>
            ) : null}

            <article className={`${panelClass} overflow-hidden`}>
              <div className="border-b border-white/8 px-5 py-4 sm:px-6">
                <h2 className="text-[22px] font-bold text-white">Details</h2>
              </div>
              <div className="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
                {isAuthenticated ? (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-400">
                      {respondedCount} responded
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-3">
                        {visibleAttendees.length > 0 ? (
                          visibleAttendees.map((entry) => (
                            <div
                              key={entry.member.id}
                              title={entry.profile?.displayName ?? "Member"}
                              className="h-10 w-10 overflow-hidden rounded-full border-2 border-[#18191a] bg-[#121722]"
                            >
                              {entry.profile?.avatarUrl ? (
                                <img src={entry.profile.avatarUrl} alt={entry.profile.displayName} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-xs font-bold text-cyan-100">
                                  {(entry.profile?.displayName ?? "M").slice(0, 1).toUpperCase()}
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#18191a] bg-[#121722] text-cyan-100">
                            <span className="material-symbols-outlined text-[18px]">groups</span>
                          </div>
                        )}
                        {counts.going > visibleAttendees.length ? (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#18191a] bg-[#202327] text-xs font-bold text-white">
                            +{counts.going - visibleAttendees.length}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-400">Sign in to see who is joining or interested.</p>
                    <Link
                      href={`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`}
                      className="inline-flex rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/25"
                    >
                      Sign in
                    </Link>
                  </div>
                )}

                <p className="text-[15px] leading-7 text-slate-200">
                  {event.description?.trim() || "The host has not added a detailed description yet."}
                </p>

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
                        {feedbackBusy ? "Saving..." : feedbackMine ? "Update feedback" : "Submit feedback"}
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

          <aside className="order-2 space-y-6 xl:order-2">
            <article className={`overflow-hidden ${panelClass}`}>
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Location</p>
                  <p className="mt-1 text-base font-semibold text-white">{event.venueName || "Venue details"}</p>
                </div>
                {mapEmbedUrl ? (
                  <button
                    type="button"
                    onClick={() => setMapDialogOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white hover:bg-white/[0.08]"
                  >
                    <span className="material-symbols-outlined text-[16px]">open_in_full</span>
                    Expand
                  </button>
                ) : null}
              </div>
              <div className="h-44 bg-[#202327]">
                {mapLocation ? (
                  <iframe
                    title="Event map"
                    src={mapEmbedUrl ?? undefined}
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
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-300 hover:text-sky-200">
                      <span className="material-symbols-outlined text-[16px]">route</span>
                      Get Directions
                    </a>
                    {mapEmbedUrl ? (
                      <button
                        type="button"
                        onClick={() => setMapDialogOpen(true)}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-200 hover:text-cyan-100"
                      >
                        <span className="material-symbols-outlined text-[16px]">zoom_out_map</span>
                        Open larger map
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-4 border-t border-white/8 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Hosted by</p>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-12 w-12 overflow-hidden rounded-full bg-[#15171a]">
                      {host?.avatarUrl ? <img src={host.avatarUrl} alt={host.displayName} className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{host?.displayName ?? "Event host"}</p>
                      <p className="text-xs text-slate-400">{[host?.city, host?.country].filter(Boolean).join(", ") || "ConXion organizer"}</p>
                    </div>
                  </div>
                </div>
              </div>
            </article>

            <article className={`${accentPanelClass} p-5`}>
              {isHost && event.coverUrl && event.coverStatus !== "approved" ? (
                <div className="mb-3 rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                  Cover review status: {event.coverStatus}.
                </div>
              ) : null}

              <div className="mb-4">
                <h3 className="text-lg font-bold text-white">Guests</h3>
              </div>

              {isAuthenticated ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-[#202327] px-4 py-4 text-center">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Joining</p>
                      <p className="mt-2 text-2xl font-black text-white">{counts.going}</p>
                    </div>
                    <div className="rounded-2xl bg-[#202327] px-4 py-4 text-center">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Interested</p>
                      <p className="mt-2 text-2xl font-black text-white">{counts.interested}</p>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-[#202327] p-4">
                    <p className="text-sm font-semibold text-white">People Joining</p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex -space-x-3">
                        {visibleAttendees.length > 0 ? (
                          visibleAttendees.map((entry) => (
                            <div
                              key={entry.member.id}
                              title={entry.profile?.displayName ?? "Member"}
                              className="h-11 w-11 overflow-hidden rounded-full border-2 border-[#202327] bg-[#121722]"
                            >
                              {entry.profile?.avatarUrl ? (
                                <img src={entry.profile.avatarUrl} alt={entry.profile.displayName} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-xs font-bold text-cyan-100">
                                  {(entry.profile?.displayName ?? "M").slice(0, 1).toUpperCase()}
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#202327] bg-[#121722] text-cyan-100">
                            <span className="material-symbols-outlined text-[18px]">groups</span>
                          </div>
                        )}
                        {counts.going > visibleAttendees.length ? (
                          <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#202327] bg-[#17191d] text-xs font-bold text-white">
                            +{counts.going - visibleAttendees.length}
                          </div>
                        ) : null}
                      </div>
                      {visibleAttendees.length === 0 ? <p className="text-sm text-slate-400">No one has joined yet.</p> : null}
                    </div>
                  </div>

                  {popularWithFriends.length > 0 ? (
                    <div className="rounded-2xl bg-[#202327] p-4">
                      <h4 className="text-sm font-semibold text-white">Popular with friends</h4>
                      <div className="mt-3 space-y-3">
                        {popularWithFriends.map((entry) => (
                          <div key={entry.member.id} className="flex items-center gap-3">
                            <div className="h-10 w-10 overflow-hidden rounded-full border border-white/20 bg-[#121722]">
                              {entry.profile?.avatarUrl ? (
                                <img src={entry.profile.avatarUrl} alt={entry.profile.displayName} className="h-full w-full object-cover" />
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-white">{entry.profile?.displayName ?? "Member"}</p>
                              <p className="text-xs text-slate-400">{statusLabel(entry.member.status)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {inviteConnections.length > 0 ? (
                    <div className="rounded-2xl bg-[#202327] p-4">
                      <h4 className="text-sm font-semibold text-white">Invite your connections</h4>
                      <div className="mt-3 space-y-3">
                        {inviteConnections.slice(0, 5).map((connection) => {
                          const alreadySent = Boolean(sentInviteUserIds[connection.userId]);
                          const busy = inviteBusyUserId === connection.userId;
                          return (
                            <div key={connection.connectionId} className="flex items-center gap-3">
                              <div className="h-10 w-10 overflow-hidden rounded-full border border-white/20 bg-[#121722]">
                                {connection.avatarUrl ? (
                                  <img src={connection.avatarUrl} alt={connection.displayName} className="h-full w-full object-cover" />
                                ) : null}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-white">{connection.displayName}</p>
                                <p className="truncate text-xs text-slate-400">{connection.subtitle}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void sendConnectionInvite(connection)}
                                disabled={alreadySent || busy}
                                className={cx(
                                  "inline-flex min-w-[96px] items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold transition",
                                  alreadySent
                                    ? "border border-white/10 bg-white/[0.05] text-white/55"
                                    : "bg-[linear-gradient(90deg,#00F5FF_0%,#FF00FF_100%)] text-[#0A0A0A] shadow-[0_0_20px_rgba(13,245,255,0.18)] hover:brightness-110",
                                  busy && "opacity-70"
                                )}
                              >
                                {busy ? "Sending..." : alreadySent ? "Invited" : "Invite"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-400">Sign in to view attendee identities, friend activity, and quick invites.</p>
              )}
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

        {actionInfo ? (
          <div className="pointer-events-none fixed bottom-5 right-5 z-[82] max-w-sm rounded-2xl border border-cyan-300/35 bg-[#0f1a1f]/95 px-4 py-3 text-sm text-cyan-50 shadow-[0_14px_40px_rgba(0,0,0,0.42)] backdrop-blur">
            {actionInfo}
          </div>
        ) : null}
      </main>

      <ConfirmationDialog
        open={requestModalOpen}
        title="Request event access"
        description="Add an optional note to help the host review your request."
        summary={
          <div className="space-y-2">
            <div>
              <button
                type="button"
                onClick={() => setRequestLinkedPickerOpen((prev) => !prev)}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-4 text-sm font-semibold text-white transition hover:border-cyan-300/35 hover:text-cyan-100"
              >
                <span className="material-symbols-outlined text-[16px]">group_add</span>
                Add Member
              </button>
              {requestLinkedMemberUserId ? (
                <p className="mt-2 text-xs text-cyan-100">
                  Added: {inviteConnections.find((connection) => connection.userId === requestLinkedMemberUserId)?.displayName ?? "Connection"}
                </p>
              ) : null}
              {requestLinkedPickerOpen ? (
                <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <input
                    type="text"
                    value={requestLinkedMemberQuery}
                    onChange={(entry) => setRequestLinkedMemberQuery(entry.target.value)}
                    placeholder="Search connection..."
                    className="mb-3 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                  />
                  <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                    <button
                      type="button"
                      onClick={() => setRequestLinkedMemberUserId("")}
                      className={cx(
                        "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition",
                        !requestLinkedMemberUserId
                          ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100"
                          : "border-white/10 bg-black/20 text-white/75 hover:border-white/20 hover:text-white"
                      )}
                    >
                      <span>No extra member</span>
                      {!requestLinkedMemberUserId ? (
                        <span className="material-symbols-outlined text-[16px]">check</span>
                      ) : null}
                    </button>
                    {filteredRequestLinkedConnections.map((connection) => {
                      const isSelected = requestLinkedMemberUserId === connection.userId;
                      return (
                        <button
                          key={connection.userId}
                          type="button"
                          onClick={() => {
                            setRequestLinkedMemberUserId(connection.userId);
                            setRequestLinkedPickerOpen(false);
                            setRequestLinkedMemberQuery("");
                          }}
                          className={cx(
                            "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition",
                            isSelected
                              ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100"
                              : "border-white/10 bg-black/20 text-white/80 hover:border-white/20 hover:text-white"
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{connection.displayName}</span>
                            <span className="block truncate text-xs text-white/45">{connection.subtitle}</span>
                          </span>
                          {isSelected ? <span className="material-symbols-outlined text-[16px]">check</span> : null}
                        </button>
                      );
                    })}
                    {filteredRequestLinkedConnections.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/10 bg-black/15 px-3 py-3 text-sm text-white/45">
                        No matching connections.
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            <textarea
              rows={3}
              value={requestNote}
              onChange={(entry) => setRequestNote(entry.target.value)}
              placeholder="Optional note for the host..."
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
            />
          </div>
        }
        confirmLabel="Send request"
        onCancel={() => {
          setRequestModalOpen(false);
          setRequestNote("");
          setRequestLinkedMemberUserId("");
          setRequestLinkedPickerOpen(false);
          setRequestLinkedMemberQuery("");
        }}
        onConfirm={() => {
          setRequestModalOpen(false);
          void handleAction("request", requestNote.trim() || undefined);
          setRequestNote("");
          setRequestLinkedMemberUserId("");
          setRequestLinkedPickerOpen(false);
          setRequestLinkedMemberQuery("");
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
        confirmLabel="Submit report"
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

      {mapDialogOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[142] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm"
              onClick={() => setMapDialogOpen(false)}
            >
              <div
                className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/12 bg-[#0f1419] shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-white">{event.venueName || "Event map"}</p>
                    <p className="truncate text-sm text-slate-400">
                      {[event.venueAddress, event.city, event.country].filter(Boolean).join(", ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {mapsUrl ? (
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-white/[0.08]"
                      >
                        <span className="material-symbols-outlined text-[16px]">route</span>
                        Directions
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setMapDialogOpen(false)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-white/60 hover:text-white"
                      aria-label="Close map"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                </div>
                <div className="min-h-[320px] flex-1 bg-[#202327]">
                  {mapEmbedUrl ? (
                    <iframe
                      title="Expanded event map"
                      src={mapEmbedUrl}
                      className="h-[70vh] w-full border-0"
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                  ) : (
                    <div className="flex h-full min-h-[320px] items-center justify-center">
                      <span className="material-symbols-outlined text-6xl text-cyan-300/45">location_on</span>
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
