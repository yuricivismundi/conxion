"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import { normalizePublicAppUrl } from "@/lib/public-app-url";
import { haptic } from "@/lib/haptic";
import Nav from "@/components/Nav";
import { useToast } from "@/components/Toast";
import EventHeroImage from "@/components/events/EventHeroImage";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import CreateGroupFromEventModal from "@/components/CreateGroupFromEventModal";
import { getPlanIdFromMeta, getPlanLimits } from "@/lib/billing/limits";
import { fetchVisibleConnections } from "@/lib/connections/read-model";
import { buildOsmEmbedUrl } from "@/lib/maps/osm";
import type { MapboxPlaceResult } from "@/lib/maps/mapbox";
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
import { canPostToEventThread, eventAccessTypeShortLabel, eventThreadTabLabel, isEventDiscoverable } from "@/lib/events/access";
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
type EventReview = {
  id: string;
  quality: number;
  note: string;
  created_at: string;
  author_id: string;
  profiles: {
    display_name: string;
    avatar_url: string | null;
    city: string | null;
    country: string | null;
  } | null;
};
type InviteConnection = {
  connectionId: string;
  userId: string;
  displayName: string;
  subtitle: string;
  avatarUrl: string | null;
};

const ACTION_TOAST_MS = 3000;
const POST_TAG_REGEX = /\[\[post_tag:(update|announcement|ticket|reminder)\]\]\n?/;

