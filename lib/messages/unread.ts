import { supabase } from "@/lib/supabase/client";

function toEpoch(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

type ParticipantRow = {
  thread_id?: string | null;
  last_read_at?: string | null;
  archived_at?: string | null;
};

type ThreadRow = {
  id?: string | null;
  thread_type?: string | null;
  connection_id?: string | null;
  trip_id?: string | null;
  event_id?: string | null;
  last_message_at?: string | null;
};

async function fetchParticipants(userId: string): Promise<{ rows: ParticipantRow[]; error: string | null }> {
  const full = await supabase
    .from("thread_participants")
    .select("thread_id,last_read_at,archived_at")
    .eq("user_id", userId)
    .limit(1200);

  if (!full.error) {
    return { rows: (full.data ?? []) as ParticipantRow[], error: null };
  }

  const lower = full.error.message.toLowerCase();
  const missingArchived =
    lower.includes("archived_at") &&
    (lower.includes("does not exist") || lower.includes("schema cache") || lower.includes("column"));

  if (!missingArchived) {
    return { rows: [], error: full.error.message };
  }

  const fallback = await supabase
    .from("thread_participants")
    .select("thread_id,last_read_at")
    .eq("user_id", userId)
    .limit(1200);

  if (fallback.error) {
    return { rows: [], error: fallback.error.message };
  }

  return { rows: (fallback.data ?? []) as ParticipantRow[], error: null };
}

function toThreadToken(thread: ThreadRow): string | null {
  const threadId = typeof thread.id === "string" ? thread.id : "";
  if (!threadId) return null;
  const type = typeof thread.thread_type === "string" ? thread.thread_type : "";
  if (type === "connection" && typeof thread.connection_id === "string" && thread.connection_id) {
    return `conn:${thread.connection_id}`;
  }
  if (type === "trip" && typeof thread.trip_id === "string" && thread.trip_id) {
    return `trip:${thread.trip_id}`;
  }
  if (type === "event" && typeof thread.event_id === "string" && thread.event_id) {
    return `event:${thread.event_id}`;
  }
  if (type === "direct") {
    return `direct:${threadId}`;
  }
  return `thread:${threadId}`;
}

export async function fetchUnreadThreadTokens(userId: string): Promise<{ tokens: Set<string>; error: string | null }> {
  const participantRes = await fetchParticipants(userId);
  if (participantRes.error) return { tokens: new Set<string>(), error: participantRes.error };

  const activeParticipants = participantRes.rows.filter((row) => {
    const threadId = typeof row.thread_id === "string" ? row.thread_id : "";
    if (!threadId) return false;
    if (typeof row.archived_at === "string" && row.archived_at.trim().length > 0) return false;
    return true;
  });

  const threadIds = Array.from(
    new Set(activeParticipants.map((row) => (typeof row.thread_id === "string" ? row.thread_id : "")).filter(Boolean))
  );
  if (threadIds.length === 0) return { tokens: new Set<string>(), error: null };

  const threadRes = await supabase
    .from("threads")
    .select("id,thread_type,connection_id,trip_id,event_id,last_message_at")
    .in("id", threadIds)
    .limit(Math.max(threadIds.length, 1));

  if (threadRes.error) return { tokens: new Set<string>(), error: threadRes.error.message };

  const threadMap = new Map<string, ThreadRow>();
  for (const raw of (threadRes.data ?? []) as ThreadRow[]) {
    const id = typeof raw.id === "string" ? raw.id : "";
    if (id) threadMap.set(id, raw);
  }

  const unreadTokens = new Set<string>();
  for (const row of activeParticipants) {
    const threadId = typeof row.thread_id === "string" ? row.thread_id : "";
    if (!threadId) continue;

    const thread = threadMap.get(threadId);
    const lastMessageAt = toEpoch(thread?.last_message_at);
    if (!lastMessageAt) continue;

    const lastReadAt = toEpoch(row.last_read_at);
    if (!lastReadAt || lastMessageAt > lastReadAt) {
      const token = toThreadToken(thread ?? {});
      if (token) unreadTokens.add(token);
    }
  }

  return { tokens: unreadTokens, error: null };
}

export async function fetchUnreadThreadCount(userId: string): Promise<{ count: number; error: string | null }> {
  const res = await fetchUnreadThreadTokens(userId);
  return { count: res.tokens.size, error: res.error };
}
