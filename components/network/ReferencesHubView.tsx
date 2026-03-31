"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PaginationControls from "@/components/PaginationControls";
import { supabase } from "@/lib/supabase/client";
import { fetchVisibleConnections } from "@/lib/connections/read-model";
import {
  REFERENCE_CONTEXT_TAGS,
  normalizeReferenceContextTag,
  referenceContextFamily,
  referenceContextLabel,
  referenceContextShortLabel,
  type ReferenceContextTag,
} from "@/lib/activities/types";
type Sentiment = "positive" | "neutral" | "negative";
type FeedFilter = "received" | "given" | "pending" | "archived";
type CandidateFilter = "all" | ReferenceContextTag;
const REFERENCE_FEED_PAGE_SIZE = 25;

type LiteProfile = {
  userId: string;
  displayName: string;
  city: string;
  country: string;
  avatarUrl?: string | null;
};

type CandidateItem = {
  key: string;
  type: ReferenceContextTag;
  entityId: string;
  connectionId: string;
  promptId?: string | null;
  recipientId: string;
  recipientName: string;
  title: string;
  subtitle: string;
  endedAt: string;
};

type ReferenceItem = {
  id: string;
  authorId: string;
  recipientId: string;
  sentiment: Sentiment;
  body: string;
  contextTag: ReferenceContextTag;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  replyText: string | null;
  editCount: number;
};

type ReferenceRowDb = {
  id?: string;
  author_id?: string;
  from_user_id?: string;
  source_id?: string;
  recipient_id?: string;
  to_user_id?: string;
  target_id?: string;
  sentiment?: string;
  rating?: string | number | null;
  body?: string | null;
  content?: string | null;
  feedback?: string | null;
  comment?: string | null;
  reference_text?: string | null;
  context?: string | null;
  context_tag?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  sync_id?: string | null;
  created_at?: string;
  reply_text?: string | null;
  reply?: string | null;
  response_text?: string | null;
  reply_body?: string | null;
  edit_count?: number | null;
};

type SyncRowDb = {
  id?: string;
  connection_id?: string;
  requester_id?: string;
  recipient_id?: string;
  status?: string;
  completed_at?: string | null;
};

type TripRowDb = {
  id?: string;
  user_id?: string;
  destination_city?: string | null;
  destination_country?: string | null;
  end_date?: string | null;
};

type TripRequestRowDb = {
  id?: string;
  trip_id?: string;
  requester_id?: string;
  status?: string;
};

type EventRowDb = {
  id?: string;
  title?: string | null;
  city?: string | null;
  country?: string | null;
  ends_at?: string | null;
};

type EventMemberRowDb = {
  event_id?: string;
  user_id?: string;
  status?: string;
};

type HostingRequestRowDb = {
  id?: string;
  sender_user_id?: string;
  recipient_user_id?: string;
  request_type?: string;
  status?: string;
  departure_date?: string | null;
};

type ReferenceRequestRowDb = {
  id?: string;
  user_id?: string;
  peer_user_id?: string;
  context_tag?: string;
  source_table?: string;
  source_id?: string;
  connection_id?: string | null;
  due_at?: string | null;
  remind_after?: string | null;
  expires_at?: string | null;
  status?: string;
};

type ReferencesHubViewProps = {
  initialConnectionId?: string | null;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function within15Days(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return false;
  const ms = Date.now() - date.getTime();
  return ms >= 0 && ms <= 15 * 24 * 60 * 60 * 1000;
}

function initialsFromName(value: string) {
  const words = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "M";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

function mapReferenceRows(rows: ReferenceRowDb[]): ReferenceItem[] {
  const toSentiment = (row: ReferenceRowDb): Sentiment | null => {
    const sentiment = typeof row.sentiment === "string" ? row.sentiment.toLowerCase() : "";
    if (sentiment === "positive" || sentiment === "neutral" || sentiment === "negative") {
      return sentiment;
    }

    const ratingRaw = row.rating;
    if (typeof ratingRaw === "number") {
      if (ratingRaw >= 4) return "positive";
      if (ratingRaw <= 2) return "negative";
      return "neutral";
    }
    if (typeof ratingRaw === "string" && ratingRaw.trim().length > 0) {
      const normalized = ratingRaw.trim().toLowerCase();
      if (normalized === "positive" || normalized === "neutral" || normalized === "negative") {
        return normalized;
      }
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) {
        if (parsed >= 4) return "positive";
        if (parsed <= 2) return "negative";
        return "neutral";
      }
    }
    return null;
  };

  const pickText = (row: ReferenceRowDb, keys: Array<keyof ReferenceRowDb>) => {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "string" && value.trim().length > 0) return value;
    }
    return "";
  };

  const pickNullableText = (row: ReferenceRowDb, keys: Array<keyof ReferenceRowDb>) => {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "string" && value.trim().length > 0) return value;
    }
    return null;
  };

  return rows
    .map((row) => {
      const id = row.id ?? "";
      const authorId = pickText(row, ["author_id", "from_user_id", "source_id"]);
      const recipientId = pickText(row, ["recipient_id", "to_user_id", "target_id"]);
      const createdAt = row.created_at ?? "";
      const sentiment = toSentiment(row);
      if (!id || !authorId || !recipientId || !createdAt) return null;
      if (!sentiment) return null;

      const body = pickText(row, ["body", "content", "feedback", "comment", "reference_text"]);
      const contextRaw = pickText(row, ["context_tag", "context", "entity_type"]) || "collaboration";
      const contextTag = normalizeReferenceContextTag(contextRaw);
      const entityType = pickText(row, ["entity_type", "context"]).toLowerCase() || (row.sync_id ? "sync" : "connection");
      const entityId = pickNullableText(row, ["entity_id", "sync_id"]);
      const replyText = pickNullableText(row, ["reply_text", "reply", "response_text", "reply_body"]);

      return {
        id,
        authorId,
        recipientId,
        sentiment,
        body,
        contextTag,
        entityType,
        entityId,
        createdAt,
        replyText,
        editCount: typeof row.edit_count === "number" ? row.edit_count : 0,
      } satisfies ReferenceItem;
    })
    .filter((row): row is ReferenceItem => Boolean(row))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function sentimentBadge(sentiment: Sentiment) {
  if (sentiment === "positive") return "border-[#00F5FF]/35 bg-[#00F5FF]/10 text-[#B8FBFF]";
  if (sentiment === "negative") return "border-[#FF00FF]/35 bg-[#FF00FF]/10 text-[#FFC6FA]";
  return "border-white/20 bg-white/[0.04] text-white/70";
}

function contextTagBadge(contextTag: ReferenceContextTag) {
  const family = referenceContextFamily(contextTag);
  if (family === "practice") return "border-[#00F5FF]/35 bg-[#00F5FF]/12 text-[#B8FBFF]";
  if (family === "travel" || family === "festival") return "border-[#FF00FF]/35 bg-[#FF00FF]/12 text-[#FFC6FA]";
  if (family === "hosting") return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
  if (family === "collaboration") return "border-violet-300/30 bg-violet-400/10 text-violet-100";
  return "border-white/20 bg-white/[0.04] text-white/70";
}

function contextTagIcon(contextTag: ReferenceContextTag) {
  if (contextTag === "practice") return "fitness_center";
  if (contextTag === "private_class" || contextTag === "group_class" || contextTag === "workshop") return "school";
  if (contextTag === "event") return "event";
  if (contextTag === "festival") return "celebration";
  if (contextTag === "social_dance") return "music_note";
  if (contextTag === "travel_together") return "flight";
  if (contextTag === "hosting") return "home";
  if (contextTag === "stay_as_guest") return "bed";
  if (contextTag === "competition") return "emoji_events";
  if (contextTag === "content_video") return "videocam";
  return "handshake";
}

function familyAccentClass(contextTag: ReferenceContextTag) {
  const family = referenceContextFamily(contextTag);
  if (family === "practice") return "text-cyan-300";
  if (family === "travel" || family === "festival") return "text-fuchsia-300";
  if (family === "hosting") return "text-emerald-300";
  if (family === "collaboration") return "text-violet-300";
  return "text-white/70";
}

