import { NextResponse } from "next/server";
import { isProPlanActive } from "@/lib/billing/account-state";
import type {
  AdminDistributionItem,
  AdminEventCoverQueueItem,
  AdminEventsHealth,
  AdminFlaggedMember,
  AdminLiteProfile,
  AdminModerationLogItem,
  AdminOverviewResponse,
  AdminPhotoQueueItem,
  AdminPrivacyQueueItem,
  AdminReportQueueItem,
  AdminRequestQueueItem,
  AdminTrendPoint,
} from "@/lib/admin/overview";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

export const runtime = "nodejs";

type ServiceClient = ReturnType<typeof getSupabaseServiceClient>;
type QueryBuilderLike = {
  eq: (column: string, value: unknown) => QueryBuilderLike;
  gte: (column: string, value: unknown) => QueryBuilderLike;
  lt: (column: string, value: unknown) => QueryBuilderLike;
  not: (column: string, operator: string, value: unknown) => QueryBuilderLike;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilderLike;
  limit: (count: number) => QueryBuilderLike;
  in: (column: string, values: unknown[]) => QueryBuilderLike;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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

function pickBoolean(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (row[key] === true) return true;
  }
  return false;
}

function normalizeProfile(row: Record<string, unknown> | null | undefined): AdminLiteProfile | null {
  if (!row) return null;
  const userId = pickString(row, ["user_id", "id"]);
  if (!userId) return null;
  return {
    userId,
    displayName: pickString(row, ["display_name", "name"]) || "Member",
    city: pickString(row, ["city"]),
    country: pickString(row, ["country"]),
    avatarUrl: pickNullableString(row, ["avatar_url"]),
  };
}

function buildProfileMap(rows: Array<Record<string, unknown>>) {
  const map = new Map<string, AdminLiteProfile>();
  rows.forEach((row) => {
    const profile = normalizeProfile(row);
    if (!profile) return;
    map.set(profile.userId, profile);
  });
  return map;
}

function toDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(date: Date) {
  const day = startOfUtcDay(date);
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day;
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function countWithin(createdAts: string[], days: number, now: Date) {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return createdAts.reduce((count, createdAt) => {
    const parsed = toDate(createdAt);
    return parsed && parsed.getTime() >= cutoff ? count + 1 : count;
  }, 0);
}

function buildWeeklyTrend(values: string[], weeks: number, now: Date): AdminTrendPoint[] {
  const firstBucket = addUtcDays(startOfUtcWeek(now), -7 * (weeks - 1));
  const buckets = Array.from({ length: weeks }, (_, index) => addUtcDays(firstBucket, index * 7));
  const counts = new Map<string, number>(buckets.map((bucket) => [bucket.toISOString(), 0]));

  values.forEach((value) => {
    const parsed = toDate(value);
    if (!parsed) return;
    const bucket = startOfUtcWeek(parsed).toISOString();
    if (!counts.has(bucket)) return;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  });

  return buckets.map((bucket) => ({
    key: bucket.toISOString(),
    label: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(bucket),
    value: counts.get(bucket.toISOString()) ?? 0,
  }));
}

function buildMonthlyTrend(values: string[], months: number, now: Date): AdminTrendPoint[] {
  const firstBucket = addUtcMonths(startOfUtcMonth(now), -(months - 1));
  const buckets = Array.from({ length: months }, (_, index) => addUtcMonths(firstBucket, index));
  const counts = new Map<string, number>(buckets.map((bucket) => [bucket.toISOString(), 0]));

  values.forEach((value) => {
    const parsed = toDate(value);
    if (!parsed) return;
    const bucket = startOfUtcMonth(parsed).toISOString();
    if (!counts.has(bucket)) return;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  });

  return buckets.map((bucket) => ({
    key: bucket.toISOString(),
    label: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(bucket),
    value: counts.get(bucket.toISOString()) ?? 0,
  }));
}

function formatRequestTypeLabel(value: string) {
  if (value === "trip_request") return "Trip requests";
  if (value === "hosting_request") return "Hosting requests";
  if (value === "service_inquiry") return "Service inquiries";
  if (value === "event_request") return "Event requests";
  if (value === "reference_request") return "Reference prompts";
  return value.replace(/_/g, " ");
}

function formatReportContextLabel(value: string) {
  if (!value) return "Other";
  return value.replace(/_/g, " ");
}

function buildDistribution(items: Map<string, number>, formatLabel: (value: string) => string): AdminDistributionItem[] {
  return Array.from(items.entries())
    .map(([key, value]) => ({
      key,
      label: formatLabel(key),
      value,
    }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value);
}

async function requireAdmin(req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false as const, status: 401, error: "Missing auth token." };
  }

  const supabase = getSupabaseUserClient(token);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return { ok: false as const, status: 401, error: "Invalid auth token." };
  }

  const adminCheck = await supabase.from("admins").select("user_id").eq("user_id", authData.user.id).maybeSingle();
  if (adminCheck.error || !adminCheck.data) {
    return { ok: false as const, status: 403, error: "Admin access required." };
  }

  return { ok: true as const, token, userId: authData.user.id };
}

