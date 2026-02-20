"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";
import { fetchVisibleConnections } from "@/lib/connections/read-model";

type CandidateType = "sync" | "trip" | "event";
type Sentiment = "positive" | "neutral" | "negative";
type FeedFilter = "all" | "received" | "given";
type CandidateFilter = "all" | CandidateType;

type LiteProfile = {
  userId: string;
  displayName: string;
  city: string;
  country: string;
};

type CandidateItem = {
  key: string;
  type: CandidateType;
  entityId: string;
  connectionId: string;
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
  context: string;
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
      const context = pickText(row, ["context", "entity_type"]) || "connection";
      const entityType = pickText(row, ["entity_type", "context"]).toLowerCase() || (row.sync_id ? "sync" : "connection");
      const entityId = pickNullableText(row, ["entity_id", "sync_id"]);
      const replyText = pickNullableText(row, ["reply_text", "reply", "response_text", "reply_body"]);

      return {
        id,
        authorId,
        recipientId,
        sentiment,
        body,
        context,
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
  if (sentiment === "positive") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  if (sentiment === "negative") return "border-rose-400/30 bg-rose-500/10 text-rose-100";
  return "border-slate-400/30 bg-slate-500/10 text-slate-100";
}

function entityTypeBadge(entityType: string) {
  const key = entityType.toLowerCase();
  if (key === "sync") return "border-cyan-300/35 bg-cyan-300/15 text-cyan-100";
  if (key === "trip") return "border-fuchsia-300/35 bg-fuchsia-400/15 text-fuchsia-100";
  if (key === "event") return "border-amber-300/35 bg-amber-300/15 text-amber-100";
  return "border-slate-300/25 bg-slate-400/10 text-slate-100";
}

function ReferencesPageContent() {
  const searchParams = useSearchParams();
  const initialConnectionId = (searchParams.get("connectionId") ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);

  const [profilesById, setProfilesById] = useState<Record<string, LiteProfile>>({});
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string>("");
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>("all");
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");

  const [sentiment, setSentiment] = useState<Sentiment>("positive");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [given, setGiven] = useState<ReferenceItem[]>([]);
  const [received, setReceived] = useState<ReferenceItem[]>([]);

  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [editDraft, setEditDraft] = useState<Record<string, { body: string; sentiment: Sentiment }>>({});
  const [busyReferenceId, setBusyReferenceId] = useState<string | null>(null);

  const selectedCandidate = useMemo(
    () => candidates.find((item) => item.key === selectedCandidateKey) ?? null,
    [candidates, selectedCandidateKey]
  );

  const visibleCandidates = useMemo(() => {
    if (candidateFilter === "all") return candidates;
    return candidates.filter((item) => item.type === candidateFilter);
  }, [candidateFilter, candidates]);

  const feedItems = useMemo(() => {
    const rows = [
      ...received.map((item) => ({ ...item, direction: "received" as const })),
      ...given.map((item) => ({ ...item, direction: "given" as const })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (feedFilter === "all") return rows;
    if (feedFilter === "received") return rows.filter((item) => item.direction === "received");
    return rows.filter((item) => item.direction === "given");
  }, [feedFilter, given, received]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) {
      setError("Please sign in first.");
      setLoading(false);
      return;
    }

    const me = authData.user.id;
    setMeId(me);

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
        .select("user_id,display_name,city,country")
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
        text.includes("column")
      );
    };

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
    setGiven(givenRows);
    setReceived(receivedRows);

    const authoredEntityKeys = new Set<string>();
    givenRows.forEach((row) => {
      if (row.entityType && row.entityId) {
        authoredEntityKeys.add(`${row.entityType}:${row.entityId}`);
      }
    });

    const cutoffIso = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const cutoffDate = cutoffIso.slice(0, 10);
    const nowIso = new Date().toISOString();
    const todayDate = nowIso.slice(0, 10);

    const nextCandidates: CandidateItem[] = [];
    const dedupe = new Set<string>();

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
        if (authoredEntityKeys.has(`sync:${syncId}`)) return;

        const dedupeKey = `sync:${syncId}:${otherUserId}`;
        if (dedupe.has(dedupeKey)) return;
        dedupe.add(dedupeKey);

        const profile = profileMap[otherUserId];
        nextCandidates.push({
          key: dedupeKey,
          type: "sync",
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
          if (authoredEntityKeys.has(`trip:${requestId}`)) return;

          const trip = myTripsById.get(tripId);
          const profile = profileMap[requesterId];
          const dedupeKey = `trip:${requestId}:${requesterId}`;
          if (dedupe.has(dedupeKey)) return;
          dedupe.add(dedupeKey);

          nextCandidates.push({
            key: dedupeKey,
            type: "trip",
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
        if (authoredEntityKeys.has(`trip:${requestId}`)) return;

        const ownerProfile = profileMap[ownerId];
        const dedupeKey = `trip:${requestId}:${ownerId}`;
        if (dedupe.has(dedupeKey)) return;
        dedupe.add(dedupeKey);

        nextCandidates.push({
          key: dedupeKey,
          type: "trip",
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
          if (authoredEntityKeys.has(`event:${eventId}`)) return;
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
          const profile = profileMap[otherUserId];
          const dedupeKey = `event:${eventId}:${otherUserId}`;
          if (dedupe.has(dedupeKey)) return;
          dedupe.add(dedupeKey);

          nextCandidates.push({
            key: dedupeKey,
            type: "event",
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
      const typeRank = (type: CandidateType) => (type === "sync" ? 0 : type === "trip" ? 1 : 2);
      const byType = typeRank(a.type) - typeRank(b.type);
      if (byType !== 0) return byType;
      return (parseDate(b.endedAt)?.getTime() ?? 0) - (parseDate(a.endedAt)?.getTime() ?? 0);
    });

    setCandidates(nextCandidates);
    if (nextCandidates.length > 0) {
      if (initialConnectionId) {
        const preferred = nextCandidates.find((item) => item.connectionId === initialConnectionId);
        setSelectedCandidateKey(preferred?.key ?? nextCandidates[0].key);
      } else {
        setSelectedCandidateKey((prev) => prev || nextCandidates[0].key);
      }
    } else {
      setSelectedCandidateKey("");
    }

    setLoading(false);
  }, [initialConnectionId]);

  /* eslint-disable react-hooks/set-state-in-effect -- async loader updates state from backend responses. */
  useEffect(() => {
    void loadAll();
  }, [loadAll]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function submitReference() {
    if (!token || !selectedCandidate || !body.trim()) {
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
        connectionId: selectedCandidate.connectionId,
        recipientId: selectedCandidate.recipientId,
        sentiment,
        body,
        entityType: selectedCandidate.type,
        entityId: selectedCandidate.entityId,
        context: selectedCandidate.type,
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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#10272b,_#071316_45%,_#05090b_100%)] text-white">
      <Nav />

      <main className="mx-auto w-full max-w-[1180px] px-4 pb-14 pt-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-black text-white" data-testid="references-page-title">
                References Hub
              </h1>
              <p className="mt-1 text-sm text-slate-300">
                Leave references only for completed syncs, ended trips, and ended events in the last 15 days.
              </p>
            </div>
            <div className="text-xs text-slate-400">
              {meId ? `Signed in as ${profilesById[meId]?.displayName ?? "Member"}` : "Sign in required"}
            </div>
          </div>

        {loading ? (
          <div className="mt-4 text-sm text-slate-300" data-testid="references-loading">
            Loading references data...
          </div>
        ) : null}
        {error ? (
          <div
            className="mt-4 rounded-xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
            data-testid="references-error"
          >
            {error}
          </div>
        ) : null}
        {info ? (
          <div
            className="mt-4 rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100"
            data-testid="references-info"
          >
            {info}
          </div>
        ) : null}
      </section>

      <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
          <article className="rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-4" data-testid="references-candidates-panel">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-300">Eligible Targets</h2>
              <span className="rounded-full border border-white/20 bg-black/25 px-2 py-0.5 text-[10px] text-slate-300">
                {candidates.length}
              </span>
            </div>

            <div className="mb-3 flex gap-2 overflow-x-auto">
              {([
                { key: "all", label: "All" },
                { key: "sync", label: "Syncs" },
                { key: "trip", label: "Trips" },
                { key: "event", label: "Events" },
              ] as const).map((option) => {
                const selected = candidateFilter === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setCandidateFilter(option.key)}
                    data-testid={`references-candidates-filter-${option.key}`}
                    className={cx(
                      "rounded-full border px-3 py-1 text-xs font-semibold",
                      selected
                        ? "border-cyan-300/35 bg-cyan-300/15 text-cyan-100"
                        : "border-white/15 bg-black/25 text-slate-300 hover:text-white"
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
              {visibleCandidates.length === 0 ? (
                <div
                  className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300"
                  data-testid="references-candidates-empty"
                >
                  No eligible references available.
                </div>
              ) : (
                visibleCandidates.map((item) => {
                  const selected = selectedCandidateKey === item.key;
                  return (
                    <button
                    key={item.key}
                    type="button"
                    onClick={() => setSelectedCandidateKey(item.key)}
                    data-testid="reference-candidate"
                    data-candidate-key={item.key}
                    data-entity-type={item.type}
                    data-entity-id={item.entityId}
                    data-recipient-id={item.recipientId}
                    className={cx(
                      "w-full rounded-xl border p-3 text-left transition-colors",
                      selected
                          ? "border-cyan-300/35 bg-cyan-300/10"
                          : "border-white/10 bg-black/20 hover:border-cyan-300/25"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-white">{item.title}</p>
                        <span className={cx("rounded-full border px-2 py-0.5 text-[10px] uppercase", entityTypeBadge(item.type))}>
                          {item.type}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-300">{item.subtitle}</p>
                    </button>
                  );
                })
              )}
            </div>
          </article>

          <article className="rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-4" data-testid="references-compose-panel">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-300">Write Reference</h2>

            {!selectedCandidate ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                Select an eligible target to continue.
              </div>
            ) : (
              <>
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4">
                  <p className="sr-only" data-testid="reference-selected-target">
                    Selected target
                  </p>
                  <p className="text-sm font-semibold text-white">{selectedCandidate.title}</p>
                  <p className="mt-1 text-xs text-slate-300">{selectedCandidate.subtitle}</p>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {([
                    { key: "positive", label: "Positive" },
                    { key: "neutral", label: "Neutral" },
                    { key: "negative", label: "Negative" },
                  ] as const).map((option) => {
                    const selected = sentiment === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setSentiment(option.key)}
                        data-testid={`reference-sentiment-${option.key}`}
                        className={cx(
                          "rounded-full border px-3 py-1 text-xs font-semibold",
                          selected
                            ? "border-cyan-300/35 bg-cyan-300/15 text-cyan-100"
                            : "border-white/15 bg-black/25 text-slate-300 hover:text-white"
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={5}
                  maxLength={1000}
                  data-testid="reference-body-input"
                  className="mt-3 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/35"
                  placeholder="Describe the experience, reliability, and quality..."
                />

                <button
                  type="button"
                  onClick={() => void submitReference()}
                  disabled={submitting || !body.trim()}
                  data-testid="reference-submit"
                  className="mt-3 rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-[#052328] hover:bg-cyan-200 disabled:opacity-60"
                >
                  {submitting ? "Submitting..." : "Submit Reference"}
                </button>
              </>
            )}

            <div className="mt-6 border-t border-white/10 pt-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">Reference Feed</h3>
                <div className="flex gap-2">
                  {([
                    { key: "all", label: "All" },
                    { key: "received", label: "Received" },
                    { key: "given", label: "Given" },
                  ] as const).map((option) => {
                    const selected = feedFilter === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setFeedFilter(option.key)}
                        data-testid={`references-feed-filter-${option.key}`}
                        className={cx(
                          "rounded-full border px-3 py-1 text-xs font-semibold",
                          selected
                            ? "border-cyan-300/35 bg-cyan-300/15 text-cyan-100"
                            : "border-white/15 bg-black/25 text-slate-300 hover:text-white"
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1" data-testid="references-feed">
                {feedItems.length === 0 ? (
                  <div
                    className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300"
                    data-testid="references-feed-empty"
                  >
                    No references yet.
                  </div>
                ) : (
                  feedItems.map((item) => {
                    const partnerId = item.direction === "given" ? item.recipientId : item.authorId;
                    const partnerName = profilesById[partnerId]?.displayName ?? "Member";
                    const canEdit = item.direction === "given" && item.editCount < 1 && within15Days(item.createdAt);
                    const canReply = item.direction === "received" && !item.replyText && within15Days(item.createdAt);
                    const draft = editDraft[item.id] ?? { body: item.body, sentiment: item.sentiment };
                    const reply = replyDraft[item.id] ?? "";
                    const busy = busyReferenceId === item.id;

                    return (
                      <article
                        key={item.id}
                        className="rounded-xl border border-white/10 bg-black/20 p-3"
                        data-testid="reference-feed-item"
                        data-reference-id={item.id}
                        data-reference-direction={item.direction}
                        data-reference-entity-type={item.entityType}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-white">
                            {item.direction === "given" ? `To ${partnerName}` : `From ${partnerName}`}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={cx("rounded-full border px-2 py-0.5 text-[10px] uppercase", sentimentBadge(item.sentiment))}>
                              {item.sentiment}
                            </span>
                            <span className={cx("rounded-full border px-2 py-0.5 text-[10px] uppercase", entityTypeBadge(item.entityType))}>
                              {item.entityType}
                            </span>
                            <span className="text-xs text-slate-400">{formatDate(item.createdAt)}</span>
                          </div>
                        </div>

                        {canEdit ? (
                          <div className="mt-3 space-y-2">
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
                                      ? "border-cyan-300/35 bg-cyan-300/15 text-cyan-100"
                                      : "border-white/15 bg-black/25 text-slate-300"
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
                              className="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/35"
                            />
                            <button
                              type="button"
                              disabled={busy || !draft.body.trim()}
                              onClick={() => void submitEdit(item.id)}
                              data-testid="reference-edit-submit"
                              data-reference-id={item.id}
                              className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
                            >
                              {busy ? "Saving..." : "Save Edit"}
                            </button>
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-slate-100">{item.body}</p>
                        )}

                        {item.replyText ? (
                          <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs text-slate-200">
                            <span className="font-semibold text-white">Reply:</span> {item.replyText}
                          </div>
                        ) : null}

                        {canReply ? (
                          <div className="mt-3 space-y-2">
                            <textarea
                              rows={2}
                              value={reply}
                              maxLength={400}
                              onChange={(e) =>
                                setReplyDraft((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              data-testid="reference-reply-input"
                              data-reference-id={item.id}
                              className="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/35"
                              placeholder="Add a short reply..."
                            />
                            <button
                              type="button"
                              disabled={busy || !reply.trim()}
                              onClick={() => void submitReply(item.id)}
                              data-testid="reference-reply-submit"
                              data-reference-id={item.id}
                              className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
                            >
                              {busy ? "Saving..." : "Post Reply"}
                            </button>
                          </div>
                        ) : null}
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}

function ReferencesPageFallback() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />
      <main className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
          Loading references...
        </div>
      </main>
    </div>
  );
}

export default function ReferencesPage() {
  return (
    <Suspense fallback={<ReferencesPageFallback />}>
      <ReferencesPageContent />
    </Suspense>
  );
}
