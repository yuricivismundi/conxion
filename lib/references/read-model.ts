import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mapActivityTypeToPublicReferenceCategory,
  type PublicReferenceCategory,
} from "@/lib/references/anti-spam";
import { normalizeActivityType } from "@/lib/activities/types";

export const REFERENCE_AUTHOR_COLUMNS = ["author_id"] as const;
export const REFERENCE_RECIPIENT_COLUMNS = ["recipient_id"] as const;
export const REFERENCE_MEMBER_COLUMNS = [...REFERENCE_AUTHOR_COLUMNS, ...REFERENCE_RECIPIENT_COLUMNS] as const;

export type ReferenceMemberColumn = (typeof REFERENCE_MEMBER_COLUMNS)[number];
export type InteractionCounterCategory =
  | "Practice"
  | "Social Dance"
  | "Event / Festival"
  | "Travelling"
  | "Request Hosting"
  | "Offer Hosting"
  | "Collaborate"
  | "Classes";

export type InteractionCounterItem = {
  category: InteractionCounterCategory;
  count: number;
};

type ReferenceDirection = "received" | "given";

type ReferenceStatRow = {
  authorId: string;
  recipientId: string;
  sentiment: "positive" | "neutral" | "negative";
  direction: ReferenceDirection;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asDirection(value: unknown): ReferenceDirection {
  return value === "given" ? "given" : "received";
}

function normalizeCategory(value: unknown): InteractionCounterCategory | null {
  const mapped = mapActivityTypeToPublicReferenceCategory(asString(value));
  if (
    mapped === "Practice" ||
    mapped === "Social Dance" ||
    mapped === "Event / Festival" ||
    mapped === "Travelling" ||
    mapped === "Request Hosting" ||
    mapped === "Offer Hosting" ||
    mapped === "Collaborate" ||
    mapped === "Classes"
  ) {
    return mapped;
  }
  return null;
}

function counterTypeToCategory(value: string): InteractionCounterCategory | null {
  switch (value.trim().toLowerCase()) {
    case "practice_count":
      return "Practice";
    case "social_dance_count":
      return "Social Dance";
    case "event_festival_count":
    case "event_count":
      return "Event / Festival";
    case "travelling_count":
    case "travel_count":
      return "Travelling";
    case "request_hosting_count":
      return "Request Hosting";
    case "offer_hosting_count":
    case "hosted_count":
      return "Offer Hosting";
    case "collaborate_count":
    case "collaboration_count":
      return "Collaborate";
    case "classes_count":
    case "private_class_count":
      return "Classes";
    default:
      return null;
  }
}

function categoryOrder(category: InteractionCounterCategory) {
  switch (category) {
    case "Practice":
      return 0;
    case "Classes":
      return 1;
    case "Social Dance":
      return 2;
    case "Event / Festival":
      return 3;
    case "Travelling":
      return 4;
    case "Request Hosting":
      return 5;
    case "Offer Hosting":
      return 6;
    case "Collaborate":
      return 7;
    default:
      return 99;
  }
}

function isReferenceSchemaCompatError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("column") ||
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("relation")
  );
}

function dedupeReferenceRows(rows: Array<Record<string, unknown>>) {
  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const id = asString(row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
  }

  return merged;
}

