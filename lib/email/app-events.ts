import { createHash } from "node:crypto";
import { renderBrandedEmail, absoluteAppUrl } from "@/lib/email/branding";
import { buildCtaPath, buildEmailCopy, type EventSummary, type HostingSummary, type SyncSummary, type TripSummary } from "@/lib/email/copy";
import { isResendConfigured, sendResendEmail } from "@/lib/email/resend";
import type { AppEmailParams } from "@/lib/email/types";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

export type { AppEmailKind, AppEmailParams } from "@/lib/email/types";

type UserSummary = {
  userId: string;
  email: string | null;
  displayName: string;
  city: string | null;
  country: string | null;
};

async function loadUserSummary(userId: string): Promise<UserSummary | null> {
  if (!userId) return null;
  const service = getSupabaseServiceClient();

  const [profileRes, authRes] = await Promise.all([
    service.from("profiles").select("display_name,city,country").eq("user_id", userId).maybeSingle(),
    service.auth.admin.getUserById(userId),
  ]);

  const email = authRes.data.user?.email?.trim() ?? null;
  const profile = (profileRes.data ?? {}) as {
    display_name?: string | null;
    city?: string | null;
    country?: string | null;
  };

  const metadataName =
    typeof authRes.data.user?.user_metadata?.display_name === "string"
      ? authRes.data.user.user_metadata.display_name
      : typeof authRes.data.user?.user_metadata?.full_name === "string"
        ? authRes.data.user.user_metadata.full_name
        : "";

  const fallbackName = email?.split("@")[0]?.replace(/[._+-]+/g, " ") ?? "Member";
  const displayName = profile.display_name?.trim() || metadataName.trim() || fallbackName.trim() || "Member";

  return {
    userId,
    email,
    displayName,
    city: profile.city?.trim() || null,
    country: profile.country?.trim() || null,
  };
}

async function loadTripSummary(tripId: string | null | undefined): Promise<TripSummary | null> {
  if (!tripId) return null;
  const service = getSupabaseServiceClient();
  const res = await service
    .from("trips")
    .select("destination_city,destination_country,start_date,end_date")
    .eq("id", tripId)
    .maybeSingle();

  if (res.error || !res.data) return null;

  const row = res.data as {
    destination_city?: string | null;
    destination_country?: string | null;
    start_date?: string | null;
    end_date?: string | null;
  };

  return {
    city: row.destination_city?.trim() || "",
    country: row.destination_country?.trim() || "",
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
  };
}

async function loadEventSummary(eventId: string | null | undefined): Promise<EventSummary | null> {
  if (!eventId) return null;
  const service = getSupabaseServiceClient();
  const res = await service
    .from("events")
    .select("title,city,country,starts_at")
    .eq("id", eventId)
    .maybeSingle();

  if (res.error || !res.data) return null;

  const row = res.data as {
    title?: string | null;
    city?: string | null;
    country?: string | null;
    starts_at?: string | null;
  };

  return {
    title: row.title?.trim() || "",
    city: row.city?.trim() || null,
    country: row.country?.trim() || null,
    startsAt: row.starts_at ?? null,
  };
}

async function loadHostingSummary(hostingRequestId: string | null | undefined): Promise<HostingSummary | null> {
  if (!hostingRequestId) return null;
  const service = getSupabaseServiceClient();
  const res = await service
    .from("hosting_requests")
    .select("request_type,arrival_date,departure_date")
    .eq("id", hostingRequestId)
    .maybeSingle();

  if (res.error || !res.data) return null;

  const row = res.data as {
    request_type?: string | null;
    arrival_date?: string | null;
    departure_date?: string | null;
  };

  return {
    requestType: row.request_type ?? null,
    arrivalDate: row.arrival_date ?? null,
    departureDate: row.departure_date ?? null,
  };
}

async function loadSyncSummary(syncId: string | null | undefined): Promise<SyncSummary | null> {
  if (!syncId) return null;
  const service = getSupabaseServiceClient();
  const res = await service
    .from("connection_syncs")
    .select("sync_type,scheduled_at")
    .eq("id", syncId)
    .maybeSingle();

  if (res.error || !res.data) return null;

  const row = res.data as {
    sync_type?: string | null;
    scheduled_at?: string | null;
  };

  return {
    syncType: row.sync_type ?? null,
    scheduledAt: row.scheduled_at ?? null,
  };
}

