import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuidLike } from "@/lib/profile-username";
import { normalizeReferenceContextTag, type ReferenceContextTag } from "@/lib/activities/types";
import {
  addDaysIso,
  getReferenceCooldownDays,
  getReferenceRuleForCategory,
  isPerActivityReferenceCategory,
  mapReferenceContextTagToPublicCategory,
  mapPublicActivityCategoryToReferenceFamily,
  referenceSourceTypeForOrigin,
  type PublicReferenceCategory,
  type ReferenceFamily,
  type ReferenceSourceType,
} from "@/lib/references/anti-spam";

type AnyClient = SupabaseClient;

type CompletionSource =
  | {
      completed: true;
      completedAt: string;
      publicCategory: PublicReferenceCategory;
      sourceType: ReferenceSourceType;
    }
  | {
      completed: false;
      reason: string;
      publicCategory: PublicReferenceCategory;
      sourceType: ReferenceSourceType;
    };

type PairReferenceRow = {
  id: string;
  createdAt: string;
  publicCategory: PublicReferenceCategory;
  referenceFamily: ReferenceFamily;
  sourceType: string | null;
  sourceId: string | null;
};

export type ReferenceEligibilityResult = {
  allowed: boolean;
  reason?: string;
  next_allowed_at?: string | null;
  publicCategory: PublicReferenceCategory;
  referenceFamily: ReferenceFamily;
  sourceType: ReferenceSourceType;
  sourceId: string | null;
  sourceCompletedAt: string | null;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIso(value: unknown) {
  const text = normalizeText(value);
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function completedDatePlus24Hours(value: unknown) {
  const iso = normalizeIso(value);
  if (!iso) return "";
  const parsed = new Date(iso);
  return new Date(parsed.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function eligibleStatusesForEventMembership(value: unknown) {
  const status = normalizeText(value).toLowerCase();
  return status === "host" || status === "going" || status === "waitlist";
}

async function fetchPairReferenceRows(params: {
  supabase: AnyClient;
  authorUserId: string;
  recipientUserId: string;
}) {
  const merged = new Map<string, PairReferenceRow>();
  const authorColumns = ["author_id"];
  const recipientColumns = ["recipient_id"];
  const select =
    "id,created_at,public_category,reference_family,source_type,source_id,context_tag,entity_id,sync_id";

  for (const authorColumn of authorColumns) {
    for (const recipientColumn of recipientColumns) {
      const res = await params.supabase
        .from("references")
        .select(select)
        .eq(authorColumn, params.authorUserId)
        .eq(recipientColumn, params.recipientUserId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (res.error) {
        const message = (res.error.message ?? "").toLowerCase();
        if (
          message.includes("schema cache") ||
          message.includes("column") ||
          message.includes("relation") ||
          message.includes("does not exist")
        ) {
          continue;
        }
        throw new Error(res.error.message);
      }

      for (const raw of (res.data ?? []) as Array<Record<string, unknown>>) {
        const id = normalizeText(raw.id);
        if (!id || merged.has(id)) continue;
        const publicCategory =
          mapReferenceContextTagToPublicCategory(
            normalizeText(raw.context_tag) || normalizeText(raw.public_category) || "collaborate"
          );
        const referenceFamily =
          (normalizeText(raw.reference_family) as ReferenceFamily) ||
          mapPublicActivityCategoryToReferenceFamily(publicCategory);
        const sourceType = normalizeText(raw.source_type) || null;
        const sourceId =
          normalizeText(raw.source_id) ||
          normalizeText(raw.entity_id) ||
          normalizeText(raw.sync_id) ||
          null;
        const createdAt = normalizeIso(raw.created_at) || new Date(0).toISOString();
        merged.set(id, {
          id,
          createdAt,
          publicCategory,
          referenceFamily,
          sourceType,
          sourceId,
        });
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function resolveCompletedSource(params: {
  supabase: AnyClient;
  authorUserId: string;
  recipientUserId: string;
  contextTag: ReferenceContextTag;
  sourceTable: string;
  sourceId: string;
}): Promise<CompletionSource> {
  const publicCategory = mapReferenceContextTagToPublicCategory(params.contextTag);
  const sourceType = referenceSourceTypeForOrigin({
    contextTag: params.contextTag,
    sourceTable: params.sourceTable,
  });
  const sourceTable = params.sourceTable.trim().toLowerCase();

  if (!params.sourceId || !isUuidLike(params.sourceId)) {
    return {
      completed: false,
      reason: "References are only available for completed activities with a valid source.",
      publicCategory,
      sourceType,
    };
  }

  if (sourceTable === "activities") {
    const res = await params.supabase
      .from("activities")
      .select("id,requester_id,recipient_id,activity_type,status,completed_at")
      .eq("id", params.sourceId)
      .maybeSingle();
    if (res.error || !res.data) {
      return {
        completed: false,
        reason: "References are only available after the activity is completed.",
        publicCategory,
        sourceType,
      };
    }
    const row = res.data as Record<string, unknown>;
    const requesterId = normalizeText(row.requester_id);
    const recipientId = normalizeText(row.recipient_id);
    const status = normalizeText(row.status).toLowerCase();
    const activityCategory = mapReferenceContextTagToPublicCategory(normalizeReferenceContextTag(normalizeText(row.activity_type)));
    const samePair =
      (requesterId === params.authorUserId && recipientId === params.recipientUserId) ||
      (requesterId === params.recipientUserId && recipientId === params.authorUserId);
    if (!samePair || activityCategory !== publicCategory || status !== "completed") {
      return {
        completed: false,
        reason: "References are only available after the activity is completed.",
        publicCategory,
        sourceType,
      };
    }
    return {
      completed: true,
      completedAt: normalizeIso(row.completed_at) || new Date().toISOString(),
      publicCategory: activityCategory,
      sourceType,
    };
  }

  if (sourceTable === "connection_syncs") {
    const res = await params.supabase
      .from("connection_syncs")
      .select("id,requester_id,recipient_id,status,sync_type,completed_at")
      .eq("id", params.sourceId)
      .maybeSingle();
    if (res.error || !res.data) {
      return {
        completed: false,
        reason: "References are only available after the activity is completed.",
        publicCategory,
        sourceType,
      };
    }
    const row = res.data as Record<string, unknown>;
    const requesterId = normalizeText(row.requester_id);
    const recipientId = normalizeText(row.recipient_id);
    const status = normalizeText(row.status).toLowerCase();
    const syncType = normalizeText(row.sync_type).toLowerCase();
    const syncCategory =
      syncType === "social_dancing"
        ? "Social Dance"
        : syncType === "workshop" || syncType === "private_class"
          ? "Classes"
          : "Practice";
    const samePair =
      (requesterId === params.authorUserId && recipientId === params.recipientUserId) ||
      (requesterId === params.recipientUserId && recipientId === params.authorUserId);
    if (!samePair || status !== "completed" || syncCategory !== publicCategory) {
      return {
        completed: false,
        reason: "References are only available after the activity is completed.",
        publicCategory,
        sourceType,
      };
    }
    return {
      completed: true,
      completedAt: normalizeIso(row.completed_at) || new Date().toISOString(),
      publicCategory: syncCategory as PublicReferenceCategory,
      sourceType,
    };
  }

  if (sourceTable === "trip_requests") {
    const res = await params.supabase
      .from("trip_requests")
      .select("id,requester_id,status,trip_id,trips:trip_id(id,user_id,end_date)")
      .eq("id", params.sourceId)
      .maybeSingle();
    if (res.error || !res.data) {
      return {
        completed: false,
        reason: "References are only available after the activity is completed.",
        publicCategory,
        sourceType,
      };
    }
    const row = res.data as Record<string, unknown>;
    const requesterId = normalizeText(row.requester_id);
    const status = normalizeText(row.status).toLowerCase();
    const trip = row.trips && typeof row.trips === "object" ? (row.trips as Record<string, unknown>) : null;
    const ownerId = normalizeText(trip?.user_id);
    const dueAt = completedDatePlus24Hours(trip?.end_date);
    const samePair =
      (requesterId === params.authorUserId && ownerId === params.recipientUserId) ||
      (requesterId === params.recipientUserId && ownerId === params.authorUserId);
    if (!samePair || status !== "accepted" || !dueAt || dueAt > new Date().toISOString()) {
      return {
        completed: false,
        reason: "References are only available after the activity is completed.",
        publicCategory,
        sourceType,
      };
    }
    return {
      completed: true,
      completedAt: dueAt,
      publicCategory,
      sourceType,
    };
  }

  if (sourceTable === "hosting_requests") {
    const res = await params.supabase
      .from("hosting_requests")
      .select("id,sender_user_id,recipient_user_id,request_type,status,departure_date")
      .eq("id", params.sourceId)
      .maybeSingle();
    if (res.error || !res.data) {
      return {
        completed: false,
        reason: "References are only available after the activity is completed.",
        publicCategory,
        sourceType,
      };
    }
    const row = res.data as Record<string, unknown>;
    const senderId = normalizeText(row.sender_user_id);
    const recipientId = normalizeText(row.recipient_user_id);
    const requestType = normalizeText(row.request_type).toLowerCase();
    const status = normalizeText(row.status).toLowerCase();
    const dueAt = completedDatePlus24Hours(row.departure_date);
    const samePair =
      (senderId === params.authorUserId && recipientId === params.recipientUserId) ||
      (senderId === params.recipientUserId && recipientId === params.authorUserId);
    const isOfferCategory =
      (requestType === "request_hosting" && recipientId === params.authorUserId) ||
      (requestType === "offer_to_host" && senderId === params.authorUserId);
    const expectedCategory: PublicReferenceCategory = isOfferCategory ? "Offer Hosting" : "Request Hosting";
    if (!samePair || status !== "accepted" || !dueAt || dueAt > new Date().toISOString() || expectedCategory !== publicCategory) {
      return {
        completed: false,
        reason: "References are only available after the activity is completed.",
        publicCategory,
        sourceType,
      };
    }
    return {
      completed: true,
      completedAt: dueAt,
      publicCategory,
      sourceType,
    };
  }

  if (sourceTable === "events") {
    const eventRes = await params.supabase
      .from("events")
      .select("id,ends_at")
      .eq("id", params.sourceId)
      .maybeSingle();
    if (eventRes.error || !eventRes.data) {
      return {
        completed: false,
        reason: "References are only available after the activity is completed.",
        publicCategory,
        sourceType,
      };
    }
    const eventRow = eventRes.data as Record<string, unknown>;
    const dueAt = completedDatePlus24Hours(eventRow.ends_at);
    if (!dueAt || dueAt > new Date().toISOString()) {
      return {
        completed: false,
        reason: "References are only available after the activity is completed.",
        publicCategory,
        sourceType,
      };
    }
    const membersRes = await params.supabase
      .from("event_members")
      .select("user_id,status")
      .eq("event_id", params.sourceId)
      .in("user_id", [params.authorUserId, params.recipientUserId])
      .limit(10);
    if (membersRes.error) {
      return {
        completed: false,
        reason: "References are only available after the activity is completed.",
        publicCategory,
        sourceType,
      };
    }
    const validMembers = new Set(
      ((membersRes.data ?? []) as Array<Record<string, unknown>>)
        .filter((row) => eligibleStatusesForEventMembership(row.status))
        .map((row) => normalizeText(row.user_id))
        .filter(Boolean)
    );
    if (!validMembers.has(params.authorUserId) || !validMembers.has(params.recipientUserId)) {
      return {
        completed: false,
        reason: "References are only available after the activity is completed.",
        publicCategory,
        sourceType,
      };
    }
    return {
      completed: true,
      completedAt: dueAt,
      publicCategory,
      sourceType,
    };
  }

  return {
    completed: false,
    reason: "References are only available after the activity is completed.",
    publicCategory,
    sourceType,
  };
}

export async function getReferenceEligibility(params: {
  supabase: AnyClient;
  authorUserId: string;
  recipientUserId: string;
  contextTag: ReferenceContextTag | string;
  sourceTable: string;
  sourceId: string;
}) : Promise<ReferenceEligibilityResult> {
  const contextTag = normalizeReferenceContextTag(String(params.contextTag));
  const publicCategory = mapReferenceContextTagToPublicCategory(contextTag);
  const referenceFamily = mapPublicActivityCategoryToReferenceFamily(publicCategory);
  const sourceType = referenceSourceTypeForOrigin({
    contextTag,
    sourceTable: params.sourceTable,
  });

  const completion = await resolveCompletedSource({
    supabase: params.supabase,
    authorUserId: params.authorUserId,
    recipientUserId: params.recipientUserId,
    contextTag,
    sourceTable: params.sourceTable,
    sourceId: params.sourceId,
  });

  if (!completion.completed) {
    return {
      allowed: false,
      reason: completion.reason,
      next_allowed_at: null,
      publicCategory: completion.publicCategory,
      referenceFamily,
      sourceType: completion.sourceType,
      sourceId: params.sourceId || null,
      sourceCompletedAt: null,
    };
  }

  const pairRows = await fetchPairReferenceRows({
    supabase: params.supabase,
    authorUserId: params.authorUserId,
    recipientUserId: params.recipientUserId,
  });

  const hasSourceDuplicate = pairRows.some((row) => {
    if (!row.sourceId || !row.sourceType) return false;
    return row.sourceType === sourceType && row.sourceId === params.sourceId;
  });

  if (hasSourceDuplicate) {
    return {
      allowed: false,
      reason: "You already left a reference for this activity.",
      next_allowed_at: null,
      publicCategory: completion.publicCategory,
      referenceFamily,
      sourceType,
      sourceId: params.sourceId,
      sourceCompletedAt: completion.completedAt,
    };
  }

  if (!isPerActivityReferenceCategory(completion.publicCategory)) {
    const cooldownDays = getReferenceCooldownDays(completion.publicCategory) ?? 0;
    const latestFamilyReference = pairRows.find((row) => row.referenceFamily === referenceFamily);
    if (latestFamilyReference?.createdAt) {
      const nextAllowedAt = addDaysIso(latestFamilyReference.createdAt, cooldownDays);
      if (new Date(nextAllowedAt).getTime() > Date.now()) {
        const familyLabel =
          referenceFamily === "practice_social"
            ? "Practice/Social Dance"
            : completion.publicCategory;
        return {
          allowed: false,
          reason: `You can leave another ${familyLabel} reference for this member after ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(nextAllowedAt))}.`,
          next_allowed_at: nextAllowedAt,
          publicCategory: completion.publicCategory,
          referenceFamily,
          sourceType,
          sourceId: params.sourceId,
          sourceCompletedAt: completion.completedAt,
        };
      }
    }
  }

  return {
    allowed: true,
    next_allowed_at: null,
    publicCategory: completion.publicCategory,
    referenceFamily,
    sourceType,
    sourceId: params.sourceId,
    sourceCompletedAt: completion.completedAt,
  };
}

