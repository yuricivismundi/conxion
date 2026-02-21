"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";
import { fetchVisibleConnections, type VisibleConnectionRow } from "@/lib/connections/read-model";
import {
  FALLBACK_GRADIENT,
  getTripHeroFallbackUrl,
  getTripHeroStorageFolderUrl,
  getTripHeroStorageUrl,
} from "@/lib/city-hero-images";
import {
  type EventMemberRecord,
  type EventRecord,
  type EventRequestRecord,
  mapEventMemberRows,
  mapEventRequestRows,
  mapEventRows,
} from "@/lib/events/model";

type TabKey = "overview" | "references" | "trips" | "sync" | "events";
type ReferenceFilter = "all" | "received" | "given";

type DanceSkill = { level?: string; verified?: boolean };
type DanceSkills = Record<string, DanceSkill>;

type ProfileData = {
  userId: string;
  displayName: string;
  city: string;
  country: string;
  avatarUrl: string | null;
  verified: boolean;
  verifiedLabel: string | null;
  roles: string[];
  languages: string[];
  interests: string[];
  availability: string[];
  danceSkills: DanceSkills;
  bio: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
};

type TripItem = {
  id: string;
  destinationCity: string;
  destinationCountry: string;
  startDate: string;
  endDate: string;
  purpose: string;
  status: string;
  createdAt: string | null;
};

type ReferenceItem = {
  id: string;
  connectionId: string;
  authorId: string;
  recipientId: string;
  context: string;
  sentiment: "positive" | "neutral" | "negative";
  body: string;
  createdAt: string;
  replyBody: string | null;
};

type SyncItem = {
  id: string;
  connectionId: string;
  completedBy: string | null;
  completedAt: string;
  note: string | null;
};

type LiteProfile = {
  userId: string;
  displayName: string;
  city: string;
  country: string;
  avatarUrl: string | null;
};

type ReportsMeta = {
  openAgainstMe: number | null;
  totalAgainstMe: number | null;
};

type ReferenceViewItem = {
  id: string;
  direction: "received" | "given";
  connectionId: string;
  partnerId: string;
  context: string;
  sentiment: "positive" | "neutral" | "negative";
  body: string;
  createdAt: string;
  replyBody: string | null;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function pickString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function pickNullableString(row: Record<string, unknown>, keys: string[]) {
  const value = pickString(row, keys);
  return value || null;
}

function isSentiment(value: unknown): value is "positive" | "neutral" | "negative" {
  return value === "positive" || value === "neutral" || value === "negative";
}

function toIsoDate(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value: string | null | undefined) {
  const d = parseDate(value);
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

function formatDateRange(start: string, end: string) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return "Dates not set";

  const startText = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(startDate);
  const endText = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(endDate);
  return `${startText} - ${endText}`;
}

function formatRelativeTime(value: string | null | undefined) {
  const d = parseDate(value);
  if (!d) return "Not available";
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "Just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function percent(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

function isTripActive(trip: TripItem, todayIso: string) {
  if (trip.status === "inactive") return false;
  if (!trip.endDate) return false;
  return trip.endDate >= todayIso;
}

function mapReferenceRows(rows: unknown[]): ReferenceItem[] {
  return rows
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const sentimentRaw = pickString(row, ["sentiment"]);
      const sentiment = isSentiment(sentimentRaw) ? sentimentRaw : "neutral";
      const createdAt = pickString(row, ["created_at", "inserted_at", "updated_at"]);
      const id = pickString(row, ["id"]);
      const connectionId = pickString(row, ["connection_id", "conn_id"]);
      const authorId = pickString(row, ["author_id", "from_user_id", "created_by"]);
      const recipientId = pickString(row, ["recipient_id", "to_user_id", "target_user_id"]);

      if (!id || !authorId || !recipientId || !createdAt) return null;

      return {
        id,
        connectionId,
        authorId,
        recipientId,
        context: pickString(row, ["context", "reference_type"]) || "connection",
        sentiment,
        body: pickString(row, ["body", "text", "message"]),
        createdAt,
        replyBody: pickNullableString(row, ["reply_body", "author_reply", "reply"]),
      } satisfies ReferenceItem;
    })
    .filter((item): item is ReferenceItem => Boolean(item))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function mapSyncRows(rows: unknown[]): SyncItem[] {
  return rows
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const id = pickString(row, ["id"]);
      const connectionId = pickString(row, ["connection_id", "conn_id"]);
      const completedAt = pickString(row, ["completed_at", "created_at", "updated_at"]);
      if (!id || !connectionId || !completedAt) return null;

      return {
        id,
        connectionId,
        completedBy: pickNullableString(row, ["completed_by", "user_id", "created_by"]),
        completedAt,
        note: pickNullableString(row, ["note", "details"]),
      } satisfies SyncItem;
    })
    .filter((item): item is SyncItem => Boolean(item))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

function mapTripRows(rows: unknown[]): TripItem[] {
  return rows
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const id = pickString(row, ["id"]);
      if (!id) return null;
      return {
        id,
        destinationCity: pickString(row, ["destination_city", "city"]),
        destinationCountry: pickString(row, ["destination_country", "country"]),
        startDate: toIsoDate(pickString(row, ["start_date", "from_date"])),
        endDate: toIsoDate(pickString(row, ["end_date", "to_date"])),
        purpose: pickString(row, ["purpose"]) || "Trip",
        status: pickString(row, ["status"]) || "active",
        createdAt: pickNullableString(row, ["created_at"]),
      } satisfies TripItem;
    })
    .filter((trip): trip is TripItem => Boolean(trip));
}