function parseDiscussionBody(raw: string) {
  const match = raw.match(POST_TAG_REGEX);
  const postTag = match ? match[1] : undefined;
  const body = postTag ? raw.replace(POST_TAG_REGEX, "") : raw;
  return { postTag, body };
}


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
  if (state === "going") return "border-cyan-300/35 bg-[linear-gradient(90deg,rgba(0,245,255,0.16),rgba(255,0,255,0.12))] text-cyan-50 hover:brightness-110";
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
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [groupMonthlyLimit, setGroupMonthlyLimit] = useState<number | null>(null);
  const [groupsUsedThisMonth, setGroupsUsedThisMonth] = useState<number>(0);

  const [event, setEvent] = useState<EventRecord | null>(null);
  const [suggestedEvents, setSuggestedEvents] = useState<EventRecord[]>([]);
  const [suggestedEventsLoading, setSuggestedEventsLoading] = useState(false);
  const [host, setHost] = useState<LiteProfile | null>(null);
  const [members, setMembers] = useState<EventMemberRecord[]>([]);
  const [myMembership, setMyMembership] = useState<EventMemberRecord | null>(null);
  const [myRequest, setMyRequest] = useState<EventRequestRecord | null>(null);
  const [profilesById, setProfilesById] = useState<Record<string, LiteProfile>>({});
  const [inviteConnections, setInviteConnections] = useState<InviteConnection[]>([]);
  const [acceptedConnectionUserIds, setAcceptedConnectionUserIds] = useState<string[]>([]);
  const [sentInviteUserIds, setSentInviteUserIds] = useState<Record<string, true>>({});
  const [inviteMonthlyLimit, setInviteMonthlyLimit] = useState<number | null>(10);
  const [inviteMonthlyUsed, setInviteMonthlyUsed] = useState(0);
  const [inviteLimitModalOpen, setInviteLimitModalOpen] = useState(false);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [hasEnded, setHasEnded] = useState(false);
  const [isHappeningNow, setIsHappeningNow] = useState(false);
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary | null>(null);
  const [feedbackMine, setFeedbackMine] = useState<FeedbackMine | null>(null);
  const [feedbackCanSubmit, setFeedbackCanSubmit] = useState(false);
  const [editReviewSecsLeft, setEditReviewSecsLeft] = useState(0);
  useEffect(() => {
    if (!feedbackMine) { setEditReviewSecsLeft(0); return; }
    const WINDOW = 15 * 60 * 1000;
    const calc = () => Math.max(0, Math.ceil((new Date(feedbackMine.created_at).getTime() + WINDOW - Date.now()) / 1000));
    setEditReviewSecsLeft(calc());
    const t = setInterval(() => { const s = calc(); setEditReviewSecsLeft(s); if (s === 0) clearInterval(t); }, 1000);
    return () => clearInterval(t);
  }, [feedbackMine]);
  const canEditReview = editReviewSecsLeft > 0;
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackInfo, setFeedbackInfo] = useState<string | null>(null);
  const [feedbackQuality, setFeedbackQuality] = useState(5);
  const [feedbackHappened, setFeedbackHappened] = useState(true);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackVisibility, setFeedbackVisibility] = useState<"private" | "public">("public");
  const [reviews, setReviews] = useState<EventReview[]>([]);
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  const [reviewStars, setReviewStars] = useState(5);
  const [reviewHoverStars, setReviewHoverStars] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewsModalOpen, setReviewsModalOpen] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestNote, setRequestNote] = useState("");
  const [requestLinkedMemberUserId, setRequestLinkedMemberUserId] = useState("");
  const [requestLinkedPickerOpen, setRequestLinkedPickerOpen] = useState(false);
  const [requestLinkedMemberQuery, setRequestLinkedMemberQuery] = useState("");
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportNote, setReportNote] = useState("");
  const [mapLocation, setMapLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [mapDialogOpen, setMapDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const responseBtnRef = useRef<HTMLButtonElement>(null);
  const [shareBtnRect, setShareBtnRect] = useState<DOMRect | null>(null);
  const [moreBtnRect, setMoreBtnRect] = useState<DOMRect | null>(null);
  const [responseBtnRect, setResponseBtnRect] = useState<DOMRect | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteSelected, setInviteSelected] = useState<Record<string, true>>({});
  const [inviteSendBusy, setInviteSendBusy] = useState(false);
  const [responseMenuOpen, setResponseMenuOpen] = useState(false);
  const [inviteBusyUserId, setInviteBusyUserId] = useState<string | null>(null);
  const [activeEventTab, setActiveEventTab] = useState<"details" | "discussion">("details");
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [discussionMessages, setDiscussionMessages] = useState<Array<{ id: string; senderId: string; body: string; createdAt: string; postTag?: string }>>([]);
  const [discussionLoading, setDiscussionLoading] = useState(false);
  const [discussionBody, setDiscussionBody] = useState("");
  const [discussionPostTag, setDiscussionPostTag] = useState<"update" | "announcement" | "ticket" | "reminder">("update");
  const [discussionSending, setDiscussionSending] = useState(false);
  const [discussionThreadId, setDiscussionThreadId] = useState<string | null>(null);
  const discussionLoadedRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const suggestedEventsScrollerRef = useRef<HTMLDivElement | null>(null);

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
    if (!shareDialogOpen && !mapDialogOpen && !shareMenuOpen && !moreMenuOpen && !inviteModalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShareDialogOpen(false);
        setMapDialogOpen(false);
        setShareMenuOpen(false);
        setMoreMenuOpen(false);
        setInviteModalOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mapDialogOpen, shareDialogOpen, shareMenuOpen, moreMenuOpen, inviteModalOpen]);

  // Scroll-lock when any full-screen modal is open
  useEffect(() => {
    const anyOpen = shareDialogOpen || mapDialogOpen || inviteModalOpen;
    if (anyOpen) {
      document.body.classList.add("modal-open");
    } else {
      document.body.classList.remove("modal-open");
    }
    return () => { document.body.classList.remove("modal-open"); };
  }, [shareDialogOpen, mapDialogOpen, inviteModalOpen]);

  useEffect(() => {
    if (!shareMenuOpen && !moreMenuOpen && !responseMenuOpen) return;
    const closeMenus = () => {
      setShareMenuOpen(false);
      setMoreMenuOpen(false);
      setResponseMenuOpen(false);
    };
    window.addEventListener("scroll", closeMenus, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", closeMenus, { capture: true });
  }, [shareMenuOpen, moreMenuOpen, responseMenuOpen]);

  useEffect(() => {
    if (!actionInfo) return;
    const timer = window.setTimeout(() => setActionInfo(null), ACTION_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [actionInfo]);

  async function copyShareLink() {
    haptic(10);
    if (!shareUrl) return;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: event?.title ?? "Event", url: shareUrl });
        return;
      }
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
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setActionError("Could not copy the event link.");
    }
  }


  const scrollSuggestedEvents = useCallback((direction: "left" | "right") => {
    const container = suggestedEventsScrollerRef.current;
    if (!container) return;
    const amount = Math.max(280, Math.round(container.clientWidth * 0.82));
    container.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  }, []);

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
      let userId = authErr || !authData.user ? null : authData.user.id;

      // Verify the profile row exists. Stale/incomplete sessions get
      // treated as anonymous so we don't flash authenticated-only UI.
      if (userId) {
        const profileCheck = await supabase
          .from("profiles")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (isStale()) return;
        if (!profileCheck.error && !profileCheck.data) {
          userId = null;
        }
      }

      setAccessToken(token);
      setMeId(userId);
      setIsAuthenticated(Boolean(userId));
      if (authData.user) {
        const meta = (authData.user.user_metadata ?? {}) as Record<string, unknown>;
        const planId = getPlanIdFromMeta(meta, Boolean(meta.is_verified));
        const limits = getPlanLimits(planId);
        setGroupMonthlyLimit(limits.privateGroupsTotal);
        setInviteMonthlyLimit(limits.eventInvitesPerMonth);

        // Load this month's invite count + already-invited users for this event
        const monthStart = new Date();
        monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
        const [countRes, existingRes] = await Promise.all([
          supabase.from("event_invitations").select("id", { count: "exact", head: true })
            .eq("inviter_user_id", authData.user.id)
            .gte("created_at", monthStart.toISOString()),
          supabase.from("event_invitations").select("recipient_user_id")
            .eq("inviter_user_id", authData.user.id)
            .eq("event_id", eventId),
        ]);
        if (!isStale()) {
          setInviteMonthlyUsed(countRes.count ?? 0);
          const alreadyInvited: Record<string, true> = {};
          for (const row of ((existingRes.data ?? []) as { recipient_user_id: string }[])) {
            alreadyInvited[row.recipient_user_id] = true;
          }
          setSentInviteUserIds(alreadyInvited);
        }
      }

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
      const eventStartsAt = new Date(loadedEvent.startsAt).getTime();
      const eventEndsAt = new Date(loadedEvent.endsAt).getTime();
      const now = Date.now();
      setHasEnded(!Number.isNaN(eventEndsAt) && eventEndsAt <= now);
      setIsHappeningNow(
        !Number.isNaN(eventStartsAt) && eventStartsAt <= now &&
        (!Number.isNaN(eventEndsAt) ? eventEndsAt > now : true)
      );

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
        const seenUserIds = new Set<string>();
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
            .filter((connection): connection is InviteConnection => {
              if (!connection) return false;
              if (seenUserIds.has(connection.userId)) return false;
              seenUserIds.add(connection.userId);
              return true;
            })
        );
      } else {
        setProfilesById({});
        setInviteConnections([]);
        setAcceptedConnectionUserIds(acceptedConnections.map((connection) => connection.other_user_id));
      }

      setFeedbackMine(null);
      setFeedbackCanSubmit(false);
      setFeedbackSummary(null);

      // Fetch public reviews (no auth required) — runs always
      try {
        const reviewsRes = await fetch(`/api/events/${encodeURIComponent(eventId)}/reviews`);
        if (!isStale() && reviewsRes.ok) {
          const rj = (await reviewsRes.json().catch(() => null)) as { ok?: boolean; reviews?: EventReview[] } | null;
          if (rj?.ok) setReviews(rj.reviews ?? []);
        }
      } catch { /* best effort */ }

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
              setFeedbackVisibility(json.mine.visibility ?? "public");
            } else {
              setFeedbackQuality(5);
              setFeedbackHappened(true);
              setFeedbackNote("");
              setFeedbackVisibility("public");
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

  useEffect(() => {
    let cancelled = false;

    async function loadSuggestedEvents() {
      if (!event || event.accessType === "private_group") {
        if (!cancelled) {
          setSuggestedEvents([]);
          setSuggestedEventsLoading(false);
        }
        return;
      }

      setSuggestedEventsLoading(true);
      try {
        const nowIso = new Date().toISOString();
        const soonIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const res = await supabase
          .from("events")
          .select("*")
          .eq("status", "published")
          .gte("starts_at", nowIso)
          .neq("id", event.id)
          .order("starts_at", { ascending: true })
          .limit(60);
        if (cancelled || res.error) {
          if (!cancelled) setSuggestedEvents([]);
          return;
        }

        const currentStyles = new Set(event.styles.map((s) => s.trim().toLowerCase()).filter(Boolean));
        const suggestions = mapEventRows((res.data ?? []) as unknown[])
          .filter((candidate) => candidate.id !== event.id && isEventDiscoverable(candidate.accessType))
          .map((candidate) => {
            const candidateStyles = candidate.styles.map((s) => s.trim().toLowerCase()).filter(Boolean);
            const sharedStyles = candidateStyles.filter((s) => currentStyles.has(s)).length;
            const sameCity = Boolean(event.city && candidate.city && event.city.toLowerCase() === candidate.city.toLowerCase());
            const sameCountry = Boolean(event.country && candidate.country && event.country.toLowerCase() === candidate.country.toLowerCase());
            const sameType = candidate.eventType.trim().toLowerCase() === event.eventType.trim().toLowerCase();
            const upcomingSoon = candidate.startsAt <= soonIso;
            // score: city match, style match, type, soon, popular (interested count as a proxy via member count)
            const score =
              (sameCity ? 10 : 0) +
              (sameCountry && !sameCity ? 3 : 0) +
              sharedStyles * 4 +
              (sameType ? 2 : 0) +
              (upcomingSoon ? 2 : 0);
            return { candidate, score };
          })
          .filter(({ score }) => score > 0)
          .sort((left, right) => right.score - left.score || new Date(left.candidate.startsAt).getTime() - new Date(right.candidate.startsAt).getTime())
          .slice(0, 12)
          .map(({ candidate }) => candidate);

        if (!cancelled) setSuggestedEvents(suggestions);
      } finally {
        if (!cancelled) setSuggestedEventsLoading(false);
      }
    }

    void loadSuggestedEvents();
    return () => {
      cancelled = true;
    };
  }, [event]);

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

  const joiningMembers = useMemo(() => {
    return members
      .filter((member) => member.status === "host" || member.status === "going")
      .sort((a, b) => {
        const leftRank = a.status === "host" ? 0 : 1;
        const rightRank = b.status === "host" ? 0 : 1;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [members]);

  const interestedMembers = useMemo(() => {
    return members
      .filter((member) => member.status === "interested")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [members]);

  const waitlistMembers = useMemo(() => {
    return members
      .filter((member) => member.status === "waitlist")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [members]);

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

  // Attendees list for Create Group modal (going/waitlist/interested, excluding self)
  const groupModalAttendees = useMemo(() => {
    return members
      .filter((m) => ["going", "waitlist", "interested"].includes(m.status) && m.userId !== meId)
      .map((m) => {
        const p = profilesById[m.userId];
        return p ? { userId: m.userId, displayName: p.displayName, avatarUrl: p.avatarUrl ?? null, isAttending: true } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [members, profilesById, meId]);

  // Connections list for Create Group modal
  const attendingUserIds = useMemo(() => new Set(members.map((m) => m.userId)), [members]);
  const groupModalConnections = useMemo(() => {
    const seen = new Set<string>();
    return inviteConnections
      .filter((c) => c.userId !== meId)
      .reduce<{ userId: string; displayName: string; avatarUrl: string | null; isAttending: boolean }[]>((acc, c) => {
        if (!seen.has(c.userId)) {
          seen.add(c.userId);
          acc.push({ userId: c.userId, displayName: c.displayName, avatarUrl: c.avatarUrl, isAttending: attendingUserIds.has(c.userId) });
        }
        return acc;
      }, []);
  }, [inviteConnections, meId, attendingUserIds]);
  const mapsUrl = event ? buildMapsUrl(event) : null;
  const mapEmbedUrl = mapLocation ? buildOsmEmbedUrl(mapLocation.lat, mapLocation.lon) : null;
  const fallbackHeroUrl = event ? pickEventFallbackHeroUrl(event) : null;
  const preferredHeroUrl = event ? pickEventHeroUrl(event) : null;
  const eventMemberLimit = event ? getEventMemberLimit(event) : null;
  const spotsLeft = eventMemberLimit === null ? null : Math.max(eventMemberLimit - counts.going, 0);
  const currentResponseState = responseStateFromParticipation(myMembership, myRequest);
  const respondedCount = counts.going + counts.interested + counts.waitlist;
  const requiresApproval = event?.accessType === "request";
  const isPrivateGroup = event?.accessType === "private_group";
  const threadTabLabel = event ? eventThreadTabLabel(event.accessType) : "Updates";
  const canInviteConnections = Boolean(
    event &&
      (
        isHost ||
        (
          event.guestsCanInvite &&
          myMembership &&
          ["host", "going", "waitlist"].includes(myMembership.status)
        )
      )
  );
  const threadHeading = !event
    ? "Event updates"
    : event.accessType === "private_group"
    ? "Private Group chat"
    : event.chatMode === "discussion"
    ? "Event chat"
    : "Event updates";
  const threadDescription = !event
    ? "Organisers post broadcast updates for this event thread."
    : event.accessType === "private_group"
    ? "Plan your dance life together with the members of this private group."
    : event.chatMode === "discussion"
    ? event.approveMessages
      ? "Joined guests can post one message each. New messages stay pending until the organiser approves them."
      : "Joined guests can post one message each in this event thread."
    : "Organisers post broadcast updates for this event thread.";

  useEffect(() => {
    if (activeEventTab !== "discussion" || !event) return;
    if (discussionLoadedRef.current) return;
    discussionLoadedRef.current = true;

    let cancelled = false;
    async function loadDiscussion() {
      if (!event) return;
      setDiscussionLoading(true);
      try {
        const threadRes = await supabase
          .from("threads")
          .select("id")
          .eq("event_id", event.id)
          .maybeSingle();
        if (cancelled || !threadRes.data?.id) { setDiscussionLoading(false); return; }
        const threadId = threadRes.data.id as string;
        setDiscussionThreadId(threadId);
        const msgRes = await supabase
          .from("thread_messages")
          .select("id,sender_id,body,created_at")
          .eq("thread_id", threadId)
          .in("status_tag", ["active", "approved"])
          .order("created_at", { ascending: true })
          .limit(50);
        if (!cancelled) {
          setDiscussionMessages(
            (msgRes.data ?? []).map((m: { id: string; sender_id: string; body: string; created_at: string }) => {
              const parsed = parseDiscussionBody(m.body ?? "");
              return { id: m.id, senderId: m.sender_id, body: parsed.body, createdAt: m.created_at, postTag: parsed.postTag };
            })
          );
        }
      } catch {
        // best effort
      } finally {
        if (!cancelled) setDiscussionLoading(false);
      }
    }
    void loadDiscussion();
    return () => { cancelled = true; };
  }, [activeEventTab, event]);

  useEffect(() => {
    let cancelled = false;

    async function loadMapLocation() {
      if (!event) { setMapLocation(null); return; }

      const venue = cleanParam(event.venueName);
      const address = cleanParam(event.venueAddress);
      const city = cleanParam(event.city);
      const country = cleanParam(event.country);
      const query = [venue, address, city, country].filter(Boolean).join(", ");
      if (query.trim().length < 3) { setMapLocation(null); return; }

      try {
        const sessionToken = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
        const suggestRes = await fetch(`/api/geocode/mapbox?${new URLSearchParams({ q: query, session_token: sessionToken })}`, { cache: "no-store" });
        const suggestJson = (await suggestRes.json().catch(() => null)) as { ok?: boolean; suggestions?: { mapboxId: string }[] } | null;
        const firstId = suggestJson?.suggestions?.[0]?.mapboxId;
        if (!firstId || cancelled) { setMapLocation(null); return; }

        const retrieveRes = await fetch("/api/geocode/mapbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mapbox_id: firstId, session_token: sessionToken }),
        });
        const retrieveJson = (await retrieveRes.json().catch(() => null)) as { ok?: boolean; result?: MapboxPlaceResult } | null;
        if (!cancelled && retrieveJson?.ok && retrieveJson.result) {
          setMapLocation({ lat: retrieveJson.result.lat, lon: retrieveJson.result.lon });
        } else if (!cancelled) {
          setMapLocation(null);
        }
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

    if (hasEnded && (action === "join" || action === "interested" || action === "request_sent_to_interested")) {
      setActionError("This event has already ended.");
      return;
    }

    haptic(10);
    setActionBusy(true);
    setActionError(null);
    setActionInfo(null);

    // ── Optimistic update ─────────────────────────────────────────────────────
    // Snapshot current state so we can roll back if the API fails
    const prevMembership = myMembership;
    const prevRequest = myRequest;
    const prevMembers = members;

    if (meId && action !== "request_sent_to_interested") {
      if (action === "join") {
        const optimistic = buildLocalMembershipRecord(myMembership, { eventId: currentEventId, userId: meId, status: "going" });
        setMyMembership(optimistic);
        setMembers((prev) => upsertLocalMembership(prev, optimistic));
        setMyRequest(null);
      } else if (action === "leave") {
        setMyMembership(null);
        setMembers((prev) => removeLocalMembership(prev, { eventId: currentEventId, userId: meId }));
      } else if (action === "interested") {
        const optimistic = buildLocalMembershipRecord(myMembership, { eventId: currentEventId, userId: meId, status: "interested" });
        setMyMembership(optimistic);
        setMembers((prev) => upsertLocalMembership(prev, optimistic));
      } else if (action === "not_interested") {
        setMyMembership(null);
        setMembers((prev) => removeLocalMembership(prev, { eventId: currentEventId, userId: meId }));
      } else if (action === "cancel_request") {
        setMyRequest(null);
        setMyMembership(null);
        setMembers((prev) => removeLocalMembership(prev, { eventId: currentEventId, userId: meId }));
      } else if (action === "request") {
        const optimistic = buildLocalRequestRecord(myRequest, { eventId: currentEventId, requesterId: meId, requestId: null, status: "pending" });
        setMyRequest(optimistic);
        setMyMembership(null);
        setMembers((prev) => removeLocalMembership(prev, { eventId: currentEventId, userId: meId }));
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

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
        return null;
      }
      return json;
    }

    const json =
      action === "request_sent_to_interested"
        ? ((await postEventAction("cancel_request")) ? await postEventAction("interested") : null)
        : await postEventAction(action, requestNoteOverride);

    if (!json) {
      // Roll back optimistic update
      setMyMembership(prevMembership);
      setMyRequest(prevRequest);
      setMembers(prevMembers);
      setActionError("Action failed. Please try again.");
      setActionBusy(false);
      return;
    }

    // Reconcile optimistic state with server response (e.g. waitlist vs going)
    if (meId) {
      if (action === "join") {
        const confirmedStatus = json.status === "waitlist" ? "waitlist" : "going";
        const confirmed = buildLocalMembershipRecord(myMembership, { eventId: currentEventId, userId: meId, status: confirmedStatus });
        setMyMembership(confirmed);
        setMembers((prev) => upsertLocalMembership(prev, confirmed));
      } else if (action === "request" && typeof json.request_id === "string") {
        const confirmed = buildLocalRequestRecord(null, { eventId: currentEventId, requesterId: meId, requestId: json.request_id, status: "pending" });
        setMyRequest(confirmed);
      } else if (action === "request_sent_to_interested" && meId) {
        const optimistic = buildLocalMembershipRecord(null, { eventId: currentEventId, userId: meId, status: "interested" });
        setMyMembership(optimistic);
        setMembers((prev) => upsertLocalMembership(prev, optimistic));
        setMyRequest(null);
      }
    }

    // Show toast confirmation
    const toastMessages: Partial<Record<EventAction | "request_sent_to_interested", string>> = {
      join: json.status === "waitlist" ? "You're on the waitlist." : "You're joining this event!",
      leave: "You've left this event.",
      request: "Invite request sent.",
      cancel_request: "Request cancelled.",
      interested: "Marked as interested.",
      request_sent_to_interested: "Marked as interested.",
      not_interested: "Selection cleared.",
    };
    const msg = toastMessages[action];
    if (msg) toast(msg, action === "leave" || action === "cancel_request" || action === "not_interested" ? "info" : "success");

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
    if (inviteMonthlyLimit !== null && inviteMonthlyUsed >= inviteMonthlyLimit) {
      setInviteLimitModalOpen(true);
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
        if (message.includes("invite_not_allowed") || message.includes("invite_requires_event_membership")) {
          throw new Error("Only organisers or joined guests with invite access can send invites.");
        }
        if (message.includes("already_joined_or_waitlisted")) {
          throw new Error("This connection already joined the event.");
        }
        throw rpc.error;
      }

      setSentInviteUserIds((prev) => ({ ...prev, [connection.userId]: true }));
      setInviteMonthlyUsed((n) => n + 1);
      setActionInfo(`Invite sent to ${connection.displayName}. They'll see it in their Events inbox.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not send invite.");
    } finally {
      setInviteBusyUserId(null);
    }
  }

  async function sendBulkInvites(userIds: string[]) {
    if (!event || userIds.length === 0) return;
    setInviteSendBusy(true);
    setActionError(null);
    const newSent: Record<string, true> = {};
    for (const userId of userIds) {
      if (sentInviteUserIds[userId]) continue;
      try {
        const rpc = await supabase.rpc("send_event_invitation", {
          p_event_id: event.id,
          p_recipient_id: userId,
          p_note: null,
        });
        if (!rpc.error) newSent[userId] = true;
      } catch {
        // continue sending others
      }
    }
    setSentInviteUserIds((prev) => ({ ...prev, ...newSent }));
    setInviteSendBusy(false);
    setInviteModalOpen(false);
    setInviteSelected({});
    setInviteSearch("");
    const count = Object.keys(newSent).length;
    if (count > 0) setActionInfo(`${count} invite${count === 1 ? "" : "s"} sent.`);
  }

  async function sendDiscussionMessage() {
    if (!event || !discussionThreadId || !discussionBody.trim() || discussionSending) return;
    setDiscussionSending(true);
    const bodyText = discussionBody.trim();
    const tag = discussionPostTag;
    const tagPrefix = isHost ? `[[post_tag:${tag}]]\n` : "";
    const outboundBody = `${tagPrefix}${bodyText}`;
    try {
      const { data, error } = await supabase.rpc("cx_send_inbox_message", {
        p_thread_id: discussionThreadId,
        p_connection_id: null,
        p_body: outboundBody,
      });
      if (!error) {
        const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
        const msgId = typeof payload.messageId === "string" ? payload.messageId
          : typeof payload.message_id === "string" ? payload.message_id
          : typeof data === "string" ? data
          : `local-${crypto.randomUUID()}`;
        setDiscussionMessages((prev) => [
          ...prev,
          { id: msgId, senderId: meId ?? "", body: bodyText, createdAt: new Date().toISOString(), postTag: isHost ? tag : undefined },
        ]);
        setDiscussionBody("");
      }
    } catch {
      // best effort
    } finally {
      setDiscussionSending(false);
    }
  }

  async function handleSubmitReview() {
    if (!event) return;
    if (!isAuthenticated || !accessToken) {
      router.push(`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`);
      return;
    }
    if (reviewStars < 1 || reviewStars > 5) {
      setReviewError("Please select a star rating.");
      return;
    }
    setReviewBusy(true);
    setReviewError(null);
    const response = await fetch(`/api/events/${encodeURIComponent(event.id)}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        quality: reviewStars,
        reviewText: reviewText.trim() || null,
        visibility: "public",
        happenedAsDescribed: true,
      }),
    });
    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !json?.ok) {
      setReviewBusy(false);
      setReviewError(json?.error ?? "Could not submit review.");
      return;
    }
    setReviewFormOpen(false);
    setReviewText("");
    setReviewStars(5);
    // Refresh reviews + summary
    const [rRes, fRes] = await Promise.all([
      fetch(`/api/events/${encodeURIComponent(event.id)}/reviews`),
      fetch(`/api/events/${encodeURIComponent(event.id)}/feedback`, { headers: { authorization: `Bearer ${accessToken}` } }),
    ]);
    if (rRes.ok) {
      const rj = (await rRes.json().catch(() => null)) as { ok?: boolean; reviews?: EventReview[] } | null;
      if (rj?.ok) setReviews(rj.reviews ?? []);
    }
    if (fRes.ok) {
      const fj = (await fRes.json().catch(() => null)) as { ok?: boolean; summary?: FeedbackSummary | null; mine?: FeedbackMine | null } | null;
      if (fj?.ok) {
        setFeedbackSummary(fj.summary ?? null);
        setFeedbackMine(fj.mine ?? null);
      }
    }
    setReviewBusy(false);
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
        <main className="mx-auto w-full max-w-[1320px] px-4 pb-28 pt-7 sm:pb-12 sm:px-6 lg:px-8">
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

      {/* Mobile back button */}
      <div className="flex items-center gap-2 px-4 pt-3 md:hidden">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/70 active:scale-95 transition"
        >
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </button>
        <span className="truncate text-sm font-semibold text-white/60">Events</span>
        {!isHost && !isAuthenticated ? (
          <Link
            href={`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`}
            className="ml-auto inline-flex items-center justify-center rounded-full bg-[#00F5FF] px-4 py-1.5 text-xs font-bold text-black hover:opacity-90 active:scale-95 transition"
          >
            Sign in to Join
          </Link>
        ) : null}
      </div>

      <main id="main-content" className="pb-40 md:pb-12">
        <section className="mx-auto w-full max-w-[1220px] px-4 pt-3 sm:px-6 sm:pt-5 lg:px-8">
          <div className="rounded-[20px] border border-white/8 bg-[#1b1d21] shadow-[0_20px_48px_rgba(0,0,0,0.24)]">
            {/* Cover — image centered, date badge absolute left-bottom */}
            <div className="relative px-3 pt-0">
              {/* Ambient glow */}
              <div className="pointer-events-none absolute inset-x-3 top-0 bottom-0 scale-110 overflow-hidden rounded-[16px] blur-3xl opacity-70">
                {preferredHeroUrl && <Image src={preferredHeroUrl} alt="" aria-hidden fill className="object-cover" sizes="100vw" />}
              </div>
              {/* Date badge — absolute, left side, bottom-aligned with image */}
              <div className="absolute bottom-0 left-3 z-10 overflow-hidden rounded-xl shadow-lg" style={{ width: 64 }}>
                <div className="bg-[linear-gradient(90deg,#22d3ee,#d946ef)] py-1 text-center text-[9px] font-bold uppercase tracking-[0.12em] text-[#06121a]">
                  {monthToken(event.startsAt)}
                </div>
                <div className="bg-[#111316] py-2 text-center">
                  <div className="text-[30px] font-black leading-none text-white">{dayToken(event.startsAt)}</div>
                </div>
              </div>
              {/* Main cover image — centered */}
              <div className="relative mx-auto overflow-hidden rounded-[16px] bg-[#0c1118]" style={{ aspectRatio: "16/9", maxHeight: 400, maxWidth: 700 }}>
                <EventHeroImage
                  primarySrc={preferredHeroUrl}
                  fallbackSrc={fallbackHeroUrl}
                  alt={event.title}
                  className="h-full w-full object-cover"
                />
                {isHost && event.coverStatus && event.coverStatus !== "approved" ? (
                  <div className="absolute bottom-2.5 right-2.5">
                    <span className={cx(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
                      event.coverStatus === "pending"
                        ? "border border-amber-400/30 bg-amber-400/15 text-amber-200"
                        : event.coverStatus === "rejected"
                          ? "border border-rose-400/30 bg-rose-400/15 text-rose-200"
                          : "border border-white/15 bg-white/10 text-white/70"
                    )}>
                      <span className="material-symbols-outlined text-[12px]">
                        {event.coverStatus === "pending" ? "schedule" : event.coverStatus === "rejected" ? "block" : "image"}
                      </span>
                      {event.coverStatus === "pending" ? "Review Pending" : event.coverStatus === "rejected" ? "Cover Rejected" : `Cover ${event.coverStatus}`}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Rejection notice for host */}
            {isHost && event.coverStatus === "rejected" ? (
              <div className="mx-3 mb-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-rose-400">block</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-rose-300">Cover photo rejected</p>
                    {event.coverReviewNote ? (
                      <p className="mt-0.5 text-xs text-rose-200/70">{event.coverReviewNote}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-400">Please upload a new cover image that meets requirements. Your event will go live once a suitable cover is approved.</p>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Info section */}
            <div className="px-4 py-4 sm:px-5">
              <div className="flex flex-row items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h1 className="text-[20px] font-bold leading-tight text-white sm:text-[26px]">
                    {event.title}
                  </h1>
                  <div className="mt-1 space-y-0.5">
                    {(event.venueName || event.city) ? (
                      <p className="text-sm text-slate-300">{[event.venueName, event.city, event.country].filter(Boolean).join(", ")}</p>
                    ) : null}
                    <p className="flex items-center gap-x-1 text-sm font-semibold text-cyan-400">
                      <span className="material-symbols-outlined text-[14px] shrink-0">calendar_month</span>
                      <span className="whitespace-nowrap">{formatEventRange(event.startsAt, event.endsAt)}</span>
                    </p>
                    {(() => {
                      if (isHappeningNow) return (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
                          <span className="relative flex h-1.5 w-1.5 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
                          </span>
                          Happening now
                        </span>
                      );
                      if (hasEnded) return (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ended</span>
                      );
                      const start = new Date(event.startsAt);
                      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
                      const isTomorrow = start.toDateString() === tomorrow.toDateString();
                      if (isTomorrow) return (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-200/90">Tomorrow</span>
                      );
                      return (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300/90">Upcoming</span>
                      );
                    })()}
                    {feedbackSummary && feedbackSummary.total_count > 0 ? (
                      <p className="flex items-center gap-1 text-xs text-amber-400 font-semibold">
                        {"★".repeat(Math.round(feedbackSummary.avg_quality ?? 0))}
                        <span className="text-white/70 font-normal">{feedbackSummary.avg_quality?.toFixed(1)} · {feedbackSummary.total_count} {feedbackSummary.total_count === 1 ? "review" : "reviews"}</span>
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  {actionError ? (
                    <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                      {actionError}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2 sm:flex-row">
                    {/* Share button with dropdown */}
                    <div className="relative">
                      <button
                        ref={shareBtnRef}
                        type="button"
                        onClick={() => {
                          setResponseMenuOpen(false);
                          setMoreMenuOpen(false);
                          setShareMenuOpen((open) => {
                            if (!open && shareBtnRef.current) setShareBtnRect(shareBtnRef.current.getBoundingClientRect());
                            return !open;
                          });
                        }}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-2.5 py-2 text-sm font-semibold text-white hover:bg-white/[0.08] sm:px-3"
                      >
                        <span className="material-symbols-outlined text-[17px]">share</span>
                        <span className="hidden sm:inline">Share</span>
                        <span className="material-symbols-outlined text-[15px] hidden sm:inline">expand_more</span>
                      </button>
                      {shareMenuOpen && shareBtnRect && typeof document !== "undefined" ? createPortal(
                        <div
                          className="fixed z-[200] w-[220px] rounded-2xl border border-white/10 bg-[#202327] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
                          style={{ top: shareBtnRect.bottom + 8, right: window.innerWidth - shareBtnRect.right }}
                        >
                          <button type="button" onClick={() => { setShareMenuOpen(false); void copyShareLink(); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-white hover:bg-white/6">
                            <span className="material-symbols-outlined text-[18px]">link</span>
                            Share link
                          </button>
                          {isAuthenticated && inviteConnections.length > 0 && canInviteConnections ? (
                            <button type="button" onClick={() => { setShareMenuOpen(false); setInviteModalOpen(true); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-white hover:bg-white/6">
                              <span className="material-symbols-outlined text-[18px]">person_add</span>
                              Invite connections
                            </button>
                          ) : null}
                        </div>,
                        document.body
                      ) : null}
                    </div>

                    {/* Response button (non-host) */}
                    {!isHost ? (
                      <div className="relative">
                        <button
                          ref={responseBtnRef}
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
                            setResponseMenuOpen((open) => {
                              if (!open && responseBtnRef.current) setResponseBtnRect(responseBtnRef.current.getBoundingClientRect());
                              return !open;
                            });
                            setActionError(null);
                          }}
                          data-tour="tour-event-join"
                          disabled={actionBusy || hasEnded}
                          className={cx(
                            "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-semibold transition",
                            hasEnded ? "border-white/10 bg-white/[0.03] text-white/30 cursor-not-allowed" : responseToneClass(currentResponseState),
                            actionBusy && "cursor-not-allowed opacity-60"
                          )}
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {hasEnded ? "event_busy" : responseIcon(currentResponseState)}
                          </span>
                          {hasEnded ? "Event ended" : responseLabel(currentResponseState)}
                          {!hasEnded && (currentResponseState === "interested" || currentResponseState === "request_sent") ? (
                            <span className="material-symbols-outlined text-[16px]">expand_more</span>
                          ) : null}
                        </button>

                        {responseMenuOpen && responseBtnRect && typeof document !== "undefined" ? createPortal(
                          <div className="fixed z-[200] w-[260px] rounded-2xl border border-white/10 bg-[#202327] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
                            style={{ top: responseBtnRect.bottom + 8, right: window.innerWidth - responseBtnRect.right }}>
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
                              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-white hover:bg-white/6"
                            >
                              <span className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">cancel</span>
                                Not interested
                              </span>
                            </button>
                          </div>,
                          document.body
                        ) : null}
                      </div>
                    ) : null}

                    {/* Host: Manage Requests */}
                    {isHost && event.accessType === "request" ? (
                      <Link
                        href={`/events/${event.id}/inbox`}
                        className="inline-flex items-center justify-center rounded-xl bg-[#00F5FF] px-3 py-2 text-sm font-bold text-black hover:opacity-90"
                      >
                        Manage Requests
                      </Link>
                    ) : null}

                    {/* Sign in (unauthenticated) — desktop only; mobile shows it in the header */}
                    {!isHost && !isAuthenticated ? (
                      <Link
                        href={`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`}
                        className="hidden md:inline-flex items-center justify-center rounded-xl bg-[#00F5FF] px-3 py-2 text-sm font-bold text-black hover:opacity-90"
                      >
                        Sign in to Join
                      </Link>
                    ) : null}


                    {/* ••• More menu */}
                    <div className="relative">
                      <button
                        ref={moreBtnRef}
                        type="button"
                        onClick={() => {
                          setResponseMenuOpen(false);
                          setShareMenuOpen(false);
                          setMoreMenuOpen((open) => {
                            if (!open && moreBtnRef.current) setMoreBtnRect(moreBtnRef.current.getBoundingClientRect());
                            return !open;
                          });
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-white/70 hover:text-white sm:border sm:border-white/12 sm:bg-[#2d3035] sm:hover:bg-[#373a40]"
                        aria-label="More options"
                        title="More options"
                      >
                        <span className="material-symbols-outlined text-[18px]">more_horiz</span>
                      </button>
                      {moreMenuOpen && moreBtnRect && typeof document !== "undefined" ? createPortal(
                        <div className="fixed z-[200] w-[220px] rounded-2xl border border-white/10 bg-[#202327] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
                          style={{ top: moreBtnRect.bottom + 8, right: window.innerWidth - moreBtnRect.right }}>
                          {isHost ? (
                            <>
                              <Link
                                href={`/events/new?edit=${encodeURIComponent(event.id)}&returnTo=${encodeURIComponent(`/events/${event.id}`)}`}
                                onClick={() => setMoreMenuOpen(false)}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-white hover:bg-white/6"
                              >
                                <span className="material-symbols-outlined text-[18px]">edit</span>
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
                                  showGuestList: event.showGuestList,
                                  guestsCanInvite: event.guestsCanInvite,
                                  approveMessages: event.approveMessages,
                                }))}`}
                                onClick={() => setMoreMenuOpen(false)}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-white hover:bg-white/6"
                              >
                                <span className="material-symbols-outlined text-[18px]">content_copy</span>
                                Duplicate
                              </Link>
                            </>
                          ) : null}
                          {isAuthenticated && (isHost || currentResponseState === "going" || currentResponseState === "interested" || currentResponseState === "waitlist") ? (
                            <button
                              type="button"
                              onClick={async () => {
                                setMoreMenuOpen(false);
                                if (meId) {
                                  const { count } = await supabase
                                    .from("groups")
                                    .select("id", { count: "exact", head: true })
                                    .eq("host_user_id", meId);
                                  setGroupsUsedThisMonth(count ?? 0);
                                }
                                setCreateGroupOpen(true);
                              }}
                              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-white hover:bg-white/6"
                            >
                              <span className="material-symbols-outlined text-[18px]">group_add</span>
                              Create Group
                            </button>
                          ) : null}
                          <a
                              href={`https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${encodeURIComponent(event.startsAt.replace(/[-:]/g, "").split(".")[0] + "Z")}/${encodeURIComponent((event.endsAt ?? event.startsAt).replace(/[-:]/g, "").split(".")[0] + "Z")}&details=${encodeURIComponent(event.description ?? "")}&location=${encodeURIComponent([event.venueName, event.venueAddress, event.city, event.country].filter(Boolean).join(", "))}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => setMoreMenuOpen(false)}
                              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-white hover:bg-white/6"
                            >
                              <span className="material-symbols-outlined text-[18px]">calendar_month</span>
                              Add to calendar
                            </a>
                          {!isHost && isAuthenticated ? (
                            <>
                              <div className="my-1 border-t border-white/8" />
                              <button
                                type="button"
                                onClick={() => {
                                  setMoreMenuOpen(false);
                                  setReportModalOpen(true);
                                  setActionError(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-rose-400 hover:bg-white/6"
                              >
                                <span className="material-symbols-outlined text-[18px]">flag</span>
                                Report event
                              </button>
                            </>
                          ) : null}
                        </div>,
                        document.body
                      ) : null}
                    </div>
                  </div>
                  {spotsLeft !== null ? (
                    <p className="mt-1 text-xs text-slate-400">
                      Spots left: <span className="font-semibold text-white">{spotsLeft}</span>
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-4 w-full max-w-[1220px] px-4 sm:px-6 lg:px-8">
          <div className="flex border-b border-white/10">
            {[
              { key: "details" as const, label: "Details", icon: "info" },
              { key: "discussion" as const, label: "Discussion", icon: event.chatMode === "discussion" || event.accessType === "private_group" ? "forum" : "campaign" },
            ].map((tab) => {
              const selected = activeEventTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveEventTab(tab.key)}
                  className={cx(
                    "inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px",
                    selected
                      ? "border-[#00F5FF] text-white"
                      : "border-transparent text-slate-400 hover:text-white"
                  )}
                >
                  <span className="material-symbols-outlined text-[17px]">{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="mx-auto mt-5 grid w-full max-w-[1220px] grid-cols-1 gap-5 px-4 pb-4 sm:px-6 sm:pb-8 xl:grid-cols-[minmax(0,2fr)_360px] lg:px-8">
          <div className="order-1 space-y-6 xl:order-1">
            {activeEventTab === "discussion" ? (
              <>
                {/* Discussion chat thread */}
                <article className={`${panelClass} overflow-hidden`}>
                  <div className="flex items-center justify-between border-b border-white/8 px-5 py-3.5">
                    <h2 className="text-[17px] font-bold text-white">{threadHeading}</h2>
                    <Link
                      href={`/messages?thread=${encodeURIComponent(`event:${event.id}`)}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white"
                    >
                      Open full
                      <span className="material-symbols-outlined text-[15px]">open_in_new</span>
                    </Link>
                  </div>

                  {/* Messages area */}
                  <div className="flex max-h-[420px] min-h-[160px] flex-col gap-3 overflow-y-auto px-5 py-4 scrollbar-subtle">
                    {discussionLoading ? (
                      <div className="flex flex-col gap-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} className={`flex gap-2 ${i % 2 === 0 ? "" : "flex-row-reverse"}`}>
                            <div className="h-8 w-8 shrink-0 rounded-full bg-white/[0.06] animate-pulse" />
                            <div className={`h-10 w-[55%] rounded-2xl bg-white/[0.06] animate-pulse`} />
                          </div>
                        ))}
                      </div>
                    ) : discussionMessages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <span className="material-symbols-outlined text-[36px] text-slate-600">
                          {event.chatMode === "discussion" || event.accessType === "private_group" ? "forum" : "campaign"}
                        </span>
                        <p className="mt-2 text-sm text-slate-500">{threadDescription}</p>
                      </div>
                    ) : (
                      discussionMessages.map((msg) => {
                        const isMe = msg.senderId === meId;
                        const isHostMsg = msg.senderId === host?.userId;
                        const senderProfile = profilesById[msg.senderId] ?? null;
                        const senderName = senderProfile?.displayName ?? (isHostMsg ? host?.displayName : null) ?? "Member";
                        const avatarUrl = senderProfile?.avatarUrl ?? (isHostMsg ? host?.avatarUrl : null) ?? null;
                        const postTagLabel: Record<string, string> = { update: "📣 Update", announcement: "🎉 Announcement", ticket: "🎟 Tickets", reminder: "⏰ Reminder" };
                        return (
                          <div key={msg.id} className={`flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[#121722]">
                              {avatarUrl ? (
                                <Image src={avatarUrl} alt={senderName} fill className="object-cover" sizes="32px" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-cyan-100">
                                  {senderName.slice(0, 1).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div className={`flex max-w-[72%] flex-col gap-0.5 ${isMe ? "items-end" : "items-start"}`}>
                              {!isMe ? (
                                <span className="px-1 text-[11px] text-slate-500">{senderName}{isHostMsg ? <span className="ml-1 text-[10px] font-semibold text-cyan-300/70">· Host</span> : null}</span>
                              ) : null}
                              {msg.postTag && postTagLabel[msg.postTag] ? (
                                <span className="mb-0.5 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                                  {postTagLabel[msg.postTag]}
                                </span>
                              ) : null}
                              <div className={cx(
                                "rounded-2xl px-3.5 py-2 text-[14px] leading-snug whitespace-pre-wrap break-words",
                                isMe
                                  ? "bg-[linear-gradient(90deg,#00c8cc,#b430d8)] text-white rounded-br-sm"
                                  : "bg-white/[0.07] text-slate-100 rounded-bl-sm"
                              )}>
                                {msg.body}
                              </div>
                              <span className="px-1 text-[10px] text-slate-600">
                                {new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Composer */}
                  {isAuthenticated && canPostToEventThread({ accessType: event.accessType, chatMode: event.chatMode, isHost }) ? (
                    <div className="border-t border-white/8 px-4 py-3">
                      {isHost ? (
                        <div className="space-y-2.5">
                          {/* Post type tags */}
                          <div className="flex flex-wrap gap-1.5">
                            {([
                              { key: "update" as const, label: "📣 Update", icon: "campaign" },
                              { key: "announcement" as const, label: "🎉 Announcement", icon: "celebration" },
                              { key: "ticket" as const, label: "🎟 Tickets", icon: "confirmation_number" },
                              { key: "reminder" as const, label: "⏰ Reminder", icon: "alarm" },
                            ]).map((tag) => (
                              <button
                                key={tag.key}
                                type="button"
                                onClick={() => setDiscussionPostTag(tag.key)}
                                className={cx(
                                  "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                                  discussionPostTag === tag.key
                                    ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-200"
                                    : "border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.07] hover:text-white"
                                )}
                              >
                                {tag.label}
                              </button>
                            ))}
                          </div>
                          <div className="relative">
                            <textarea
                              rows={3}
                              value={discussionBody}
                              onChange={(e) => setDiscussionBody(e.target.value.slice(0, 600))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                  e.preventDefault();
                                  void sendDiscussionMessage();
                                }
                              }}
                              placeholder="Share an update, ticket link, schedule change…"
                              className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none"
                            />
                            <span className="absolute bottom-2 right-3 text-[10px] text-slate-600">{discussionBody.length}/600</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] text-slate-600">⌘↵ to post</p>
                            <button
                              type="button"
                              onClick={() => void sendDiscussionMessage()}
                              disabled={!discussionBody.trim() || discussionSending}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-[linear-gradient(90deg,#00F5FF_0%,#FF00FF_100%)] px-4 py-2 text-sm font-bold text-[#071116] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                            >
                              <span className="material-symbols-outlined text-[16px]">send</span>
                              {discussionSending ? "Posting…" : "Post"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-end gap-2">
                          <textarea
                            rows={2}
                            value={discussionBody}
                            onChange={(e) => setDiscussionBody(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void sendDiscussionMessage();
                              }
                            }}
                            placeholder="Write a message…"
                            className="flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => void sendDiscussionMessage()}
                            disabled={!discussionBody.trim() || discussionSending}
                            className="h-10 w-10 shrink-0 rounded-xl bg-[linear-gradient(90deg,#00F5FF_0%,#FF00FF_100%)] flex items-center justify-center text-[#071116] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                          >
                            <span className="material-symbols-outlined text-[18px]">send</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : !isAuthenticated ? (
                    <div className="border-t border-white/8 px-4 py-3">
                      <Link
                        href={`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`}
                        className="block w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-sm text-slate-400 hover:bg-white/[0.07]"
                      >
                        Sign in to participate
                      </Link>
                    </div>
                  ) : (
                    <div className="border-t border-white/8 px-4 py-3">
                      <p className="text-center text-xs text-slate-500">
                        {event.chatMode === "broadcast" ? "Only organisers can post in broadcast mode." : "Join this event to participate."}
                      </p>
                    </div>
                  )}
                </article>

                {(suggestedEventsLoading || suggestedEvents.length > 0) ? (
                  <article className={panelClass}>
                    <div className="flex items-center justify-between px-5 py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Suggested events</p>
                      <Link
                        href="/events"
                        className="text-xs font-semibold text-slate-400 hover:text-white"
                      >
                        Explore all →
                      </Link>
                    </div>

                    {suggestedEventsLoading ? (
                      <div className="flex gap-4 overflow-hidden px-5 pb-5">
                        {Array.from({ length: 3 }).map((_, index) => (
                          <div key={index} className="w-[220px] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] animate-pulse">
                            <div className="h-28 bg-white/[0.05]" />
                            <div className="space-y-2 p-3">
                              <div className="h-3 w-16 rounded bg-white/[0.08]" />
                              <div className="h-4 w-3/4 rounded bg-white/[0.08]" />
                              <div className="h-3 w-1/2 rounded bg-white/[0.06]" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="relative overflow-x-auto pb-10">
                        <div
                          className="flex gap-3 px-4"
                          style={{
                            animation: suggestedEvents.length > 3 ? "marquee-left 60s linear infinite" : undefined,
                            width: suggestedEvents.length > 3 ? "max-content" : undefined,
                          }}
                        >
                          {(suggestedEvents.length > 3 ? [...suggestedEvents, ...suggestedEvents] : suggestedEvents).map((suggested, idx) => {
                            const hero = pickEventHeroUrl(suggested) || pickEventFallbackHeroUrl(suggested);
                            const location = [suggested.city, suggested.country].filter(Boolean).join(", ");
                            const startDate = new Date(suggested.startsAt);
                            const weekday = startDate.toLocaleDateString("en-US", { weekday: "short" });
                            const month = startDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
                            const day = startDate.getDate();
                            const timeStr = startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                            const now = new Date();
                            const daysUntil = Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                            const upcomingLabel = daysUntil <= 7 ? "THIS WEEK" : daysUntil <= 30 ? "UPCOMING" : "UPCOMING";
                            return (
                              <Link
                                key={`${suggested.id}-${idx}`}
                                href={`/events/${suggested.id}`}
                                className="group relative flex w-[200px] shrink-0 flex-col overflow-hidden rounded-2xl border border-cyan-300/12 bg-[#121212] shadow-[0_4px_16px_rgba(0,0,0,0.3)] transition hover:border-cyan-300/28"
                              >
                                {/* Top: image — half of card */}
                                <div className="relative h-[80px] shrink-0 overflow-hidden bg-[#0d0f12]">
                                  {hero ? (
                                    <Image src={hero} alt="" fill className="object-cover opacity-80 transition group-hover:opacity-95" sizes="200px" />
                                  ) : (
                                    <div className="h-full w-full bg-[linear-gradient(135deg,#0d1520,#1a0d24)]" />
                                  )}
                                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/40" />
                                </div>
                                {/* Bottom: date + content */}
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2">
                                  <div className="mb-1 flex items-center gap-1.5">
                                    <span className="text-[11px] font-black text-white">{month} {day}</span>
                                    <span className="text-[10px] font-semibold uppercase text-slate-500">{weekday}</span>
                                  </div>
                                  <p className="truncate text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-300">
                                    {upcomingLabel}{suggested.eventType ? ` · ${suggested.eventType}` : ""}
                                  </p>
                                  <h4 className="line-clamp-2 text-[12px] font-bold leading-snug text-white">{suggested.title}</h4>
                                  <p className="flex items-center gap-0.5 text-[11px] text-slate-500">
                                    <span className="material-symbols-outlined text-[11px] text-cyan-300/50">location_on</span>
                                    <span className="truncate">{location || "Location TBA"}</span>
                                  </p>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                        {suggestedEvents.length > 3 ? (
                          <>
                            <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[#1b1d21] to-transparent" />
                            <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[#1b1d21] to-transparent" />
                          </>
                        ) : null}
                      </div>
                    )}
                  </article>
                ) : null}
              </>
            ) : null}

            {activeEventTab === "details" ? (
              <>
                <article className={`${panelClass} overflow-hidden`}>
                  <div className="border-b border-white/8 px-5 py-4">
                    <h2 className="text-[20px] font-bold text-white">Details</h2>
                  </div>
                  <div className="space-y-3 px-5 py-4">

                    {/* People responded */}
                    {(isHost || event.showGuestList) && respondedCount > 0 ? (
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined shrink-0 text-[20px] text-slate-400">group</span>
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <div className="flex -space-x-2">
                            {visibleAttendees.map((entry) => (
                              <div key={entry.member.id} title={entry.profile?.displayName ?? "Member"} className="relative h-7 w-7 overflow-hidden rounded-full border-2 border-[#1b1d21] bg-[#121722]">
                                {entry.profile?.avatarUrl ? (
                                  <Image src={entry.profile.avatarUrl} alt={entry.profile.displayName} fill className="object-cover" sizes="28px" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-[9px] font-bold text-cyan-100">
                                    {(entry.profile?.displayName ?? "M").slice(0, 1).toUpperCase()}
                                  </div>
                                )}
                              </div>
                            ))}
                            {counts.going > visibleAttendees.length ? (
                              <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#1b1d21] bg-[#202327] text-[9px] font-bold text-white">
                                +{counts.going - visibleAttendees.length}
                              </div>
                            ) : null}
                          </div>
                          <p className="text-[14px] text-slate-300">{respondedCount} people responded</p>
                        </div>
                      </div>
                    ) : null}

                    {/* Location */}
                    {(event.venueName || event.venueAddress || event.city) ? (
                      <div className="flex items-start gap-3">
                        <span className="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-slate-400">location_on</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold text-white">
                            {event.venueName || [event.venueAddress, event.city, event.country].filter(Boolean).join(", ")}
                          </p>
                          {event.venueName && (event.venueAddress || event.city) ? (
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-sm text-slate-400">
                                {[event.venueAddress, event.city, event.country].filter(Boolean).join(", ")}
                              </span>
                              {mapsUrl ? (
                                <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs font-semibold text-sky-400 hover:text-sky-300">
                                  <span className="material-symbols-outlined text-[13px]">route</span>
                                  Get directions
                                </a>
                              ) : null}
                            </div>
                          ) : mapsUrl ? (
                            <a href={mapsUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-0.5 text-xs font-semibold text-sky-400 hover:text-sky-300">
                              <span className="material-symbols-outlined text-[13px]">route</span>
                              Get directions
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {/* Tickets / Links */}
                    {isAuthenticated && event.links.length > 0 ? (
                      event.links.map((link, index) => (
                        <div key={`${link.url}-${index}`} className="flex items-start gap-3">
                          <span className="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-slate-400">
                            {link.type === "ticket" || link.label.toLowerCase().includes("ticket") ? "confirmation_number" : "link"}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[15px] font-semibold text-white">{link.label}</p>
                            <a href={link.url} target="_blank" rel="noreferrer" className="truncate text-sm text-sky-400 hover:text-sky-300">
                              {link.url.replace(/^https?:\/\//, "")}
                            </a>
                          </div>
                        </div>
                      ))
                    ) : !isAuthenticated && event.links.length > 0 ? (
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined shrink-0 text-[20px] text-slate-400">lock</span>
                        <div className="min-w-0">
                          <p className="text-[14px] text-slate-300">Links visible to members. <Link href={`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`} className="font-semibold text-cyan-400 hover:text-cyan-300">Sign in</Link></p>
                        </div>
                      </div>
                    ) : null}

                    {/* Access / visibility */}
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined shrink-0 text-[20px] text-slate-400">
                        {event.accessType === "private_group" ? "lock" : event.accessType === "request" ? "how_to_reg" : "public"}
                      </span>
                      <div className="min-w-0">
                        <span className="text-[15px] font-semibold text-white">
                          {event.accessType === "private_group" ? "Private group" : event.accessType === "request" ? "Request to join" : "Public event"}
                        </span>
                        <span className="ml-1.5 text-sm text-slate-400">
                          {event.accessType === "private_group" ? "· Members only" : event.accessType === "request" ? "· Host approves" : "· Open to anyone on ConXion"}
                        </span>
                      </div>
                    </div>

                    {/* Description */}
                    {event.description?.trim() ? (
                      <p className="pt-1 text-[15px] leading-7 text-slate-200 whitespace-pre-wrap">
                        {event.description.trim()}
                      </p>
                    ) : null}

                    {/* Tags */}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[12px] font-medium">
                      {(event.city || event.country) ? (
                        <span className="inline-flex items-center gap-0.5 text-slate-400">
                          <span className="material-symbols-outlined text-[12px]">location_on</span>
                          {[event.city, event.country].filter(Boolean).join(", ")}
                        </span>
                      ) : null}
                      {event.eventType ? (
                        <span className="text-violet-300">#{event.eventType}</span>
                      ) : null}
                      <span className="text-slate-400">
                        #{event.accessType === "private_group" ? "Private" : event.accessType === "request" ? "Request" : "Public"}
                      </span>
                      {event.styles.map((style) => (
                        <span key={style} className="text-cyan-300">#{style}</span>
                      ))}
                    </div>

                  </div>
                </article>

              </>
            ) : null}
          </div>

          <aside className="order-2 space-y-6 xl:order-2">
            <article className={`overflow-hidden ${panelClass}`}>
              <div className="relative h-64 bg-[#202327]">
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
                {/* Cover attribution bar + show venue info */}
                <div className="absolute bottom-0 left-0 right-0 bg-[#1a1c20] px-4 py-3">
                  {event.venueName ? <p className="text-sm font-semibold text-white">{event.venueName}</p> : null}
                  <p className="text-xs text-slate-400">
                    {isAuthenticated
                      ? [event.venueAddress, event.city, event.country].filter(Boolean).join(", ")
                      : [event.city, event.country].filter(Boolean).join(", ")}
                  </p>
                </div>
              </div>
              <div className="px-4 pb-4 pt-3">
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
                    <div className="relative h-12 w-12 overflow-hidden rounded-full bg-[#15171a]">
                      {host?.avatarUrl ? <Image src={host.avatarUrl} alt={host.displayName} fill className="object-cover" sizes="48px" /> : null}
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

                  {(isHost || event.showGuestList) && <div className="rounded-2xl bg-[#202327] p-4">
                    <p className="text-sm font-semibold text-white">People Joining</p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex -space-x-3">
                        {visibleAttendees.length > 0 ? (
                          visibleAttendees.map((entry) => (
                            <div
                              key={entry.member.id}
                              title={entry.profile?.displayName ?? "Member"}
                              className="relative h-11 w-11 overflow-hidden rounded-full border-2 border-[#202327] bg-[#121722]"
                            >
                              {entry.profile?.avatarUrl ? (
                                <Image src={entry.profile.avatarUrl} alt={entry.profile.displayName} fill className="object-cover" sizes="44px" />
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
                  </div>}

                  {popularWithFriends.length > 0 ? (
                    <div className="rounded-2xl bg-[#202327] p-4">
                      <h4 className="text-sm font-semibold text-white">Connections Attending</h4>
                      <div className="mt-3 space-y-3">
                        {popularWithFriends.map((entry) => (
                          <div key={entry.member.id} className="flex items-center gap-3">
                            <div className="relative h-10 w-10 overflow-hidden rounded-full border border-white/20 bg-[#121722]">
                              {entry.profile?.avatarUrl ? (
                                <Image src={entry.profile.avatarUrl} alt={entry.profile.displayName} fill className="object-cover" sizes="40px" />
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

                  {inviteConnections.length > 0 && canInviteConnections ? (
                    <div className="rounded-2xl bg-[#202327] p-4">
                      <h4 className="text-sm font-semibold text-white">Go with friends</h4>
                      <div className="mt-3 space-y-3">
                        {inviteConnections.slice(0, 5).map((connection) => {
                          const alreadySent = Boolean(sentInviteUserIds[connection.userId]);
                          const busy = inviteBusyUserId === connection.userId;
                          return (
                            <div key={connection.connectionId} className="flex items-center gap-3">
                              <div className="relative h-10 w-10 overflow-hidden rounded-full border border-white/20 bg-[#121722]">
                                {connection.avatarUrl ? (
                                  <Image src={connection.avatarUrl} alt={connection.displayName} fill className="object-cover" sizes="40px" />
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

        {/* Reviews + Suggested — full width, below map/friends on mobile */}
        {activeEventTab === "details" ? (
          <section className="mx-auto mt-5 w-full max-w-[1220px] space-y-5 px-4 pb-32 sm:px-6 sm:pb-8 lg:px-8">
            {(hasEnded || reviews.length > 0) ? (
            <article id="reviews" className={`${panelClass} overflow-hidden`}>
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/[0.06] space-y-2">
                {/* Row 1: title + rating */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-[17px] font-bold text-white shrink-0">Reviews</h3>
                    {feedbackSummary && feedbackSummary.total_count > 0 ? (
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-amber-400 text-sm shrink-0">{"★".repeat(Math.round(feedbackSummary.avg_quality ?? 0))}</span>
                        <span className="text-sm font-semibold text-white shrink-0">{feedbackSummary.avg_quality?.toFixed(1)}</span>
                        <span className="text-xs text-slate-400 shrink-0">· {feedbackSummary.total_count} {feedbackSummary.total_count === 1 ? "review" : "reviews"}</span>
                      </div>
                    ) : null}
                  </div>
                  {reviews.length > 0 ? (
                    <button type="button" onClick={() => setReviewsModalOpen(true)}
                      className="text-xs font-semibold text-slate-400 hover:text-white transition shrink-0">
                      See all →
                    </button>
                  ) : null}
                </div>
                {/* Row 2: edit action (only when relevant) */}
                {hasEnded && !isHost && (feedbackCanSubmit || canEditReview) ? (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => {
                        if (feedbackMine && !reviewFormOpen) {
                          setReviewStars(feedbackMine.quality ?? 0);
                          setReviewText(feedbackMine.note ?? "");
                        }
                        setReviewFormOpen((o) => !o);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-300/20 transition"
                    >
                      <span className="material-symbols-outlined text-[14px]">edit</span>
                      {feedbackMine ? "Edit review" : "Leave a review"}
                    </button>
                    {canEditReview && feedbackMine ? (
                      <span className="text-[10px] text-slate-500 tabular-nums">
                        {String(Math.floor(editReviewSecsLeft / 60)).padStart(2, "0")}:{String(editReviewSecsLeft % 60).padStart(2, "0")}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Inline review form */}
              {reviewFormOpen ? (
                <div className="border-b border-white/[0.06] bg-white/[0.02] px-5 py-4 space-y-3">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button key={star} type="button"
                        onMouseEnter={() => setReviewHoverStars(star)}
                        onMouseLeave={() => setReviewHoverStars(0)}
                        onClick={() => setReviewStars(star)}
                        className="text-2xl leading-none transition-transform hover:scale-110"
                      >
                        <span className={(reviewHoverStars || reviewStars) >= star ? "text-amber-400" : "text-white/20"}>★</span>
                      </button>
                    ))}
                    <span className="ml-2 text-sm text-slate-400">
                      {["", "Poor", "Fair", "Good", "Great", "Amazing"][reviewHoverStars || reviewStars]}
                    </span>
                  </div>
                  <textarea rows={3} value={reviewText} onChange={(e) => setReviewText(e.target.value)} maxLength={300}
                    placeholder="Share your experience… (optional)"
                    className="w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-300/40"
                  />
                  {reviewError ? <p className="text-xs text-rose-300">{reviewError}</p> : null}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-500">{reviewText.length}/300</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setReviewFormOpen(false)} className="rounded-full px-4 py-1.5 text-sm text-slate-400 hover:text-white transition">Cancel</button>
                      <button type="button" onClick={() => void handleSubmitReview()} disabled={reviewBusy || reviewStars < 1}
                        className="rounded-full bg-cyan-300 px-4 py-1.5 text-sm font-bold text-[#052328] hover:bg-cyan-200 disabled:opacity-50 transition"
                      >
                        {reviewBusy ? "Posting..." : feedbackMine ? "Update" : "Post review"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Horizontal scroll strip */}
              {reviews.length > 0 ? (
                <div className="flex gap-3 overflow-x-auto px-5 py-4 pb-5" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
                  {reviews.map((review) => {
                    const profile = review.profiles;
                    const name = profile?.display_name ?? "Attendee";
                    const avatar = profile?.avatar_url ?? null;
                    const location = [profile?.city, profile?.country].filter(Boolean).join(", ");
                    const date = new Date(review.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" });
                    return (
                      <div key={review.id} className="flex w-[260px] shrink-0 flex-col gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
                        <div className="flex items-center gap-2.5">
                          <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/[0.06]">
                            {avatar ? <Image src={avatar} alt={name} fill className="object-cover" sizes="32px" /> : <span className="flex h-full w-full items-center justify-center text-xs font-bold text-cyan-100">{name.slice(0, 1).toUpperCase()}</span>}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{name}</p>
                            {location ? <p className="truncate text-[11px] text-slate-500">{location}</p> : null}
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex gap-0.5">
                            {[1,2,3,4,5].map((s) => <span key={s} className={`text-[13px] ${s <= review.quality ? "text-amber-400" : "text-white/15"}`}>★</span>)}
                          </div>
                          <span className="text-[11px] text-slate-500">{date}</span>
                        </div>
                        {review.note ? <p className="line-clamp-3 text-[13px] leading-relaxed text-slate-300">{review.note}</p> : null}
                      </div>
                    );
                  })}
                </div>
              ) : hasEnded ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-slate-500">No reviews yet. Be the first to leave one.</p>
                </div>
              ) : null}
            </article>
            ) : null}

            {/* Reviews modal */}
            {reviewsModalOpen ? (
              <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setReviewsModalOpen(false)}>
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                <div className="relative z-10 w-full max-w-lg rounded-t-3xl sm:rounded-3xl border border-white/10 bg-[#141518] shadow-[0_24px_80px_rgba(0,0,0,0.5)] flex flex-col max-h-[85vh]"
                  onClick={(e) => e.stopPropagation()}>
                  {/* Modal header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07] shrink-0">
                    <div className="flex items-center gap-3">
                      <h3 className="text-[17px] font-bold text-white">All Reviews</h3>
                      {feedbackSummary && feedbackSummary.total_count > 0 ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-amber-400">{"★".repeat(Math.round(feedbackSummary.avg_quality ?? 0))}</span>
                          <span className="text-sm font-semibold text-white">{feedbackSummary.avg_quality?.toFixed(1)}</span>
                          <span className="text-xs text-slate-400">· {feedbackSummary.total_count}</span>
                        </div>
                      ) : null}
                    </div>
                    <button type="button" onClick={() => setReviewsModalOpen(false)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.07] text-white/60 hover:text-white transition">
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                  {/* Scrollable list */}
                  <div className="overflow-y-auto divide-y divide-white/[0.05] overscroll-contain">
                    {reviews.map((review) => {
                      const profile = review.profiles;
                      const name = profile?.display_name ?? "Attendee";
                      const avatar = profile?.avatar_url ?? null;
                      const location = [profile?.city, profile?.country].filter(Boolean).join(", ");
                      const date = new Date(review.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                      return (
                        <div key={review.id} className="flex gap-3 px-5 py-4">
                          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/[0.06]">
                            {avatar ? <Image src={avatar} alt={name} fill className="object-cover" sizes="36px" /> : <span className="flex h-full w-full items-center justify-center text-xs font-bold text-cyan-100">{name.slice(0, 1).toUpperCase()}</span>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-sm font-semibold text-white">{name}</span>
                              {location ? <span className="text-xs text-slate-500">{location}</span> : null}
                              <span className="text-xs text-slate-600">·</span>
                              <span className="text-xs text-slate-500">{date}</span>
                            </div>
                            <div className="mt-0.5 flex gap-0.5">
                              {[1,2,3,4,5].map((s) => <span key={s} className={`text-[13px] ${s <= review.quality ? "text-amber-400" : "text-white/15"}`}>★</span>)}
                            </div>
                            {review.note ? <p className="mt-1.5 text-sm leading-relaxed text-slate-200">{review.note}</p> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {(suggestedEventsLoading || suggestedEvents.length > 0) ? (
              <article className={panelClass}>
                <div className="flex items-center justify-between px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Suggested events</p>
                  <Link href="/events" className="text-xs font-semibold text-slate-400 hover:text-white">Explore all →</Link>
                </div>
                {suggestedEventsLoading ? (
                  <div className="flex gap-4 overflow-hidden px-5 pb-5">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="w-[220px] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] animate-pulse">
                        <div className="h-28 bg-white/[0.05]" />
                        <div className="space-y-2 p-3">
                          <div className="h-3 w-16 rounded bg-white/[0.08]" />
                          <div className="h-4 w-3/4 rounded bg-white/[0.08]" />
                          <div className="h-3 w-1/2 rounded bg-white/[0.06]" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="relative overflow-hidden pb-8">
                    <div className="flex gap-3 px-4" style={{ animation: suggestedEvents.length > 3 ? "marquee-left 60s linear infinite" : undefined, width: suggestedEvents.length > 3 ? "max-content" : undefined }}>
                      {(suggestedEvents.length > 3 ? [...suggestedEvents, ...suggestedEvents] : suggestedEvents).map((suggested, idx) => {
                        const hero = pickEventHeroUrl(suggested) || pickEventFallbackHeroUrl(suggested);
                        const location = [suggested.city, suggested.country].filter(Boolean).join(", ");
                        const startDate = new Date(suggested.startsAt);
                        const weekday = startDate.toLocaleDateString("en-US", { weekday: "short" });
                        const month = startDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
                        const day = startDate.getDate();
                        const now = new Date();
                        const daysUntil = Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                        const upcomingLabel = daysUntil <= 7 ? "THIS WEEK" : "UPCOMING";
                        return (
                          <Link key={`${suggested.id}-${idx}`} href={`/events/${suggested.id}`}
                            className="group relative flex w-[200px] shrink-0 flex-col overflow-hidden rounded-2xl border border-cyan-300/12 bg-[#121212] shadow-[0_4px_16px_rgba(0,0,0,0.3)] transition hover:border-cyan-300/28"
                          >
                            <div className="relative h-[80px] shrink-0 overflow-hidden bg-[#0d0f12]">
                              {hero ? <Image src={hero} alt="" fill className="object-cover opacity-80 transition group-hover:opacity-95" sizes="200px" /> : <div className="h-full w-full bg-[linear-gradient(135deg,#0d1520,#1a0d24)]" />}
                              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/40" />
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2">
                              <div className="mb-1 flex items-center gap-1.5">
                                <span className="text-[11px] font-black text-white">{month} {day}</span>
                                <span className="text-[10px] font-semibold uppercase text-slate-500">{weekday}</span>
                              </div>
                              <p className="truncate text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-300">{upcomingLabel}{suggested.eventType ? ` · ${suggested.eventType}` : ""}</p>
                              <h4 className="line-clamp-2 text-[12px] font-bold leading-snug text-white">{suggested.title}</h4>
                              <p className="flex items-center gap-0.5 text-[11px] text-slate-500">
                                <span className="material-symbols-outlined text-[11px] text-cyan-300/50">location_on</span>
                                <span className="truncate">{location || "Location TBA"}</span>
                              </p>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                    {suggestedEvents.length > 3 ? (
                      <>
                        <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[#1b1d21] to-transparent" />
                        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[#1b1d21] to-transparent" />
                      </>
                    ) : null}
                  </div>
                )}
              </article>
            ) : null}
          </section>
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

      {event && meId && (
        <CreateGroupFromEventModal
          open={createGroupOpen}
          onClose={() => setCreateGroupOpen(false)}
          eventId={eventId}
          eventTitle={event.title}
          accessToken={accessToken ?? ""}
          attendees={groupModalAttendees}
          connections={groupModalConnections}
          monthlyLimit={groupMonthlyLimit}
          groupsUsed={groupsUsedThisMonth}
        />
      )}

      {inviteModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[141] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6"
              onClick={() => { setInviteModalOpen(false); setInviteSelected({}); setInviteSearch(""); }}
            >
              <div
                className="sheet-up flex w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-white/12 bg-[#0f1419] shadow-2xl sm:rounded-3xl"
                style={{ maxHeight: "min(680px, 92vh)" }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Drag handle — mobile only */}
                <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                  <h2 className="text-base font-bold text-white">Invite people</h2>
                  <button
                    type="button"
                    onClick={() => { setInviteModalOpen(false); setInviteSelected({}); setInviteSearch(""); }}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/60 hover:text-white"
                    aria-label="Close"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>

                {/* Search */}
                <div className="border-b border-white/8 px-4 py-3">
                  <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                    <span className="material-symbols-outlined text-[18px] text-slate-400">search</span>
                    <input
                      type="text"
                      value={inviteSearch}
                      onChange={(e) => setInviteSearch(e.target.value)}
                      placeholder="Search for people..."
                      className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
                      autoFocus
                    />
                    {inviteSearch ? (
                      <button type="button" onClick={() => setInviteSearch("")} className="text-slate-400 hover:text-white">
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Connection list */}
                <div className="flex-1 overflow-y-auto">
                  {(() => {
                    const query = inviteSearch.trim().toLowerCase();
                    const filtered = inviteConnections.filter((c) =>
                      !query || [c.displayName, c.subtitle].join(" ").toLowerCase().includes(query)
                    );
                    const selectedCount = Object.keys(inviteSelected).length;
                    const allFilteredSelected = filtered.length > 0 && filtered.every((c) => inviteSelected[c.userId] || sentInviteUserIds[c.userId]);

                    if (filtered.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-500">
                          <span className="material-symbols-outlined text-4xl">person_search</span>
                          <p className="text-sm">No connections found</p>
                        </div>
                      );
                    }

                    return (
                      <div className="px-2 py-2">
                        <div className="flex items-center justify-between px-3 py-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            Your connections
                          </p>
                          {filtered.some((c) => !sentInviteUserIds[c.userId]) ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (allFilteredSelected) {
                                  setInviteSelected({});
                                } else {
                                  const next: Record<string, true> = {};
                                  filtered.forEach((c) => { if (!sentInviteUserIds[c.userId]) next[c.userId] = true; });
                                  setInviteSelected(next);
                                }
                              }}
                              className="text-xs font-semibold text-cyan-400 hover:text-cyan-300"
                            >
                              {allFilteredSelected ? "Deselect all" : "Select all"}
                            </button>
                          ) : null}
                        </div>
                        {filtered.map((connection) => {
                          const alreadySent = Boolean(sentInviteUserIds[connection.userId]);
                          const selected = Boolean(inviteSelected[connection.userId]);
                          return (
                            <button
                              key={connection.userId}
                              type="button"
                              disabled={alreadySent}
                              onClick={() => {
                                if (alreadySent) return;
                                setInviteSelected((prev) => {
                                  const next = { ...prev };
                                  if (next[connection.userId]) delete next[connection.userId];
                                  else next[connection.userId] = true;
                                  return next;
                                });
                              }}
                              className={cx(
                                "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition",
                                alreadySent ? "opacity-50 cursor-default" : "hover:bg-white/[0.05]"
                              )}
                            >
                              <div className="relative shrink-0">
                                {connection.avatarUrl ? (
                                  <img
                                    src={connection.avatarUrl}
                                    alt={connection.displayName}
                                    className="h-10 w-10 rounded-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400/30 to-fuchsia-500/30 text-sm font-bold text-white">
                                    {connection.displayName.charAt(0).toUpperCase()}
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-white">{connection.displayName}</p>
                                {connection.subtitle ? (
                                  <p className="truncate text-xs text-slate-400">{connection.subtitle}</p>
                                ) : null}
                              </div>
                              <div className="shrink-0">
                                {alreadySent ? (
                                  <span className="text-xs font-semibold text-emerald-400">Sent</span>
                                ) : (
                                  <div className={cx(
                                    "flex h-5 w-5 items-center justify-center rounded-full border-2 transition",
                                    selected
                                      ? "border-transparent bg-[linear-gradient(90deg,#22d3ee,#d946ef)]"
                                      : "border-white/25 bg-transparent"
                                  )}>
                                    {selected ? <span className="material-symbols-outlined text-[13px] text-[#06121a] font-bold">check</span> : null}
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                        {selectedCount > 0 ? (
                          <p className="px-3 pt-1 pb-0 text-xs text-slate-500">{selectedCount} selected</p>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-white/8 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => { void copyShareLink(); }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white hover:bg-white/[0.08]"
                  >
                    <span className="material-symbols-outlined text-[16px]">link</span>
                    Copy invite link
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setInviteModalOpen(false); setInviteSelected({}); setInviteSearch(""); }}
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={Object.keys(inviteSelected).length === 0 || inviteSendBusy}
                      onClick={() => void sendBulkInvites(Object.keys(inviteSelected))}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[linear-gradient(90deg,#22d3ee,#d946ef)] px-4 py-2 text-sm font-bold text-[#06121a] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                    >
                      {inviteSendBusy ? (
                        <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                      ) : null}
                      Send invites
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {mapDialogOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[142] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6"
              onClick={() => setMapDialogOpen(false)}
            >
              <div
                className="sheet-up flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-white/12 bg-[#0f1419] shadow-2xl sm:rounded-3xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
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

      {/* Invite limit upgrade modal */}
      {inviteLimitModalOpen ? (
        <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setInviteLimitModalOpen(false)}>
          <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-[#141518] border border-white/[0.08] overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            {/* Header gradient */}
            <div className="h-1.5 w-full bg-gradient-to-r from-cyan-400 via-violet-500 to-fuchsia-500" />
            <div className="px-6 py-8 text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/20 to-violet-500/20 border border-white/10">
                <span className="material-symbols-outlined text-[28px] text-cyan-300">send</span>
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold text-white">Invite limit reached</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  You&apos;ve used all <span className="text-white font-semibold">{inviteMonthlyLimit} event invites</span> for this month on the Starter plan. Upgrade to Plus for unlimited invites.
                </p>
              </div>
              <div className="space-y-2 pt-1">
                <a href="/pricing"
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-violet-500 py-3 text-sm font-bold text-white hover:opacity-90 transition">
                  <span className="material-symbols-outlined text-[16px]">workspace_premium</span>
                  Upgrade to Plus
                </a>
                <button type="button" onClick={() => setInviteLimitModalOpen(false)}
                  className="w-full rounded-2xl py-3 text-sm font-semibold text-slate-400 hover:text-white transition">
                  Maybe later
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
