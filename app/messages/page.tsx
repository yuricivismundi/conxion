"use client";

import { Suspense, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image, { type ImageLoaderProps } from "next/image";
import Link from "next/link";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";
import { fetchVisibleConnections } from "@/lib/connections/read-model";

type ThreadKind = "connection" | "trip";
type FilterTab = "all" | "connections" | "trips" | "archived";

type ParsedThread = { kind: ThreadKind; id: string };

type MessageRowDb = {
  id?: string;
  connection_id?: string;
  sender_id?: string;
  body?: string | null;
  created_at?: string;
};

type ProfileRow = {
  user_id?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  city?: string | null;
  country?: string | null;
};

type TripRow = {
  id?: string;
  destination_city?: string | null;
  destination_country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type ThreadRow = {
  threadId: string;
  dbThreadId: string | null;
  kind: ThreadKind;
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  preview: string;
  updatedAt: string;
  unreadCount: number;
  badge: string;
};

type ThreadDbRow = {
  id?: string;
  thread_type?: string;
  connection_id?: string | null;
  trip_id?: string | null;
  last_message_at?: string | null;
  created_at?: string | null;
};

type ThreadMessageDbRow = {
  id?: string;
  thread_id?: string;
  sender_id?: string;
  body?: string | null;
  created_at?: string;
};

type ComposeConnectionTarget = {
  connectionId: string;
  displayName: string;
  subtitle: string;
  avatarUrl: string | null;
};

type ComposeTripTarget = {
  tripId: string;
  displayName: string;
  subtitle: string;
  updatedAt: string;
};

type TripRequestRow = {
  id?: string;
  trip_id?: string;
  requester_id?: string;
  status?: string;
  decided_at?: string | null;
  updated_at?: string | null;
  created_at?: string;
};

type MessageItem = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  status?: "sending" | "sent" | "failed";
  localOnly?: boolean;
};

type MessageReactionDbRow = {
  message_id?: string;
  reactor_id?: string;
  emoji?: string;
};

type MessageReactionAggregate = {
  emoji: string;
  count: number;
  mine: boolean;
};

type ReplyTarget = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};

type ActiveThreadMeta = {
  kind: ThreadKind;
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  badge: string;
  otherUserId: string | null;
  connectionId: string | null;
  tripId: string | null;
  threadId: string | null;
};

type ThreadPrefsPatch = {
  archived_at?: string | null;
  muted_until?: string | null;
  pinned_at?: string | null;
  last_read_at?: string | null;
};

type VisibleConnectionLite = {
  id: string;
  other_user_id: string;
  trip_id: string | null;
  connect_context: string | null;
};

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "🎉"];
const QUICK_STARTERS = ["Hey! 👋", "Are you available this week?", "Sounds good ✅", "Let’s coordinate details."];
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "👏", "😮", "😢", "🙏"];
const LOCAL_REACTIONS_STORAGE_KEY = "cx_messages_reactions_local_v1";
const LOCAL_MANUAL_UNREAD_STORAGE_KEY = "cx_messages_manual_unread_v1";
const LOCAL_THREAD_DRAFTS_STORAGE_KEY = "cx_messages_thread_drafts_v1";
const LOCAL_ARCHIVED_THREADS_STORAGE_KEY = "cx_messages_archived_threads_v1";
const LOCAL_MUTED_THREADS_STORAGE_KEY = "cx_messages_muted_threads_v1";
const LOCAL_PINNED_THREADS_STORAGE_KEY = "cx_messages_pinned_threads_v1";
const REPORT_REASON_OPTIONS = [
  "Harassment",
  "Suicide or self-injury",
  "Pretending to be someone else",
  "Violence or dangerous organizations",
  "Nudity or sexual activity",
  "Selling or promoting restricted items",
  "Scam or fraud",
  "Hate speech",
  "Other",
];

const REPLY_MARKER_REGEX = /^\[\[reply:([a-zA-Z0-9_-]+)\]\]\n?/;

function buildComposeTargets(
  rows: VisibleConnectionLite[],
  profilesById: Record<string, { displayName: string; avatarUrl: string | null; city: string; country: string }>
) {
  const dedupe = new Map<string, ComposeConnectionTarget>();
  rows.forEach((row) => {
    if (!row.id) return;
    const profile = profilesById[row.other_user_id];
    const cityCountry = [profile?.city ?? "", profile?.country ?? ""].filter(Boolean).join(", ");
    const subtitle = row.trip_id || row.connect_context === "trip" || row.connect_context === "traveller" ? "Trip thread" : cityCountry || "Connection";
    dedupe.set(row.id, {
      connectionId: row.id,
      displayName: profile?.displayName ?? "Connection",
      subtitle,
      avatarUrl: profile?.avatarUrl ?? null,
    });
  });
  return Array.from(dedupe.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function buildTripComposeTargets(
  acceptedTripIds: string[],
  tripsById: Record<string, TripRow>,
  updatedAtByTripId: Record<string, string>
) {
  return acceptedTripIds
    .map((tripId) => {
      const trip = tripsById[tripId];
      const destination = [trip?.destination_city ?? "", trip?.destination_country ?? ""].filter(Boolean).join(", ");
      const start = trip?.start_date ? formatDateShort(trip.start_date) : null;
      const subtitle = [destination || "Trip", start].filter(Boolean).join(" • ");
      return {
        tripId,
        displayName: destination ? `Trip to ${destination}` : "Trip thread",
        subtitle: subtitle || "Trip",
        updatedAt: updatedAtByTripId[tripId] || trip?.start_date || new Date().toISOString(),
      } satisfies ComposeTripTarget;
    })
    .sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt));
}