function pickProfileName(profile: LiteProfile | null | undefined) {
  return profile?.displayName?.trim() || "Unknown member";
}

function sentimentBadge(sentiment: "positive" | "neutral" | "negative") {
  if (sentiment === "positive") {
    return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  }
  if (sentiment === "negative") {
    return "border-rose-400/30 bg-rose-500/10 text-rose-200";
  }
  return "border-slate-400/30 bg-slate-500/10 text-slate-200";
}

async function fetchReferencesByUser(userId: string, role: "author" | "recipient") {
  const column = role === "author" ? "author_id" : "recipient_id";

  const direct = await supabase
    .from("references")
    .select("*")
    .eq(column, userId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (!direct.error) {
    return mapReferenceRows((direct.data ?? []) as unknown[]);
  }

  const fallback = await supabase.from("references").select("*").limit(1000);
  if (fallback.error) return [];

  return mapReferenceRows((fallback.data ?? []) as unknown[]).filter((item) =>
    role === "author" ? item.authorId === userId : item.recipientId === userId
  );
}

async function fetchSyncsByConnections(connectionIds: string[]) {
  if (!connectionIds.length) return [] as SyncItem[];

  const direct = await supabase
    .from("syncs")
    .select("*")
    .in("connection_id", connectionIds)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (!direct.error) {
    return mapSyncRows((direct.data ?? []) as unknown[]);
  }

  const fallback = await supabase.from("syncs").select("*").limit(1000);
  if (fallback.error) return [];

  const idSet = new Set(connectionIds);
  return mapSyncRows((fallback.data ?? []) as unknown[]).filter((item) => idSet.has(item.connectionId));
}

async function fetchReportsMeta(userId: string): Promise<ReportsMeta> {
  const openDirect = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("target_user_id", userId)
    .eq("status", "open");

  const totalDirect = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("target_user_id", userId);

  if (!openDirect.error && !totalDirect.error) {
    return {
      openAgainstMe: openDirect.count ?? 0,
      totalAgainstMe: totalDirect.count ?? 0,
    };
  }

  const fallback = await supabase.from("reports").select("*").limit(2000);
  if (fallback.error) {
    return {
      openAgainstMe: null,
      totalAgainstMe: null,
    };
  }

  const rows = (fallback.data ?? []) as Array<Record<string, unknown>>;
  const againstMe = rows.filter((row) => pickString(row, ["target_user_id"]) === userId);
  const open = againstMe.filter((row) => pickString(row, ["status"]) === "open");

  return {
    openAgainstMe: open.length,
    totalAgainstMe: againstMe.length,
  };
}

export default function MySpacePage() {
  const router = useRouter();
  const [currentTime] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);

  const [connections, setConnections] = useState<VisibleConnectionRow[]>([]);
  const [trips, setTrips] = useState<TripItem[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [eventMemberships, setEventMemberships] = useState<EventMemberRecord[]>([]);
  const [eventRequests, setEventRequests] = useState<EventRequestRecord[]>([]);
  const [referencesReceived, setReferencesReceived] = useState<ReferenceItem[]>([]);
  const [referencesGiven, setReferencesGiven] = useState<ReferenceItem[]>([]);
  const [syncs, setSyncs] = useState<SyncItem[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, LiteProfile>>({});
  const [reportsMeta, setReportsMeta] = useState<ReportsMeta>({ openAgainstMe: null, totalAgainstMe: null });

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [referenceFilter, setReferenceFilter] = useState<ReferenceFilter>("all");

  const [syncBusyConnId, setSyncBusyConnId] = useState<string | null>(null);
  const [syncActionError, setSyncActionError] = useState<string | null>(null);
  const [syncActionInfo, setSyncActionInfo] = useState<string | null>(null);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setSyncActionError(null);
      setSyncActionInfo(null);

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData.user) {
        router.replace("/auth");
        return;
      }

      const userId = authData.user.id;
      if (cancelled) return;

      setMeId(userId);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!cancelled) {
        setAccessToken(sessionData.session?.access_token ?? null);
      }

      const profileRes = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
      if (profileRes.error) {
        if (!cancelled) {
          setError(profileRes.error.message);
          setLoading(false);
        }
        return;
      }

      if (!profileRes.data) {
        router.replace("/onboarding");
        return;
      }

      const profileRow = profileRes.data as Record<string, unknown>;
      const normalizedProfile: ProfileData = {
        userId,
        displayName: pickString(profileRow, ["display_name", "name"]) || "Member",
        city: pickString(profileRow, ["city"]),
        country: pickString(profileRow, ["country"]),
        avatarUrl: pickNullableString(profileRow, ["avatar_url"]),
        verified: profileRow.verified === true,
        verifiedLabel: pickNullableString(profileRow, ["verified_label"]),
        roles: asStringArray(profileRow.roles),
        languages: asStringArray(profileRow.languages),
        interests: asStringArray(profileRow.interests),
        availability: asStringArray(profileRow.availability),
        danceSkills:
          profileRow.dance_skills && typeof profileRow.dance_skills === "object"
            ? (profileRow.dance_skills as DanceSkills)
            : {},
        bio: pickNullableString(profileRow, ["bio", "about"]),
        createdAt: pickNullableString(profileRow, ["created_at"]),
        lastSeenAt: pickNullableString(profileRow, ["last_seen_at"]),
      };

      const [connectionsResult, tripsResult, receivedRefs, givenRefs, reports, hostedEventsRes, myEventMembersRes, myEventRequestsRes] =
        await Promise.all([
        fetchVisibleConnections(supabase, userId).catch(() => [] as VisibleConnectionRow[]),
        supabase
          .from("trips")
          .select("id,user_id,destination_city,destination_country,start_date,end_date,purpose,status,created_at")
          .eq("user_id", userId)
          .order("start_date", { ascending: false })
          .limit(200),
        fetchReferencesByUser(userId, "recipient"),
        fetchReferencesByUser(userId, "author"),
        fetchReportsMeta(userId),
        supabase.from("events").select("*").eq("host_user_id", userId).order("starts_at", { ascending: true }).limit(200),
        supabase.from("event_members").select("*").eq("user_id", userId).in("status", ["host", "going", "waitlist"]).limit(500),
        supabase.from("event_requests").select("*").eq("requester_id", userId).in("status", ["pending", "accepted"]).limit(500),
      ]);

      const tripsData = mapTripRows((tripsResult.data ?? []) as unknown[]);
      const hostedEvents = mapEventRows((hostedEventsRes.data ?? []) as unknown[]);
      const myMemberRows = mapEventMemberRows((myEventMembersRes.data ?? []) as unknown[]);
      const myRequestRows = mapEventRequestRows((myEventRequestsRes.data ?? []) as unknown[]);

      const hostedEventIds = new Set(hostedEvents.map((event) => event.id));
      const relatedEventIds = Array.from(
        new Set([...myMemberRows.map((row) => row.eventId), ...myRequestRows.map((row) => row.eventId)]).values()
      ).filter((id) => Boolean(id) && !hostedEventIds.has(id));

      let relatedEvents: EventRecord[] = [];
      if (relatedEventIds.length > 0) {
        const relatedEventsRes = await supabase.from("events").select("*").in("id", relatedEventIds);
        relatedEvents = mapEventRows((relatedEventsRes.data ?? []) as unknown[]);
      }

      const mergedEventsMap: Record<string, EventRecord> = {};
      [...hostedEvents, ...relatedEvents].forEach((event) => {
        mergedEventsMap[event.id] = event;
      });
      const allMyEvents = Object.values(mergedEventsMap).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

      const acceptedConnectionIds = connectionsResult
        .filter((row) => row.is_accepted_visible)
        .map((row) => row.id)
        .filter(Boolean);

      const syncRows = await fetchSyncsByConnections(acceptedConnectionIds);

      const relevantUserIds = new Set<string>();
      connectionsResult.forEach((row) => {
        if (row.other_user_id) relevantUserIds.add(row.other_user_id);
      });
      receivedRefs.forEach((row) => {
        if (row.authorId && row.authorId !== userId) relevantUserIds.add(row.authorId);
      });
      givenRefs.forEach((row) => {
        if (row.recipientId && row.recipientId !== userId) relevantUserIds.add(row.recipientId);
      });
      allMyEvents.forEach((event) => {
        if (event.hostUserId && event.hostUserId !== userId) relevantUserIds.add(event.hostUserId);
      });

      const ids = Array.from(relevantUserIds);
      const profileMap: Record<string, LiteProfile> = {};
      if (ids.length) {
        const { data: profileRows } = await supabase
          .from("profiles")
          .select("user_id,display_name,city,country,avatar_url")
          .in("user_id", ids);

        (profileRows ?? []).forEach((raw) => {
          const row = (raw ?? {}) as Record<string, unknown>;
          const id = pickString(row, ["user_id"]);
          if (!id) return;
          profileMap[id] = {
            userId: id,
            displayName: pickString(row, ["display_name", "name"]) || "Member",
            city: pickString(row, ["city"]),
            country: pickString(row, ["country"]),
            avatarUrl: pickNullableString(row, ["avatar_url"]),
          };
        });
      }

      if (cancelled) return;

      setProfile(normalizedProfile);
      setConnections(connectionsResult);
      setTrips(tripsData);
      setEvents(allMyEvents);
      setEventMemberships(myMemberRows);
      setEventRequests(myRequestRows);
      setReferencesReceived(receivedRefs);
      setReferencesGiven(givenRefs);
      setSyncs(syncRows);
      setProfilesById(profileMap);
      setReportsMeta(reports);
      setLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const activeTrips = useMemo(
    () => trips.filter((trip) => isTripActive(trip, todayIso)).sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [todayIso, trips]
  );

  const pastTrips = useMemo(
    () => trips.filter((trip) => !isTripActive(trip, todayIso)).sort((a, b) => b.endDate.localeCompare(a.endDate)),
    [todayIso, trips]
  );

  const connectionStats = useMemo(() => {
    const accepted = connections.filter((row) => row.is_accepted_visible);
    const incomingPending = connections.filter((row) => row.is_incoming_pending);
    const outgoingPending = connections.filter((row) => row.is_outgoing_pending);
    const incomingAll = connections.filter((row) => row.target_id === meId);
    const incomingResponded = incomingAll.filter((row) =>
      row.status === "accepted" || row.status === "declined" || row.status === "blocked"
    );

    return {
      accepted,
      incomingPending,
      outgoingPending,
      incomingAllCount: incomingAll.length,
      incomingRespondedCount: incomingResponded.length,
    };
  }, [connections, meId]);

  const syncConnectionIds = useMemo(() => new Set(syncs.map((item) => item.connectionId)), [syncs]);

  const syncPendingCandidates = useMemo(() => {
    return connectionStats.accepted
      .filter((conn) => !syncConnectionIds.has(conn.id))
      .slice(0, 12)
      .map((conn) => ({
        connectionId: conn.id,
        otherUserId: conn.other_user_id,
        tripId: conn.trip_id,
        tripCity: conn.trip_destination_city,
        tripCountry: conn.trip_destination_country,
        tripStart: conn.trip_start_date,
      }));
  }, [connectionStats.accepted, syncConnectionIds]);

  const upcomingSyncs = useMemo(() => {
    return connectionStats.accepted
      .filter((conn) => Boolean(conn.trip_id) && Boolean(conn.trip_start_date) && (conn.trip_start_date ?? "") >= todayIso)
      .sort((a, b) => (a.trip_start_date ?? "").localeCompare(b.trip_start_date ?? ""))
      .slice(0, 20);
  }, [connectionStats.accepted, todayIso]);

  const referenceFeed = useMemo(() => {
    const received: ReferenceViewItem[] = referencesReceived.map((item) => ({
      id: item.id,
      direction: "received",
      connectionId: item.connectionId,
      partnerId: item.authorId,
      context: item.context,
      sentiment: item.sentiment,
      body: item.body,
      createdAt: item.createdAt,
      replyBody: item.replyBody,
    }));

    const given: ReferenceViewItem[] = referencesGiven.map((item) => ({
      id: item.id,
      direction: "given",
      connectionId: item.connectionId,
      partnerId: item.recipientId,
      context: item.context,
      sentiment: item.sentiment,
      body: item.body,
      createdAt: item.createdAt,
      replyBody: item.replyBody,
    }));

    const merged = [...received, ...given].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (referenceFilter === "received") return merged.filter((item) => item.direction === "received");
    if (referenceFilter === "given") return merged.filter((item) => item.direction === "given");
    return merged;
  }, [referenceFilter, referencesGiven, referencesReceived]);

  const trustStats = useMemo(() => {
    const total = referencesReceived.length;
    const positive = referencesReceived.filter((item) => item.sentiment === "positive").length;
    const neutral = referencesReceived.filter((item) => item.sentiment === "neutral").length;
    const negative = referencesReceived.filter((item) => item.sentiment === "negative").length;
    const trustScore = total > 0 ? Math.round(((positive + neutral * 0.5) / total) * 100) : 0;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const refsThisMonth = referencesReceived.filter((item) => {
      const date = parseDate(item.createdAt);
      return date ? date >= monthStart : false;
    }).length;

    return {
      total,
      positive,
      neutral,
      negative,
      trustScore,
      positivePct: percent(positive, total),
      neutralPct: percent(neutral, total),
      negativePct: percent(negative, total),
      refsThisMonth,
    };
  }, [referencesReceived]);

  const profileCompletion = useMemo(() => {
    if (!profile) return 0;

    const checks = [
      Boolean(profile.displayName.trim()),
      Boolean(profile.avatarUrl),
      Boolean(profile.city.trim()),
      Boolean(profile.country.trim()),
      profile.roles.length > 0,
      profile.languages.length > 0,
      profile.interests.length > 0,
      Object.keys(profile.danceSkills).length > 0,
    ];

    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [profile]);

  const socialLinksCount = useMemo(() => {
    if (!profile) return 0;
    const row = [profile.bio, ...profile.availability].filter(Boolean);
    return row.length;
  }, [profile]);

  const responseRate = useMemo(() => {
    if (connectionStats.incomingAllCount === 0) return null;
    return Math.round((connectionStats.incomingRespondedCount / connectionStats.incomingAllCount) * 100);
  }, [connectionStats.incomingAllCount, connectionStats.incomingRespondedCount]);

  const statusBadge = useMemo(() => {
    if (activeTrips.length > 0) return "On Trip";
    if (connectionStats.incomingPending.length > 0) return "Accepting Sync";
    return "Open to Connect";
  }, [activeTrips.length, connectionStats.incomingPending.length]);

  const danceStyles = useMemo(() => {
    if (!profile) return [] as Array<{ style: string; level: string; verified: boolean }>;

    const keys = Object.keys(profile.danceSkills);
    return keys
      .map((style) => {
        const skill = profile.danceSkills[style] ?? {};
        return {
          style,
          level: asString(skill.level),
          verified: skill.verified === true,
        };
      })
      .sort((a, b) => a.style.localeCompare(b.style));
  }, [profile]);

  const tripsThisYear = useMemo(() => {
    const year = new Date().getFullYear();
    return trips.filter((trip) => {
      const date = parseDate(trip.createdAt) ?? parseDate(trip.startDate);
      return date ? date.getFullYear() === year : false;
    }).length;
  }, [trips]);

  const eventMembershipByEvent = useMemo(() => {
    const map: Record<string, EventMemberRecord> = {};
    eventMemberships.forEach((membership) => {
      map[membership.eventId] = membership;
    });
    return map;
  }, [eventMemberships]);

  const eventRequestByEvent = useMemo(() => {
    const map: Record<string, EventRequestRecord> = {};
    eventRequests.forEach((request) => {
      map[request.eventId] = request;
    });
    return map;
  }, [eventRequests]);

  const eventsTimeline = useMemo(() => {
    if (!meId) return [] as Array<{
      event: EventRecord;
      relation: "hosted" | "going" | "waitlist" | "requested";
      statusLabel: string;
    }>;

    return events
      .map((event) => {
        if (event.hostUserId === meId) {
          return { event, relation: "hosted" as const, statusLabel: "Hosted" };
        }

        const membership = eventMembershipByEvent[event.id];
        if (membership?.status === "going") {
          return { event, relation: "going" as const, statusLabel: "Going" };
        }
        if (membership?.status === "waitlist") {
          return { event, relation: "waitlist" as const, statusLabel: "Waitlist" };
        }

        const request = eventRequestByEvent[event.id];
        if (request?.status === "pending" || request?.status === "accepted") {
          return {
            event,
            relation: "requested" as const,
            statusLabel: request.status === "accepted" ? "Approved" : "Requested",
          };
        }

        return null;
      })
      .filter((item): item is { event: EventRecord; relation: "hosted" | "going" | "waitlist" | "requested"; statusLabel: string } =>
        Boolean(item)
      )
      .sort((a, b) => a.event.startsAt.localeCompare(b.event.startsAt));
  }, [eventMembershipByEvent, eventRequestByEvent, events, meId]);

  const hostedEventsCount = useMemo(() => {
    return eventsTimeline.filter((item) => item.relation === "hosted").length;
  }, [eventsTimeline]);

  const goingEventsCount = useMemo(() => {
    return eventsTimeline.filter((item) => item.relation === "going" || item.relation === "waitlist").length;
  }, [eventsTimeline]);

  const requestedEventsCount = useMemo(() => {
    return eventsTimeline.filter((item) => item.relation === "requested").length;
  }, [eventsTimeline]);

  async function markSyncCompleted(connectionId: string) {
    if (!accessToken) {
      setSyncActionError("Missing auth session. Please sign in again.");
      return;
    }

    setSyncBusyConnId(connectionId);
    setSyncActionError(null);
    setSyncActionInfo(null);

    const response = await fetch("/api/syncs/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ connectionId }),
    });

    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

    if (!response.ok || !json?.ok) {
      setSyncActionError(json?.error ?? "Failed to mark sync completed.");
      setSyncBusyConnId(null);
      return;
    }

    const reloaded = await fetchSyncsByConnections(connectionStats.accepted.map((row) => row.id));
    setSyncs(reloaded);
    setSyncBusyConnId(null);
    setSyncActionInfo("Sync marked as completed.");
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A] text-white">Loading...</div>;
  }

  if (!profile || !meId) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[1180px] px-4 py-8">
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
            {error ?? "Unable to load your profile."}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-slate-100">
      <Nav />

      <main className="mx-auto w-full max-w-[1260px] px-4 pb-14 pt-6 sm:px-6 lg:px-8">
        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        <section className="overflow-hidden rounded-[28px] border border-cyan-200/10 bg-[#0b1a1d]/70 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="relative h-44 w-full sm:h-56">
            <div className="absolute inset-0 bg-[linear-gradient(125deg,rgba(17,113,127,0.48),rgba(164,41,187,0.35))]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.28),transparent_50%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(236,72,153,0.22),transparent_56%)]" />
            <div className="absolute bottom-4 right-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.push("/me/edit")}
                className="rounded-xl border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/25"
              >
                Edit Profile
              </button>
              <Link
                href="/references"
                className="rounded-xl border border-white/20 bg-black/30 px-4 py-2 text-sm font-medium text-white/85 hover:bg-black/45"
              >
                Manage References
              </Link>
            </div>
          </div>

          <div className="relative px-4 pb-6 sm:px-6 lg:px-8">
            <div className="-mt-16 flex flex-col gap-5 sm:-mt-20 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 items-end gap-4">
                <div className="h-28 w-28 overflow-hidden rounded-full border-4 border-[#071316] bg-[#11272b] shadow-[0_12px_36px_rgba(0,0,0,0.55)] sm:h-36 sm:w-36">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="Profile" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm text-white/55">No photo</div>
                  )}
                </div>

                <div className="min-w-0 pb-1">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-2xl font-bold text-white sm:text-3xl">{profile.displayName}</h1>
                    {profile.verified ? (
                      <span className="material-symbols-outlined text-cyan-300" title="Verified">
                        verified
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1 text-sm text-slate-300">
                    {[profile.city, profile.country].filter(Boolean).join(", ") || "Location not set"}
                  </p>

                  <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-100">
                    <span className="h-2 w-2 rounded-full bg-cyan-300" />
                    {statusBadge}
                  </div>
                </div>
              </div>

              {profile.verifiedLabel ? (
                <div className="rounded-full border border-fuchsia-300/35 bg-fuchsia-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-fuchsia-100">
                  {profile.verifiedLabel}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-left hover:border-cyan-300/35 hover:bg-white/[0.06]"
          >
            <p className="text-xs uppercase tracking-wide text-slate-400">Connections</p>
            <p className="mt-1 text-2xl font-bold text-white">{connectionStats.accepted.length}</p>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("references")}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-left hover:border-cyan-300/35 hover:bg-white/[0.06]"
          >
            <p className="text-xs uppercase tracking-wide text-slate-400">References</p>
            <p className="mt-1 text-2xl font-bold text-white">{trustStats.total}</p>
            <p className="mt-1 text-xs text-emerald-300">+{trustStats.refsThisMonth} this month</p>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("trips")}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-left hover:border-cyan-300/35 hover:bg-white/[0.06]"
          >
            <p className="text-xs uppercase tracking-wide text-slate-400">Active Trips</p>
            <p className="mt-1 text-2xl font-bold text-white">{activeTrips.length}</p>
            <p className="mt-1 text-xs text-slate-400">{trips.length} total trips</p>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("sync")}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-left hover:border-cyan-300/35 hover:bg-white/[0.06]"
          >
            <p className="text-xs uppercase tracking-wide text-slate-400">Sync Activities</p>
            <p className="mt-1 text-2xl font-bold text-white">{syncs.length}</p>
            <p className="mt-1 text-xs text-slate-400">{syncPendingCandidates.length} pending completion</p>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("events")}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-left hover:border-cyan-300/35 hover:bg-white/[0.06]"
          >
            <p className="text-xs uppercase tracking-wide text-slate-400">Events</p>
            <p className="mt-1 text-2xl font-bold text-white">{eventsTimeline.length}</p>
            <p className="mt-1 text-xs text-slate-400">{hostedEventsCount} hosted</p>
          </button>
        </section>

        <div className="mt-6 border-b border-white/10">
          <div className="no-scrollbar flex overflow-x-auto">
            {[
              { key: "overview", label: "Overview" },
              { key: "references", label: "References" },
              { key: "trips", label: "Trips" },
              { key: "sync", label: "Sync Activity" },
              { key: "events", label: "Events" },
            ].map((tab) => {
              const selected = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key as TabKey)}
                  className={cx(
                    "relative px-4 py-3 text-sm font-semibold",
                    selected ? "text-cyan-200" : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  {tab.label}
                  {selected ? (
                    <span className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-cyan-300" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,360px)]">
          <section className="space-y-6">
            {activeTab === "overview" ? (
              <>
                <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-white">About</h2>
                    <Link href="/me/edit" className="text-sm font-medium text-cyan-200 hover:text-cyan-100">
                      Edit
                    </Link>
                  </div>

                  <p className="text-sm leading-relaxed text-slate-300">
                    {profile.bio?.trim() || "No bio yet. Update your profile to add your dance story."}
                  </p>

                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Dance Styles</h3>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {danceStyles.length ? (
                          danceStyles.map((item) => (
                            <span
                              key={item.style}
                              className="inline-flex items-center gap-1 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100"
                            >
                              {item.style}
                              {item.level ? <span className="text-cyan-300/80">({item.level})</span> : null}
                              {item.verified ? (
                                <span className="material-symbols-outlined text-[14px] text-cyan-200">verified</span>
                              ) : null}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-slate-400">No styles added.</span>
                        )}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Roles & Languages</h3>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {profile.roles.length ? (
                          profile.roles.map((role) => (
                            <span
                              key={role}
                              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-200"
                            >
                              {role}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-slate-400">No roles selected.</span>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {profile.languages.length ? (
                          profile.languages.map((language) => (
                            <span
                              key={language}
                              className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-slate-300"
                            >
                              {language}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-slate-400">No languages selected.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </article>

                <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                  <h2 className="mb-5 text-lg font-bold text-white">Trust Snapshot</h2>

                  <div className="space-y-4">
                    <div>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="text-slate-300">Positive</span>
                        <span className="font-semibold text-emerald-200">{trustStats.positivePct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800">
                        <div className="h-2 rounded-full bg-emerald-400/80" style={{ width: `${trustStats.positivePct}%` }} />
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="text-slate-300">Neutral</span>
                        <span className="font-semibold text-slate-200">{trustStats.neutralPct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800">
                        <div className="h-2 rounded-full bg-slate-400/70" style={{ width: `${trustStats.neutralPct}%` }} />
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="text-slate-300">Negative</span>
                        <span className="font-semibold text-rose-200">{trustStats.negativePct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800">
                        <div className="h-2 rounded-full bg-rose-400/70" style={{ width: `${trustStats.negativePct}%` }} />
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Total Refs</p>
                      <p className="mt-1 text-xl font-bold text-white">{trustStats.total}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Trust Score</p>
                      <p className="mt-1 text-xl font-bold text-cyan-200">{trustStats.trustScore}%</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Member Since</p>
                      <p className="mt-1 text-sm font-semibold text-white">{formatDate(profile.createdAt)}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Profile Completion</p>
                      <p className="mt-1 text-sm font-semibold text-white">{profileCompletion}%</p>
                    </div>
                  </div>
                </article>

                <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                  <h2 className="mb-4 text-lg font-bold text-white">Activity Summary</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Last Active</p>
                      <p className="mt-1 text-sm font-semibold text-white">{formatRelativeTime(profile.lastSeenAt)}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Trips This Year</p>
                      <p className="mt-1 text-sm font-semibold text-white">{tripsThisYear}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Syncs Completed</p>
                      <p className="mt-1 text-sm font-semibold text-white">{syncs.length}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Response Rate</p>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {responseRate === null ? "Not enough data" : `${responseRate}%`}
                      </p>
                    </div>
                  </div>
                </article>

                <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-white">My Events</h2>
                    <Link
                      href="/events"
                      className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/25"
                    >
                      Explore Events
                    </Link>
                  </div>

                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Hosted</p>
                      <p className="mt-1 text-xl font-bold text-white">{hostedEventsCount}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Going / Waitlist</p>
                      <p className="mt-1 text-xl font-bold text-white">{goingEventsCount}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Requested</p>
                      <p className="mt-1 text-xl font-bold text-white">{requestedEventsCount}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {eventsTimeline.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                        No event activity yet.
                      </div>
                    ) : (
                      eventsTimeline.slice(0, 5).map((item) => {
                        const endTs = new Date(item.event.endsAt).getTime();
                        const eventEnded = !Number.isNaN(endTs) && endTs <= currentTime;
                        const canFeedback = eventEnded && (item.relation === "hosted" || item.relation === "going" || item.relation === "waitlist");

                        return (
                          <div key={item.event.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-white">{item.event.title}</p>
                                <p className="text-xs text-slate-400">
                                  {[item.event.city, item.event.country].filter(Boolean).join(", ")}
                                  {" • "}
                                  {formatDate(item.event.startsAt)}
                                </p>
                              </div>
                              <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                                {item.statusLabel}
                              </span>
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Link
                                href={`/events/${item.event.id}`}
                                className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-white/[0.1]"
                              >
                                View
                              </Link>
                              {item.event.hostUserId === meId ? (
                                <>
                                  <Link
                                    href={`/events/${item.event.id}/inbox`}
                                    className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-white/[0.1]"
                                  >
                                    Inbox
                                  </Link>
                                  <Link
                                    href={`/events/${item.event.id}/edit`}
                                    className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-white/[0.1]"
                                  >
                                    Edit
                                  </Link>
                                </>
                              ) : null}
                              {canFeedback ? (
                                <Link
                                  href={`/events/${item.event.id}#feedback`}
                                  className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                                >
                                  Feedback
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </article>
              </>
            ) : null}

            {activeTab === "references" ? (
              <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-lg font-bold text-white">References</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    {([
                      { key: "all", label: "All" },
                      { key: "received", label: "Received" },
                      { key: "given", label: "Given" },
                    ] as const).map((option) => {
                      const selected = referenceFilter === option.key;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setReferenceFilter(option.key)}
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

                <div className="mb-4 flex items-center justify-between rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm text-cyan-50">
                  <span>References can be created after sync completion.</span>
                  <Link href="/references" className="font-semibold text-cyan-100 hover:text-cyan-50">
                    Leave a reference
                  </Link>
                </div>

                <div className="space-y-3">
                  {referenceFeed.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                      No references for this filter.
                    </div>
                  ) : (
                    referenceFeed.map((item) => {
                      const partner = profilesById[item.partnerId];
                      return (
                        <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span className="font-semibold text-slate-200">
                              {item.direction === "received" ? "From" : "To"}: {pickProfileName(partner)}
                            </span>
                            <span>•</span>
                            <span>{formatDate(item.createdAt)}</span>
                            <span>•</span>
                            <span className="uppercase">{item.context || "connection"}</span>
                            <span
                              className={cx(
                                "rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase",
                                sentimentBadge(item.sentiment)
                              )}
                            >
                              {item.sentiment}
                            </span>
                          </div>

                          <p className="text-sm leading-relaxed text-slate-200">{item.body || "No text provided."}</p>

                          {item.replyBody ? (
                            <div className="mt-3 rounded-xl border border-cyan-300/25 bg-cyan-300/10 p-3 text-sm text-cyan-50">
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-cyan-100/90">Reply</p>
                              <p>{item.replyBody}</p>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </article>
            ) : null}

            {activeTab === "trips" ? (
              <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">Trips</h2>
                  <Link
                    href="/connections"
                    className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/25"
                  >
                    Create trip
                  </Link>
                </div>

                <div className="space-y-4">
                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-slate-200">Active Trips</h3>
                    <div className="space-y-3">
                      {activeTrips.length === 0 ? (
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                          No active trips.
                        </div>
                      ) : (
                        activeTrips.map((trip) => {
                          const hero =
                            getTripHeroStorageFolderUrl(trip.destinationCountry) ||
                            getTripHeroStorageUrl(trip.destinationCountry) ||
                            getTripHeroFallbackUrl(trip.destinationCity, trip.destinationCountry);
                          return (
                            <div key={trip.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                              <div className="relative h-28 w-full bg-slate-800">
                                {hero ? (
                                  <img
                                    src={hero}
                                    alt={`${trip.destinationCity}, ${trip.destinationCountry}`}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="h-full w-full" style={{ background: FALLBACK_GRADIENT }} />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-[#060b0d] via-transparent to-transparent" />
                              </div>

                              <div className="p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-base font-semibold text-white">
                                      {[trip.destinationCity, trip.destinationCountry].filter(Boolean).join(", ") || "Destination not set"}
                                    </p>
                                    <p className="text-xs text-slate-400">{formatDateRange(trip.startDate, trip.endDate)}</p>
                                  </div>
                                  <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">
                                    {trip.purpose}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-slate-200">Past Trips</h3>
                    <div className="space-y-2">
                      {pastTrips.length === 0 ? (
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                          No past trips.
                        </div>
                      ) : (
                        pastTrips.map((trip) => (
                          <div key={trip.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-white">
                                  {[trip.destinationCity, trip.destinationCountry].filter(Boolean).join(", ") || "Destination not set"}
                                </p>
                                <p className="text-xs text-slate-400">{formatDateRange(trip.startDate, trip.endDate)}</p>
                              </div>
                              <span className="rounded-full border border-white/15 bg-white/[0.05] px-3 py-1 text-xs text-slate-300">
                                {trip.purpose}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              </article>
            ) : null}

            {activeTab === "sync" ? (
              <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <h2 className="mb-4 text-lg font-bold text-white">Sync Activity</h2>

                {syncActionError ? (
                  <div className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                    {syncActionError}
                  </div>
                ) : null}
                {syncActionInfo ? (
                  <div className="mb-3 rounded-xl border border-cyan-300/30 bg-cyan-300/10 p-3 text-sm text-cyan-50">
                    {syncActionInfo}
                  </div>
                ) : null}

                <div className="space-y-6">
                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-slate-200">Upcoming Syncs</h3>
                    <div className="space-y-2">
                      {upcomingSyncs.length === 0 ? (
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                          No upcoming syncs linked to trips.
                        </div>
                      ) : (
                        upcomingSyncs.map((conn) => {
                          const partner = profilesById[conn.other_user_id];
                          return (
                            <div key={conn.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                              <p className="text-sm font-semibold text-white">{pickProfileName(partner)}</p>
                              <p className="text-xs text-slate-400">
                                {[conn.trip_destination_city, conn.trip_destination_country].filter(Boolean).join(", ") || "Trip"}
                                {conn.trip_start_date ? ` • Starts ${formatDate(conn.trip_start_date)}` : ""}
                              </p>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-slate-200">Pending Sync Completion</h3>
                    <div className="space-y-2">
                      {syncPendingCandidates.length === 0 ? (
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                          All accepted connections already have a completed sync.
                        </div>
                      ) : (
                        syncPendingCandidates.map((item) => {
                          const partner = profilesById[item.otherUserId];
                          return (
                            <div key={item.connectionId} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold text-white">{pickProfileName(partner)}</p>
                                  <p className="text-xs text-slate-400">
                                    {[item.tripCity, item.tripCountry].filter(Boolean).join(", ") || "Connection sync"}
                                    {item.tripStart ? ` • ${formatDate(item.tripStart)}` : ""}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void markSyncCompleted(item.connectionId)}
                                  disabled={syncBusyConnId === item.connectionId}
                                  className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/25 disabled:opacity-60"
                                >
                                  {syncBusyConnId === item.connectionId ? "Saving..." : "Mark complete"}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-slate-200">Completed Syncs</h3>
                    <div className="space-y-2">
                      {syncs.length === 0 ? (
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                          No completed syncs yet.
                        </div>
                      ) : (
                        syncs.map((sync) => {
                          const conn = connectionStats.accepted.find((row) => row.id === sync.connectionId);
                          const partner = conn ? profilesById[conn.other_user_id] : null;
                          return (
                            <div key={sync.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                              <p className="text-sm font-semibold text-white">{pickProfileName(partner)}</p>
                              <p className="text-xs text-slate-400">Completed {formatDate(sync.completedAt)}</p>
                              {sync.note ? <p className="mt-1 text-xs text-slate-300">{sync.note}</p> : null}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-slate-200">Pending Sync Requests</h3>
                    <div className="space-y-2">
                      {connectionStats.incomingPending.length === 0 ? (
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                          No pending connection requests.
                        </div>
                      ) : (
                        connectionStats.incomingPending.map((conn) => {
                          const partner = profilesById[conn.other_user_id];
                          return (
                            <div key={conn.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                              <p className="text-sm font-semibold text-white">{pickProfileName(partner)}</p>
                              <p className="text-xs text-slate-400">Pending since {formatDate(conn.created_at)}</p>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>
                </div>
              </article>
            ) : null}

            {activeTab === "events" ? (
              <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">Events</h2>
                  <Link
                    href="/events/new"
                    className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/25"
                  >
                    Create Event
                  </Link>
                </div>

                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Hosted</p>
                    <p className="mt-1 text-xl font-bold text-white">{hostedEventsCount}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Going / Waitlist</p>
                    <p className="mt-1 text-xl font-bold text-white">{goingEventsCount}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Requested</p>
                    <p className="mt-1 text-xl font-bold text-white">{requestedEventsCount}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {eventsTimeline.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                      You have no event activity yet.
                    </div>
                  ) : (
                    eventsTimeline.map((item) => {
                      const endTs = new Date(item.event.endsAt).getTime();
                      const eventEnded = !Number.isNaN(endTs) && endTs <= currentTime;
                      const canFeedback = eventEnded && (item.relation === "hosted" || item.relation === "going" || item.relation === "waitlist");

                      return (
                        <div key={item.event.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-lg font-semibold text-white">{item.event.title}</p>
                              <p className="text-xs text-slate-400">
                                {[item.event.city, item.event.country].filter(Boolean).join(", ")}
                                {" • "}
                                {formatDate(item.event.startsAt)}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                                {item.statusLabel}
                              </span>
                              <Link
                                href={`/events/${item.event.id}`}
                                className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-white/[0.1]"
                              >
                                View
                              </Link>
                              {item.event.hostUserId === meId ? (
                                <>
                                  <Link
                                    href={`/events/${item.event.id}/inbox`}
                                    className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-white/[0.1]"
                                  >
                                    Inbox
                                  </Link>
                                  <Link
                                    href={`/events/${item.event.id}/edit`}
                                    className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-white/[0.1]"
                                  >
                                    Edit
                                  </Link>
                                </>
                              ) : null}
                              {canFeedback ? (
                                <Link
                                  href={`/events/${item.event.id}#feedback`}
                                  className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                                >
                                  Feedback
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </article>
            ) : null}
          </section>

          <aside className="space-y-5">
            <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-300">Verification</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Identity verified</span>
                  <span className={profile.verified ? "text-emerald-300" : "text-slate-500"}>
                    {profile.verified ? "Active" : "Not verified"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Roles set</span>
                  <span className="text-slate-200">{profile.roles.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Languages set</span>
                  <span className="text-slate-200">{profile.languages.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Profile completion</span>
                  <span className="text-cyan-200">{profileCompletion}%</span>
                </div>
              </div>
            </article>

            <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-300">Response Metrics</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Response rate</span>
                  <span className="text-slate-100">{responseRate === null ? "Not enough data" : `${responseRate}%`}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Incoming pending</span>
                  <span className="text-slate-100">{connectionStats.incomingPending.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Outgoing pending</span>
                  <span className="text-slate-100">{connectionStats.outgoingPending.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Total sync records</span>
                  <span className="text-slate-100">{syncs.length}</span>
                </div>
              </div>
            </article>

            <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-300">Account Status</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Open reports</span>
                  <span className="text-slate-100">
                    {reportsMeta.openAgainstMe === null ? "Not available" : reportsMeta.openAgainstMe}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Total reports</span>
                  <span className="text-slate-100">
                    {reportsMeta.totalAgainstMe === null ? "Not available" : reportsMeta.totalAgainstMe}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Interests set</span>
                  <span className="text-slate-100">{profile.interests.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Availability entries</span>
                  <span className="text-slate-100">{socialLinksCount}</span>
                </div>
              </div>
            </article>
          </aside>
        </div>
      </main>
    </div>
  );
}