function shouldSkipRecipient(email: string | null) {
  if (!email) return true;
  return email.toLowerCase().endsWith("@local.test");
}

export async function sendAppEmail(params: AppEmailParams) {
  if (!isResendConfigured()) {
    return { ok: false as const, skipped: true as const, error: "Resend is not configured." };
  }

  const [recipient, actor, trip, event, hosting, sync] = await Promise.all([
    loadUserSummary(params.recipientUserId),
    params.actorUserId ? loadUserSummary(params.actorUserId) : Promise.resolve(null),
    loadTripSummary(params.tripId),
    loadEventSummary(params.eventId),
    loadHostingSummary(params.hostingRequestId),
    loadSyncSummary(params.syncId),
  ]);

  if (!recipient || shouldSkipRecipient(recipient.email)) {
    if (!params.recipientEmailOverride) {
      return { ok: false as const, skipped: true as const, error: "Recipient email is not deliverable." };
    }
  }

  const recipientEmail = params.recipientEmailOverride?.trim() || recipient?.email || null;
  if (!recipientEmail) {
    return { ok: false as const, skipped: true as const, error: "Recipient email is missing." };
  }

  const copy = buildEmailCopy({
    kind: params.kind,
    actorName: actor?.displayName || "Someone",
    trip,
    event,
    hosting,
    sync,
    contextTag: params.contextTag,
    promptDueAt: params.promptDueAt,
    promptExpiresAt: params.promptExpiresAt,
    activityTitle: params.activityTitle,
    activityHappenedAt: params.activityHappenedAt,
    unreadCount: params.unreadCount,
  });
  const ctaUrl = absoluteAppUrl(buildCtaPath(params));
  const rendered = renderBrandedEmail({
    recipientName: params.recipientNameOverride?.trim() || recipient?.displayName || "Member",
    eyebrow: copy.eyebrow,
    title: copy.title,
    intro: copy.intro,
    detailLines: copy.details,
    heroBadge: copy.heroBadge,
    heroTitle: copy.heroTitle,
    heroSubtitle: copy.heroSubtitle,
    heroBody: copy.heroBody,
    heroTheme: copy.heroTheme,
    detailStyle: copy.detailStyle,
    ctaLabel: copy.ctaLabel,
    ctaUrl,
    footerNote: copy.footerNote,
    ctaHint: copy.ctaHint,
    titleSizePx: copy.titleSizePx,
    logoWidthPx: copy.logoWidthPx,
    showGreeting: copy.showGreeting,
    showFooterNote: copy.showFooterNote,
    showFallbackLink: copy.showFallbackLink,
  });

  const idempotencySource = [
    params.kind,
    params.recipientUserId,
    params.actorUserId ?? "",
    params.connectionId ?? "",
    params.tripId ?? "",
    params.eventId ?? "",
    params.syncId ?? "",
    params.hostingRequestId ?? "",
    params.referenceId ?? "",
    params.promptId ?? "",
    params.contextTag ?? "",
    params.promptDueAt ?? "",
    params.promptExpiresAt ?? "",
    params.activityTitle ?? "",
    params.activityHappenedAt ?? "",
    String(params.unreadCount ?? ""),
    String(params.reminderCount ?? ""),
    params.ticketCode ?? "",
    params.supportClaimId ?? "",
    params.supportSubject ?? "",
    params.supportStatus ?? "",
    params.recipientEmailOverride ?? "",
    params.idempotencySeed ?? "",
  ].join(":");
  const idempotencyKey = createHash("sha256").update(idempotencySource).digest("hex");

  return sendResendEmail({
    to: recipientEmail,
    subject: copy.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey,
  });
}

export async function sendAppEmailBestEffort(params: AppEmailParams) {
  try {
    const result = await sendAppEmail(params);
    if (!result.ok && !result.skipped) {
      console.error("[email] failed to send", params.kind, result.error);
    }
  } catch (error) {
    console.error("[email] unexpected failure", params.kind, error);
  }
}