function toTime(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRelative(iso?: string) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function formatDateShort(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function parseTripLabel(row: TripRow | null | undefined) {
  if (!row?.destination_city || !row.destination_country) return "Trip chat";
  const datePart = row.start_date ? formatDateShort(row.start_date) : "TBD";
  return `${row.destination_city}, ${row.destination_country} • ${datePart}`;
}

function formatTime(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatChatDayLabel(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function parseThreadToken(rawToken: string): ParsedThread | null {
  if (!rawToken) return null;
  if (rawToken.startsWith("conn:")) return { kind: "connection", id: rawToken.slice(5) };
  if (rawToken.startsWith("trip:")) return { kind: "trip", id: rawToken.slice(5) };
  return { kind: "connection", id: rawToken };
}

function msUntilLocalMidnight(nowMs: number) {
  const now = new Date(nowMs);
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(0, next.getTime() - nowMs);
}

function formatRemaining(ms: number) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function parseReplyPayload(body: string) {
  const raw = body ?? "";
  const match = raw.match(REPLY_MARKER_REGEX);
  if (!match) {
    return { replyToId: null as string | null, text: raw };
  }
  const replyToId = match[1] ?? null;
  const text = raw.replace(REPLY_MARKER_REGEX, "");
  return { replyToId, text };
}

function toSingleLineText(value: string, max = 140) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max).trimEnd()}...`;
}

function buildReactionAggregateMap(rows: MessageReactionDbRow[], viewerId: string | null) {
  const byMessage: Record<string, Record<string, MessageReactionAggregate>> = {};

  rows.forEach((row) => {
    const messageId = row.message_id ?? "";
    const emoji = row.emoji ?? "";
    const reactorId = row.reactor_id ?? "";
    if (!messageId || !emoji) return;

    if (!byMessage[messageId]) byMessage[messageId] = {};
    if (!byMessage[messageId][emoji]) {
      byMessage[messageId][emoji] = { emoji, count: 0, mine: false };
    }
    byMessage[messageId][emoji].count += 1;
    if (viewerId && reactorId === viewerId) {
      byMessage[messageId][emoji].mine = true;
    }
  });

  const result: Record<string, MessageReactionAggregate[]> = {};
  Object.entries(byMessage).forEach(([messageId, emojiMap]) => {
    result[messageId] = Object.values(emojiMap).sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
  });
  return result;
}

function shouldFallbackPrefs(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("archived_at") ||
      lower.includes("muted_until") ||
      lower.includes("pinned_at") ||
      lower.includes("last_read_at") ||
      lower.includes("schema cache") ||
    lower.includes("column") ||
    lower.includes("could not find the table") ||
    lower.includes("relation")
  );
}

const remoteImageLoader = ({ src }: ImageLoaderProps) => src;

function MessagesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeQuery, setComposeQuery] = useState("");
  const [composeConnectionTargets, setComposeConnectionTargets] = useState<ComposeConnectionTarget[]>([]);
  const [composeTripTargets, setComposeTripTargets] = useState<ComposeTripTarget[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const [meId, setMeId] = useState<string | null>(null);
  const [activeThreadToken, setActiveThreadToken] = useState<string | null>(null);
  const [activeMeta, setActiveMeta] = useState<ActiveThreadMeta | null>(null);
  const [activeMessages, setActiveMessages] = useState<MessageItem[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadDbSupported, setThreadDbSupported] = useState(true);
  const [threadBody, setThreadBody] = useState("");
  const [sending, setSending] = useState(false);
  const [dailyLimitReached, setDailyLimitReached] = useState(false);
  const [threadInfo, setThreadInfo] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("Scam or fraud");
  const [reportNote, setReportNote] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportFromMessageId, setReportFromMessageId] = useState<string | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("Safety concern");
  const [blockNote, setBlockNote] = useState("");
  const [blockBusy, setBlockBusy] = useState(false);
  const [archivedThreads, setArchivedThreads] = useState<Record<string, true>>({});
  const [mutedUntilByThread, setMutedUntilByThread] = useState<Record<string, string>>({});
  const [pinnedThreads, setPinnedThreads] = useState<Record<string, true>>({});
  const [threadPrefsInLocalMode, setThreadPrefsInLocalMode] = useState(false);
  const [activeLastReadAt, setActiveLastReadAt] = useState<string | null>(null);
  const [activePeerLastReadAt, setActivePeerLastReadAt] = useState<string | null>(null);
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
  const [openThreadRowMenuId, setOpenThreadRowMenuId] = useState<string | null>(null);
  const [threadActionsOpen, setThreadActionsOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [manualUnreadByThread, setManualUnreadByThread] = useState<Record<string, true>>({});
  const [threadDrafts, setThreadDrafts] = useState<Record<string, string>>({});
  const [hoveredUnreadThreadId, setHoveredUnreadThreadId] = useState<string | null>(null);
  const [recentlyUpdatedThreadIds, setRecentlyUpdatedThreadIds] = useState<Record<string, true>>({});
  const [messageReactions, setMessageReactions] = useState<Record<string, MessageReactionAggregate[]>>({});
  const [reactionsServerSupported, setReactionsServerSupported] = useState(true);
  const [localReactionsByThread, setLocalReactionsByThread] = useState<
    Record<string, Record<string, MessageReactionAggregate[]>>
  >({});
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
  const [, setPeerTyping] = useState(false);
  const [meAvatarUrl, setMeAvatarUrl] = useState<string | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [clockMs, setClockMs] = useState(Date.now());
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const threadActionsRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const localReactionsByThreadRef = useRef<Record<string, Record<string, MessageReactionAggregate[]>>>({});
  const threadDraftsRef = useRef<Record<string, string>>({});
  const previousThreadsRef = useRef<Record<string, { updatedAt: string; unreadCount: number }>>({});
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingLastSentAtRef = useRef(0);
  const typingTimeoutRef = useRef<number | null>(null);
  const swipeGestureRef = useRef<{
    messageId: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LOCAL_REACTIONS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, Record<string, MessageReactionAggregate[]>> | null;
      if (parsed && typeof parsed === "object") {
        localReactionsByThreadRef.current = parsed;
        setLocalReactionsByThread(parsed);
      }
    } catch {
      // Ignore invalid local cache payloads.
    }
  }, []);

  useEffect(() => {
    localReactionsByThreadRef.current = localReactionsByThread;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_REACTIONS_STORAGE_KEY, JSON.stringify(localReactionsByThread));
    } catch {
      // Ignore local storage failures.
    }
  }, [localReactionsByThread]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LOCAL_MANUAL_UNREAD_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, true> | null;
      if (parsed && typeof parsed === "object") {
        setManualUnreadByThread(parsed);
      }
    } catch {
      // Ignore invalid local cache payloads.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_MANUAL_UNREAD_STORAGE_KEY, JSON.stringify(manualUnreadByThread));
    } catch {
      // Ignore local storage failures.
    }
  }, [manualUnreadByThread]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LOCAL_THREAD_DRAFTS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string> | null;
      if (parsed && typeof parsed === "object") {
        threadDraftsRef.current = parsed;
        setThreadDrafts(parsed);
      }
    } catch {
      // Ignore invalid local cache payloads.
    }
  }, []);

  useEffect(() => {
    threadDraftsRef.current = threadDrafts;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_THREAD_DRAFTS_STORAGE_KEY, JSON.stringify(threadDrafts));
    } catch {
      // Ignore local storage failures.
    }
  }, [threadDrafts]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LOCAL_ARCHIVED_THREADS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, true> | null;
      if (parsed && typeof parsed === "object") {
        setArchivedThreads(parsed);
      }
    } catch {
      // Ignore invalid local cache payloads.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_ARCHIVED_THREADS_STORAGE_KEY, JSON.stringify(archivedThreads));
    } catch {
      // Ignore local storage failures.
    }
  }, [archivedThreads]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LOCAL_MUTED_THREADS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string> | null;
      if (parsed && typeof parsed === "object") {
        const now = Date.now();
        const cleaned = Object.fromEntries(Object.entries(parsed).filter(([, until]) => toTime(until) > now));
        setMutedUntilByThread(cleaned);
      }
    } catch {
      // Ignore invalid local cache payloads.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_MUTED_THREADS_STORAGE_KEY, JSON.stringify(mutedUntilByThread));
    } catch {
      // Ignore local storage failures.
    }
  }, [mutedUntilByThread]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LOCAL_PINNED_THREADS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, true> | null;
      if (parsed && typeof parsed === "object") {
        setPinnedThreads(parsed);
      }
    } catch {
      // Ignore invalid local cache payloads.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_PINNED_THREADS_STORAGE_KEY, JSON.stringify(pinnedThreads));
    } catch {
      // Ignore local storage failures.
    }
  }, [pinnedThreads]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (!threadActionsRef.current) return;
      const target = event.target as Node | null;
      if (target && !threadActionsRef.current.contains(target)) {
        setThreadActionsOpen(false);
      }
      const el = target instanceof Element ? target : null;
      if (!el?.closest('[data-thread-row-menu="true"]')) {
        setOpenThreadRowMenuId(null);
      }
    };

    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === "Escape") {
        setOpenMessageMenuId(null);
        setOpenThreadRowMenuId(null);
        setThreadActionsOpen(false);
        setComposerEmojiOpen(false);
        setHoveredUnreadThreadId(null);
        if (reportOpen) setReportOpen(false);
        if (blockOpen) setBlockOpen(false);
        if (composeOpen) setComposeOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [blockOpen, composeOpen, reportOpen]);

  useEffect(() => {
    const currentMap: Record<string, { updatedAt: string; unreadCount: number }> = {};
    threads.forEach((thread) => {
      currentMap[thread.threadId] = {
        updatedAt: thread.updatedAt,
        unreadCount: thread.unreadCount,
      };
    });

	    const previous = previousThreadsRef.current;
	    const previousIds = Object.keys(previous);
	    if (previousIds.length > 0) {
      const changedIds = threads
        .filter((thread) => {
          const prev = previous[thread.threadId];
          if (!prev) return false;
          return toTime(thread.updatedAt) > toTime(prev.updatedAt) || thread.unreadCount > prev.unreadCount;
        })
        .map((thread) => thread.threadId);

	      if (changedIds.length > 0) {
        previousThreadsRef.current = currentMap;
	        setRecentlyUpdatedThreadIds((prev) => {
	          const next = { ...prev };
	          changedIds.forEach((id) => {
	            next[id] = true;
          });
          return next;
        });

	        const timer = window.setTimeout(() => {
	          setRecentlyUpdatedThreadIds((prev) => {
	            const next = { ...prev };
            changedIds.forEach((id) => {
              delete next[id];
            });
            return next;
          });
        }, 1200);

	        return () => window.clearTimeout(timer);
	      }
	    }

    previousThreadsRef.current = currentMap;
  }, [threads]);

  useEffect(() => {
    setMutedUntilByThread((prev) => {
      const entries = Object.entries(prev);
      const next = entries.filter(([, until]) => toTime(until) > clockMs);
      if (next.length === entries.length) return prev;
      return Object.fromEntries(next);
    });
  }, [clockMs]);

  const loadThreadReactions = useCallback(
    async (params: { kind: ThreadKind; threadScopeId: string; viewerId: string; threadToken?: string }) => {
      const res = await supabase
        .from("message_reactions")
        .select("message_id,reactor_id,emoji")
        .eq("thread_kind", params.kind)
        .eq("thread_id", params.threadScopeId)
        .limit(6000);

      if (res.error) {
        const lower = res.error.message.toLowerCase();
        if (
          lower.includes("relation") ||
          lower.includes("schema cache") ||
          lower.includes("does not exist") ||
          lower.includes("permission denied")
        ) {
          setReactionsServerSupported(false);
          return false;
        }
        throw new Error(res.error.message);
      }

      setReactionsServerSupported(true);
      const nextMap = buildReactionAggregateMap((res.data ?? []) as MessageReactionDbRow[], params.viewerId);
      setMessageReactions(nextMap);
      if (params.threadToken) {
        setLocalReactionsByThread((prev) => ({ ...prev, [params.threadToken as string]: nextMap }));
      }
      return true;
    },
    []
  );

  const loadThreadByToken = useCallback(async (token: string, userId: string) => {
    const parsed = parseThreadToken(token);
    if (!parsed) return;

    setThreadLoading(true);
    setThreadError(null);
    setThreadInfo(null);
    setDailyLimitReached(false);
    setThreadDbSupported(true);
    setMessageReactions(localReactionsByThreadRef.current[token] ?? {});

    try {
      if (parsed.kind === "connection") {
        const visibleRows = await fetchVisibleConnections(supabase, userId);
        const row = visibleRows.find((item) => item.id === parsed.id && item.is_visible_in_messages);
        if (!row) throw new Error("This conversation is not available.");

        const profileRes = await supabase
          .from("profiles")
          .select("user_id,display_name,avatar_url,city,country")
          .eq("user_id", row.other_user_id)
          .maybeSingle();
        const profile = (profileRes.data ?? null) as ProfileRow | null;

        const messagesRes = await supabase
          .from("messages")
          .select("id,sender_id,body,created_at")
          .eq("connection_id", row.id)
          .order("created_at", { ascending: true })
          .limit(1000);
        if (messagesRes.error) throw new Error(messagesRes.error.message);

        let threadId: string | null = null;
        let previousLastReadAt: string | null = null;
        const threadRes = await supabase.from("threads").select("id").eq("connection_id", row.id).maybeSingle();
        if (!threadRes.error) {
          threadId = (threadRes.data as { id?: string } | null)?.id ?? null;
          if (!threadId) {
            const createThreadRes = await supabase
              .from("threads")
              .insert({
                thread_type: "connection",
                connection_id: row.id,
                created_by: userId,
                last_message_at: new Date().toISOString(),
              })
              .select("id")
              .single();
            if (!createThreadRes.error) {
              threadId = (createThreadRes.data as { id?: string } | null)?.id ?? null;
            }
          }
        }
        if (threadId) {
          await supabase.from("thread_participants").upsert(
            [
              { thread_id: threadId, user_id: userId, role: "member", last_read_at: new Date().toISOString() },
              { thread_id: threadId, user_id: row.other_user_id, role: "member" },
            ],
            { onConflict: "thread_id,user_id" }
          );

          const participantRes = await supabase
            .from("thread_participants")
            .select("last_read_at")
            .eq("thread_id", threadId)
            .eq("user_id", userId)
            .maybeSingle();
          if (!participantRes.error) {
            const participantRow = participantRes.data as { last_read_at?: string | null } | null;
            previousLastReadAt = participantRow?.last_read_at ?? null;
          }

          const peerParticipantRes = await supabase
            .from("thread_participants")
            .select("last_read_at")
            .eq("thread_id", threadId)
            .eq("user_id", row.other_user_id)
            .maybeSingle();
          if (!peerParticipantRes.error) {
            const peerParticipant = peerParticipantRes.data as { last_read_at?: string | null } | null;
            setActivePeerLastReadAt(peerParticipant?.last_read_at ?? null);
          } else {
            setActivePeerLastReadAt(null);
          }
        } else {
          setActivePeerLastReadAt(null);
        }
        setActiveLastReadAt(previousLastReadAt);

        setActiveMeta({
          kind: "connection",
          title: profile?.display_name ?? "Connection",
          subtitle: [profile?.city ?? "", profile?.country ?? ""].filter(Boolean).join(", ") || "Connection",
          avatarUrl: profile?.avatar_url ?? null,
          badge: "Connection",
          otherUserId: row.other_user_id,
          connectionId: row.id,
          tripId: null,
          threadId,
        });
        setActiveMessages(
          ((messagesRes.data ?? []) as Array<Record<string, unknown>>).map((m) => ({
            id: typeof m.id === "string" ? m.id : crypto.randomUUID(),
            senderId: typeof m.sender_id === "string" ? m.sender_id : "",
            body: typeof m.body === "string" ? m.body : "",
            createdAt: typeof m.created_at === "string" ? m.created_at : "",
            status: "sent",
          }))
        );
        await loadThreadReactions({
          kind: "connection",
          threadScopeId: row.id,
          viewerId: userId,
          threadToken: token,
        });
      } else {
        const tripRes = await supabase
          .from("trips")
          .select("id,user_id,destination_city,destination_country,start_date,end_date")
          .eq("id", parsed.id)
          .maybeSingle();
        if (tripRes.error) throw new Error(tripRes.error.message);
        const trip = (tripRes.data ?? null) as TripRow & { user_id?: string } | null;
        if (!trip?.id) throw new Error("Trip thread not found.");

        let allowed = trip.user_id === userId;
        if (!allowed) {
          const reqRes = await supabase
            .from("trip_requests")
            .select("id")
            .eq("trip_id", parsed.id)
            .eq("requester_id", userId)
            .eq("status", "accepted")
            .maybeSingle();
          allowed = Boolean(reqRes.data);
        }
        if (!allowed) throw new Error("You do not have access to this trip thread.");

        const existingThreadRes = await supabase.from("threads").select("id").eq("trip_id", parsed.id).maybeSingle();
        if (
          existingThreadRes.error &&
          (existingThreadRes.error.message.toLowerCase().includes("relation") ||
            existingThreadRes.error.message.toLowerCase().includes("schema cache"))
        ) {
          setThreadDbSupported(false);
          setActiveLastReadAt(null);
          setActiveMeta({
            kind: "trip",
            title: trip.destination_city ? `Trip to ${trip.destination_city}` : "Trip chat",
            subtitle: parseTripLabel(trip),
            avatarUrl: null,
            badge: "Trip",
            otherUserId: null,
            connectionId: null,
            tripId: trip.id ?? null,
            threadId: null,
          });
          setActiveMessages([]);
          setThreadLoading(false);
          return;
        }
        if (existingThreadRes.error) throw new Error(existingThreadRes.error.message);

        let threadId = (existingThreadRes.data as { id?: string } | null)?.id ?? null;
        let previousLastReadAt: string | null = null;
        if (!threadId) {
          const createThreadRes = await supabase
            .from("threads")
            .insert({
              thread_type: "trip",
              trip_id: parsed.id,
              created_by: userId,
              last_message_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (createThreadRes.error) throw new Error(createThreadRes.error.message);
          threadId = (createThreadRes.data as { id?: string } | null)?.id ?? null;
        }

        if (threadId) {
          const participantRes = await supabase
            .from("thread_participants")
            .select("last_read_at")
            .eq("thread_id", threadId)
            .eq("user_id", userId)
            .maybeSingle();
          if (!participantRes.error) {
            const participantRow = participantRes.data as { last_read_at?: string | null } | null;
            previousLastReadAt = participantRow?.last_read_at ?? null;
          }

          await supabase.from("thread_participants").upsert(
            { thread_id: threadId, user_id: userId, role: "member", last_read_at: new Date().toISOString() },
            { onConflict: "thread_id,user_id" }
          );
        }
        setActivePeerLastReadAt(null);
        setActiveLastReadAt(previousLastReadAt);

        const tripMsgRes = threadId
          ? await supabase
              .from("thread_messages")
              .select("id,sender_id,body,created_at")
              .eq("thread_id", threadId)
              .order("created_at", { ascending: true })
              .limit(1000)
          : { data: [], error: null };
        if (tripMsgRes.error) throw new Error(tripMsgRes.error.message);

        setActiveMeta({
          kind: "trip",
          title: trip.destination_city ? `Trip to ${trip.destination_city}` : "Trip chat",
          subtitle: parseTripLabel(trip),
          avatarUrl: null,
          badge: "Trip",
          otherUserId: null,
          connectionId: null,
          tripId: trip.id ?? null,
          threadId,
        });
        setActiveMessages(
          ((tripMsgRes.data ?? []) as Array<Record<string, unknown>>).map((m) => ({
            id: typeof m.id === "string" ? m.id : crypto.randomUUID(),
            senderId: typeof m.sender_id === "string" ? m.sender_id : "",
            body: typeof m.body === "string" ? m.body : "",
            createdAt: typeof m.created_at === "string" ? m.created_at : "",
            status: "sent",
          }))
        );
        if (threadId) {
          await loadThreadReactions({
            kind: "trip",
            threadScopeId: threadId,
            viewerId: userId,
            threadToken: token,
          });
        }
      }
    } catch (e: unknown) {
      setThreadError(e instanceof Error ? e.message : "Failed to load thread.");
      setActiveMeta(null);
      setActiveMessages([]);
      setActiveLastReadAt(null);
      setActivePeerLastReadAt(null);
    } finally {
      setThreadLoading(false);
    }
  }, [loadThreadReactions]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setThreadPrefsInLocalMode(false);

      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      if (cancelled) return;
      setMeId(user.id);
      const authAvatar =
        typeof user.user_metadata?.avatar_url === "string"
          ? user.user_metadata.avatar_url
          : typeof user.user_metadata?.picture === "string"
          ? user.user_metadata.picture
          : null;
      setMeAvatarUrl(authAvatar);

      if (!authAvatar) {
        const meProfileRes = await supabase.from("profiles").select("avatar_url").eq("user_id", user.id).maybeSingle();
        if (!cancelled && !meProfileRes.error) {
          const meProfile = meProfileRes.data as { avatar_url?: string | null } | null;
          setMeAvatarUrl(meProfile?.avatar_url ?? null);
        }
      }

      try {
        let archivedFromDb: Record<string, true> = {};
        let mutedFromDb: Record<string, string> = {};
        let pinnedFromDb: Record<string, true> = {};
        const visibleRows = await fetchVisibleConnections(supabase, user.id);
        const visibleConnections = visibleRows.filter((row) => row.is_visible_in_messages);
        const otherUserIds = Array.from(new Set(visibleConnections.map((row) => row.other_user_id).filter(Boolean)));
        const tripIds = Array.from(new Set(visibleConnections.map((row) => row.trip_id).filter(Boolean))) as string[];
        const connectionsById: Record<string, (typeof visibleConnections)[number]> = Object.fromEntries(
          visibleConnections.map((row) => [row.id, row])
        );

        const tripRequestColumnsPrimary = "id,trip_id,requester_id,status,decided_at,updated_at,created_at";
        const tripRequestColumnsFallback = "id,trip_id,requester_id,status,updated_at,created_at";

        const [ownedTripsRes, acceptedOutgoingPrimaryRes] = await Promise.all([
          supabase.from("trips").select("id").eq("user_id", user.id).limit(500),
          supabase
            .from("trip_requests")
            .select(tripRequestColumnsPrimary)
            .eq("requester_id", user.id)
            .eq("status", "accepted")
            .limit(500),
        ]);

        let acceptedOutgoingRows = (acceptedOutgoingPrimaryRes.data ?? []) as TripRequestRow[];
        if (acceptedOutgoingPrimaryRes.error) {
          const msg = acceptedOutgoingPrimaryRes.error.message.toLowerCase();
          if (msg.includes("column") || msg.includes("schema cache")) {
            const acceptedOutgoingFallbackRes = await supabase
              .from("trip_requests")
              .select(tripRequestColumnsFallback)
              .eq("requester_id", user.id)
              .eq("status", "accepted")
              .limit(500);
            acceptedOutgoingRows = (acceptedOutgoingFallbackRes.data ?? []) as TripRequestRow[];
          }
        }

        const ownedTripIds = Array.from(
          new Set(
            ((ownedTripsRes.data ?? []) as Array<Record<string, unknown>>)
              .map((row) => (typeof row.id === "string" ? row.id : ""))
              .filter(Boolean)
          )
        );

        let acceptedIncomingRes: { data: unknown[]; error: { message: string } | null } = { data: [], error: null };
        if (ownedTripIds.length) {
          const incomingPrimary = await supabase
            .from("trip_requests")
            .select(tripRequestColumnsPrimary)
            .in("trip_id", ownedTripIds)
            .eq("status", "accepted")
            .limit(1000);
          if (incomingPrimary.error) {
            const msg = incomingPrimary.error.message.toLowerCase();
            if (msg.includes("column") || msg.includes("schema cache")) {
              const incomingFallback = await supabase
                .from("trip_requests")
                .select(tripRequestColumnsFallback)
                .in("trip_id", ownedTripIds)
                .eq("status", "accepted")
                .limit(1000);
              acceptedIncomingRes = {
                data: (incomingFallback.data ?? []) as unknown[],
                error: incomingFallback.error ? { message: incomingFallback.error.message } : null,
              };
            } else {
              acceptedIncomingRes = { data: [], error: { message: incomingPrimary.error.message } };
            }
          } else {
            acceptedIncomingRes = { data: (incomingPrimary.data ?? []) as unknown[], error: null };
          }
        }

        const acceptedTripRows = [
          ...acceptedOutgoingRows,
          ...((acceptedIncomingRes.data ?? []) as TripRequestRow[]),
        ].filter((row) => (row.trip_id ?? "").length > 0);

        const acceptedTripIds = Array.from(new Set(acceptedTripRows.map((row) => row.trip_id ?? "").filter(Boolean)));
        const acceptedTripUpdatedAtById: Record<string, string> = {};
        acceptedTripRows.forEach((row) => {
          const id = row.trip_id ?? "";
          if (!id) return;
          const candidate = row.decided_at || row.updated_at || row.created_at || new Date().toISOString();
          const prev = acceptedTripUpdatedAtById[id];
          if (!prev || toTime(candidate) > toTime(prev)) acceptedTripUpdatedAtById[id] = candidate;
        });

        const threadsRes = await supabase
          .from("threads")
          .select("id,thread_type,connection_id,trip_id,last_message_at,created_at")
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(500);

        const threadsRelationMissing =
          Boolean(threadsRes.error) &&
          (threadsRes.error?.message.toLowerCase().includes("relation") ||
            threadsRes.error?.message.toLowerCase().includes("does not exist") ||
            threadsRes.error?.message.toLowerCase().includes("schema cache") ||
            threadsRes.error?.message.toLowerCase().includes("could not find the table"));

        let mergedThreads: ThreadRow[] = [];

        if (!threadsRes.error && Array.isArray(threadsRes.data) && threadsRes.data.length > 0) {
          const threadRows = (threadsRes.data ?? []) as ThreadDbRow[];
          const threadIds = threadRows.map((row) => row.id ?? "").filter(Boolean);
          const connectionThreadIds = Array.from(
            new Set(threadRows.filter((row) => row.thread_type === "connection").map((row) => row.connection_id ?? "").filter(Boolean))
          );
          const tripThreadIds = Array.from(
            new Set(threadRows.filter((row) => row.thread_type === "trip").map((row) => row.trip_id ?? "").filter(Boolean))
          );
          const threadOtherUserIds = Array.from(
            new Set(
              [...otherUserIds, ...connectionThreadIds]
                .map((connectionId) => connectionsById[connectionId]?.other_user_id ?? "")
                .filter((value): value is string => Boolean(value))
            )
          );
          const allTripIds = Array.from(new Set([...tripIds, ...tripThreadIds, ...acceptedTripIds]));

          const [profilesRes, tripsRes, threadMessagesRes, threadParticipantsRes] = await Promise.all([
            threadOtherUserIds.length
              ? supabase
                  .from("profiles")
                  .select("user_id,display_name,avatar_url,city,country")
                  .in("user_id", threadOtherUserIds)
              : Promise.resolve({ data: [], error: null }),
            allTripIds.length
              ? supabase
                  .from("trips")
                  .select("id,destination_city,destination_country,start_date,end_date")
                  .in("id", allTripIds)
              : Promise.resolve({ data: [], error: null }),
            threadIds.length
              ? supabase
                  .from("thread_messages")
                  .select("id,thread_id,sender_id,body,created_at")
                  .in("thread_id", threadIds)
                  .order("created_at", { ascending: false })
                  .limit(1000)
              : Promise.resolve({ data: [], error: null }),
            threadIds.length
              ? supabase
                  .from("thread_participants")
                  .select("thread_id,last_read_at,archived_at,muted_until,pinned_at")
                  .eq("user_id", user.id)
                  .in("thread_id", threadIds)
              : Promise.resolve({ data: [], error: null }),
          ]);

          const profilesById: Record<string, { displayName: string; avatarUrl: string | null; city: string; country: string }> = {};
          ((profilesRes.data ?? []) as ProfileRow[]).forEach((row) => {
            const key = row.user_id ?? "";
            if (!key) return;
            profilesById[key] = {
              displayName: row.display_name ?? "Unknown",
              avatarUrl: row.avatar_url ?? null,
              city: row.city ?? "",
              country: row.country ?? "",
            };
          });
          setComposeConnectionTargets(
            buildComposeTargets(
              visibleConnections.map((row) => ({
                id: row.id,
                other_user_id: row.other_user_id,
                trip_id: row.trip_id ?? null,
                connect_context: row.connect_context ?? null,
              })),
              profilesById
            )
          );

          const tripsById: Record<string, TripRow> = {};
          ((tripsRes.data ?? []) as TripRow[]).forEach((row) => {
            const key = row.id ?? "";
            if (!key) return;
            tripsById[key] = row;
          });
          setComposeTripTargets(buildTripComposeTargets(acceptedTripIds, tripsById, acceptedTripUpdatedAtById));

          const lastByThread: Record<string, { body: string; senderId: string; createdAt: string }> = {};
          const threadMessagesByThread: Record<string, Array<{ senderId: string; createdAt: string }>> = {};
          ((threadMessagesRes.data ?? []) as ThreadMessageDbRow[]).forEach((row) => {
            const key = row.thread_id ?? "";
            if (!key) return;
            if (!lastByThread[key]) {
              const parsedBody = parseReplyPayload(row.body ?? "");
              lastByThread[key] = {
                body: parsedBody.text,
                senderId: row.sender_id ?? "",
                createdAt: row.created_at ?? "",
              };
            }
            if (!threadMessagesByThread[key]) threadMessagesByThread[key] = [];
            threadMessagesByThread[key].push({
              senderId: row.sender_id ?? "",
              createdAt: row.created_at ?? "",
            });
          });

          const lastReadByThread: Record<string, string> = {};
          const archivedByToken: Record<string, true> = {};
          const mutedUntilByToken: Record<string, string> = {};
          const pinnedByToken: Record<string, true> = {};
          const tokenByDbThreadId: Record<string, string> = {};
          threadRows.forEach((row) => {
            const dbThreadId = row.id ?? "";
            if (!dbThreadId) return;
            if (row.thread_type === "connection" && row.connection_id) {
              tokenByDbThreadId[dbThreadId] = `conn:${row.connection_id}`;
              return;
            }
            if (row.thread_type === "trip" && row.trip_id) {
              tokenByDbThreadId[dbThreadId] = `trip:${row.trip_id}`;
            }
          });

          ((threadParticipantsRes.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
            const threadId = typeof row.thread_id === "string" ? row.thread_id : "";
            const lastReadAt = typeof row.last_read_at === "string" ? row.last_read_at : "";
            if (threadId) lastReadByThread[threadId] = lastReadAt;

            const token = tokenByDbThreadId[threadId] ?? "";
            if (!token) return;
            const archivedAt = typeof row.archived_at === "string" ? row.archived_at : "";
            const mutedUntil = typeof row.muted_until === "string" ? row.muted_until : "";
            const pinnedAt = typeof row.pinned_at === "string" ? row.pinned_at : "";
            if (archivedAt) archivedByToken[token] = true;
            if (mutedUntil && toTime(mutedUntil) > Date.now()) mutedUntilByToken[token] = mutedUntil;
            if (pinnedAt) pinnedByToken[token] = true;
          });

          archivedFromDb = archivedByToken;
          mutedFromDb = mutedUntilByToken;
          pinnedFromDb = pinnedByToken;

          const unreadCountByThread: Record<string, number> = {};
          Object.entries(threadMessagesByThread).forEach(([threadId, rows]) => {
            const lastReadAt = lastReadByThread[threadId];
            const lastReadTime = lastReadAt ? Date.parse(lastReadAt) : 0;
            const count = rows.filter((row) => {
              if (!row.createdAt) return false;
              if (row.senderId === user.id) return false;
              const createdAtTime = Date.parse(row.createdAt);
              if (!Number.isFinite(createdAtTime)) return false;
              return createdAtTime > lastReadTime;
            }).length;
            unreadCountByThread[threadId] = count;
          });

          const mappedFromThreadsUnfiltered: Array<ThreadRow | null> = threadRows
            .map((row) => {
              const threadId = row.id ?? "";
              if (!threadId) return null;
              const last = lastByThread[threadId];
              const updatedAt = last?.createdAt || row.last_message_at || row.created_at || new Date().toISOString();

              if (row.thread_type === "connection") {
                const connectionId = row.connection_id ?? "";
                const connection = connectionsById[connectionId];
                if (!connection) return null;
                const other = profilesById[connection.other_user_id];
                const cameFromTrip =
                  connection.connect_context === "trip" ||
                  connection.connect_context === "traveller" ||
                  Boolean(connection.trip_id);
                return {
                  threadId: `conn:${connection.id}`,
                  dbThreadId: threadId,
                  kind: "connection",
                  title: other?.displayName ?? "Connection",
                  subtitle: cameFromTrip
                    ? `From trip • ${parseTripLabel((connection.trip_id ? tripsById[connection.trip_id] : null) ?? null)}`
                    : [other?.city ?? "", other?.country ?? ""].filter(Boolean).join(", ") || "Connection",
                  avatarUrl: other?.avatarUrl ?? null,
                  preview: last?.body || "No messages yet.",
                  updatedAt,
                  unreadCount: unreadCountByThread[threadId] ?? (last && last.senderId !== user.id ? 1 : 0),
                  badge: "Connection",
                } satisfies ThreadRow;
              }

              if (row.thread_type === "trip") {
                const id = row.trip_id ?? "";
                if (!id) return null;
                const trip = tripsById[id];
                return {
                  threadId: `trip:${id}`,
                  dbThreadId: threadId,
                  kind: "trip",
                  title: trip?.destination_city ? `Trip to ${trip.destination_city}` : "Trip chat",
                  subtitle: parseTripLabel(trip ?? null),
                  avatarUrl: null,
                  preview: last?.body || "Trip thread",
                  updatedAt,
                  unreadCount: unreadCountByThread[threadId] ?? (last && last.senderId !== user.id ? 1 : 0),
                  badge: "Trip",
                } satisfies ThreadRow;
              }
              return null;
            });

          const mappedFromThreads: ThreadRow[] = mappedFromThreadsUnfiltered
            .filter((row): row is ThreadRow => row !== null)
            .sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt));

          const mappedThreadIds = new Set(mappedFromThreads.map((item) => item.threadId));
          const fallbackConnectionThreads: ThreadRow[] = visibleConnections
            .filter((row) => !mappedThreadIds.has(`conn:${row.id}`))
            .map((row) => {
              const other = profilesById[row.other_user_id];
              const cameFromTrip =
                row.connect_context === "trip" || row.connect_context === "traveller" || Boolean(row.trip_id);
              return {
                threadId: `conn:${row.id}`,
                dbThreadId: null,
                kind: "connection",
                title: other?.displayName ?? "Connection",
                subtitle: cameFromTrip
                  ? `From trip • ${parseTripLabel((row.trip_id ? tripsById[row.trip_id] : null) ?? null)}`
                  : [other?.city ?? "", other?.country ?? ""].filter(Boolean).join(", ") || "Connection",
                avatarUrl: other?.avatarUrl ?? null,
                preview: "No messages yet.",
                updatedAt: row.created_at || new Date().toISOString(),
                unreadCount: 0,
                badge: "Connection",
              };
            });

          const fallbackTripThreads: ThreadRow[] = acceptedTripIds
            .filter((tripId) => !mappedThreadIds.has(`trip:${tripId}`))
            .map((tripId) => {
              const trip = tripsById[tripId];
              const updatedAt = acceptedTripUpdatedAtById[tripId] || trip?.start_date || new Date().toISOString();
              return {
                threadId: `trip:${tripId}`,
                dbThreadId: null,
                kind: "trip",
                title: trip?.destination_city ? `Trip to ${trip.destination_city}` : "Trip chat",
                subtitle: parseTripLabel(trip ?? null),
                avatarUrl: null,
                preview: "Open trip chat",
                updatedAt,
                unreadCount: 0,
                badge: "Trip",
              } satisfies ThreadRow;
            });

          mergedThreads = [...mappedFromThreads, ...fallbackConnectionThreads, ...fallbackTripThreads].sort(
            (a, b) => toTime(b.updatedAt) - toTime(a.updatedAt)
          );
        } else if (threadsRes.error && !threadsRelationMissing) {
          throw new Error(threadsRes.error.message);
        }

        if (mergedThreads.length === 0) {
          const allTripIdsFallback = Array.from(new Set([...tripIds, ...acceptedTripIds]));
          const [profilesRes, tripsRes, messagesRes] = await Promise.all([
            otherUserIds.length
              ? supabase
                  .from("profiles")
                  .select("user_id,display_name,avatar_url,city,country")
                  .in("user_id", otherUserIds)
              : Promise.resolve({ data: [], error: null }),
            allTripIdsFallback.length
              ? supabase
                  .from("trips")
                  .select("id,destination_city,destination_country,start_date,end_date")
                  .in("id", allTripIdsFallback)
              : Promise.resolve({ data: [], error: null }),
            supabase
              .from("messages")
              .select("id,connection_id,sender_id,body,created_at")
              .order("created_at", { ascending: false })
              .limit(500),
          ]);

          const profilesById: Record<string, { displayName: string; avatarUrl: string | null; city: string; country: string }> = {};
          ((profilesRes.data ?? []) as ProfileRow[]).forEach((row) => {
            const key = row.user_id ?? "";
            if (!key) return;
            profilesById[key] = {
              displayName: row.display_name ?? "Unknown",
              avatarUrl: row.avatar_url ?? null,
              city: row.city ?? "",
              country: row.country ?? "",
            };
          });
          setComposeConnectionTargets(
            buildComposeTargets(
              visibleConnections.map((row) => ({
                id: row.id,
                other_user_id: row.other_user_id,
                trip_id: row.trip_id ?? null,
                connect_context: row.connect_context ?? null,
              })),
              profilesById
            )
          );

          const tripsById: Record<string, TripRow> = {};
          ((tripsRes.data ?? []) as TripRow[]).forEach((row) => {
            const key = row.id ?? "";
            if (!key) return;
            tripsById[key] = row;
          });
          setComposeTripTargets(buildTripComposeTargets(acceptedTripIds, tripsById, acceptedTripUpdatedAtById));

          const lastByConnection: Record<string, { body: string; senderId: string; createdAt: string }> = {};
          ((messagesRes.data ?? []) as MessageRowDb[]).forEach((row) => {
            const connectionId = row.connection_id ?? "";
            if (!connectionId || lastByConnection[connectionId]) return;
            const parsedBody = parseReplyPayload(row.body ?? "");
            lastByConnection[connectionId] = {
              body: parsedBody.text,
              senderId: row.sender_id ?? "",
              createdAt: row.created_at ?? "",
            };
          });

          const connectionThreads: ThreadRow[] = visibleConnections.map((row) => {
            const other = profilesById[row.other_user_id];
            const last = lastByConnection[row.id];
            const cameFromTrip =
              row.connect_context === "trip" || row.connect_context === "traveller" || Boolean(row.trip_id);

            return {
              threadId: `conn:${row.id}`,
              dbThreadId: null,
              kind: "connection",
              title: other?.displayName ?? "Connection",
              subtitle: cameFromTrip
                ? `From trip • ${parseTripLabel((row.trip_id ? tripsById[row.trip_id] : null) ?? null)}`
                : [other?.city ?? "", other?.country ?? ""].filter(Boolean).join(", ") || "Connection",
              avatarUrl: other?.avatarUrl ?? null,
              preview: last?.body || "No messages yet.",
              updatedAt: last?.createdAt || row.created_at || new Date().toISOString(),
              unreadCount: last && last.senderId !== user.id ? 1 : 0,
              badge: "Connection",
            };
          });

          const tripThreads: ThreadRow[] = acceptedTripIds.map((tripId) => {
            const trip = tripsById[tripId];
            const updatedAt = acceptedTripUpdatedAtById[tripId] || trip?.start_date || new Date().toISOString();
            return {
              threadId: `trip:${tripId}`,
              dbThreadId: null,
              kind: "trip",
              title: trip?.destination_city ? `Trip to ${trip.destination_city}` : "Trip chat",
              subtitle: parseTripLabel(trip ?? null),
              avatarUrl: null,
              preview: "Open trip chat",
              updatedAt,
              unreadCount: 0,
              badge: "Trip",
            } satisfies ThreadRow;
          });

          mergedThreads = [...connectionThreads, ...tripThreads].sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt));
        }

        if (!cancelled) {
          setArchivedThreads((prev) => ({ ...prev, ...archivedFromDb }));
          setMutedUntilByThread((prev) => {
            const merged = { ...prev, ...mutedFromDb };
            const now = Date.now();
            return Object.fromEntries(Object.entries(merged).filter(([, until]) => toTime(until) > now));
          });
          setPinnedThreads((prev) => ({ ...prev, ...pinnedFromDb }));
          setThreads(mergedThreads);
          setActiveThreadToken((prev) => {
            const validPrev = prev && mergedThreads.some((row) => row.threadId === prev);
            if (validPrev) return prev;
            return mergedThreads[0]?.threadId ?? null;
          });
          setLoading(false);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load inbox.");
          setThreads([]);
          setComposeConnectionTargets([]);
          setComposeTripTargets([]);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadTick, router]);

  useEffect(() => {
    const requested = searchParams.get("thread");
    if (!requested) return;
    if (!threads.some((thread) => thread.threadId === requested)) return;
    setActiveThreadToken((prev) => (prev === requested ? prev : requested));
  }, [searchParams, threads]);

  useEffect(() => {
    if (!meId || !activeThreadToken) {
      setActiveMeta(null);
      setActiveMessages([]);
      setThreadError(null);
      setActiveLastReadAt(null);
      setActivePeerLastReadAt(null);
      setOpenMessageMenuId(null);
      setOpenThreadRowMenuId(null);
      setThreadActionsOpen(false);
      setReplyTo(null);
      setHighlightedMessageId(null);
      setComposerEmojiOpen(false);
      setThreadBody("");
      setMessageReactions({});
      return;
    }
    setOpenMessageMenuId(null);
    setOpenThreadRowMenuId(null);
    setThreadActionsOpen(false);
    setReplyTo(null);
    setHighlightedMessageId(null);
    setComposerEmojiOpen(false);
    setThreadBody(threadDraftsRef.current[activeThreadToken] ?? "");
    void loadThreadByToken(activeThreadToken, meId);
  }, [activeThreadToken, loadThreadByToken, meId, reloadTick]);

  useEffect(() => {
    if (!activeThreadToken) return;
    setThreadDrafts((prev) => {
      const current = prev[activeThreadToken] ?? "";
      if (current === threadBody) return prev;
      const next = { ...prev };
      if (threadBody.trim().length === 0) {
        delete next[activeThreadToken];
      } else {
        next[activeThreadToken] = threadBody;
      }
      return next;
    });
  }, [activeThreadToken, threadBody]);

  const sendActiveMessage = useCallback(async () => {
    const text = threadBody.trim();
    if (!text || !meId || !activeMeta) return;
    const outboundText = replyTo ? `[[reply:${replyTo.id}]]\n${text}` : text;
    setSending(true);
    setThreadError(null);
    setDailyLimitReached(false);
    const optimisticId = `local-${crypto.randomUUID()}`;
    const optimisticCreatedAt = new Date().toISOString();
    const optimisticMessage: MessageItem = {
      id: optimisticId,
      senderId: meId,
      body: outboundText,
      createdAt: optimisticCreatedAt,
      status: "sending",
      localOnly: true,
    };
    setActiveMessages((prev) => [...prev, optimisticMessage]);
    setThreadBody("");

    try {
      if (activeMeta.kind === "connection" && activeMeta.connectionId) {
        const rpc = await supabase.rpc("send_message", {
          p_connection_id: activeMeta.connectionId,
          p_body: outboundText,
        });
        if (rpc.error) throw rpc.error;
      } else if (activeMeta.kind === "trip" && activeMeta.threadId) {
        const insert = await supabase.from("thread_messages").insert({
          thread_id: activeMeta.threadId,
          sender_id: meId,
          body: outboundText,
        });
        if (insert.error) throw insert.error;
      } else {
        throw new Error("Thread messaging is unavailable for this chat.");
      }
      setActiveMessages((prev) =>
        prev.map((message) => (message.id === optimisticId ? { ...message, status: "sent", localOnly: false } : message))
      );
      setReplyTo(null);
      setThreadInfo(null);
      setReloadTick((v) => v + 1);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to send message.";
      if (
        message.toLowerCase().includes("daily limit") ||
        message.toLowerCase().includes("daily_limit_reached") ||
        message.toLowerCase().includes("rate limit")
      ) {
        setDailyLimitReached(true);
        setActiveMessages((prev) =>
          prev.map((item) => (item.id === optimisticId ? { ...item, status: "failed" } : item))
        );
      } else {
        setThreadError(message);
        setActiveMessages((prev) =>
          prev.map((item) => (item.id === optimisticId ? { ...item, status: "failed" } : item))
        );
      }
    } finally {
      setSending(false);
    }
  }, [activeMeta, meId, replyTo, threadBody]);

  const submitReport = useCallback(async () => {
    if (!activeMeta?.connectionId) return;
    setReportBusy(true);
    setReportError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? "";
      if (!accessToken) throw new Error("Missing auth session token");

      const response = await fetch("/api/connections/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          connId: activeMeta.connectionId,
          action: "report",
          reason: reportReason,
          note: [reportNote.trim(), reportFromMessageId ? `Message ID: ${reportFromMessageId}` : ""].filter(Boolean).join("\n") || undefined,
          context: "message",
          contextId: activeMeta.connectionId,
        }),
      });

      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Failed to submit report");
      }

      setReportOpen(false);
      setReportNote("");
      setReportReason("Scam or fraud");
      setReportFromMessageId(null);
      setThreadInfo("Report sent. Our moderation team will review it.");
    } catch (e: unknown) {
      setReportError(e instanceof Error ? e.message : "Failed to submit report.");
    } finally {
      setReportBusy(false);
    }
  }, [activeMeta?.connectionId, reportFromMessageId, reportNote, reportReason]);

  const upsertThreadPrefs = useCallback(
    async (dbThreadId: string | null, patch: ThreadPrefsPatch) => {
      if (!meId) return false;
      if (!dbThreadId) {
        setThreadPrefsInLocalMode(true);
        return false;
      }

      const payload: Record<string, string | null> = {
        thread_id: dbThreadId,
        user_id: meId,
        role: "member",
      };
      if (patch.archived_at !== undefined) payload.archived_at = patch.archived_at;
      if (patch.muted_until !== undefined) payload.muted_until = patch.muted_until;
      if (patch.pinned_at !== undefined) payload.pinned_at = patch.pinned_at;
      if (patch.last_read_at !== undefined) payload.last_read_at = patch.last_read_at;

      const res = await supabase.from("thread_participants").upsert(payload, {
        onConflict: "thread_id,user_id",
      });
      if (!res.error) {
        setThreadPrefsInLocalMode(false);
        return true;
      }

      if (shouldFallbackPrefs(res.error.message)) {
        setThreadPrefsInLocalMode(true);
        return false;
      }

      throw new Error(res.error.message);
    },
    [meId]
  );

  const archiveThread = useCallback(
    async (threadToken: string, dbThreadId: string | null) => {
      setThreadError(null);
      try {
        await upsertThreadPrefs(dbThreadId, { archived_at: new Date().toISOString() });
        setArchivedThreads((prev) => ({ ...prev, [threadToken]: true }));
        setThreadInfo("Thread archived. Open the Archived filter to restore it.");

        if (activeThreadToken === threadToken) {
          const next = threads.find((item) => item.threadId !== threadToken && !archivedThreads[item.threadId]);
          if (next) {
            setActiveThreadToken(next.threadId);
            router.replace(`/messages?thread=${encodeURIComponent(next.threadId)}`);
          } else {
            setActiveThreadToken(null);
            router.replace("/messages");
          }
        }
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to archive thread.");
      }
    },
    [activeThreadToken, archivedThreads, router, threads, upsertThreadPrefs]
  );

  const unarchiveThread = useCallback(
    async (threadToken: string, dbThreadId: string | null) => {
      setThreadError(null);
      try {
        await upsertThreadPrefs(dbThreadId, { archived_at: null });
        setArchivedThreads((prev) => {
          if (!prev[threadToken]) return prev;
          const copy = { ...prev };
          delete copy[threadToken];
          return copy;
        });
        setThreadInfo("Thread restored.");
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to restore thread.");
      }
    },
    [upsertThreadPrefs]
  );

  const muteThreadForHours = useCallback(
    async (threadToken: string, dbThreadId: string | null, hours: number) => {
      setThreadError(null);
      try {
        const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        await upsertThreadPrefs(dbThreadId, { muted_until: until });
        setMutedUntilByThread((prev) => ({ ...prev, [threadToken]: until }));
        setThreadInfo(`Notifications muted for ${hours}h.`);
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to mute thread.");
      }
    },
    [upsertThreadPrefs]
  );

  const unmuteThread = useCallback(
    async (threadToken: string, dbThreadId: string | null) => {
      setThreadError(null);
      try {
        await upsertThreadPrefs(dbThreadId, { muted_until: null });
        setMutedUntilByThread((prev) => {
          if (!prev[threadToken]) return prev;
          const copy = { ...prev };
          delete copy[threadToken];
          return copy;
        });
        setThreadInfo("Notifications unmuted.");
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to unmute thread.");
      }
    },
    [upsertThreadPrefs]
  );

  const pinThread = useCallback(
    async (threadToken: string, dbThreadId: string | null) => {
      setThreadError(null);
      try {
        await upsertThreadPrefs(dbThreadId, { pinned_at: new Date().toISOString() });
        setPinnedThreads((prev) => ({ ...prev, [threadToken]: true }));
        setThreadInfo("Thread pinned to top.");
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to pin thread.");
      }
    },
    [upsertThreadPrefs]
  );

  const unpinThread = useCallback(
    async (threadToken: string, dbThreadId: string | null) => {
      setThreadError(null);
      try {
        await upsertThreadPrefs(dbThreadId, { pinned_at: null });
        setPinnedThreads((prev) => {
          if (!prev[threadToken]) return prev;
          const copy = { ...prev };
          delete copy[threadToken];
          return copy;
        });
        setThreadInfo("Thread unpinned.");
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to unpin thread.");
      }
    },
    [upsertThreadPrefs]
  );

  const setThreadUnreadState = useCallback(
    async (thread: ThreadRow, unread: boolean) => {
      const timestamp = new Date().toISOString();
      const nextCount = unread ? thread.unreadCount : 0;

      setThreads((prev) => prev.map((row) => (row.threadId === thread.threadId ? { ...row, unreadCount: nextCount } : row)));
      setManualUnreadByThread((prev) => {
        if (unread) {
          if (thread.unreadCount > 0) {
            if (!prev[thread.threadId]) return prev;
            const copy = { ...prev };
            delete copy[thread.threadId];
            return copy;
          }
          return { ...prev, [thread.threadId]: true };
        }
        if (!prev[thread.threadId]) return prev;
        const copy = { ...prev };
        delete copy[thread.threadId];
        return copy;
      });
      if (thread.threadId === activeThreadToken) {
        setActiveLastReadAt(timestamp);
      }
      if (unread) {
        setRecentlyUpdatedThreadIds((prev) => ({ ...prev, [thread.threadId]: true }));
        window.setTimeout(() => {
          setRecentlyUpdatedThreadIds((prev) => {
            if (!prev[thread.threadId]) return prev;
            const copy = { ...prev };
            delete copy[thread.threadId];
            return copy;
          });
        }, 1400);
      }

      try {
        if (!unread) {
          await upsertThreadPrefs(thread.dbThreadId, { last_read_at: timestamp });
        }
        setThreadInfo(unread ? "Thread marked as unread." : "Thread marked as read.");
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to update unread state.");
      } finally {
        setOpenThreadRowMenuId(null);
      }
    },
    [activeThreadToken, upsertThreadPrefs]
  );

  const activeDbThreadId = useMemo(() => {
    if (activeMeta?.threadId) return activeMeta.threadId;
    if (!activeThreadToken) return null;
    return threads.find((thread) => thread.threadId === activeThreadToken)?.dbThreadId ?? null;
  }, [activeMeta?.threadId, activeThreadToken, threads]);

  const blockConnection = useCallback(async () => {
    if (!activeMeta?.connectionId) return;

    setBlockBusy(true);
    setThreadError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? "";
      if (!accessToken) throw new Error("Missing auth session token");

      const response = await fetch("/api/connections/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          connId: activeMeta.connectionId,
          action: "block",
          reason: blockReason,
          note: blockNote.trim() || "User blocked from inbox quick action",
        }),
      });

      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Failed to block connection");
      }

      if (activeThreadToken) {
        await upsertThreadPrefs(activeDbThreadId, { archived_at: new Date().toISOString() });
        setArchivedThreads((prev) => ({ ...prev, [activeThreadToken]: true }));
      }
      setBlockOpen(false);
      setBlockReason("Safety concern");
      setBlockNote("");
      setThreadInfo("Member blocked. Conversation archived.");
      setReloadTick((v) => v + 1);
    } catch (e: unknown) {
      setThreadError(e instanceof Error ? e.message : "Failed to block member.");
    } finally {
      setBlockBusy(false);
    }
  }, [activeDbThreadId, activeMeta?.connectionId, activeThreadToken, blockNote, blockReason, upsertThreadPrefs]);

  const archivedCount = useMemo(() => threads.filter((thread) => Boolean(archivedThreads[thread.threadId])).length, [archivedThreads, threads]);
  const activeIsArchived = Boolean(activeThreadToken && archivedThreads[activeThreadToken]);
  const activeIsPinned = Boolean(activeThreadToken && pinnedThreads[activeThreadToken]);
  const activeMuteUntil = activeThreadToken ? mutedUntilByThread[activeThreadToken] : undefined;
  const activeIsMuted = Boolean(activeMuteUntil && toTime(activeMuteUntil) > clockMs);
  const activeMuteRemaining = activeIsMuted ? formatRemaining(toTime(activeMuteUntil) - clockMs) : "";
  const dailyResetIn = useMemo(() => formatRemaining(msUntilLocalMidnight(clockMs)), [clockMs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = threads.filter((thread) => {
      const isArchived = Boolean(archivedThreads[thread.threadId]);
      if (activeTab === "archived") {
        if (!isArchived) return false;
      } else if (isArchived) {
        return false;
      }

      if (activeTab === "connections" && thread.kind !== "connection") return false;
      if (activeTab === "trips" && thread.kind !== "trip") return false;

      if (!q) return true;
      const haystack = [thread.title, thread.subtitle, thread.preview, thread.badge].join(" ").toLowerCase();
      return haystack.includes(q);
    });
    return rows.sort((a, b) => {
      const aPinned = Boolean(pinnedThreads[a.threadId]);
      const bPinned = Boolean(pinnedThreads[b.threadId]);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return toTime(b.updatedAt) - toTime(a.updatedAt);
    });
  }, [activeTab, archivedThreads, pinnedThreads, query, threads]);

  const filteredComposeConnections = useMemo(() => {
    const needle = composeQuery.trim().toLowerCase();
    if (!needle) return composeConnectionTargets;
    return composeConnectionTargets.filter((item) => `${item.displayName} ${item.subtitle}`.toLowerCase().includes(needle));
  }, [composeConnectionTargets, composeQuery]);

  const filteredComposeTrips = useMemo(() => {
    const needle = composeQuery.trim().toLowerCase();
    if (!needle) return composeTripTargets;
    return composeTripTargets.filter((item) => `${item.displayName} ${item.subtitle}`.toLowerCase().includes(needle));
  }, [composeQuery, composeTripTargets]);

  const chatRows = useMemo(() => {
    const rows: Array<
      { type: "day"; key: string; label: string } | { type: "unread"; key: string } | { type: "message"; key: string; message: MessageItem }
    > = [];
    let lastDay = "";
    let unreadInserted = false;
    const unreadAfterTime = activeLastReadAt ? toTime(activeLastReadAt) : 0;

    activeMessages.forEach((message) => {
      const date = new Date(message.createdAt);
      const dayKey = Number.isNaN(date.getTime())
        ? ""
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      if (dayKey && dayKey !== lastDay) {
        rows.push({
          type: "day",
          key: `day-${dayKey}`,
          label: formatChatDayLabel(message.createdAt),
        });
        lastDay = dayKey;
      }

      if (
        !unreadInserted &&
        unreadAfterTime > 0 &&
        message.senderId !== meId &&
        toTime(message.createdAt) > unreadAfterTime
      ) {
        rows.push({ type: "unread", key: `unread-${message.id}` });
        unreadInserted = true;
      }

      rows.push({
        type: "message",
        key: message.id,
        message,
      });
    });

    return rows;
  }, [activeLastReadAt, activeMessages, meId]);

  const parsedMessagesById = useMemo(() => {
    const map: Record<string, { replyToId: string | null; text: string }> = {};
    activeMessages.forEach((message) => {
      map[message.id] = parseReplyPayload(message.body);
    });
    return map;
  }, [activeMessages]);

  const messageById = useMemo(() => {
    const map: Record<string, MessageItem> = {};
    activeMessages.forEach((message) => {
      map[message.id] = message;
    });
    return map;
  }, [activeMessages]);

  const latestReadOutgoingMessageId = useMemo(() => {
    if (!meId || activeMeta?.kind !== "connection") return null;
    const peerReadTime = toTime(activePeerLastReadAt);
    if (peerReadTime <= 0) return null;

    let latestId: string | null = null;
    let latestTime = 0;

    activeMessages.forEach((message) => {
      if (message.senderId !== meId) return;
      if (message.status === "sending" || message.status === "failed" || message.localOnly) return;
      const createdAtMs = toTime(message.createdAt);
      if (createdAtMs <= 0 || createdAtMs > peerReadTime) return;
      if (createdAtMs >= latestTime) {
        latestTime = createdAtMs;
        latestId = message.id;
      }
    });

    return latestId;
  }, [activeMessages, activeMeta?.kind, activePeerLastReadAt, meId]);

  const scrollToLatest = useCallback((smooth = false) => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJumpToLatest(distance > 260);
    };
    onScroll();
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeThreadToken, activeMessages.length]);

  useEffect(() => {
    if (!activeThreadToken) return;
    const timer = window.setTimeout(() => scrollToLatest(false), 10);
    return () => window.clearTimeout(timer);
  }, [activeThreadToken, scrollToLatest]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el || activeMessages.length === 0) return;
    const last = activeMessages[activeMessages.length - 1];
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 180 || last?.senderId === meId) {
      scrollToLatest(true);
    }
  }, [activeMessages, meId, scrollToLatest]);

  useEffect(() => {
    if (!activeMeta?.threadId || !activeMeta.otherUserId || activeMeta.kind !== "connection") {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      const res = await supabase
        .from("thread_participants")
        .select("last_read_at")
        .eq("thread_id", activeMeta.threadId as string)
        .eq("user_id", activeMeta.otherUserId as string)
        .maybeSingle();
      if (cancelled || res.error) return;
      const row = res.data as { last_read_at?: string | null } | null;
      setActivePeerLastReadAt(row?.last_read_at ?? null);
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeMeta?.kind, activeMeta?.otherUserId, activeMeta?.threadId]);

  useEffect(() => {
    setPeerTyping(false);
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    const threadScopeId = activeMeta ? (activeMeta.kind === "connection" ? activeMeta.connectionId : activeMeta.threadId) : null;
    if (!meId || !activeMeta || !threadScopeId || !activeThreadToken) {
      if (typingChannelRef.current) {
        void supabase.removeChannel(typingChannelRef.current);
        typingChannelRef.current = null;
      }
      return;
    }

    if (typingChannelRef.current) {
      void supabase.removeChannel(typingChannelRef.current);
      typingChannelRef.current = null;
    }

    const channel = supabase.channel(`messages-typing-${activeMeta.kind}-${threadScopeId}`);
    channel.on("broadcast", { event: "typing" }, (payload) => {
      const actorId = typeof payload.payload?.userId === "string" ? payload.payload.userId : "";
      if (!actorId || actorId === meId) return;
      setPeerTyping(true);
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = window.setTimeout(() => {
        setPeerTyping(false);
        typingTimeoutRef.current = null;
      }, 2400);
    });
    channel.subscribe();
    typingChannelRef.current = channel;

    return () => {
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      void supabase.removeChannel(channel);
      if (typingChannelRef.current === channel) {
        typingChannelRef.current = null;
      }
    };
  }, [activeMeta, activeThreadToken, meId]);

  useEffect(() => {
    if (!meId || !activeMeta || !typingChannelRef.current) return;
    const trimmed = threadBody.trim();
    if (!trimmed) return;

    const now = Date.now();
    if (now - typingLastSentAtRef.current < 1200) return;
    typingLastSentAtRef.current = now;

    void typingChannelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: meId, at: now },
    });
  }, [activeMeta, meId, threadBody]);

  useEffect(() => {
    if (reactionsServerSupported || !meId || !activeMeta || !activeThreadToken) return;
    const threadScopeId = activeMeta.kind === "connection" ? activeMeta.connectionId : activeMeta.threadId;
    if (!threadScopeId) return;

    const timer = window.setTimeout(() => {
      void loadThreadReactions({
        kind: activeMeta.kind,
        threadScopeId,
        viewerId: meId,
        threadToken: activeThreadToken,
      });
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [activeMeta, activeThreadToken, loadThreadReactions, meId, reactionsServerSupported]);

  const copyMessageBody = useCallback(async (body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      setThreadInfo("Message copied.");
    } catch {
      setThreadError("Clipboard is unavailable in this browser.");
    }
  }, []);

  const toggleMessageReaction = useCallback(
    async (message: MessageItem, emoji: string) => {
      if (!meId || !activeMeta) return;

      const threadKind = activeMeta.kind;
      const threadScopeId = activeMeta.kind === "connection" ? activeMeta.connectionId : activeMeta.threadId;
      if (!threadScopeId) return;

      const current = messageReactions[message.id] ?? [];
      const existing = current.find((item) => item.emoji === emoji);
      const hasMine = Boolean(existing?.mine);

      const applyLocalToggle = () =>
        setMessageReactions((prev) => {
          const list = [...(prev[message.id] ?? [])];
          const index = list.findIndex((item) => item.emoji === emoji);

        if (hasMine) {
          if (index >= 0) {
            const item = list[index];
            const nextCount = Math.max(0, item.count - 1);
            if (nextCount === 0) {
              list.splice(index, 1);
            } else {
              list[index] = { ...item, count: nextCount, mine: false };
            }
          }
        } else if (index >= 0) {
          const item = list[index];
          list[index] = { ...item, count: item.count + 1, mine: true };
        } else {
          list.push({ emoji, count: 1, mine: true });
        }

        const next = { ...prev };
        if (list.length === 0) {
          delete next[message.id];
        } else {
          next[message.id] = list;
        }
          if (activeThreadToken) {
            setLocalReactionsByThread((prevStore) => ({ ...prevStore, [activeThreadToken]: next }));
          }
          return next;
        });

      applyLocalToggle();

      if (!reactionsServerSupported || message.localOnly) {
        return;
      }

      try {
        if (hasMine) {
          const res = await supabase
            .from("message_reactions")
            .delete()
            .eq("message_id", message.id)
            .eq("thread_kind", threadKind)
            .eq("thread_id", threadScopeId)
            .eq("reactor_id", meId)
            .eq("emoji", emoji);
          if (res.error) throw new Error(res.error.message);
        } else {
          const res = await supabase.from("message_reactions").insert({
            message_id: message.id,
            thread_kind: threadKind,
            thread_id: threadScopeId,
            reactor_id: meId,
            emoji,
          });
          if (res.error && !res.error.message.toLowerCase().includes("duplicate")) {
            throw new Error(res.error.message);
          }
        }

        await loadThreadReactions({
          kind: threadKind,
          threadScopeId,
          viewerId: meId,
          threadToken: activeThreadToken ?? undefined,
        });
      } catch (e: unknown) {
        const messageText = e instanceof Error ? e.message : "Failed to update reaction.";
        const lower = messageText.toLowerCase();
        if (
          lower.includes("relation") ||
          lower.includes("schema cache") ||
          lower.includes("does not exist") ||
          lower.includes("permission denied")
        ) {
          setReactionsServerSupported(false);
          setThreadInfo("Reactions are saved locally for now. Server sync will resume automatically.");
          return;
        }
        setThreadInfo("Reaction saved locally. Server sync is temporarily unavailable.");
      }
    },
    [activeMeta, activeThreadToken, loadThreadReactions, meId, messageReactions, reactionsServerSupported]
  );

  const focusMessageTarget = useCallback((messageId: string) => {
    const target = messageRefs.current[messageId];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    window.setTimeout(() => {
      setHighlightedMessageId((prev) => (prev === messageId ? null : prev));
    }, 1400);
  }, []);

  const onMessagePointerDown = useCallback((messageId: string, event: ReactPointerEvent) => {
    if (event.pointerType !== "touch") return;
    swipeGestureRef.current = {
      messageId,
      startX: event.clientX,
      startY: event.clientY,
      endX: event.clientX,
      endY: event.clientY,
    };
  }, []);

  const onMessagePointerMove = useCallback((messageId: string, event: ReactPointerEvent) => {
    if (event.pointerType !== "touch") return;
    if (!swipeGestureRef.current || swipeGestureRef.current.messageId !== messageId) return;
    swipeGestureRef.current.endX = event.clientX;
    swipeGestureRef.current.endY = event.clientY;
  }, []);

  const onMessagePointerUp = useCallback(
    (message: MessageItem, event: ReactPointerEvent) => {
      if (event.pointerType !== "touch") return;
      if (!swipeGestureRef.current || swipeGestureRef.current.messageId !== message.id) return;

      const { startX, startY, endX, endY } = swipeGestureRef.current;
      swipeGestureRef.current = null;

      const deltaX = endX - startX;
      const deltaY = endY - startY;
      if (Math.abs(deltaX) < 72 || Math.abs(deltaY) > 28) return;

      const parsed = parseReplyPayload(message.body);
      setReplyTo({
        id: message.id,
        senderId: message.senderId,
        body: parsed.text,
        createdAt: message.createdAt,
      });
    },
    []
  );

  const openReportFromMessage = useCallback((messageId: string) => {
    setReportFromMessageId(messageId);
    setReportOpen(true);
  }, []);

  const deleteOwnMessage = useCallback(
    async (message: MessageItem) => {
      if (!meId || message.senderId !== meId) return;
      if (message.localOnly) {
        setActiveMessages((prev) => prev.filter((item) => item.id !== message.id));
        setThreadInfo("Message removed.");
        return;
      }

      try {
        if (activeMeta?.kind === "connection" && activeMeta.connectionId) {
          const res = await supabase
            .from("messages")
            .delete()
            .eq("id", message.id)
            .eq("connection_id", activeMeta.connectionId)
            .eq("sender_id", meId);
          if (res.error) throw new Error(res.error.message);
        } else if (activeMeta?.kind === "trip" && activeMeta.threadId) {
          const res = await supabase
            .from("thread_messages")
            .delete()
            .eq("id", message.id)
            .eq("thread_id", activeMeta.threadId)
            .eq("sender_id", meId);
          if (res.error) throw new Error(res.error.message);
        } else {
          throw new Error("Delete is unavailable for this message.");
        }

        setActiveMessages((prev) => prev.filter((item) => item.id !== message.id));
        setThreadInfo("Message deleted.");
        setReloadTick((v) => v + 1);
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to delete message.");
      }
    },
    [activeMeta, meId]
  );

  return (
    <div className="font-sans h-screen bg-[#0A0A0A] text-white flex flex-col overflow-hidden">
      <Nav />

      <main className="flex-1 min-h-0 flex overflow-hidden">
        <aside className="z-10 flex w-full min-h-0 flex-col border-r border-white/10 bg-[#121212] md:w-[460px]">
          <div className="flex flex-col px-4 pt-5 pb-2 gap-4">
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-bold leading-tight">Inbox</h1>
              <button
                aria-label="New Message"
                onClick={() => setComposeOpen(true)}
                className="flex items-center justify-center size-8 rounded-full bg-[#0df2f2]/10 hover:bg-[#0df2f2]/20 text-[#0df2f2] transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                  edit_square
                </span>
              </button>
            </div>

            <div className="relative w-full h-11">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-[#90cbcb]">
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                  search
                </span>
              </div>
              <input
                ref={searchInputRef}
                className="block h-full w-full rounded-full border-none bg-black/30 py-2 pl-10 pr-3 text-sm text-white placeholder-[#90cbcb] transition-shadow focus:outline-none focus:ring-2 focus:ring-[#0df2f2]/50"
                placeholder="Search messages..."
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {([
                { key: "all", label: "All" },
                { key: "connections", label: "Connections" },
                { key: "trips", label: "Trips" },
                { key: "archived", label: `Archived${archivedCount ? ` (${archivedCount})` : ""}` },
              ] as const).map((tab) => {
                const selected = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    data-testid={`thread-filter-${tab.key}`}
                    className={[
                      "shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold border transition-colors",
                      selected
                        ? "border-[#0df2f2]/40 bg-[#0df2f2]/20 text-[#0df2f2]"
                        : "border-white/15 bg-white/[0.04] text-[#90cbcb] hover:text-white",
                    ].join(" ")}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

	          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {error ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
            ) : null}
            {loading ? (
              <div className="p-3 text-sm text-[#90cbcb]">Loading conversations...</div>
            ) : filtered.length === 0 ? (
              <div className="p-3 text-sm text-[#90cbcb]">
                {activeTab === "archived" ? "No archived threads yet." : "No threads found."}
              </div>
            ) : (
              filtered.map((thread) => {
                const mutedUntil = mutedUntilByThread[thread.threadId];
                const isMuted = Boolean(mutedUntil && toTime(mutedUntil) > clockMs);
                const isPinned = Boolean(pinnedThreads[thread.threadId]);
                const rowMenuOpen = openThreadRowMenuId === thread.threadId;
                const isUnread = thread.unreadCount > 0 || Boolean(manualUnreadByThread[thread.threadId]);
                const activateThread = () => {
                  setOpenThreadRowMenuId(null);
                  setManualUnreadByThread((prev) => {
                    if (!prev[thread.threadId]) return prev;
                    const copy = { ...prev };
                    delete copy[thread.threadId];
                    return copy;
                  });
                  setThreads((prev) => prev.map((row) => (row.threadId === thread.threadId ? { ...row, unreadCount: 0 } : row)));
                  if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
                    router.push(`/messages/${encodeURIComponent(thread.threadId)}`);
                    return;
                  }
                  setActiveThreadToken(thread.threadId);
                  router.replace(`/messages?thread=${encodeURIComponent(thread.threadId)}`);
                };
                return (
                  <div
                    key={thread.threadId}
                    className="relative group"
                    data-thread-token={thread.threadId}
                    onMouseEnter={() => {
                      if (isUnread) setHoveredUnreadThreadId(thread.threadId);
                    }}
                    onMouseLeave={() => {
                      setHoveredUnreadThreadId((prev) => (prev === thread.threadId ? null : prev));
                    }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      data-testid="thread-row"
                      data-thread-token={thread.threadId}
                      className={[
                        "w-full min-h-[98px] text-left group flex items-center gap-2 rounded-xl border bg-black/25 p-2.5 transition-colors",
                        activeThreadToken === thread.threadId
                          ? "border-[#db2777]/45 bg-[#241723]"
                          : "border-white/10 hover:border-[#25d1f4]/30 hover:bg-[#1c2224]",
                        recentlyUpdatedThreadIds[thread.threadId] ? "shadow-[0_0_0_1px_rgba(219,39,119,0.5),0_0_18px_rgba(219,39,119,0.18)]" : "",
                      ].join(" ")}
                      onClick={activateThread}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          activateThread();
                        }
                      }}
                    >
                      <div className="relative z-10 h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/10 bg-[#223838]">
                        {thread.avatarUrl ? (
                          <Image
                            src={thread.avatarUrl}
                            alt={thread.title}
                            fill
                            sizes="48px"
                            loader={remoteImageLoader}
                            unoptimized
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-cyan-100/80">
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                              person
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`truncate text-[14px] leading-tight ${isUnread ? "font-semibold text-white" : "font-medium text-[#e8f4f4]"}`}>
                            {thread.title}
                          </p>
                          <div className="relative flex shrink-0 items-center gap-1 pl-1" data-thread-row-menu="true">
                            <p className={`text-[11px] leading-tight ${isUnread ? "text-[#f472b6]" : "text-[#7fd8e0]"}`}>
                              {formatRelative(thread.updatedAt)}
                            </p>
                            {isUnread ? <span data-testid="thread-unread-dot" className="h-2 w-2 rounded-full bg-[#db2777]" /> : null}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenThreadRowMenuId((prev) => (prev === thread.threadId ? null : thread.threadId));
                              }}
                              data-testid="thread-row-menu-button"
                              className="inline-flex h-4 w-4 items-center justify-center text-slate-400 transition-colors hover:text-[#f5a5cf]"
                              aria-label="Thread row actions"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 13, lineHeight: 1 }}>
                                more_vert
                              </span>
                            </button>
                            {rowMenuOpen ? (
                              <div
                                className="absolute right-0 top-full z-40 mt-1 w-40 rounded-xl border border-white/10 bg-[#101616] p-1 shadow-xl"
                                onClick={(event) => event.stopPropagation()}
                                data-thread-row-menu="true"
                                data-testid="thread-row-menu"
                              >
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void setThreadUnreadState(thread, !isUnread);
                                  }}
                                  data-testid={isUnread ? "thread-mark-read" : "thread-mark-unread"}
                                  className="flex w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-xs text-slate-200 hover:border-[#f39acb]/35 hover:bg-[#f39acb]/10"
                                >
                                  <span className="material-symbols-outlined text-sm">
                                    {isUnread ? "drafts" : "mark_email_unread"}
                                  </span>
                                  {isUnread ? "Mark as read" : "Mark as unread"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                          {thread.kind === "trip" ? (
                            <span className="inline-flex items-center rounded-full bg-[#3b1f35] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-[#f7b5d9]">
                              Trip
                            </span>
                          ) : null}
                          {isPinned ? (
                            <span
                              data-testid="thread-pinned-indicator"
                              className="material-symbols-outlined text-amber-200/90"
                              style={{ fontSize: 12 }}
                              title="Pinned"
                            >
                              keep
                            </span>
                          ) : null}
                          {isMuted ? (
                            <span
                              data-testid="thread-muted-indicator"
                              className="material-symbols-outlined text-slate-300/90"
                              style={{ fontSize: 12 }}
                              title="Muted"
                            >
                              notifications_off
                            </span>
                          ) : null}
                          <span className="truncate text-[12px] text-[#90cbcb]">{thread.subtitle}</span>
                        </div>

                        <p className={`mt-1 truncate text-[13px] leading-snug ${isUnread ? "text-[#f5e6f0]" : "text-[#c3dddd]"}`}>{thread.preview}</p>
                      </div>
                    </div>

                    {hoveredUnreadThreadId === thread.threadId && isUnread ? (
                      <div className="absolute left-12 right-10 top-full z-50 mt-1.5 rounded-xl border border-white/10 bg-[#101616]/95 p-2.5 shadow-2xl backdrop-blur-sm">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#f39acb]">Unread preview</p>
                        <p
                          className="mt-1 text-[12px] leading-snug text-[#f1dde8]"
                          style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                        >
                          {thread.preview || "New activity in this chat."}
                        </p>
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void setThreadUnreadState(thread, false);
                              setHoveredUnreadThreadId(null);
                            }}
                            className="rounded-full border border-[#db2777]/40 bg-[#db2777]/15 px-2.5 py-1 text-[10px] font-semibold text-[#ffd9ee] hover:bg-[#db2777]/25"
                          >
                            Mark read
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
	          </div>
        </aside>

        <section className="hidden flex-1 min-h-0 flex-col bg-[#121212] md:flex">
          {!activeMeta ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="max-w-md flex flex-col items-center">
                <div className="mb-6 rounded-full bg-[#162a2a] p-8">
                  <span className="material-symbols-outlined text-[#224949]" style={{ fontSize: 64 }}>
                    forum
                  </span>
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Thread Inbox</h2>
                <p className="text-[#90cbcb] mb-8">Select a connection or trip thread to start chatting.</p>
                <button
                  type="button"
                  onClick={() => setComposeOpen(true)}
                  className="flex items-center gap-2 rounded-full bg-[#0df2f2] px-6 py-3 font-bold text-[#052328] transition-all hover:bg-[#0be0e0]"
                >
                  <span className="material-symbols-outlined">add_comment</span>
                  <span>Start New Thread</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <header className="h-[88px] px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#121212]">
                <div className="flex items-center gap-4 min-w-0">
                  {activeMeta.otherUserId ? (
                    <Link href={`/members/${activeMeta.otherUserId}`} className="shrink-0">
                      <div className="relative h-10 w-10 overflow-hidden rounded-full border border-white/10 bg-[#223838] transition-colors hover:border-cyan-300/40">
                        {activeMeta.avatarUrl ? (
                          <Image
                            src={activeMeta.avatarUrl}
                            alt={activeMeta.title}
                            fill
                            sizes="40px"
                            loader={remoteImageLoader}
                            unoptimized
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-cyan-100/80">
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                              person
                            </span>
                          </div>
                        )}
                      </div>
                    </Link>
                  ) : (
                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/10 bg-[#223838]">
                      {activeMeta.avatarUrl ? (
                        <Image
                          src={activeMeta.avatarUrl}
                          alt={activeMeta.title}
                          fill
                          sizes="40px"
                          loader={remoteImageLoader}
                          unoptimized
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-cyan-100/80">
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                            person
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {activeMeta.otherUserId ? (
                        <Link href={`/members/${activeMeta.otherUserId}`} className="truncate text-lg font-bold text-white hover:text-cyan-200">
                          {activeMeta.title}
                        </Link>
                      ) : (
                        <h2 className="text-lg font-bold text-white truncate">{activeMeta.title}</h2>
                      )}
                      {activeMeta.kind === "trip" ? (
                        <span className="px-2 py-0.5 rounded-full bg-[#0df2f2]/10 text-[#0df2f2] text-[10px] font-bold uppercase tracking-wider">
                          Trip
                        </span>
                      ) : null}
                    </div>
	                    <p className="text-xs text-[#90cbcb] truncate">{activeMeta.subtitle}</p>
		                  </div>
		                </div>

                <div className="relative flex items-center gap-2" ref={threadActionsRef}>
                  {threadPrefsInLocalMode ? (
                    <span className="rounded-full border border-amber-300/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                      Local prefs mode
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setThreadActionsOpen((prev) => !prev)}
                    data-testid="thread-actions-button"
                    className="rounded-full border border-white/15 bg-black/20 p-2 text-slate-200 hover:border-cyan-300/35 hover:text-cyan-100"
                    aria-label="Thread actions"
                    title="Thread actions"
	                  >
	                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
	                      more_vert
	                    </span>
	                  </button>

                  {threadActionsOpen ? (
                    <div
                      className="absolute top-full right-0 mt-2 z-[80] w-56 rounded-xl border border-white/10 bg-[#111818] p-1 shadow-2xl"
                      data-testid="thread-actions-menu"
                    >
                      {activeThreadToken ? (
                        activeIsPinned ? (
                          <button
                            type="button"
                            onClick={() => {
                              void unpinThread(activeThreadToken, activeDbThreadId);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-unpin"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                          >
                            <span className="material-symbols-outlined text-base">keep_off</span>
                            Unpin
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              void pinThread(activeThreadToken, activeDbThreadId);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-pin"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                          >
                            <span className="material-symbols-outlined text-base">keep</span>
                            Pin to top
                          </button>
                        )
                      ) : null}

                      {activeThreadToken ? (
                        activeIsMuted ? (
                          <button
                            type="button"
                            onClick={() => {
                              void unmuteThread(activeThreadToken, activeDbThreadId);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-unmute"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                          >
                            <span className="material-symbols-outlined text-base">notifications_active</span>
                            Unmute ({activeMuteRemaining})
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                void muteThreadForHours(activeThreadToken, activeDbThreadId, 8);
                                setThreadActionsOpen(false);
                              }}
                              data-testid="thread-action-mute-8h"
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                            >
                              <span className="material-symbols-outlined text-base">notifications_off</span>
                              Mute for 8h
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void muteThreadForHours(activeThreadToken, activeDbThreadId, 24);
                                setThreadActionsOpen(false);
                              }}
                              data-testid="thread-action-mute-24h"
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                            >
                              <span className="material-symbols-outlined text-base">notifications_paused</span>
                              Mute for 24h
                            </button>
                          </>
                        )
                      ) : null}

                      {activeThreadToken ? (
                        activeIsArchived ? (
                          <button
                            type="button"
                            onClick={() => {
                              void unarchiveThread(activeThreadToken, activeDbThreadId);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-unarchive"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                          >
                            <span className="material-symbols-outlined text-base">unarchive</span>
                            Unarchive
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              void archiveThread(activeThreadToken, activeDbThreadId);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-archive"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                          >
                            <span className="material-symbols-outlined text-base">archive</span>
                            Archive
                          </button>
                        )
                      ) : null}

                      {activeMeta.kind === "connection" && activeMeta.connectionId ? (
                        <>
                          <div className="my-1 h-px bg-white/10" />
                          <button
                            type="button"
                            onClick={() => {
                              setReportFromMessageId(null);
                              setReportOpen(true);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-report"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                          >
                            <span className="material-symbols-outlined text-base">flag</span>
                            Report
                          </button>
                          <button
                            type="button"
                            disabled={blockBusy}
                            onClick={() => {
                              setBlockOpen(true);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-block"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-200 hover:bg-rose-500/15 disabled:opacity-60"
                          >
                            <span className="material-symbols-outlined text-base">block</span>
                            {blockBusy ? "Blocking..." : "Block"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </header>

              <div className="relative flex-1 min-h-0">
                <div
                  ref={chatScrollRef}
                  className="cx-scroll h-full overflow-y-auto p-6 space-y-4"
                  onClick={() => {
                    setOpenMessageMenuId(null);
                    setComposerEmojiOpen(false);
                  }}
                >
                  {threadLoading ? (
                    <div className="text-sm text-[#90cbcb]">Loading conversation...</div>
                  ) : null}
                  {threadInfo ? (
                    <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 p-3 text-sm text-cyan-100">{threadInfo}</div>
                  ) : null}
                  {threadError ? (
                    <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{threadError}</div>
                  ) : null}
                  {dailyLimitReached ? (
                    <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      Daily message limit reached. Try again in {dailyResetIn}.
                    </div>
                  ) : null}
                  {!threadDbSupported && activeMeta.kind === "trip" ? (
                    <div className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 p-3 text-sm text-cyan-50">
                      Trip chat needs thread migration enabled.
                    </div>
                  ) : null}
                  {!threadLoading && activeMessages.length === 0 ? (
                    <div className="py-10 space-y-4">
                      <div className="text-center text-[#90cbcb] text-sm">No messages yet. Start with a quick text:</div>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {QUICK_STARTERS.map((starter) => (
                          <button
                            key={starter}
                            type="button"
                            onClick={() => setThreadBody(starter)}
                            className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs text-slate-200 hover:border-cyan-300/35 hover:text-cyan-100"
                          >
                            {starter}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    chatRows.map((row) => {
                      if (row.type === "day") {
                        return (
                          <div key={row.key} className="flex items-center justify-center py-2">
                            <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold tracking-wide text-slate-300">
                              {row.label}
                            </span>
                          </div>
                        );
                      }

                      if (row.type === "unread") {
                        return (
                          <div key={row.key} className="flex items-center gap-3 py-1.5">
                            <div className="h-px flex-1 bg-cyan-300/20" />
                            <span className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100">
                              Unread
                            </span>
                            <div className="h-px flex-1 bg-cyan-300/20" />
                          </div>
                        );
                      }

                      const message = row.message;
                      const mine = message.senderId === meId;
                      const showMenu = openMessageMenuId === message.id;
                      const showReportOption = activeMeta.kind === "connection" && !mine;
                      const parsedMessage = parsedMessagesById[message.id] ?? parseReplyPayload(message.body);
                      const replyTarget = parsedMessage.replyToId ? messageById[parsedMessage.replyToId] ?? null : null;
                      const parsedReplyTarget = replyTarget ? parseReplyPayload(replyTarget.body) : null;
                      const isHighlightedTarget = highlightedMessageId === message.id;
                      const reactions = messageReactions[message.id] ?? [];
                      const showSeenByRecipient =
                        mine &&
                        activeMeta.kind === "connection" &&
                        Boolean(activePeerLastReadAt) &&
                        latestReadOutgoingMessageId === message.id;

                      return (
                        <div
                          key={row.key}
                          ref={(node) => {
                            messageRefs.current[message.id] = node;
                          }}
                          className={`group relative flex items-end gap-2 w-full ${mine ? "justify-end" : ""}`}
                        >
                          {!mine ? (
                            activeMeta.avatarUrl ? (
                              <div className="relative mb-1 h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/10 bg-[#223838]">
                                <Image
                                  src={activeMeta.avatarUrl}
                                  alt={activeMeta.title}
                                  fill
                                  sizes="36px"
                                  loader={remoteImageLoader}
                                  unoptimized
                                  className="object-cover"
                                />
                              </div>
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-[#224949] shrink-0 mb-1 flex items-center justify-center text-cyan-100/80">
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                                  person
                                </span>
                              </div>
                            )
                          ) : null}

                          <div
                            className={`relative flex flex-col gap-1 max-w-[74%] md:max-w-[66%] ${mine ? "items-end" : "items-start"}`}
                            onPointerDown={(event) => onMessagePointerDown(message.id, event)}
                            onPointerMove={(event) => onMessagePointerMove(message.id, event)}
                            onPointerUp={(event) => onMessagePointerUp(message, event)}
                            onPointerCancel={() => {
                              swipeGestureRef.current = null;
                            }}
                          >
                            {replyTarget ? (
                              <button
                                type="button"
                                onClick={() => focusMessageTarget(replyTarget.id)}
                                onMouseEnter={() => setHighlightedMessageId(replyTarget.id)}
                                onMouseLeave={() =>
                                  setHighlightedMessageId((prev) => (prev === replyTarget.id ? null : prev))
                                }
                                className={[
                                  "max-w-full rounded-xl border px-2.5 py-1 text-left text-[11px] transition-colors",
                                  mine
                                    ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/15"
                                    : "border-white/15 bg-white/[0.03] text-slate-200 hover:bg-white/[0.06]",
                                ].join(" ")}
                                title="Jump to replied message"
                              >
                                <span className="block font-semibold text-[10px] uppercase tracking-wide opacity-80">
                                  Reply to {replyTarget.senderId === meId ? "you" : activeMeta?.title ?? "member"}
                                </span>
                                <span className="mt-0.5 block truncate">
                                  {toSingleLineText(parsedReplyTarget?.text ?? replyTarget.body, 84)}
                                </span>
                              </button>
                            ) : null}

                            <div className={`flex w-full items-center gap-1 ${mine ? "justify-end" : "justify-start"}`}>
                              <div
                                className={[
                                  "inline-flex w-fit max-w-full px-2.5 py-1 rounded-2xl text-[13px] leading-snug transition-shadow",
                                  mine
                                    ? "bg-[#0df2f2] text-[#102323] rounded-br-none font-medium"
                                    : "bg-[#224949] text-white rounded-bl-none",
                                  isHighlightedTarget ? "ring-2 ring-cyan-300/70 shadow-[0_0_0_4px_rgba(34,211,238,0.12)]" : "",
                                ].join(" ")}
                              >
                                {parsedMessage.text}
                              </div>
                              <div className={`relative flex items-center ${mine ? "order-first" : ""}`}>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setOpenMessageMenuId((prev) => (prev === message.id ? null : message.id));
                                  }}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/25 text-slate-300 transition-colors hover:border-[#f39acb]/55 hover:text-[#f6a7d1]"
                                  aria-label="Message actions"
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 15, lineHeight: 1 }}>
                                    more_vert
                                  </span>
                                </button>

                                {showMenu ? (
                                  <div
                                    className={`absolute z-[70] bottom-full mb-2 w-52 rounded-xl border border-white/10 bg-[#101616] p-1 shadow-xl ${
                                      mine ? "right-0" : "left-0"
                                    }`}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <div className="rounded-lg px-2 py-2">
                                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">React</p>
                                      <div className="flex flex-wrap items-center gap-1">
                                        {QUICK_REACTIONS.map((emoji) => (
                                          <button
                                            key={`${message.id}-${emoji}-menu`}
                                            type="button"
                                            disabled={message.localOnly}
                                            onClick={() => {
                                              void toggleMessageReaction(message, emoji);
                                              setOpenMessageMenuId(null);
                                            }}
                                            className={`rounded-full px-1.5 py-1 text-sm disabled:opacity-40 ${
                                              reactions.some((item) => item.emoji === emoji && item.mine) ? "bg-white/10" : "hover:bg-white/10"
                                            }`}
                                            title={
                                              reactions.some((item) => item.emoji === emoji && item.mine) ? `Remove ${emoji}` : `Add ${emoji}`
                                            }
                                          >
                                            {emoji}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="my-1 h-px bg-white/10" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void copyMessageBody(parsedMessage.text);
                                        setOpenMessageMenuId(null);
                                      }}
                                      className="flex w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-xs text-slate-200 hover:border-cyan-300/35 hover:bg-cyan-300/10"
                                    >
                                      <span className="material-symbols-outlined text-sm">content_copy</span>
                                      Copy
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReplyTo({
                                          id: message.id,
                                          senderId: message.senderId,
                                          body: parsedMessage.text,
                                          createdAt: message.createdAt,
                                        });
                                        setOpenMessageMenuId(null);
                                      }}
                                      className="mt-1 flex w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-xs text-slate-200 hover:border-cyan-300/35 hover:bg-cyan-300/10"
                                    >
                                      <span className="material-symbols-outlined text-sm">reply</span>
                                      Reply
                                    </button>
                                    {mine ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void deleteOwnMessage(message);
                                          setOpenMessageMenuId(null);
                                        }}
                                        className="mt-1 flex w-full items-center gap-2 rounded-full border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-left text-xs text-rose-100 hover:bg-rose-500/15"
                                      >
                                        <span className="material-symbols-outlined text-sm">delete</span>
                                        Delete
                                      </button>
                                    ) : null}
                                    {showReportOption ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          openReportFromMessage(message.id);
                                          setOpenMessageMenuId(null);
                                        }}
                                        className="mt-1 flex w-full items-center gap-2 rounded-full border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-left text-xs text-rose-100 hover:bg-rose-500/15"
                                      >
                                        <span className="material-symbols-outlined text-sm">flag</span>
                                        Report
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            {reactions.length > 0 ? (
                              <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : "justify-start"}`}>
                                {reactions.map((emoji) => (
                                  <button
                                    key={`${message.id}-${emoji.emoji}`}
                                    type="button"
                                    onClick={() => {
                                      void toggleMessageReaction(message, emoji.emoji);
                                    }}
                                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] hover:border-cyan-300/35 ${
                                      emoji.mine ? "border-cyan-300/45 bg-cyan-300/15 text-cyan-50" : "border-white/20 bg-black/25"
                                    }`}
                                    title={emoji.mine ? "Remove your reaction" : "Toggle reaction"}
                                  >
                                    <span>{emoji.emoji}</span>
                                    {emoji.count > 1 ? <span className="text-[10px] font-semibold">{emoji.count}</span> : null}
                                  </button>
                                ))}
                              </div>
                            ) : null}

                            <div className={`flex items-center gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                              <span className="text-[10px] text-slate-400">{formatTime(message.createdAt)}</span>
                              {mine && message.status === "sending" ? (
                                <span className="text-[10px] text-cyan-100/90" title="Sending">
                                  Sending…
                                </span>
                              ) : null}
                              {mine && message.status === "failed" ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const failedParsed = parseReplyPayload(message.body);
                                    if (failedParsed.replyToId && messageById[failedParsed.replyToId]) {
                                      const target = messageById[failedParsed.replyToId];
                                      const targetParsed = parseReplyPayload(target.body);
                                      setReplyTo({
                                        id: target.id,
                                        senderId: target.senderId,
                                        body: targetParsed.text,
                                        createdAt: target.createdAt,
                                      });
                                    }
                                    setThreadBody(failedParsed.text);
                                    setActiveMessages((prev) => prev.filter((item) => item.id !== message.id));
                                  }}
                                  className="text-[10px] text-rose-200 hover:text-rose-100 underline underline-offset-2"
                                  title="Failed to send. Click to retry"
                                >
                                  Retry
                                </button>
                              ) : null}
                              {mine && message.status !== "sending" && message.status !== "failed" ? (
                                (() => {
                                  const peerReadTime = toTime(activePeerLastReadAt);
                                  const isRead =
                                    activeMeta.kind === "connection" &&
                                    peerReadTime > 0 &&
                                    toTime(message.createdAt) > 0 &&
                                    toTime(message.createdAt) <= peerReadTime;
                                  const isDelivered = !message.localOnly;

                                  if (!isDelivered) {
                                    return (
                                      <span
                                        className="material-symbols-outlined text-slate-400"
                                        style={{ fontSize: 13 }}
                                        title="Sent"
                                        aria-label="Sent"
                                      >
                                        done
                                      </span>
                                    );
                                  }

                                  return (
                                    <span
                                      className={`material-symbols-outlined ${isRead ? "text-[#0df2f2]" : "text-slate-400"}`}
                                      style={{ fontSize: 14 }}
                                      title={isRead ? "Read" : "Delivered"}
                                      aria-label={isRead ? "Read" : "Delivered"}
                                    >
                                      done_all
                                    </span>
                                  );
                                })()
                              ) : null}
                            </div>

                            {showSeenByRecipient ? (
                              <div
                                className={`mt-0.5 flex items-center gap-1.5 text-[10px] ${mine ? "justify-end text-cyan-100/85" : "justify-start text-slate-400"}`}
                                title={`Seen by ${activeMeta.title}${activePeerLastReadAt ? ` at ${formatTime(activePeerLastReadAt)}` : ""}`}
                              >
                                <div className="relative h-4 w-4 overflow-hidden rounded-full border border-cyan-300/30 bg-[#204242]">
                                  {activeMeta.avatarUrl ? (
                                    <Image
                                      src={activeMeta.avatarUrl}
                                      alt={activeMeta.title}
                                      fill
                                      sizes="16px"
                                      loader={remoteImageLoader}
                                      unoptimized
                                      className="object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[9px] text-cyan-100/90">
                                      <span className="material-symbols-outlined" style={{ fontSize: 10 }}>
                                        person
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <span>Seen{activePeerLastReadAt ? ` • ${formatTime(activePeerLastReadAt)}` : ""}</span>
                              </div>
                            ) : null}

                          </div>

                          {mine ? (
                            meAvatarUrl ? (
                              <div className="relative mb-1 h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/10 bg-[#223838]">
                                <Image
                                  src={meAvatarUrl}
                                  alt="You"
                                  fill
                                  sizes="36px"
                                  loader={remoteImageLoader}
                                  unoptimized
                                  className="object-cover"
                                />
                              </div>
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-[#224949] shrink-0 mb-1 flex items-center justify-center text-cyan-100/80">
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                                  person
                                </span>
                              </div>
                            )
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>

                {showJumpToLatest ? (
                  <button
                    type="button"
                    onClick={() => scrollToLatest(true)}
                    className="absolute bottom-4 right-6 rounded-full border border-cyan-300/35 bg-[#0d2324]/95 px-4 py-2 text-xs font-semibold text-cyan-100 shadow-[0_10px_25px_rgba(0,0,0,0.35)] hover:bg-[#123133]"
                  >
                    Jump to latest
                  </button>
                ) : null}
              </div>

              <footer className="shrink-0 p-3 bg-[#121212] border-t border-slate-800">
                {replyTo ? (
                  <div className="max-w-4xl mx-auto mb-2 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-cyan-100/90">
                        Replying to {replyTo.senderId === meId ? "you" : activeMeta?.title ?? "message"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-cyan-50/90">{replyTo.body.replace(/\s+/g, " ").trim()}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      className="shrink-0 rounded-full border border-white/20 p-1 text-slate-200 hover:border-cyan-300/35 hover:text-cyan-100"
                      aria-label="Cancel reply"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                        close
                      </span>
                    </button>
                  </div>
                ) : null}
                <div className="max-w-4xl mx-auto flex items-end gap-2">
                  <div className="relative mb-1 shrink-0">
                    <button
                      type="button"
                      disabled={dailyLimitReached}
                      onClick={() => setComposerEmojiOpen((prev) => !prev)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/25 text-slate-300 transition-colors hover:border-cyan-300/35 hover:text-cyan-100 disabled:opacity-50"
                      aria-label="Open emoji picker"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
                        sentiment_satisfied
                      </span>
                    </button>
                    {composerEmojiOpen ? (
                      <div className="absolute left-0 bottom-11 z-[80] w-44 rounded-xl border border-white/10 bg-[#101616] p-2 shadow-xl">
                        <div className="grid grid-cols-4 gap-1">
                          {QUICK_EMOJIS.map((emoji) => (
                            <button
                              key={`composer-${emoji}`}
                              type="button"
                              onClick={() => {
                                setThreadBody((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${emoji}`);
                                setComposerEmojiOpen(false);
                              }}
                              className="rounded-lg px-1 py-1.5 text-lg transition-colors hover:bg-white/10"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="relative flex flex-1 items-end gap-1.5 rounded-full border border-slate-700/90 bg-black/35 px-2 py-1">
                  <textarea
                    className="flex-1 bg-transparent border-none px-2 py-1.5 text-[14px] leading-5 text-white placeholder-slate-500 focus:ring-0 resize-none max-h-28"
                    placeholder={dailyLimitReached ? "Daily limit reached. Sending unlocks after reset." : "Type a message..."}
                    rows={1}
                    disabled={dailyLimitReached}
                    value={threadBody}
                    onChange={(e) => setThreadBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!sending) void sendActiveMessage();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void sendActiveMessage()}
                    disabled={sending || dailyLimitReached || !threadBody.trim()}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0df2f2] text-[#052328] hover:bg-[#0be0e0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                      send
                    </span>
                  </button>
                  </div>
                </div>
                <div className="max-w-4xl mx-auto min-h-[16px] mt-1">
                  {dailyLimitReached ? (
                    <p className="text-[10px] text-amber-200/90">
                      Messaging is paused by daily limit. You can send again in {dailyResetIn}.
                    </p>
                  ) : threadPrefsInLocalMode ? (
                    <p className="text-[10px] text-slate-400">
                      Archive, mute, and pin are currently stored locally on this device.
                    </p>
                  ) : null}
                </div>
              </footer>
            </>
          )}
        </section>
      </main>

      {reportOpen ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#121414]">
            <div className="h-px w-full bg-gradient-to-r from-rose-400/60 via-rose-400/10 to-[#0df2f2]/30" />
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-white">{reportFromMessageId ? "Report Message" : "Report Conversation"}</h3>
                <button
                  type="button"
                  onClick={() => {
                    if (reportBusy) return;
                    setReportOpen(false);
                    setReportError(null);
                    setReportFromMessageId(null);
                  }}
                  className="text-white/55 hover:text-white"
                  aria-label="Close report modal"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              {reportError ? (
                <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{reportError}</div>
              ) : null}
              {reportFromMessageId ? (
                <div className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
                  Context attached to message <span className="font-semibold">{reportFromMessageId.slice(0, 8)}</span>.
                </div>
              ) : null}

              <div className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">Reason</span>
                <div className="max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-1">
                  {REPORT_REASON_OPTIONS.map((option) => {
                    const selected = reportReason === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setReportReason(option)}
                        className={[
                          "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                          selected ? "bg-rose-500/20 text-rose-100" : "text-slate-200 hover:bg-white/5",
                        ].join(" ")}
                      >
                        <span>{option}</span>
                        <span className="material-symbols-outlined text-base text-white/45">chevron_right</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-xs text-slate-300">
                If someone is in immediate danger, contact local emergency services.
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300">Details (optional)</span>
                <textarea
                  value={reportNote}
                  onChange={(e) => setReportNote(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-rose-300/35 focus:outline-none resize-none"
                  placeholder="Add context for moderators..."
                />
              </label>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={reportBusy}
                  onClick={() => {
                    setReportOpen(false);
                    setReportError(null);
                    setReportFromMessageId(null);
                  }}
                  className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/70 hover:text-white disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={reportBusy}
                  onClick={() => void submitReport()}
                  className="rounded-full bg-rose-500 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-rose-400 disabled:opacity-60"
                >
                  {reportBusy ? "Sending..." : "Submit report"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {blockOpen ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#121414]">
            <div className="h-px w-full bg-gradient-to-r from-rose-500/80 via-rose-400/20 to-[#0df2f2]/30" />
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-white">Block Member</h3>
                <button
                  type="button"
                  onClick={() => {
                    if (blockBusy) return;
                    setBlockOpen(false);
                  }}
                  className="text-white/55 hover:text-white"
                  aria-label="Close block modal"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-100">
                They won’t be able to message you in this connection. The thread will be archived.
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300">Reason</span>
                <select
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white focus:border-rose-300/35 focus:outline-none"
                >
                  <option>Safety concern</option>
                  <option>Harassment / abuse</option>
                  <option>Spam / scams</option>
                  <option>Boundary violation</option>
                  <option>Other</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300">Note (optional)</span>
                <textarea
                  value={blockNote}
                  onChange={(e) => setBlockNote(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-rose-300/35 focus:outline-none resize-none"
                  placeholder="Add context for moderation logs..."
                />
              </label>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={blockBusy}
                  onClick={() => setBlockOpen(false)}
                  className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/70 hover:text-white disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={blockBusy}
                  onClick={() => void blockConnection()}
                  className="rounded-full bg-rose-500 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-rose-400 disabled:opacity-60"
                >
                  {blockBusy ? "Blocking..." : "Confirm block"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {composeOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#121414] shadow-[0_30px_60px_rgba(0,0,0,0.45)]">
            <div className="h-px w-full bg-gradient-to-r from-[#0df2f2]/60 via-[#0df2f2]/10 to-[#f20db1]/60" />
            <div className="p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-white">Start New Thread</h3>
                <button
                  type="button"
                  onClick={() => {
                    setComposeOpen(false);
                    setComposeQuery("");
                  }}
                  className="text-white/55 hover:text-white"
                  aria-label="Close composer"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="mt-3 relative">
                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">search</span>
                <input
                  value={composeQuery}
                  onChange={(e) => setComposeQuery(e.target.value)}
                  placeholder="Search connection or trip..."
                  className="w-full rounded-xl border border-white/15 bg-black/25 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
              </div>

              <div className="mt-3 max-h-[360px] space-y-3 overflow-y-auto pr-1">
                {filteredComposeConnections.length === 0 && filteredComposeTrips.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-slate-400 space-y-3">
                    <p>No eligible connections or trips available yet.</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href="/connections"
                        className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                      >
                        Find Connections
                      </Link>
                      <Link
                        href="/trips"
                        className="rounded-full border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-cyan-300/30 hover:text-cyan-100"
                      >
                        Browse Trips
                      </Link>
                    </div>
                  </div>
                ) : (
                  <>
                    {filteredComposeConnections.length > 0 ? (
                      <div className="space-y-2">
                        <p className="px-1 text-[11px] font-bold uppercase tracking-widest text-cyan-200/80">Connections</p>
                        {filteredComposeConnections.map((target) => (
                          <button
                            key={target.connectionId}
                            type="button"
                            onClick={() => {
                              const token = `conn:${target.connectionId}`;
                              setComposeOpen(false);
                              setComposeQuery("");
                              if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
                                router.push(`/messages/${encodeURIComponent(token)}`);
                                return;
                              }
                              setActiveThreadToken(token);
                              router.replace(`/messages?thread=${encodeURIComponent(token)}`);
                            }}
                            className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-left hover:border-cyan-300/30 hover:bg-[#1e2f2f]"
                          >
                            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-[#223838]">
                              {target.avatarUrl ? (
                                <Image
                                  src={target.avatarUrl}
                                  alt={target.displayName}
                                  fill
                                  sizes="40px"
                                  loader={remoteImageLoader}
                                  unoptimized
                                  className="object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-cyan-100/80">
                                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                                    person
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white">{target.displayName}</p>
                              <p className="truncate text-xs text-slate-400">{target.subtitle}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {filteredComposeTrips.length > 0 ? (
                      <div className="space-y-2">
                        <p className="px-1 text-[11px] font-bold uppercase tracking-widest text-cyan-200/80">Trips</p>
                        {filteredComposeTrips.map((target) => (
                          <button
                            key={target.tripId}
                            type="button"
                            onClick={() => {
                              const token = `trip:${target.tripId}`;
                              setComposeOpen(false);
                              setComposeQuery("");
                              if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
                                router.push(`/messages/${encodeURIComponent(token)}`);
                                return;
                              }
                              setActiveThreadToken(token);
                              router.replace(`/messages?thread=${encodeURIComponent(token)}`);
                            }}
                            className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-left hover:border-cyan-300/30 hover:bg-[#1e2f2f]"
                          >
                            <div className="h-10 w-10 shrink-0 rounded-full bg-[#223838] flex items-center justify-center text-cyan-200">
                              <span className="material-symbols-outlined">luggage</span>
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white">{target.displayName}</p>
                              <p className="truncate text-xs text-slate-400">{target.subtitle}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setComposeOpen(false);
                    setComposeQuery("");
                  }}
                  className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/70 hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        .cx-scroll::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .cx-scroll::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.04);
          border-radius: 9999px;
        }
        .cx-scroll::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.45);
          border: 2px solid transparent;
          background-clip: padding-box;
          border-radius: 9999px;
        }
        .cx-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.72);
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .cx-scroll {
          scrollbar-color: rgba(148, 163, 184, 0.65) rgba(255, 255, 255, 0.04);
          scrollbar-width: thin;
        }
      `}</style>
    </div>
  );
}

function MessagesPageFallback() {
  return (
    <div className="font-sans h-screen bg-[#0A0A0A] text-white flex flex-col overflow-hidden">
      <Nav />
      <div className="flex-1 p-4 sm:p-6">
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
          Loading messages...
        </div>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<MessagesPageFallback />}>
      <MessagesPageContent />
    </Suspense>
  );
}