const REFERENCE_REPLY_MAX_CHARS = 300;

function candidateEntityType(type: ReferenceContextTag) {
  if (type === "practice" || type === "private_class" || type === "group_class" || type === "workshop") return "sync";
  if (type === "event" || type === "festival" || type === "social_dance" || type === "competition") return "event";
  if (type === "travel_together" || type === "hosting" || type === "stay_as_guest") return "trip";
  return "connection";
}

function ReferencesHubSkeleton() {
  return (
    <div className="w-full space-y-6">
      <section className="overflow-hidden rounded-xl border border-white/10 bg-[#121212]">
        <div className="flex flex-col divide-y divide-white/10 md:flex-row md:divide-x md:divide-y-0">
          <div className="w-full px-5 py-5 sm:px-8 sm:py-6 md:w-1/4">
            <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
            <div className="mt-4 h-10 w-20 animate-pulse rounded bg-white/10" />
          </div>
          <div className="flex-1 px-5 py-5 sm:px-8 sm:py-6">
            <div className="h-3 w-36 animate-pulse rounded bg-white/10" />
            <div className="mt-5 h-2 w-full animate-pulse rounded-full bg-white/10" />
            <div className="mt-4 flex gap-4">
              <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
            </div>
          </div>
          <div className="w-full px-5 py-5 sm:px-8 sm:py-6 md:w-[22%]">
            <div className="mx-auto h-3 w-24 animate-pulse rounded bg-white/10" />
            <div className="mx-auto mt-4 h-12 w-24 animate-pulse rounded bg-white/10" />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-8 lg:flex-row">
        <aside className="w-full shrink-0 space-y-8 lg:w-64">
          <div className="rounded-xl border border-white/10 bg-[#101317] p-4">
            <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
            <div className="mt-4 space-y-2">
              {[0, 1, 2, 3].map((idx) => (
                <div key={idx} className="h-10 animate-pulse rounded-lg bg-white/[0.05]" />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#101317] p-4">
            <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
            <div className="mt-4 space-y-2">
              {[0, 1, 2, 3, 4].map((idx) => (
                <div key={idx} className="h-10 animate-pulse rounded-lg bg-white/[0.05]" />
              ))}
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-4">
          {[0, 1, 2].map((idx) => (
            <article key={idx} className="rounded-xl border border-white/10 bg-[#121212] p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-4">
                  <div className="h-12 w-12 animate-pulse rounded-full border border-white/10 bg-white/[0.04]" />
                  <div className="space-y-3">
                    <div className="h-5 w-40 animate-pulse rounded bg-white/10" />
                    <div className="h-3 w-56 animate-pulse rounded bg-white/10" />
                  </div>
                </div>
                <div className="h-6 w-6 animate-pulse rounded-full bg-white/10" />
              </div>
              <div className="mt-6 space-y-3 pl-16">
                <div className="h-4 w-full animate-pulse rounded bg-white/10" />
                <div className="h-4 w-[92%] animate-pulse rounded bg-white/10" />
                <div className="h-4 w-[78%] animate-pulse rounded bg-white/10" />
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function ReferencesHubView({ initialConnectionId = null }: ReferencesHubViewProps) {
  const router = useRouter();
  const initialConnectionIdValue = (initialConnectionId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(null);

  const [profilesById, setProfilesById] = useState<Record<string, LiteProfile>>({});
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string>("");
  const [pendingPromptCount, setPendingPromptCount] = useState(0);
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>("all");
  const [feedFilter, setFeedFilter] = useState<FeedFilter>(initialConnectionIdValue ? "pending" : "received");
  const [feedContextFilter, setFeedContextFilter] = useState<"all" | ReferenceContextTag>("all");
  const [feedPage, setFeedPage] = useState(1);

  const [sentiment, setSentiment] = useState<Sentiment>("positive");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [given, setGiven] = useState<ReferenceItem[]>([]);
  const [received, setReceived] = useState<ReferenceItem[]>([]);
  const [archivedGiven, setArchivedGiven] = useState<ReferenceItem[]>([]);
  const [archivedReceived, setArchivedReceived] = useState<ReferenceItem[]>([]);

  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [editDraft, setEditDraft] = useState<Record<string, { body: string; sentiment: Sentiment }>>({});
  const [busyReferenceId, setBusyReferenceId] = useState<string | null>(null);
  const [openMenuReferenceId, setOpenMenuReferenceId] = useState<string | null>(null);
  const [archivingReferenceId, setArchivingReferenceId] = useState<string | null>(null);

  const selectedCandidate = useMemo(
    () => candidates.find((item) => item.key === selectedCandidateKey) ?? null,
    [candidates, selectedCandidateKey]
  );

  const visibleCandidates = useMemo(() => {
    const rows = candidateFilter === "all" ? candidates : candidates.filter((item) => item.type === candidateFilter);
    return rows;
  }, [candidateFilter, candidates]);

  const selectedPendingCandidate = useMemo(() => {
    if (visibleCandidates.length === 0) return null;
    return visibleCandidates.find((item) => item.key === selectedCandidateKey) ?? visibleCandidates[0];
  }, [selectedCandidateKey, visibleCandidates]);
  const visibleCandidateGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        recipientId: string;
        recipientName: string;
        items: CandidateItem[];
        latestEndedAt: string;
      }
    >();

    visibleCandidates.forEach((item) => {
      const existing = groups.get(item.recipientId);
      if (existing) {
        existing.items.push(item);
        if ((parseDate(item.endedAt)?.getTime() ?? 0) > (parseDate(existing.latestEndedAt)?.getTime() ?? 0)) {
          existing.latestEndedAt = item.endedAt;
        }
      } else {
        groups.set(item.recipientId, {
          recipientId: item.recipientId,
          recipientName: item.recipientName,
          items: [item],
          latestEndedAt: item.endedAt,
        });
      }
    });

    return Array.from(groups.values()).sort(
      (a, b) => (parseDate(b.latestEndedAt)?.getTime() ?? 0) - (parseDate(a.latestEndedAt)?.getTime() ?? 0)
    );
  }, [visibleCandidates]);

  const feedItems = useMemo(() => {
    let rows = [
      ...received.map((item) => ({ ...item, direction: "received" as const })),
      ...given.map((item) => ({ ...item, direction: "given" as const })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (feedFilter === "received" || feedFilter === "given") {
      rows = rows.filter((item) => (feedFilter === "received" ? item.direction === "received" : item.direction === "given"));
    } else if (feedFilter === "archived") {
      rows = [
        ...archivedReceived.map((item) => ({ ...item, direction: "received" as const })),
        ...archivedGiven.map((item) => ({ ...item, direction: "given" as const })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    if (feedContextFilter !== "all") {
      rows = rows.filter((item) => item.contextTag === feedContextFilter);
    }
    return rows;
  }, [archivedGiven, archivedReceived, feedContextFilter, feedFilter, given, received]);
  const totalFeedPages = useMemo(() => Math.max(1, Math.ceil(feedItems.length / REFERENCE_FEED_PAGE_SIZE)), [feedItems.length]);
  const currentFeedPage = Math.min(feedPage, totalFeedPages);
  const visibleFeedItems = useMemo(
    () => feedItems.slice((currentFeedPage - 1) * REFERENCE_FEED_PAGE_SIZE, currentFeedPage * REFERENCE_FEED_PAGE_SIZE),
    [currentFeedPage, feedItems]
  );

  const scopedFeedRows = useMemo(() => {
    if (feedFilter === "received") return received;
    if (feedFilter === "given") return given;
    if (feedFilter === "archived") return [...archivedReceived, ...archivedGiven];
    return [] as ReferenceItem[];
  }, [archivedGiven, archivedReceived, feedFilter, given, received]);

  const scopedContextCounts = useMemo(() => {
    const counts = REFERENCE_CONTEXT_TAGS.reduce(
      (acc, tag) => {
        acc[tag] = 0;
        return acc;
      },
      {} as Record<ReferenceContextTag, number>
    );
    scopedFeedRows.forEach((item) => {
      counts[item.contextTag] += 1;
    });
    return counts;
  }, [scopedFeedRows]);

  const totalReferences = received.length + given.length;
  const positiveCount = useMemo(
    () => [...received, ...given].filter((item) => item.sentiment === "positive").length,
    [given, received]
  );
  const neutralCount = useMemo(
    () => [...received, ...given].filter((item) => item.sentiment === "neutral").length,
    [given, received]
  );
  const negativeCount = useMemo(
    () => [...received, ...given].filter((item) => item.sentiment === "negative").length,
    [given, received]
  );
  const pendingCount = useMemo(() => candidates.length, [candidates.length]);
  const pendingContextCounts = useMemo(() => {
    const counts = REFERENCE_CONTEXT_TAGS.reduce(
      (acc, tag) => {
        acc[tag] = 0;
        return acc;
      },
      {} as Record<ReferenceContextTag, number>
    );
    candidates.forEach((item) => {
      counts[item.type] += 1;
    });
    return counts;
  }, [candidates]);
  const trustPercent = totalReferences > 0 ? Math.round((positiveCount / totalReferences) * 100) : 0;

  /* eslint-disable react-hooks/set-state-in-effect -- page-local UI pagination reset on filter updates. */
  useEffect(() => {
    setFeedPage(1);
  }, [feedFilter, feedContextFilter]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    setPendingPromptCount(0);

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) {
      setError("Please sign in first.");
      setLoading(false);
      return;
    }

    const me = authData.user.id;

    const { data: sessionData } = await supabase.auth.getSession();
    setToken(sessionData.session?.access_token ?? null);

    const visibleConnections = await fetchVisibleConnections(supabase, me);
    const acceptedConnections = visibleConnections.filter((row) => row.is_accepted_visible);
    const connectionByOtherUser = new Map<string, string>();
    acceptedConnections.forEach((row) => {
      if (row.other_user_id && row.id) connectionByOtherUser.set(row.other_user_id, row.id);
    });

    const profileIds = Array.from(
      new Set([me, ...acceptedConnections.map((row) => row.other_user_id).filter(Boolean)])
    );
    const profileMap: Record<string, LiteProfile> = {};
    if (profileIds.length > 0) {
      const profileRes = await supabase
        .from("profiles")
        .select("user_id,display_name,city,country,avatar_url")
        .in("user_id", profileIds);
      if (!profileRes.error) {
        ((profileRes.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
          const userId = typeof row.user_id === "string" ? row.user_id : "";
          if (!userId) return;
          profileMap[userId] = {
            userId,
            displayName:
              typeof row.display_name === "string" && row.display_name.trim() ? row.display_name : "Member",
            city: typeof row.city === "string" ? row.city : "",
            country: typeof row.country === "string" ? row.country : "",
            avatarUrl: typeof row.avatar_url === "string" ? row.avatar_url : null,
          };
        });
      }
    }
    setProfilesById(profileMap);

    const isMissingSchemaError = (message: string) => {
      const text = message.toLowerCase();
      return (
        text.includes("relation") ||
        text.includes("schema cache") ||
        text.includes("does not exist") ||
        text.includes("could not find the table") ||
        text.includes("column") ||
        text.includes("function") ||
        text.includes("record \"r\" has no field")
      );
    };

    const nowIso = new Date().toISOString();
    const cutoffIso = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const cutoffDate = cutoffIso.slice(0, 10);
    const todayDate = nowIso.slice(0, 10);

    const accessToken = sessionData.session?.access_token ?? "";
    if (!accessToken) {
      throw new Error("Missing auth session token");
    }

    const syncPromptRes = await fetch("/api/references/prompts/sync", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const syncPromptPayload = (await syncPromptRes.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!syncPromptRes.ok || !syncPromptPayload?.ok) {
      const errorMessage = syncPromptPayload?.error ?? "Failed to sync reference prompts.";
      if (!isMissingSchemaError(errorMessage)) {
        throw new Error(errorMessage);
      }
    }

    const promptRes = await supabase
      .from("reference_requests")
      .select("id,user_id,peer_user_id,context_tag,source_table,source_id,connection_id,due_at,remind_after,expires_at,status")
      .eq("user_id", me)
      .eq("status", "pending")
      .lte("due_at", nowIso)
      .gte("expires_at", nowIso)
      .order("due_at", { ascending: false })
      .limit(600);
    if (promptRes.error && !isMissingSchemaError(promptRes.error.message)) {
      throw new Error(promptRes.error.message);
    }
    const promptRows = promptRes.error ? [] : ((promptRes.data ?? []) as ReferenceRequestRowDb[]);

    const fetchReferencesForActor = async (columns: string[]) => {
      for (const column of columns) {
        const res = await supabase
          .from("references")
          .select("*")
          .eq(column, me)
          .order("created_at", { ascending: false })
          .limit(500);
        if (!res.error) {
          return (res.data ?? []) as ReferenceRowDb[];
        }
        if (!isMissingSchemaError(res.error.message)) {
          break;
        }
      }
      return [] as ReferenceRowDb[];
    };

    const [givenRawRows, receivedRawRows] = await Promise.all([
      fetchReferencesForActor(["author_id", "from_user_id", "source_id"]),
      fetchReferencesForActor(["recipient_id", "to_user_id", "target_id"]),
    ]);

    const givenRows = mapReferenceRows(givenRawRows);
    const receivedRows = mapReferenceRows(receivedRawRows);

    const archiveRes = await supabase
      .from("reference_archives")
      .select("reference_id")
      .eq("user_id", me)
      .limit(1000);
    const archivedReferenceIds = archiveRes.error && !isMissingSchemaError(archiveRes.error.message)
      ? null
      : new Set(
          ((archiveRes.error ? [] : archiveRes.data ?? []) as Array<Record<string, unknown>>)
            .map((row) => (typeof row.reference_id === "string" ? row.reference_id : ""))
            .filter(Boolean)
        );

    setArchivedGiven(
      archivedReferenceIds ? givenRows.filter((row) => archivedReferenceIds.has(row.id)) : []
    );
    setArchivedReceived(
      archivedReferenceIds ? receivedRows.filter((row) => archivedReferenceIds.has(row.id)) : []
    );
    setGiven(
      archivedReferenceIds ? givenRows.filter((row) => !archivedReferenceIds.has(row.id)) : givenRows
    );
    setReceived(
      archivedReferenceIds ? receivedRows.filter((row) => !archivedReferenceIds.has(row.id)) : receivedRows
    );

    const resolvedProfileMap: Record<string, LiteProfile> = { ...profileMap };
    const missingProfileIds = Array.from(
      new Set(
        [
          ...promptRows.map((row) => row.peer_user_id ?? "").filter(Boolean),
          ...givenRows.flatMap((row) => [row.authorId, row.recipientId]),
          ...receivedRows.flatMap((row) => [row.authorId, row.recipientId]),
        ].filter((id) => id && !resolvedProfileMap[id])
      )
    );

    if (missingProfileIds.length > 0) {
      const extraProfilesRes = await supabase
        .from("profiles")
        .select("user_id,display_name,city,country,avatar_url")
        .in("user_id", missingProfileIds);
      if (!extraProfilesRes.error) {
        ((extraProfilesRes.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
          const userId = typeof row.user_id === "string" ? row.user_id : "";
          if (!userId) return;
          resolvedProfileMap[userId] = {
            userId,
            displayName:
              typeof row.display_name === "string" && row.display_name.trim() ? row.display_name : "Member",
            city: typeof row.city === "string" ? row.city : "",
            country: typeof row.country === "string" ? row.country : "",
            avatarUrl: typeof row.avatar_url === "string" ? row.avatar_url : null,
          };
        });
      }
    }
    setProfilesById(resolvedProfileMap);

    const authoredEntityKeys = new Set<string>();
    const authoredPairTypeKeys = new Set<string>();
    givenRows.forEach((row) => {
      if (row.contextTag && row.entityId) {
        authoredEntityKeys.add(`${row.contextTag}:${row.entityId}`);
      }
      if (row.contextTag && row.recipientId) {
        authoredPairTypeKeys.add(`${row.contextTag}:${row.recipientId}`);
      }
    });

    const nextCandidates: CandidateItem[] = [];
    const dedupe = new Set<string>();

    promptRows.forEach((row) => {
      const promptId = row.id ?? "";
      const peerUserId = row.peer_user_id ?? "";
      const sourceId = row.source_id ?? "";
      if (!promptId || !peerUserId || !sourceId) return;

      const type = normalizeReferenceContextTag(row.context_tag ?? "collaboration");
      if (authoredPairTypeKeys.has(`${type}:${peerUserId}`)) return;

      const dedupeKey = `${type}:${peerUserId}`;
      if (dedupe.has(dedupeKey)) return;
      dedupe.add(dedupeKey);

      const profile = resolvedProfileMap[peerUserId];
      const displayName = profile?.displayName ?? "Member";
      const connectionId = row.connection_id ?? connectionByOtherUser.get(peerUserId) ?? "";
      const dueAt = row.due_at ?? "";
      const title =
        type === "travel_together"
          ? `Trip completed with ${displayName}`
          : type === "hosting"
          ? `Hosting completed with ${displayName}`
          : type === "stay_as_guest"
          ? `Guest stay completed with ${displayName}`
          : `Reference request with ${displayName}`;
      const subtitle = dueAt
        ? `Prompt unlocked ${formatDate(dueAt)}`
        : `${displayName} is ready for a reference`;

      nextCandidates.push({
        key: dedupeKey,
        type,
        entityId: sourceId,
        connectionId,
        promptId,
        recipientId: peerUserId,
        recipientName: displayName,
        title,
        subtitle,
        endedAt: dueAt || row.expires_at || nowIso,
      });
    });

    const syncRes = await supabase
      .from("connection_syncs")
      .select("id,connection_id,requester_id,recipient_id,status,completed_at")
      .eq("status", "completed")
      .gte("completed_at", cutoffIso)
      .or(`requester_id.eq.${me},recipient_id.eq.${me}`)
      .limit(600);

    if (!syncRes.error) {
      ((syncRes.data ?? []) as SyncRowDb[]).forEach((row) => {
        const syncId = row.id ?? "";
        const connectionId = row.connection_id ?? "";
        const completedAt = row.completed_at ?? "";
        const requesterId = row.requester_id ?? "";
        const recipientId = row.recipient_id ?? "";
        if (!syncId || !connectionId || !completedAt || !requesterId || !recipientId) return;

        const otherUserId = requesterId === me ? recipientId : requesterId;
        if (!otherUserId || !connectionByOtherUser.has(otherUserId)) return;
        if (authoredPairTypeKeys.has(`practice:${otherUserId}`)) return;

        const dedupeKey = `practice:${otherUserId}`;
        if (dedupe.has(dedupeKey)) return;
        dedupe.add(dedupeKey);

        const profile = resolvedProfileMap[otherUserId];
        nextCandidates.push({
          key: dedupeKey,
          type: "practice",
          entityId: syncId,
          connectionId,
          recipientId: otherUserId,
          recipientName: profile?.displayName ?? "Member",
          title: `Sync with ${profile?.displayName ?? "member"}`,
          subtitle: `Completed ${formatDate(completedAt)}`,
          endedAt: completedAt,
        });
      });
    }

    const myTripsRes = await supabase
      .from("trips")
      .select("id,user_id,destination_city,destination_country,end_date")
      .eq("user_id", me)
      .gte("end_date", cutoffDate)
      .lte("end_date", todayDate)
      .limit(300);

    const myTrips = ((myTripsRes.data ?? []) as TripRowDb[]).filter((row) => row.id);
    const myTripIds = myTrips.map((trip) => trip.id ?? "").filter(Boolean);
    const myTripsById = new Map<string, TripRowDb>(myTrips.map((trip) => [trip.id ?? "", trip]));

    if (myTripIds.length > 0) {
      const ownerReqRes = await supabase
        .from("trip_requests")
        .select("id,trip_id,requester_id,status")
        .eq("status", "accepted")
        .in("trip_id", myTripIds)
        .limit(600);

      if (!ownerReqRes.error) {
        ((ownerReqRes.data ?? []) as TripRequestRowDb[]).forEach((row) => {
          const requestId = row.id ?? "";
          const requesterId = row.requester_id ?? "";
          const tripId = row.trip_id ?? "";
          if (!requestId || !requesterId || !tripId) return;
          const connectionId = connectionByOtherUser.get(requesterId);
          if (!connectionId) return;
          if (authoredPairTypeKeys.has(`travel_together:${requesterId}`)) return;

          const trip = myTripsById.get(tripId);
          const profile = profileMap[requesterId];
          const dedupeKey = `travel_together:${requesterId}`;
          if (dedupe.has(dedupeKey)) return;
          dedupe.add(dedupeKey);

          nextCandidates.push({
            key: dedupeKey,
            type: "travel_together",
            entityId: requestId,
            connectionId,
            recipientId: requesterId,
            recipientName: profile?.displayName ?? "Member",
            title: `${trip?.destination_city ?? "Trip"} trip`,
            subtitle: `${profile?.displayName ?? "Member"} • ended ${formatDate(trip?.end_date ?? null)}`,
            endedAt: trip?.end_date ?? "",
          });
        });
      }
    }

    const requesterTripReqRes = await supabase
      .from("trip_requests")
      .select("id,trip_id,requester_id,status")
      .eq("status", "accepted")
      .eq("requester_id", me)
      .limit(600);

    const requesterTripReqs = ((requesterTripReqRes.data ?? []) as TripRequestRowDb[]).filter((row) => row.id && row.trip_id);
    const requesterTripIds = Array.from(new Set(requesterTripReqs.map((row) => row.trip_id ?? "").filter(Boolean)));
    if (requesterTripIds.length > 0) {
      const requesterTripsRes = await supabase
        .from("trips")
        .select("id,user_id,destination_city,destination_country,end_date")
        .in("id", requesterTripIds)
        .gte("end_date", cutoffDate)
        .lte("end_date", todayDate)
        .limit(600);

      const requesterTripsById = new Map<string, TripRowDb>(
        ((requesterTripsRes.data ?? []) as TripRowDb[]).map((trip) => [trip.id ?? "", trip])
      );

      requesterTripReqs.forEach((request) => {
        const requestId = request.id ?? "";
        const tripId = request.trip_id ?? "";
        const trip = requesterTripsById.get(tripId);
        const ownerId = trip?.user_id ?? "";
        if (!requestId || !tripId || !trip || !ownerId) return;
        const connectionId = connectionByOtherUser.get(ownerId);
        if (!connectionId) return;
        if (authoredPairTypeKeys.has(`travel_together:${ownerId}`)) return;

        const ownerProfile = resolvedProfileMap[ownerId];
        const dedupeKey = `travel_together:${ownerId}`;
        if (dedupe.has(dedupeKey)) return;
        dedupe.add(dedupeKey);

        nextCandidates.push({
          key: dedupeKey,
          type: "travel_together",
          entityId: requestId,
          connectionId,
          recipientId: ownerId,
          recipientName: ownerProfile?.displayName ?? "Member",
          title: `${trip.destination_city ?? "Trip"} trip`,
          subtitle: `${ownerProfile?.displayName ?? "Member"} • ended ${formatDate(trip.end_date ?? null)}`,
          endedAt: trip.end_date ?? "",
        });
      });
    }

    const hostingRes = await supabase
      .from("hosting_requests")
      .select("id,sender_user_id,recipient_user_id,request_type,status,departure_date")
      .eq("status", "accepted")
      .gte("departure_date", cutoffDate)
      .lte("departure_date", todayDate)
      .or(`sender_user_id.eq.${me},recipient_user_id.eq.${me}`)
      .limit(800);

    if (!hostingRes.error) {
      ((hostingRes.data ?? []) as HostingRequestRowDb[]).forEach((row) => {
        const requestId = row.id ?? "";
        const senderId = row.sender_user_id ?? "";
        const recipientUserId = row.recipient_user_id ?? "";
        const requestType = row.request_type ?? "";
        const departureDate = row.departure_date ?? "";
        if (!requestId || !senderId || !recipientUserId || !departureDate) return;

        const otherUserId = senderId === me ? recipientUserId : senderId;
        const connectionId = connectionByOtherUser.get(otherUserId);
        if (!connectionId) return;

        const iAmHost =
          (requestType === "request_hosting" && recipientUserId === me) ||
          (requestType === "offer_to_host" && senderId === me);
        const type: ReferenceContextTag = iAmHost ? "hosting" : "stay_as_guest";

        if (authoredPairTypeKeys.has(`${type}:${otherUserId}`)) return;
        const dedupeKey = `${type}:${otherUserId}`;
        if (dedupe.has(dedupeKey)) return;
        dedupe.add(dedupeKey);

        const profile = resolvedProfileMap[otherUserId];
        nextCandidates.push({
          key: dedupeKey,
          type,
          entityId: requestId,
          connectionId,
          recipientId: otherUserId,
          recipientName: profile?.displayName ?? "Member",
          title: iAmHost
            ? `Hosted ${profile?.displayName ?? "member"}`
            : `Stayed with ${profile?.displayName ?? "member"}`,
          subtitle: `Hosting completed ${formatDate(departureDate)}`,
          endedAt: departureDate,
        });
      });
    }

    const myMembershipRes = await supabase
      .from("event_members")
      .select("event_id,user_id,status")
      .eq("user_id", me)
      .in("status", ["host", "going", "waitlist"])
      .limit(1200);

    const myEventIds = Array.from(
      new Set(((myMembershipRes.data ?? []) as EventMemberRowDb[]).map((row) => row.event_id ?? "").filter(Boolean))
    );

    if (myEventIds.length > 0) {
      const eventsRes = await supabase
        .from("events")
        .select("id,title,city,country,ends_at")
        .in("id", myEventIds)
        .gte("ends_at", cutoffIso)
        .lte("ends_at", nowIso)
        .limit(1200);

      const endedEvents = ((eventsRes.data ?? []) as EventRowDb[]).filter((row) => row.id);
      const endedEventIds = endedEvents.map((row) => row.id ?? "");
      const endedEventsById = new Map<string, EventRowDb>(endedEvents.map((event) => [event.id ?? "", event]));

      if (endedEventIds.length > 0) {
        const eventMembersRes = await supabase
          .from("event_members")
          .select("event_id,user_id,status")
          .in("event_id", endedEventIds)
          .in("status", ["host", "going", "waitlist"])
          .limit(5000);

        const grouped = new Map<string, EventMemberRowDb[]>();
        ((eventMembersRes.data ?? []) as EventMemberRowDb[]).forEach((row) => {
          const eventId = row.event_id ?? "";
          if (!eventId) return;
          if (!grouped.has(eventId)) grouped.set(eventId, []);
          grouped.get(eventId)?.push(row);
        });

        endedEventIds.forEach((eventId) => {
          const members = (grouped.get(eventId) ?? []).filter((row) => row.user_id && row.user_id !== me);
          if (!members.length) return;

          members.sort((a, b) => {
            const rank = (status: string | undefined) => (status === "host" ? 0 : status === "going" ? 1 : 2);
            return rank(a.status) - rank(b.status);
          });

          const picked = members.find((row) => connectionByOtherUser.has(row.user_id ?? ""));
          if (!picked?.user_id) return;

          const otherUserId = picked.user_id;
          const connectionId = connectionByOtherUser.get(otherUserId);
          if (!connectionId) return;

          const event = endedEventsById.get(eventId);
          const contextTag: ReferenceContextTag =
            event?.title && /festival|congress/i.test(event.title) ? "festival" : "event";
          if (authoredPairTypeKeys.has(`${contextTag}:${otherUserId}`)) return;
          const profile = resolvedProfileMap[otherUserId];
          const dedupeKey = `${contextTag}:${otherUserId}`;
          if (dedupe.has(dedupeKey)) return;
          dedupe.add(dedupeKey);

          nextCandidates.push({
            key: dedupeKey,
            type: contextTag,
            entityId: eventId,
            connectionId,
            recipientId: otherUserId,
            recipientName: profile?.displayName ?? "Member",
            title: event?.title ?? "Event",
            subtitle: `${profile?.displayName ?? "Member"} • ended ${formatDate(event?.ends_at ?? null)}`,
            endedAt: event?.ends_at ?? "",
          });
        });
      }
    }

    nextCandidates.sort((a, b) => {
      return (parseDate(b.endedAt)?.getTime() ?? 0) - (parseDate(a.endedAt)?.getTime() ?? 0);
    });

    setPendingPromptCount(nextCandidates.length);

    setCandidates(nextCandidates);
    if (nextCandidates.length > 0) {
      if (initialConnectionIdValue) {
        const preferred = nextCandidates.find((item) => item.connectionId === initialConnectionIdValue);
        setSelectedCandidateKey(preferred?.key ?? nextCandidates[0].key);
      } else {
        setSelectedCandidateKey((prev) => prev || nextCandidates[0].key);
      }
    } else {
      setSelectedCandidateKey("");
    }

    setLoading(false);
  }, [initialConnectionIdValue]);

  /* eslint-disable react-hooks/set-state-in-effect -- async loader updates state from backend responses. */
  useEffect(() => {
    void loadAll();
  }, [loadAll]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function submitReference(candidateOverride?: CandidateItem | null) {
    const targetCandidate = candidateOverride ?? selectedCandidate;
    if (!token || !targetCandidate || !body.trim()) {
      setError("Choose an eligible reference target and write your message.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setInfo(null);

    const response = await fetch("/api/references", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        connectionId: targetCandidate.connectionId,
        recipientId: targetCandidate.recipientId,
        referenceRequestId: targetCandidate.promptId ?? null,
        sentiment,
        text: body,
        contextTag: targetCandidate.type,
        entityId: targetCandidate.entityId,
      }),
    });

    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setSubmitting(false);
    if (!response.ok || !json?.ok) {
      setError(json?.error ?? "Failed to submit reference.");
      return;
    }

    setBody("");
    try {
      await loadAll();
    } catch {
      // Keep success feedback visible even if refresh fails on mixed legacy schemas.
    }
    setFeedContextFilter("all");
    setFeedFilter("given");
    setInfo("Reference submitted.");
  }

  async function submitReply(referenceId: string) {
    const text = (replyDraft[referenceId] ?? "").trim();
    if (!token || !text) return;
    setBusyReferenceId(referenceId);
    setError(null);
    setInfo(null);

    const response = await fetch("/api/references", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ mode: "reply", referenceId, replyText: text }),
    });
    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setBusyReferenceId(null);
    if (!response.ok || !json?.ok) {
      setError(json?.error ?? "Failed to save reply.");
      return;
    }
    setReplyDraft((prev) => ({ ...prev, [referenceId]: "" }));
    try {
      await loadAll();
    } catch {
      // Keep success feedback visible even if refresh fails on mixed legacy schemas.
    }
    setInfo("Reply posted.");
  }

  async function submitEdit(referenceId: string) {
    const draft = editDraft[referenceId];
    if (!token || !draft || !draft.body.trim()) return;
    setBusyReferenceId(referenceId);
    setError(null);
    setInfo(null);

    const response = await fetch("/api/references", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mode: "edit",
        referenceId,
        body: draft.body,
        sentiment: draft.sentiment,
      }),
    });
    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setBusyReferenceId(null);
    if (!response.ok || !json?.ok) {
      setError(json?.error ?? "Failed to update reference.");
      return;
    }
    try {
      await loadAll();
    } catch {
      // Keep success feedback visible even if refresh fails on mixed legacy schemas.
    }
    setInfo("Reference updated.");
  }

  async function archiveReference(referenceId: string) {
    if (!token) {
      setError("Please sign in again.");
      return;
    }

    setArchivingReferenceId(referenceId);
    setOpenMenuReferenceId(null);
    setError(null);
    setInfo(null);

    const moveOut = (rows: ReferenceItem[]) => rows.filter((row) => row.id !== referenceId);
    const foundGiven = given.find((row) => row.id === referenceId) ?? null;
    const foundReceived = received.find((row) => row.id === referenceId) ?? null;
    if (foundGiven) {
      setGiven((prev) => prev.filter((row) => row.id !== referenceId));
      setArchivedGiven((prev) => [foundGiven, ...prev.filter((row) => row.id !== referenceId)]);
    }
    if (foundReceived) {
      setReceived((prev) => prev.filter((row) => row.id !== referenceId));
      setArchivedReceived((prev) => [foundReceived, ...prev.filter((row) => row.id !== referenceId)]);
    }

    const response = await fetch("/api/references/archive", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ referenceId }),
    });

    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setArchivingReferenceId(null);
    if (!response.ok || !json?.ok) {
      if (foundGiven) {
        setGiven((prev) => [foundGiven, ...moveOut(prev)]);
        setArchivedGiven((prev) => prev.filter((row) => row.id !== referenceId));
      }
      if (foundReceived) {
        setReceived((prev) => [foundReceived, ...moveOut(prev)]);
        setArchivedReceived((prev) => prev.filter((row) => row.id !== referenceId));
      }
      setError(json?.error ?? "Failed to archive reference.");
      return;
    }
    setInfo("Reference archived.");
  }

  async function unarchiveReference(referenceId: string) {
    if (!token) {
      setError("Please sign in again.");
      return;
    }

    setArchivingReferenceId(referenceId);
    setOpenMenuReferenceId(null);
    setError(null);
    setInfo(null);

    const foundGiven = archivedGiven.find((row) => row.id === referenceId) ?? null;
    const foundReceived = archivedReceived.find((row) => row.id === referenceId) ?? null;
    if (foundGiven) {
      setArchivedGiven((prev) => prev.filter((row) => row.id !== referenceId));
      setGiven((prev) => [foundGiven, ...prev.filter((row) => row.id !== referenceId)]);
    }
    if (foundReceived) {
      setArchivedReceived((prev) => prev.filter((row) => row.id !== referenceId));
      setReceived((prev) => [foundReceived, ...prev.filter((row) => row.id !== referenceId)]);
    }

    const response = await fetch("/api/references/archive", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ referenceId }),
    });

    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setArchivingReferenceId(null);
    if (!response.ok || !json?.ok) {
      if (foundGiven) {
        setGiven((prev) => prev.filter((row) => row.id !== referenceId));
        setArchivedGiven((prev) => [foundGiven, ...prev.filter((row) => row.id !== referenceId)]);
      }
      if (foundReceived) {
        setReceived((prev) => prev.filter((row) => row.id !== referenceId));
        setArchivedReceived((prev) => [foundReceived, ...prev.filter((row) => row.id !== referenceId)]);
      }
      setError(json?.error ?? "Failed to restore reference.");
      return;
    }

    setInfo("Reference restored.");
  }

  function openReferenceReport(referenceId: string) {
    setOpenMenuReferenceId(null);
    router.push(`/references/report/${referenceId}`);
  }

  if (loading) {
    return <ReferencesHubSkeleton />;
  }

  return (
    <div className="w-full space-y-6 text-white">
        {error ? (
          <div
            className="rounded-2xl border border-[#FF00FF]/30 bg-[#FF00FF]/10 px-4 py-4 text-sm text-[#FFC6FA]"
            data-testid="references-error"
          >
            {error}
          </div>
        ) : null}
        {info ? (
          <div
            className="rounded-2xl border border-[#00F5FF]/35 bg-[#00F5FF]/10 px-4 py-4 text-sm text-[#B8FBFF]"
            data-testid="references-info"
          >
            {info}
          </div>
        ) : null}
        <section className="overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))]">
          <div className="flex flex-col divide-y divide-white/10 md:flex-row md:divide-x md:divide-y-0">
            <div className="flex w-full items-center gap-4 px-4 py-5 sm:px-6 md:w-[24%]">
              <div className="w-full text-center">
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/45">References</p>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                  <h3 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{totalReferences}</h3>
                  {pendingPromptCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-300">
                      <span className="material-symbols-outlined text-[14px]">schedule</span>
                      {pendingPromptCount} pending
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex-1 px-4 py-5 sm:px-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/45">Trust Distribution</p>
                <div className="flex flex-wrap items-center gap-4 text-[11px] font-bold">
                  <span className="inline-flex items-center gap-1.5 text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" />{positiveCount} Positive</span>
                  <span className="inline-flex items-center gap-1.5 text-white/55"><span className="h-2 w-2 rounded-full bg-white/35" />{neutralCount} Neutral</span>
                  <span className="inline-flex items-center gap-1.5 text-rose-300"><span className="h-2 w-2 rounded-full bg-rose-400" />{negativeCount} Negative</span>
                </div>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-white/6">
                <div className="bg-emerald-400" style={{ width: `${totalReferences ? (positiveCount / totalReferences) * 100 : 0}%` }} />
                <div className="bg-white/35" style={{ width: `${totalReferences ? (neutralCount / totalReferences) * 100 : 0}%` }} />
                <div className="bg-rose-400" style={{ width: `${totalReferences ? (negativeCount / totalReferences) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="flex w-full items-center justify-end bg-cyan-400/[0.03] px-4 py-5 sm:px-6 md:w-[22%]">
              <div className="w-full text-center">
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/45">Trust Index</p>
                <h3 className="mt-1 text-4xl font-black tracking-tighter text-cyan-300 sm:text-5xl">{trustPercent}%</h3>
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          <aside className="w-full shrink-0 lg:w-64">
            <div className="space-y-8">
              <div>
                <p className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Direction</p>
                <div className="rounded-xl border border-white/10 bg-[#101317] p-1">
                  {([
                    { key: "received", label: "Received", count: received.length },
                    { key: "given", label: "Given", count: given.length },
                    { key: "pending", label: "Pending", count: pendingCount },
                    { key: "archived", label: "Archived", count: archivedReceived.length + archivedGiven.length },
                  ] as const).map((option) => {
                    const selected = feedFilter === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setFeedFilter(option.key)}
                        data-testid={`references-feed-filter-${option.key}`}
                        className={cx(
                          "flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-left text-xs font-bold transition",
                          selected
                            ? option.key === "archived"
                              ? "bg-white/12 text-white"
                              : "bg-cyan-400 text-slate-950"
                            : "text-white/60 hover:bg-white/[0.04] hover:text-white"
                        )}
                      >
                        <span>{option.label}</span>
                        <span
                          className={cx(
                            "rounded-full px-2 py-0.5 text-[10px] font-black",
                            selected
                              ? option.key === "archived"
                                ? "bg-black/25 text-white"
                                : "bg-slate-950/15 text-slate-950"
                              : "border border-white/15 bg-white/[0.03] text-white/75"
                          )}
                        >
                          {option.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Category</p>
                <div className="flex flex-wrap gap-2 lg:flex-col">
                  {(
                    [
                      {
                        key: "all",
                        label: feedFilter === "pending" ? "All Pending" : "All References",
                        count: feedFilter === "pending" ? pendingCount : scopedFeedRows.length,
                      },
                      ...REFERENCE_CONTEXT_TAGS.map((tag) => ({
                        key: tag,
                        label: referenceContextLabel(tag),
                        count: feedFilter === "pending" ? pendingContextCounts[tag] ?? 0 : scopedContextCounts[tag] ?? 0,
                      })),
                    ] as Array<{ key: "all" | ReferenceContextTag; label: string; count: number }>
                  ).map((option) => {
                    const selected = feedFilter === "pending" ? candidateFilter === option.key : feedContextFilter === option.key;
                    return (
                      <button
                        key={`category-${option.key}`}
                        type="button"
                        onClick={() =>
                          feedFilter === "pending"
                            ? setCandidateFilter(option.key as CandidateFilter)
                            : setFeedContextFilter(option.key as "all" | ReferenceContextTag)
                        }
                        className={cx(
                          "flex items-center justify-between rounded-lg border px-4 py-2.5 text-left text-xs font-bold transition lg:w-full",
                          selected
                            ? "border-cyan-400 bg-cyan-400 text-slate-950"
                            : "border-white/10 bg-[#101317] text-white/65 hover:border-white/20 hover:text-white"
                        )}
                      >
                        <span>{option.label}</span>
                        <span className={cx("rounded-full px-1.5 py-0.5 text-[10px] font-black", selected ? "bg-slate-950/15 text-slate-950" : "border border-white/10 bg-black/20 text-white/70")}>
                          {option.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-white/10 pt-6">
                <p className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Resources</p>
                <nav className="space-y-1">
                  <Link href="/support" className="flex items-center gap-3 px-3 py-2 text-xs text-white/45 transition hover:text-cyan-300">
                    <span className="material-symbols-outlined text-sm">help</span>
                    Help Center
                  </Link>
                  <Link
                    href="/safety-center#references-trust"
                    className="flex items-center gap-3 px-3 py-2 text-xs text-white/45 transition hover:text-cyan-300"
                  >
                    <span className="material-symbols-outlined text-sm">policy</span>
                    Trust Guidelines
                  </Link>
                </nav>
              </div>
            </div>
          </aside>

          <div className="min-w-0 flex-1 space-y-4">
            {feedFilter === "pending" ? (
              <div className="grid gap-5 2xl:grid-cols-[340px_minmax(0,1fr)]">
                <article className="rounded-xl border border-white/10 bg-[#121212] p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-[0.14em] text-white/85">Pending References</h3>
                    <p className="mt-1 text-sm text-white/55">Completed activities waiting for your feedback.</p>
                  </div>
                  <span className="rounded-full border border-white/15 bg-white/[0.03] px-2.5 py-1 text-xs font-semibold text-white/65">
                    {visibleCandidates.length}
                  </span>
                </div>

                {visibleCandidateGroups.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {visibleCandidateGroups.map((group) => (
                      <button
                        key={`pending-summary-${group.recipientId}`}
                        type="button"
                        onClick={() => setSelectedCandidateKey(group.items[0]?.key ?? "")}
                        className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-semibold text-white/75 hover:border-[#00F5FF]/25 hover:text-white"
                      >
                        {group.recipientName} · {group.items.length}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="mt-4 max-h-[336px] space-y-4 overflow-y-auto pr-0 sm:pr-1">
                  {visibleCandidateGroups.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/60">
                      No pending references to leave.
                    </div>
                  ) : (
                    visibleCandidateGroups.map((group) => (
                      <div key={`group-${group.recipientId}`} className="space-y-2.5">
                        <div className="flex items-center justify-between gap-3 px-1">
                          <div>
                            <p className="text-sm font-semibold text-white">{group.recipientName}</p>
                            <p className="mt-0.5 text-xs text-white/45">
                              {group.items.length} pending {group.items.length === 1 ? "reference" : "references"}
                            </p>
                          </div>
                          <span className="rounded-full border border-white/15 bg-black/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/65">
                            {formatDate(group.latestEndedAt)}
                          </span>
                        </div>

                        {group.items.map((item) => {
                          const selected = selectedPendingCandidate?.key === item.key;
                          return (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => setSelectedCandidateKey(item.key)}
                              className={cx(
                                "w-full rounded-2xl border px-4 py-3 text-left transition",
                                selected
                                  ? "border-[#00F5FF]/40 bg-[linear-gradient(120deg,rgba(0,245,255,0.12),rgba(255,0,255,0.09))]"
                                  : "border-white/10 bg-black/20 hover:border-[#00F5FF]/25 hover:bg-black/30"
                              )}
                              data-testid="reference-candidate"
                              data-candidate-key={item.key}
                              data-entity-type={candidateEntityType(item.type)}
                              data-entity-id={item.entityId}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-base font-semibold text-white">{item.title}</p>
                                  <p className="mt-1 text-sm text-white/65">{item.subtitle}</p>
                                </div>
                                <span
                                  className={cx(
                                    "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]",
                                    contextTagBadge(item.type)
                                  )}
                                >
                                  {referenceContextShortLabel(item.type)}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              </article>

                <article className="rounded-xl border border-white/10 bg-[#121212] p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-2xl font-bold text-white">Write Reference</h3>
                    <p className="mt-1 text-sm text-white/60">Reference each finalized activity once. Keep it factual and specific.</p>
                    </div>
                  </div>

                {selectedPendingCandidate ? (
                  <>
                    <div className="rounded-xl border border-[#00F5FF]/20 bg-[linear-gradient(135deg,rgba(0,245,255,0.08),rgba(255,255,255,0.02))] px-4 py-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-[#00F5FF]/25 bg-[#00F5FF]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#B8FBFF]">
                          Ready to write
                        </span>
                        <span
                          className={cx(
                            "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]",
                            contextTagBadge(selectedPendingCandidate.type)
                          )}
                        >
                          {referenceContextLabel(selectedPendingCandidate.type)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-lg font-semibold text-white">{selectedPendingCandidate.recipientName}</p>
                          <p className="mt-1 text-sm text-white/65">{selectedPendingCandidate.subtitle}</p>
                        </div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">Finalized activity</p>
                      </div>
                    </div>

                    <div className="mt-4 flex gap-2">
                      {(["positive", "neutral", "negative"] as const).map((option) => (
                        <button
                          key={`sentiment-${option}`}
                          type="button"
                          onClick={() => setSentiment(option)}
                          className={cx(
                            "rounded-full border px-4 py-1.5 text-sm font-semibold transition",
                            sentiment === option
                              ? option === "positive"
                                ? "border-[#00F5FF]/40 bg-[#00F5FF]/14 text-[#B8FBFF]"
                                : option === "negative"
                                ? "border-[#FF00FF]/35 bg-[#FF00FF]/12 text-[#FFC6FA]"
                                : "border-white/30 bg-white/[0.08] text-white"
                              : "border-white/15 bg-black/25 text-white/70 hover:text-white"
                          )}
                          data-testid={`reference-sentiment-${option}`}
                          >
                          {option[0]!.toUpperCase() + option.slice(1)}
                        </button>
                      ))}
                    </div>

                    <textarea
                      rows={6}
                      value={body}
                      maxLength={1200}
                      onChange={(event) => setBody(event.target.value)}
                      className="mt-4 w-full rounded-2xl border border-white/15 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#00F5FF]/35"
                      placeholder="Describe the experience, reliability, communication, respect, and overall quality."
                      data-testid="reference-body-input"
                    />
                    <div className="mt-2 flex justify-end">
                      <span className="text-xs text-white/45">{body.length}/1200</span>
                    </div>

                    <button
                      type="button"
                      disabled={submitting || !body.trim()}
                      onClick={() => void submitReference(selectedPendingCandidate)}
                      className={cx(
                        "mt-4 inline-flex items-center rounded-full bg-[linear-gradient(90deg,#00F5FF,#FF00FF)] px-5 py-2.5 text-base font-bold text-[#0A0A0A] transition",
                        "disabled:cursor-not-allowed disabled:opacity-50"
                      )}
                      data-testid="reference-submit"
                    >
                      {submitting ? "Submitting..." : "Submit Reference"}
                    </button>
                  </>
                ) : (
                <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-white/60">
                    Select a pending interaction on the left to continue.
                  </div>
                )}
                </article>
              </div>
            ) : null}

            {feedFilter !== "pending" ? (
              <article className="space-y-4">
              <div className="space-y-5" data-testid="references-feed">
                {feedItems.length === 0 ? (
                  <div
                    className="rounded-xl border border-dashed border-white/15 bg-black/20 px-4 py-8 text-center text-sm text-white/60"
                    data-testid="references-feed-empty"
                  >
                    No references found for this filter.
                  </div>
                ) : (
                  visibleFeedItems.map((item) => {
                    const partnerId = item.direction === "given" ? item.recipientId : item.authorId;
                    const partner = profilesById[partnerId];
                    const partnerName = partner?.displayName ?? "Member";
                    const replyProfile = profilesById[item.recipientId];
                    const canEdit = item.direction === "given" && item.editCount < 1 && within15Days(item.createdAt);
                    const canReply = item.direction === "received" && !item.replyText && within15Days(item.createdAt);
                    const draft = editDraft[item.id] ?? { body: item.body, sentiment: item.sentiment };
                    const reply = replyDraft[item.id] ?? "";
                    const busy = busyReferenceId === item.id;
                    const hoverBorderClass =
                      referenceContextFamily(item.contextTag) === "practice"
                        ? "hover:border-slate-600"
                        : referenceContextFamily(item.contextTag) === "travel" || referenceContextFamily(item.contextTag) === "festival"
                          ? "hover:border-magenta-500/30"
                          : "hover:border-cyan-400/30";

                    return (
                      <article
                        key={item.id}
                        className={cx(
                          "glass-card rounded-xl border border-slate-800/50 bg-[#121212] p-6 transition-all duration-300",
                          hoverBorderClass
                        )}
                        data-testid="reference-feed-item"
                        data-reference-id={item.id}
                        data-reference-direction={item.direction}
                        data-reference-entity-type={item.contextTag}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex gap-4">
                            <div className="relative">
                              {partner?.avatarUrl ? (
                                <img
                                  src={partner.avatarUrl}
                                  alt={partnerName}
                                  className="h-12 w-12 rounded-full border-2 border-slate-800 object-cover"
                                />
                              ) : (
                                <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-slate-800 bg-white/[0.04] text-sm font-bold text-white">
                                  {initialsFromName(partnerName)}
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-white">{partnerName}</h4>
                                <span
                                  className={cx(
                                    "rounded border px-2 py-0.5 text-[10px] font-black uppercase tracking-tight",
                                    contextTagBadge(item.contextTag)
                                  )}
                                >
                                  {referenceContextLabel(item.contextTag)}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500">{formatDate(item.createdAt)} • {referenceContextShortLabel(item.contextTag)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span
                              className={cx(
                                "material-symbols-outlined",
                                item.sentiment === "positive"
                                  ? "text-emerald-400"
                                  : item.sentiment === "negative"
                                    ? "text-rose-400"
                                    : "text-slate-500"
                              )}
                              style={{ fontVariationSettings: "'FILL' 1" }}
                            >
                              {item.sentiment === "positive"
                                ? "sentiment_very_satisfied"
                                : item.sentiment === "negative"
                                  ? "sentiment_dissatisfied"
                                  : "sentiment_neutral"}
                            </span>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setOpenMenuReferenceId((prev) => (prev === item.id ? null : item.id))}
                                className="text-slate-500 transition-colors hover:text-white"
                                aria-label="Reference options"
                              >
                                <span className="material-symbols-outlined text-lg">more_vert</span>
                              </button>
                              {openMenuReferenceId === item.id ? (
                                <div className="absolute right-0 top-8 z-20 min-w-[180px] rounded-xl border border-white/10 bg-[#101317] p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
                                  {feedFilter === "archived" ? (
                                    <button
                                      type="button"
                                      onClick={() => void unarchiveReference(item.id)}
                                      disabled={archivingReferenceId === item.id}
                                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/75 transition hover:bg-white/[0.04] hover:text-white disabled:opacity-60"
                                    >
                                      <span className="material-symbols-outlined text-[18px]">unarchive</span>
                                      {archivingReferenceId === item.id ? "Restoring..." : "Restore"}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => void archiveReference(item.id)}
                                      disabled={archivingReferenceId === item.id}
                                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/75 transition hover:bg-white/[0.04] hover:text-white disabled:opacity-60"
                                    >
                                      <span className="material-symbols-outlined text-[18px]">inventory_2</span>
                                      {archivingReferenceId === item.id ? "Archiving..." : "Archive"}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => openReferenceReport(item.id)}
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/75 transition hover:bg-white/[0.04] hover:text-white"
                                  >
                                    <span className="material-symbols-outlined text-[18px]">flag</span>
                                    Report reference
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 pl-16">
                          {canEdit ? (
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                {(["positive", "neutral", "negative"] as const).map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() =>
                                      setEditDraft((prev) => ({
                                        ...prev,
                                        [item.id]: { ...draft, sentiment: option },
                                      }))
                                    }
                                    data-testid="reference-edit-sentiment"
                                    data-reference-id={item.id}
                                    data-sentiment={option}
                                    className={cx(
                                      "rounded-full border px-2 py-0.5 text-[11px] uppercase",
                                      draft.sentiment === option
                                        ? "border-[#00F5FF]/35 bg-[#00F5FF]/15 text-[#B8FBFF]"
                                        : "border-white/15 bg-black/25 text-white/70"
                                    )}
                                  >
                                    {option}
                                  </button>
                                ))}
                              </div>
                              <textarea
                                rows={3}
                                value={draft.body}
                                onChange={(e) =>
                                  setEditDraft((prev) => ({
                                    ...prev,
                                    [item.id]: { ...draft, body: e.target.value },
                                  }))
                                }
                                data-testid="reference-edit-input"
                                data-reference-id={item.id}
                                className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-[#00F5FF]/35"
                              />
                              <button
                                type="button"
                                disabled={busy || !draft.body.trim()}
                                onClick={() => void submitEdit(item.id)}
                                data-testid="reference-edit-submit"
                                data-reference-id={item.id}
                                className="rounded-full border border-[#00F5FF]/35 bg-[#00F5FF]/10 px-3 py-1 text-xs font-semibold text-[#B8FBFF] hover:bg-[#00F5FF]/18 disabled:opacity-60"
                              >
                                {busy ? "Saving..." : "Save Edit"}
                              </button>
                            </div>
                          ) : (
                            <p className={cx("text-sm italic leading-relaxed text-slate-300", item.replyText ? "mb-6" : "")}>
                              &ldquo;{item.body}&rdquo;
                            </p>
                          )}

                          {(item.replyText || canReply || canEdit) ? (
                            <div className="mt-4 border-t border-white/10 pt-3">
                              <div className="flex items-center gap-5">
                                {canReply ? (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-white/60 hover:text-white"
                                  >
                                    <span className="material-symbols-outlined text-base">reply</span>
                                    Reply
                                  </button>
                                ) : null}
                              </div>

                              {item.replyText ? (
                                <div className="relative mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                                  <div className="flex gap-4">
                                    <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-slate-800">
                                      {replyProfile?.avatarUrl ? (
                                        <img
                                          src={replyProfile.avatarUrl}
                                          alt={replyProfile.displayName}
                                          className="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center bg-white/[0.04] text-[11px] font-bold text-white">
                                          {initialsFromName(replyProfile?.displayName ?? "You")}
                                        </div>
                                      )}
                                    </div>
                                    <p className="text-xs italic leading-relaxed text-slate-400">
                                      &ldquo;{item.replyText}&rdquo;
                                    </p>
                                  </div>
                                </div>
                              ) : null}

                              {canReply ? (
                                <div className="mt-3 space-y-2">
                                  <textarea
                                    rows={2}
                                    value={reply}
                                    maxLength={REFERENCE_REPLY_MAX_CHARS}
                                    onChange={(e) =>
                                      setReplyDraft((prev) => ({
                                        ...prev,
                                        [item.id]: e.target.value,
                                      }))
                                    }
                                    data-testid="reference-reply-input"
                                    data-reference-id={item.id}
                                    className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-[#00F5FF]/35"
                                    placeholder="Add a short reply..."
                                  />
                                  <div className="flex justify-end">
                                    <span className="text-[11px] text-white/45">
                                      {reply.length}/{REFERENCE_REPLY_MAX_CHARS}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={busy || !reply.trim()}
                                    onClick={() => void submitReply(item.id)}
                                    data-testid="reference-reply-submit"
                                    data-reference-id={item.id}
                                    className="rounded-full border border-[#00F5FF]/35 bg-[#00F5FF]/10 px-3 py-1 text-xs font-semibold text-[#B8FBFF] hover:bg-[#00F5FF]/18 disabled:opacity-60"
                                  >
                                    {busy ? "Saving..." : "Post Reply"}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              {feedItems.length ? (
                <PaginationControls
                  page={currentFeedPage}
                  totalPages={totalFeedPages}
                  totalItems={feedItems.length}
                  pageSize={REFERENCE_FEED_PAGE_SIZE}
                  itemLabel="references"
                  onPageChange={(page) => setFeedPage(Math.max(1, Math.min(page, totalFeedPages)))}
                  className="pt-2"
                />
              ) : null}
              </article>
            ) : null}
          </div>
        </section>
    </div>
  );
}