async function safeCount(
  service: ServiceClient,
  table: string,
  apply?: (query: QueryBuilderLike) => QueryBuilderLike,
  column = "id"
) {
  try {
    let query = service.from(table as never).select(column, { count: "exact", head: true }) as unknown as QueryBuilderLike;
    if (apply) query = apply(query);
    const { count, error } = (await query) as unknown as {
      count: number | null;
      error: { message?: string } | null;
    };
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function safeRows(
  service: ServiceClient,
  table: string,
  apply?: (query: QueryBuilderLike) => QueryBuilderLike
) {
  try {
    let query = service.from(table as never).select("*") as unknown as QueryBuilderLike;
    if (apply) query = apply(query);
    const { data, error } = (await query) as unknown as {
      data: unknown;
      error: { message?: string } | null;
    };
    if (error) return [] as Array<Record<string, unknown>>;
    return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  } catch {
    return [] as Array<Record<string, unknown>>;
  }
}

async function listAllAuthUsers(service: ServiceClient) {
  const users: Array<Record<string, unknown>> = [];
  let page = 1;
  const perPage = 200;

  while (page <= 50) {
    const res = await service.auth.admin.listUsers({ page, perPage });
    if (res.error) break;

    const batch = Array.isArray(res.data.users)
      ? (res.data.users as unknown as Array<Record<string, unknown>>)
      : [];
    users.push(...batch);

    if (batch.length < perPage) break;
    page += 1;
  }

  return users;
}

async function loadEventsHealth(service: ServiceClient): Promise<AdminEventsHealth | null> {
  try {
    const snapshot = (await service.rpc("cx_events_health_snapshot")) as {
      data: unknown;
      error: { message?: string } | null;
    };
    if (!snapshot.error && snapshot.data && typeof snapshot.data === "object") {
      const row = snapshot.data as Record<string, unknown>;
      return {
        upcomingTotal: Number(row.upcoming_total ?? 0) || 0,
        upcomingPublicVisible: Number(row.upcoming_public_visible ?? 0) || 0,
        pastTotal: Number(row.past_total ?? 0) || 0,
        archivedTotal: Number(row.archived_total ?? 0) || 0,
        generatedAt:
          (typeof row.generated_at === "string" && row.generated_at) || new Date().toISOString(),
      };
    }

    const nowIso = new Date().toISOString();
    const [upcomingRes, publicUpcomingRes, pastRes, archivedRes] = await Promise.all([
      safeCount(service, "events", (query) => query.eq("status", "published").gte("ends_at", nowIso)),
      safeCount(
        service,
        "events",
        (query) => query.eq("status", "published").eq("visibility", "public").eq("hidden_by_admin", false).gte("ends_at", nowIso)
      ),
      safeCount(service, "events", (query) => query.eq("status", "published").lt("ends_at", nowIso)),
      safeCount(service, "events_archive", undefined, "event_id"),
    ]);

    return {
      upcomingTotal: upcomingRes,
      upcomingPublicVisible: publicUpcomingRes,
      pastTotal: pastRes,
      archivedTotal: archivedRes,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
    }

    const service = getSupabaseServiceClient();
    const now = new Date();
    const since180d = addUtcDays(startOfUtcDay(now), -179).toISOString();
    const generatedAt = now.toISOString();

    const [
      authUsers,
      totalProfiles,
      verifiedMembers,
      activeHosts,
      openReports,
      pendingAvatarReviews,
      pendingEventCovers,
      hiddenEvents,
      upcomingEvents,
      adminsRows,
      recentReports,
      recentClaims,
      recentLogs,
      recentPrivacy,
      recentEvents,
      recentTripRequests,
      recentHostingRequests,
      recentServiceInquiries,
      recentEventRequests,
      recentReferenceRequests,
      recentReferences,
      pendingAvatarRows,
      eventsHealth,
    ] = await Promise.all([
      listAllAuthUsers(service),
      safeCount(service, "profiles"),
      safeCount(service, "profiles", (query) => query.eq("verified", true), "user_id"),
      safeCount(service, "profiles", (query) => query.eq("can_host", true), "user_id"),
      safeCount(service, "reports", (query) => query.eq("status", "open")),
      safeCount(
        service,
        "profiles",
        (query) => query.eq("avatar_status", "pending").not("avatar_url", "is", null),
        "user_id"
      ),
      safeCount(service, "events", (query) => query.eq("cover_status", "pending")),
      safeCount(service, "events", (query) => query.eq("hidden_by_admin", true)),
      safeCount(service, "events", (query) => query.eq("status", "published").gte("ends_at", generatedAt)),
      safeRows(service, "admins", (query) => query.limit(100)),
      safeRows(service, "reports", (query) => query.gte("created_at", since180d).order("created_at", { ascending: false }).limit(2000)),
      safeRows(service, "reference_report_claims", (query) => query.order("created_at", { ascending: false }).limit(1000)),
      safeRows(service, "moderation_logs", (query) => query.gte("created_at", since180d).order("created_at", { ascending: false }).limit(2000)),
      safeRows(service, "privacy_requests", (query) => query.gte("created_at", since180d).order("created_at", { ascending: false }).limit(1000)),
      safeRows(service, "events", (query) => query.gte("created_at", since180d).order("created_at", { ascending: false }).limit(2000)),
      safeRows(service, "trip_requests", (query) => query.gte("created_at", since180d).order("created_at", { ascending: false }).limit(2000)),
      safeRows(service, "hosting_requests", (query) => query.gte("created_at", since180d).order("created_at", { ascending: false }).limit(2000)),
      safeRows(service, "service_inquiries", (query) => query.gte("created_at", since180d).order("created_at", { ascending: false }).limit(2000)),
      safeRows(service, "event_requests", (query) => query.gte("created_at", since180d).order("created_at", { ascending: false }).limit(2000)),
      safeRows(service, "reference_requests", (query) => query.gte("created_at", since180d).order("created_at", { ascending: false }).limit(2000)),
      safeRows(service, "references", (query) => query.gte("created_at", since180d).order("created_at", { ascending: false }).limit(2000)),
      safeRows(
        service,
        "profiles",
        (query) => query.eq("avatar_status", "pending").not("avatar_url", "is", null).order("updated_at", { ascending: false }).limit(300)
      ),
      loadEventsHealth(service),
    ]);

    const adminIds = adminsRows.map((row) => pickString(row, ["user_id"])).filter(Boolean);
    const tripIds = recentTripRequests.map((row) => pickString(row, ["trip_id"])).filter(Boolean);
    const eventIds = Array.from(
      new Set(
        [...recentEvents.map((row) => pickString(row, ["id"])), ...recentEventRequests.map((row) => pickString(row, ["event_id"]))]
          .filter(Boolean)
      )
    );

    const [tripRows, eventLookupRows] = await Promise.all([
      tripIds.length > 0
        ? safeRows(service, "trips", (query) => query.in("id", tripIds))
        : Promise.resolve([] as Array<Record<string, unknown>>),
      eventIds.length > 0
        ? safeRows(service, "events", (query) => query.in("id", eventIds))
        : Promise.resolve([] as Array<Record<string, unknown>>),
    ]);

    const tripMap = new Map<string, Record<string, unknown>>();
    tripRows.forEach((row) => {
      const id = pickString(row, ["id"]);
      if (!id) return;
      tripMap.set(id, row);
    });

    const eventMap = new Map<string, Record<string, unknown>>();
    [...recentEvents, ...eventLookupRows].forEach((row) => {
      const id = pickString(row, ["id"]);
      if (!id) return;
      eventMap.set(id, row);
    });

    const relatedUserIds = new Set<string>(adminIds);
    pendingAvatarRows.forEach((row) => {
      const userId = pickString(row, ["user_id"]);
      if (userId) relatedUserIds.add(userId);
    });

    recentReports.forEach((row) => {
      const reporterId = pickString(row, ["reporter_id", "created_by"]);
      const targetUserId = pickString(row, ["target_user_id", "reported_user_id"]);
      if (reporterId) relatedUserIds.add(reporterId);
      if (targetUserId) relatedUserIds.add(targetUserId);
    });

    recentClaims.forEach((row) => {
      const ids = [
        pickString(row, ["reporter_id"]),
        pickString(row, ["target_user_id"]),
        pickString(row, ["reference_author_id"]),
        pickString(row, ["reference_recipient_id"]),
      ];
      ids.filter(Boolean).forEach((value) => relatedUserIds.add(value));
    });

    recentLogs.forEach((row) => {
      const actorId = pickString(row, ["actor_id"]);
      const targetUserId = pickString(row, ["target_user_id"]);
      if (actorId) relatedUserIds.add(actorId);
      if (targetUserId) relatedUserIds.add(targetUserId);
    });

    recentPrivacy.forEach((row) => {
      const requesterId = pickString(row, ["requester_id"]);
      if (requesterId) relatedUserIds.add(requesterId);
    });

    recentEvents.forEach((row) => {
      const hostUserId = pickString(row, ["host_user_id"]);
      if (hostUserId) relatedUserIds.add(hostUserId);
    });

    recentTripRequests.forEach((row) => {
      const requesterId = pickString(row, ["requester_id"]);
      if (requesterId) relatedUserIds.add(requesterId);
      const trip = tripMap.get(pickString(row, ["trip_id"]));
      const ownerId = trip ? pickString(trip, ["user_id"]) : "";
      if (ownerId) relatedUserIds.add(ownerId);
    });

    recentHostingRequests.forEach((row) => {
      const ids = [pickString(row, ["sender_user_id"]), pickString(row, ["recipient_user_id"])];
      ids.filter(Boolean).forEach((value) => relatedUserIds.add(value));
    });

    recentServiceInquiries.forEach((row) => {
      const ids = [pickString(row, ["requester_id"]), pickString(row, ["recipient_id"])];
      ids.filter(Boolean).forEach((value) => relatedUserIds.add(value));
    });

    recentEventRequests.forEach((row) => {
      const requesterId = pickString(row, ["requester_id"]);
      if (requesterId) relatedUserIds.add(requesterId);
      const event = eventMap.get(pickString(row, ["event_id"]));
      const ownerId = event ? pickString(event, ["host_user_id"]) : "";
      if (ownerId) relatedUserIds.add(ownerId);
    });

    recentReferenceRequests.forEach((row) => {
      const ids = [pickString(row, ["user_id"]), pickString(row, ["peer_user_id"])];
      ids.filter(Boolean).forEach((value) => relatedUserIds.add(value));
    });

    const profileRows =
      relatedUserIds.size > 0
        ? await safeRows(service, "profiles", (query) => query.in("user_id", Array.from(relatedUserIds)))
        : [];
    const profileMap = buildProfileMap(profileRows);

    const authCreatedAts = authUsers
      .map((row) => pickString(row, ["created_at"]))
      .filter(Boolean);
    const plusMembers = authUsers.reduce((count, user) => {
      const metadata = asRecord(user.user_metadata);
      const status = pickNullableString(metadata, ["billing_pro_status"]);
      return isProPlanActive(status) ? count + 1 : count;
    }, 0);

    const reportStatusById = new Map<string, string>();
    recentReports.forEach((row) => {
      const id = pickString(row, ["id"]);
      if (!id) return;
      reportStatusById.set(id, pickString(row, ["status"]) || "open");
    });

    const claimsByReportId = new Map<string, Record<string, unknown>>();
    recentClaims.forEach((row) => {
      const reportId = pickString(row, ["report_id"]);
      if (!reportId || claimsByReportId.has(reportId)) return;
      claimsByReportId.set(reportId, row);
    });

    const eventReportCounts = new Map<string, { open: number; total: number }>();
    const reportContextDistribution = new Map<string, number>();
    const flaggedMemberCounts = new Map<string, number>();

    recentReports.forEach((row) => {
      const context = pickString(row, ["context"]) || "other";
      reportContextDistribution.set(context, (reportContextDistribution.get(context) ?? 0) + 1);

      const targetUserId = pickString(row, ["target_user_id", "reported_user_id"]);
      if (targetUserId) {
        flaggedMemberCounts.set(targetUserId, (flaggedMemberCounts.get(targetUserId) ?? 0) + 1);
      }

      if (!context.toLowerCase().includes("event")) return;
      const eventId = pickString(row, ["context_id"]);
      if (!eventId) return;
      const current = eventReportCounts.get(eventId) ?? { open: 0, total: 0 };
      current.total += 1;
      if ((pickString(row, ["status"]) || "open") === "open") current.open += 1;
      eventReportCounts.set(eventId, current);
    });

    const requestTypeDistribution = new Map<string, number>();
    const requestCreatedAts: string[] = [];
    const requestItems: AdminRequestQueueItem[] = [];

    recentTripRequests.forEach((row) => {
      const id = pickString(row, ["id"]);
      const createdAt = pickString(row, ["created_at"]);
      const status = pickString(row, ["status"]) || "pending";
      const requesterId = pickString(row, ["requester_id"]);
      const trip = tripMap.get(pickString(row, ["trip_id"])) ?? null;
      const ownerId = trip ? pickString(trip, ["user_id"]) : "";
      if (!id || !createdAt) return;

      requestTypeDistribution.set("trip_request", (requestTypeDistribution.get("trip_request") ?? 0) + 1);
      requestCreatedAts.push(createdAt);

      requestItems.push({
        id,
        type: "trip_request",
        label: "Trip request",
        status,
        createdAt,
        requester: profileMap.get(requesterId) ?? null,
        target: profileMap.get(ownerId) ?? null,
        title:
          trip
            ? [pickString(trip, ["purpose"]), pickString(trip, ["destination_city"]), pickString(trip, ["destination_country"])]
                .filter(Boolean)
                .join(" • ") || "Trip request"
            : "Trip request",
        subtitle:
          [pickString(trip ?? {}, ["start_date"]), pickString(trip ?? {}, ["end_date"])]
            .filter(Boolean)
            .join(" → ") || "No travel dates",
        meta: null,
      });
    });

    recentHostingRequests.forEach((row) => {
      const id = pickString(row, ["id"]);
      const createdAt = pickString(row, ["created_at"]);
      const status = pickString(row, ["status"]) || "pending";
      const senderId = pickString(row, ["sender_user_id"]);
      const recipientId = pickString(row, ["recipient_user_id"]);
      const requestType = pickString(row, ["request_type"]) || "request_hosting";
      if (!id || !createdAt) return;

      requestTypeDistribution.set("hosting_request", (requestTypeDistribution.get("hosting_request") ?? 0) + 1);
      requestCreatedAts.push(createdAt);

      requestItems.push({
        id,
        type: "hosting_request",
        label: requestType === "offer_to_host" ? "Host offer" : "Hosting request",
        status,
        createdAt,
        requester: profileMap.get(senderId) ?? null,
        target: profileMap.get(recipientId) ?? null,
        title: requestType === "offer_to_host" ? "Offer to host" : "Need hosting",
        subtitle:
          [pickString(row, ["arrival_date"]), pickString(row, ["departure_date"])].filter(Boolean).join(" → ") || "Dates pending",
        meta: `Travellers ${pickString(row, ["travellers_count"]) || "1"}`,
      });
    });

    recentServiceInquiries.forEach((row) => {
      const id = pickString(row, ["id"]);
      const createdAt = pickString(row, ["created_at"]);
      const status = pickString(row, ["status"]) || "pending";
      const requesterId = pickString(row, ["requester_id"]);
      const recipientId = pickString(row, ["recipient_id"]);
      const inquiryKind = pickString(row, ["inquiry_kind"]) || "service";
      if (!id || !createdAt) return;

      requestTypeDistribution.set("service_inquiry", (requestTypeDistribution.get("service_inquiry") ?? 0) + 1);
      requestCreatedAts.push(createdAt);

      requestItems.push({
        id,
        type: "service_inquiry",
        label: "Service inquiry",
        status,
        createdAt,
        requester: profileMap.get(requesterId) ?? null,
        target: profileMap.get(recipientId) ?? null,
        title: inquiryKind.replace(/_/g, " "),
        subtitle: pickString(row, ["requested_dates_text"]) || "No requested dates",
        meta: pickString(row, ["requester_type"]) || null,
      });
    });

    recentEventRequests.forEach((row) => {
      const id = pickString(row, ["id"]);
      const createdAt = pickString(row, ["created_at"]);
      const status = pickString(row, ["status"]) || "pending";
      const requesterId = pickString(row, ["requester_id"]);
      const event = eventMap.get(pickString(row, ["event_id"])) ?? null;
      const ownerId = event ? pickString(event, ["host_user_id"]) : "";
      if (!id || !createdAt) return;

      requestTypeDistribution.set("event_request", (requestTypeDistribution.get("event_request") ?? 0) + 1);
      requestCreatedAts.push(createdAt);

      requestItems.push({
        id,
        type: "event_request",
        label: "Event request",
        status,
        createdAt,
        requester: profileMap.get(requesterId) ?? null,
        target: profileMap.get(ownerId) ?? null,
        title: event ? pickString(event, ["title"]) || "Event request" : "Event request",
        subtitle:
          event
            ? [pickString(event, ["city"]), pickString(event, ["country"]), pickString(event, ["starts_at"])]
                .filter(Boolean)
                .join(" • ")
            : "Event access",
        meta: null,
      });
    });

    recentReferenceRequests.forEach((row) => {
      const id = pickString(row, ["id"]);
      const createdAt = pickString(row, ["created_at"]);
      const status = pickString(row, ["status"]) || "pending";
      const requesterId = pickString(row, ["user_id"]);
      const peerId = pickString(row, ["peer_user_id"]);
      if (!id || !createdAt) return;

      requestTypeDistribution.set("reference_request", (requestTypeDistribution.get("reference_request") ?? 0) + 1);
      requestCreatedAts.push(createdAt);

      requestItems.push({
        id,
        type: "reference_request",
        label: "Reference prompt",
        status,
        createdAt,
        requester: profileMap.get(requesterId) ?? null,
        target: profileMap.get(peerId) ?? null,
        title: pickString(row, ["context_tag"]).replace(/_/g, " ") || "Reference prompt",
        subtitle: pickString(row, ["due_at"]) || "No due date",
        meta: pickString(row, ["source_table"]) || null,
      });
    });

    const avatarItems: AdminPhotoQueueItem[] = pendingAvatarRows
      .map((row) => {
        const profile = normalizeProfile(row);
        if (!profile) return null;
        return {
          ...profile,
          avatarStatus: pickString(row, ["avatar_status"]) || "pending",
          uploadedAt: pickString(row, ["updated_at"]) || null,
        } satisfies AdminPhotoQueueItem;
      })
      .filter((item): item is AdminPhotoQueueItem => Boolean(item));

    const eventCoverItems: AdminEventCoverQueueItem[] = recentEvents
      .map((row) => {
        const eventId = pickString(row, ["id"]);
        const hostUserId = pickString(row, ["host_user_id"]);
        const createdAt = pickString(row, ["created_at"]);
        const startsAt = pickString(row, ["starts_at"]);
        if (!eventId || !hostUserId || !createdAt || !startsAt) return null;
        const reportCounts = eventReportCounts.get(eventId) ?? { open: 0, total: 0 };
        return {
          eventId,
          title: pickString(row, ["title"]) || "Untitled event",
          status: pickString(row, ["status"]) || "published",
          visibility: pickString(row, ["visibility"]) || "public",
          coverStatus: pickString(row, ["cover_status"]) || "pending",
          coverUrl: pickNullableString(row, ["cover_url"]),
          createdAt,
          startsAt,
          city: pickString(row, ["city"]),
          country: pickString(row, ["country"]),
          hiddenByAdmin: pickBoolean(row, ["hidden_by_admin"]),
          hiddenReason: pickNullableString(row, ["hidden_reason"]),
          coverReviewNote: pickNullableString(row, ["cover_review_note"]),
          openReports: reportCounts.open,
          totalReports: reportCounts.total,
          host: profileMap.get(hostUserId) ?? null,
        } satisfies AdminEventCoverQueueItem;
      })
      .filter((item): item is AdminEventCoverQueueItem => Boolean(item))
      .filter((item) => item.coverStatus === "pending" || item.openReports > 0 || item.hiddenByAdmin)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 24);

    const reportItems: AdminReportQueueItem[] = recentReports
      .map((row) => {
        const id = pickString(row, ["id"]);
        const reporterId = pickString(row, ["reporter_id", "created_by"]);
        const targetUserId = pickString(row, ["target_user_id", "reported_user_id"]);
        const createdAt = pickString(row, ["created_at"]);
        if (!id || !reporterId || !targetUserId || !createdAt) return null;
        const claim = claimsByReportId.get(id) ?? null;
        return {
          id,
          status: pickString(row, ["status"]) || "open",
          context: pickString(row, ["context"]) || "other",
          contextId: pickNullableString(row, ["context_id"]),
          reason: pickString(row, ["reason"]) || "No reason",
          note: pickNullableString(row, ["note"]),
          createdAt,
          reporter: profileMap.get(reporterId) ?? null,
          target: profileMap.get(targetUserId) ?? null,
          ticketCode: claim ? pickNullableString(claim, ["ticket_code"]) : null,
          claimId: claim ? pickNullableString(claim, ["id"]) : null,
          subject: claim ? pickNullableString(claim, ["subject"]) : null,
          description: claim ? pickNullableString(claim, ["description"]) : null,
          referenceExcerpt: claim ? pickNullableString(claim, ["reference_excerpt"]) : null,
          contextTag: claim ? pickNullableString(claim, ["context_tag"]) : null,
          reporterEmail: claim ? pickNullableString(claim, ["reporter_email"]) : null,
          evidenceLinks:
            claim && Array.isArray(claim.evidence_links)
              ? claim.evidence_links.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
              : [],
          profileLink: claim ? pickNullableString(claim, ["profile_link"]) : null,
        } satisfies AdminReportQueueItem;
      })
      .filter((item): item is AdminReportQueueItem => Boolean(item))
      .slice(0, 80);

    const openPrivacyStatuses = new Set(["open", "under_review", "needs_info"]);
    const privacyItems: AdminPrivacyQueueItem[] = recentPrivacy
      .map((row) => {
        const id = pickString(row, ["id"]);
        const requesterId = pickString(row, ["requester_id"]);
        const createdAt = pickString(row, ["created_at"]);
        const dueAt = pickString(row, ["due_at"]);
        if (!id || !requesterId || !createdAt || !dueAt) return null;
        return {
          id,
          ticketCode: pickString(row, ["ticket_code"]) || "PR-",
          requestType: pickString(row, ["request_type"]) || "other",
          status: pickString(row, ["status"]) || "open",
          subject: pickString(row, ["subject"]) || "Privacy request",
          description: pickString(row, ["description"]),
          requesterEmail: pickNullableString(row, ["requester_email"]),
          dueAt,
          createdAt,
          requester: profileMap.get(requesterId) ?? null,
        } satisfies AdminPrivacyQueueItem;
      })
      .filter((item): item is AdminPrivacyQueueItem => Boolean(item))
      .filter((item) => openPrivacyStatuses.has(item.status))
      .slice(0, 40);

    const logItems: AdminModerationLogItem[] = recentLogs
      .map((row) => {
        const id = pickString(row, ["id"]);
        const actorId = pickString(row, ["actor_id"]);
        const createdAt = pickString(row, ["created_at"]);
        if (!id || !actorId || !createdAt) return null;
        const targetUserId = pickString(row, ["target_user_id"]);
        return {
          id,
          action: pickString(row, ["action"]) || "update",
          note: pickNullableString(row, ["note"]),
          createdAt,
          reportId: pickNullableString(row, ["report_id"]),
          actor: profileMap.get(actorId) ?? null,
          target: targetUserId ? profileMap.get(targetUserId) ?? null : null,
        } satisfies AdminModerationLogItem;
      })
      .filter((item): item is AdminModerationLogItem => Boolean(item))
      .slice(0, 80);

    const flaggedMembers: AdminFlaggedMember[] = Array.from(flaggedMemberCounts.entries())
      .map(([userId, reports]) => {
        const profile = profileMap.get(userId);
        if (!profile) return null;
        return {
          ...profile,
          reports,
        } satisfies AdminFlaggedMember;
      })
      .filter((item): item is AdminFlaggedMember => Boolean(item))
      .sort((left, right) => right.reports - left.reports)
      .slice(0, 10);

    const adminTeam = adminIds
      .map((adminId) => profileMap.get(adminId) ?? null)
      .filter((item): item is AdminLiteProfile => Boolean(item));

    const openReferenceClaims = recentClaims.reduce((count, row) => {
      const reportId = pickString(row, ["report_id"]);
      const status = reportId ? reportStatusById.get(reportId) ?? "open" : "open";
      return status === "open" ? count + 1 : count;
    }, 0);

    const pendingRequests = requestItems.filter((item) => item.status === "pending").length;

    const referencesCreatedAts = recentReferences
      .map((row) => pickString(row, ["created_at"]))
      .filter(Boolean);
    const eventCreatedAts = recentEvents
      .map((row) => pickString(row, ["created_at"]))
      .filter(Boolean);
    const moderationCreatedAts = recentLogs
      .map((row) => pickString(row, ["created_at"]))
      .filter(Boolean);
    const reportCreatedAts = recentReports
      .map((row) => pickString(row, ["created_at"]))
      .filter(Boolean);

    const response: AdminOverviewResponse = {
      generatedAt,
      stats: {
        totalMembers: authUsers.length,
        totalProfiles,
        verifiedMembers,
        plusMembers,
        activeHosts,
        totalAdmins: adminIds.length,
        newUsers7d: countWithin(authCreatedAts, 7, now),
        newUsers30d: countWithin(authCreatedAts, 30, now),
        openReports,
        openPrivacyRequests: privacyItems.length,
        openReferenceClaims,
        pendingAvatarReviews,
        pendingEventCovers,
        pendingRequests,
        upcomingEvents,
        hiddenEvents,
        references30d: countWithin(referencesCreatedAts, 30, now),
        events30d: countWithin(eventCreatedAts, 30, now),
        moderationActions30d: countWithin(moderationCreatedAts, 30, now),
      },
      trends: {
        signupsWeekly: buildWeeklyTrend(authCreatedAts, 8, now),
        requestsWeekly: buildWeeklyTrend(requestCreatedAts, 8, now),
        reportsWeekly: buildWeeklyTrend(reportCreatedAts, 8, now),
        eventsMonthly: buildMonthlyTrend(eventCreatedAts, 6, now),
        referencesMonthly: buildMonthlyTrend(referencesCreatedAts, 6, now),
      },
      distribution: {
        requestsByType: buildDistribution(requestTypeDistribution, formatRequestTypeLabel),
        reportsByContext: buildDistribution(reportContextDistribution, formatReportContextLabel),
      },
      highlights: {
        flaggedMembers,
        adminTeam,
      },
      queues: {
        reports: reportItems,
        avatars: avatarItems,
        eventCovers: eventCoverItems,
        privacy: privacyItems,
        requests: requestItems.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 120),
        logs: logItems,
      },
      eventsHealth,
    };

    return NextResponse.json({ ok: true, overview: response });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load admin overview." },
      { status: 500 }
    );
  }
}