export async function fetchReferencesForMember(
  client: SupabaseClient,
  params: {
    memberId: string;
    select?: string;
    columns?: readonly ReferenceMemberColumn[];
    perColumnLimit?: number;
    ascending?: boolean;
  }
) {
  const columns = params.columns ?? REFERENCE_MEMBER_COLUMNS;
  const select = params.select ?? "*";
  const perColumnLimit = Math.max(1, params.perColumnLimit ?? 400);
  const ascending = params.ascending ?? false;
  const overallLimit = perColumnLimit * columns.length;
  const filter = columns.map((column) => `${column}.eq.${params.memberId}`).join(",");

  const combinedRes = await client
    .from("references")
    .select(select)
    .or(filter)
    .order("created_at", { ascending })
    .limit(overallLimit);

  if (!combinedRes.error) {
    return dedupeReferenceRows(((combinedRes.data ?? []) as unknown[]).map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => Boolean(row)));
  }

  if (!isReferenceSchemaCompatError(combinedRes.error.message)) {
    throw combinedRes.error;
  }

  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const column of columns) {
    const res = await client
      .from("references")
      .select(select)
      .eq(column, params.memberId)
      .order("created_at", { ascending })
      .limit(perColumnLimit);

    if (res.error) {
      if (isReferenceSchemaCompatError(res.error.message)) continue;
      throw res.error;
    }

    for (const raw of (res.data ?? []) as unknown[]) {
      const row = asRecord(raw);
      if (!row) continue;
      const id = asString(row.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
    }
  }

  merged.sort((a, b) => {
    const aCreatedAt = asString(a.created_at);
    const bCreatedAt = asString(b.created_at);
    return ascending ? aCreatedAt.localeCompare(bCreatedAt) : bCreatedAt.localeCompare(aCreatedAt);
  });

  return merged;
}

export function getReferenceStatsForProfile(rows: ReferenceStatRow[]) {
  const totals = {
    total: rows.length,
    received: 0,
    given: 0,
    positive: 0,
    neutral: 0,
    negative: 0,
    uniqueMembers: 0,
  };
  const uniqueAuthors = new Set<string>();
  for (const row of rows) {
    totals[row.direction] += 1;
    totals[row.sentiment] += 1;
    if (row.direction === "received" && row.authorId) {
      uniqueAuthors.add(row.authorId);
    }
  }
  totals.uniqueMembers = uniqueAuthors.size;
  return totals;
}

