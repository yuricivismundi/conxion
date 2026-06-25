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
  group_id?: string | null;
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
  if (type === "group" && typeof thread.group_id === "string" && thread.group_id) {
    return `group:${thread.group_id}`;
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
    .select("id,thread_type,connection_id,trip_id,event_id,group_id,last_message_at")
    .in("id", threadIds)
    .limit(Math.max(threadIds.length, 1));

  if (threadRes.error) return { tokens: new Set<string>(), error: threadRes.error.message };

  const threadMap = new Map<string, ThreadRow>();
  for (const raw of (threadRes.data ?? []) as ThreadRow[]) {
    const id = typeof raw.id === "string" ? raw.id : "";
    if (id) threadMap.set(id, raw);
  }

  // Build the candidate set first: threads where last_message_at > last_read_at.
  // Then verify the LAST message in each candidate was NOT sent by the current user
  // — otherwise their own outgoing message inflates the unread count even though
  // there's nothing new for them to read.
  const candidates: Array<{ threadId: string; lastReadAt: number; thread: ThreadRow }> = [];
  for (const row of activeParticipants) {
    const threadId = typeof row.thread_id === "string" ? row.thread_id : "";
    if (!threadId) continue;
    const thread = threadMap.get(threadId);
    if (!thread) continue;
    const lastMessageAt = toEpoch(thread.last_message_at);
    if (!lastMessageAt) continue;
    const lastReadAt = toEpoch(row.last_read_at);
    if (lastReadAt && lastMessageAt <= lastReadAt) continue;
    candidates.push({ threadId, lastReadAt, thread });
  }

  if (candidates.length === 0) return { tokens: new Set<string>(), error: null };

  // Fetch incoming messages (from someone other than the user) across all candidate
  // threads. We only care whether any incoming message exists newer than this user's
  // last_read_at for each thread.
  const candidateIds = candidates.map((c) => c.threadId);
  const messagesRes = await supabase
    .from("thread_messages")
    .select("thread_id,sender_id,created_at")
    .in("thread_id", candidateIds)
    .neq("sender_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.max(candidateIds.length * 5, 200));

  if (messagesRes.error) return { tokens: new Set<string>(), error: messagesRes.error.message };

  const latestIncomingByThread = new Map<string, number>();
  for (const raw of (messagesRes.data ?? []) as Array<{ thread_id?: string | null; created_at?: string | null }>) {
    const tid = typeof raw.thread_id === "string" ? raw.thread_id : "";
    if (!tid) continue;
    if (latestIncomingByThread.has(tid)) continue; // ordered desc, first hit wins
    const ts = toEpoch(raw.created_at);
    if (ts) latestIncomingByThread.set(tid, ts);
  }

  const unreadTokens = new Set<string>();
  for (const c of candidates) {
    const latestIncoming = latestIncomingByThread.get(c.threadId);
    if (!latestIncoming) continue; // no incoming messages → user is alone or sent the last one
    if (c.lastReadAt && latestIncoming <= c.lastReadAt) continue; // already read past it
    const token = toThreadToken(c.thread);
    if (token) unreadTokens.add(token);
  }

  return { tokens: unreadTokens, error: null };
}

export async function fetchUnreadThreadCount(userId: string): Promise<{ count: number; error: string | null }> {
  const res = await fetchUnreadThreadTokens(userId);
  return { count: res.tokens.size, error: res.error };
}
