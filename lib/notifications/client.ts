import { supabase } from "@/lib/supabase/client";

export type NotificationRow = {
  id: string;
  user_id: string;
  actor_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  link_url: string | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeRow(value: unknown): NotificationRow | null {
  const row = asRecord(value);
  const id = asText(row.id);
  const userId = asText(row.user_id);
  const kind = asText(row.kind);
  const title = asText(row.title);
  const createdAt = asText(row.created_at);
  if (!id || !userId || !kind || !title || !createdAt) return null;

  return {
    id,
    user_id: userId,
    actor_id: asNullableText(row.actor_id),
    kind,
    title,
    body: asNullableText(row.body),
    link_url: asNullableText(row.link_url),
    metadata: asRecord(row.metadata),
    is_read: asBoolean(row.is_read),
    created_at: createdAt,
    read_at: asNullableText(row.read_at),
  };
}

export async function fetchNotifications(params?: {
  limit?: number;
  unreadOnly?: boolean;
}): Promise<{ data: NotificationRow[]; error: string | null }> {
  const limit = Math.max(1, Math.min(params?.limit ?? 30, 200));

  let query = supabase
    .from("notifications")
    .select("id,user_id,actor_id,kind,title,body,link_url,metadata,is_read,created_at,read_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params?.unreadOnly) query = query.eq("is_read", false);

  const res = await query;
  if (res.error) return { data: [], error: res.error.message };

  const rows = (res.data ?? []).map(normalizeRow).filter((row): row is NotificationRow => Boolean(row));
  return { data: rows, error: null };
}

export async function fetchNotificationsUnreadCount(): Promise<{ count: number; error: string | null }> {
  const res = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("is_read", false);

  if (res.error) return { count: 0, error: res.error.message };
  return { count: res.count ?? 0, error: null };
}

export async function markNotificationRead(notificationId: string): Promise<{ error: string | null }> {
  const id = notificationId.trim();
  if (!id) return { error: "Notification id is required." };

  const res = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("is_read", false);

  return { error: res.error?.message ?? null };
}

export async function markAllNotificationsRead(): Promise<{ error: string | null }> {
  const res = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("is_read", false);

  return { error: res.error?.message ?? null };
}

export function formatNotificationRelativeTime(value: string | null | undefined): string {
  if (!value) return "now";
  const at = new Date(value).getTime();
  if (!Number.isFinite(at) || at <= 0) return "now";

  const diffMs = Date.now() - at;
  if (diffMs < 60_000) return "now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  return `${years}y`;
}

export function notificationCategory(kind: string): "requests" | "trips" | "hosting" | "references" | "events" | "general" {
  const value = kind.toLowerCase();
  if (value.includes("hosting") || value.includes("host")) return "hosting";
  if (value.includes("trip")) return "trips";
  if (value.includes("event")) return "events";
  if (value.includes("reference")) return "references";
  if (value.includes("request")) return "requests";
  return "general";
}

export function notificationCategoryLabel(category: ReturnType<typeof notificationCategory>): string {
  switch (category) {
    case "requests":
      return "Requests";
    case "trips":
      return "Trips";
    case "hosting":
      return "Hosting";
    case "references":
      return "References";
    case "events":
      return "Events";
    default:
      return "General";
  }
}

export async function createSampleNotificationsForCurrentUser(): Promise<{ created: number; error: string | null }> {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) return { created: 0, error: sessionErr.message };

  const token = sessionData.session?.access_token ?? "";
  const userId = sessionData.session?.user?.id ?? "";
  if (!token || !userId) return { created: 0, error: "You must be signed in to create sample notifications." };

  const now = Date.now();
  const suffix = Math.random().toString(36).slice(2, 8);
  const samples: Array<{
    kind: "trip_request_received" | "trip_request_accepted" | "trip_request_declined" | "reference_received";
    title: string;
    body: string;
    linkUrl: string;
    metadata: Record<string, unknown>;
  }> = [
    {
      kind: "trip_request_received",
      title: "New trip request",
      body: "Alex wants to join your Tallinn dance trip.",
      linkUrl: "/messages?filter=requests",
      metadata: { sample: true, scenario: "trip_received", nonce: `${now}-1-${suffix}` },
    },
    {
      kind: "trip_request_accepted",
      title: "Trip request accepted",
      body: "Your Barcelona trip request was accepted.",
      linkUrl: "/trips/my",
      metadata: { sample: true, scenario: "trip_accepted", nonce: `${now}-2-${suffix}` },
    },
    {
      kind: "trip_request_declined",
      title: "Trip request declined",
      body: "A host declined this request. You can send a new one.",
      linkUrl: "/trips/explore",
      metadata: { sample: true, scenario: "trip_declined", nonce: `${now}-3-${suffix}` },
    },
    {
      kind: "reference_received",
      title: "New reference received",
      body: "You received a new reference from a recent dance connection.",
      linkUrl: "/references",
      metadata: { sample: true, scenario: "reference_received", nonce: `${now}-4-${suffix}` },
    },
  ];

  let created = 0;
  for (const sample of samples) {
    const res = await fetch("/api/notifications/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId,
        kind: sample.kind,
        title: sample.title,
        body: sample.body,
        linkUrl: sample.linkUrl,
        metadata: sample.metadata,
      }),
    });

    const payload = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !payload?.ok) {
      return { created, error: payload?.error ?? "Failed to create sample notifications." };
    }
    created += 1;
  }

  return { created, error: null };
}