export function collapsePublicReferencesByAuthor<T extends {
  authorId: string;
  recipientId: string;
  direction: ReferenceDirection;
  createdAt: string;
}>(rows: T[]) {
  const latestByGroup = new Map<string, T>();
  const hiddenCountByGroup = new Map<string, number>();

  for (const row of rows) {
    const groupKey = row.direction === "received" ? `received:${row.authorId}` : `given:${row.recipientId}`;
    const existing = latestByGroup.get(groupKey);
    if (!existing) {
      latestByGroup.set(groupKey, row);
      hiddenCountByGroup.set(groupKey, 0);
      continue;
    }
    if (row.createdAt > existing.createdAt) {
      latestByGroup.set(groupKey, row);
      hiddenCountByGroup.set(groupKey, (hiddenCountByGroup.get(groupKey) ?? 0) + 1);
    } else {
      hiddenCountByGroup.set(groupKey, (hiddenCountByGroup.get(groupKey) ?? 0) + 1);
    }
  }

  return Array.from(latestByGroup.entries())
    .map(([groupKey, row]) => ({
      ...row,
      groupKey,
      hiddenCount: hiddenCountByGroup.get(groupKey) ?? 0,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function deriveInteractionCountsFromLiveData(client: SupabaseClient, memberId: string) {
  const counts = new Map<InteractionCounterCategory, number>();
  const bump = (category: InteractionCounterCategory | null) => {
    if (!category) return;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  };

  const activitiesRes = await client
    .from("activities")
    .select("id,activity_type,status,requester_id,recipient_id")
    .or(`requester_id.eq.${memberId},recipient_id.eq.${memberId}`)
    .in("status", ["completed"]);
  if (!activitiesRes.error) {
    for (const row of (activitiesRes.data ?? []) as Array<Record<string, unknown>>) {
      bump(normalizeCategory(row.activity_type));
    }
  }

  const syncsRes = await client
    .from("connection_syncs")
    .select("id,sync_type,status,requester_id,recipient_id,completed_at")
    .or(`requester_id.eq.${memberId},recipient_id.eq.${memberId}`)
    .eq("status", "completed");
  if (!syncsRes.error) {
    for (const row of (syncsRes.data ?? []) as Array<Record<string, unknown>>) {
      const syncType = asString(row.sync_type).toLowerCase();
      if (syncType === "social_dancing") {
        bump("Social Dance");
      } else if (syncType === "private_class" || syncType === "workshop") {
        bump("Classes");
      } else {
        bump("Practice");
      }
    }
  }

  const tripReqsRes = await client
    .from("trip_requests")
    .select("id,requester_id,status,trips:trip_id(id,user_id,end_date)")
    .eq("status", "accepted")
    .eq("requester_id", memberId);
  if (!tripReqsRes.error) {
    for (const row of (tripReqsRes.data ?? []) as Array<Record<string, unknown>>) {
      const trip = row.trips && typeof row.trips === "object" ? (row.trips as Record<string, unknown>) : null;
      const endDate = asNullableString(trip?.end_date);
      if (endDate && endDate <= new Date().toISOString().slice(0, 10)) {
        bump("Travelling");
      }
    }
  }

  const hostedTripsRes = await client
    .from("trips")
    .select("id,user_id,end_date")
    .eq("user_id", memberId)
    .lte("end_date", new Date().toISOString().slice(0, 10));
  if (!hostedTripsRes.error) {
    const tripIds = ((hostedTripsRes.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => asString(row.id))
      .filter(Boolean);
    if (tripIds.length > 0) {
      const incomingReqsRes = await client
        .from("trip_requests")
        .select("id")
        .eq("status", "accepted")
        .in("trip_id", tripIds);
      if (!incomingReqsRes.error) {
        for (const _row of (incomingReqsRes.data ?? []) as Array<Record<string, unknown>>) {
          bump("Travelling");
        }
      }
    }
  }

  const hostingRes = await client
    .from("hosting_requests")
    .select("id,sender_user_id,recipient_user_id,request_type,status,departure_date")
    .or(`sender_user_id.eq.${memberId},recipient_user_id.eq.${memberId}`)
    .eq("status", "accepted")
    .lte("departure_date", new Date().toISOString().slice(0, 10));
  if (!hostingRes.error) {
    for (const row of (hostingRes.data ?? []) as Array<Record<string, unknown>>) {
      const senderId = asString(row.sender_user_id);
      const recipientId = asString(row.recipient_user_id);
      const requestType = asString(row.request_type).toLowerCase();
      const isHost =
        (requestType === "request_hosting" && recipientId === memberId) ||
        (requestType === "offer_to_host" && senderId === memberId);
      bump(isHost ? "Offer Hosting" : "Request Hosting");
    }
  }

  const eventMembersRes = await client
    .from("event_members")
    .select("event_id,status")
    .eq("user_id", memberId)
    .in("status", ["host", "going", "waitlist"]);
  if (!eventMembersRes.error) {
    const eventIds = ((eventMembersRes.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => asString(row.event_id))
      .filter(Boolean);
    if (eventIds.length > 0) {
      const eventsRes = await client
        .from("events")
        .select("id")
        .in("id", eventIds)
        .lt("ends_at", new Date().toISOString());
      if (!eventsRes.error) {
        for (const _row of (eventsRes.data ?? []) as Array<Record<string, unknown>>) {
          bump("Event / Festival");
        }
      }
    }
  }

  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .filter((item) => item.count > 0)
    .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category));
}

export async function getInteractionCountsForProfile(client: SupabaseClient, memberId: string) {
  const res = await client
    .from("member_interaction_counters")
    .select("counter_type,count")
    .eq("user_id", memberId)
    .gt("count", 0);

  if (!res.error && (res.data?.length ?? 0) > 0) {
    const mapped = ((res.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => {
        const category = counterTypeToCategory(asString(row.counter_type));
        const count = typeof row.count === "number" ? row.count : Number(row.count ?? 0);
        if (!category || !Number.isFinite(count) || count <= 0) return null;
        return { category, count } satisfies InteractionCounterItem;
      })
      .filter((item): item is InteractionCounterItem => Boolean(item))
      .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category));
    if (mapped.length > 0) {
      return mapped;
    }
  }

  return deriveInteractionCountsFromLiveData(client, memberId);
}
