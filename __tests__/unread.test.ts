/**
 * Unit tests for lib/messages/unread.ts logic.
 *
 * We extract and test the pure helper functions by copy — the Supabase
 * client is not imported here, so no mocking is needed.
 */
import { describe, expect, it } from "vitest";

// ── toEpoch (extracted from source) ───────────────────────────────────────

function toEpoch(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

describe("toEpoch", () => {
  it("returns 0 for null", () => expect(toEpoch(null)).toBe(0));
  it("returns 0 for undefined", () => expect(toEpoch(undefined)).toBe(0));
  it("returns 0 for empty string", () => expect(toEpoch("")).toBe(0));
  it("returns 0 for invalid date string", () => expect(toEpoch("not-a-date")).toBe(0));
  it("returns correct ms for valid ISO string", () => {
    const iso = "2024-06-01T10:00:00.000Z";
    expect(toEpoch(iso)).toBe(new Date(iso).getTime());
  });
  it("handles date-only strings", () => {
    const iso = "2024-06-01";
    expect(toEpoch(iso)).toBeGreaterThan(0);
  });
});

// ── toThreadToken (extracted from source) ─────────────────────────────────

type ThreadRow = {
  id?: string | null;
  thread_type?: string | null;
  connection_id?: string | null;
  trip_id?: string | null;
  event_id?: string | null;
  group_id?: string | null;
  last_message_at?: string | null;
};

function toThreadToken(thread: ThreadRow): string | null {
  const threadId = typeof thread.id === "string" ? thread.id : "";
  if (!threadId) return null;
  const type = typeof thread.thread_type === "string" ? thread.thread_type : "";
  if (type === "connection" && typeof thread.connection_id === "string" && thread.connection_id)
    return `conn:${thread.connection_id}`;
  if (type === "trip" && typeof thread.trip_id === "string" && thread.trip_id)
    return `trip:${thread.trip_id}`;
  if (type === "event" && typeof thread.event_id === "string" && thread.event_id)
    return `event:${thread.event_id}`;
  if (type === "group" && typeof thread.group_id === "string" && thread.group_id)
    return `group:${thread.group_id}`;
  if (type === "direct") return `direct:${threadId}`;
  return `thread:${threadId}`;
}

describe("toThreadToken", () => {
  it("returns null when id is missing", () => {
    expect(toThreadToken({})).toBeNull();
    expect(toThreadToken({ id: null })).toBeNull();
    expect(toThreadToken({ id: "" })).toBeNull();
  });

  it("connection type uses connection_id", () => {
    expect(toThreadToken({ id: "t1", thread_type: "connection", connection_id: "c1" })).toBe("conn:c1");
  });

  it("connection type falls back to thread:id when connection_id missing", () => {
    expect(toThreadToken({ id: "t1", thread_type: "connection" })).toBe("thread:t1");
  });

  it("trip type uses trip_id", () => {
    expect(toThreadToken({ id: "t1", thread_type: "trip", trip_id: "trip99" })).toBe("trip:trip99");
  });

  it("event type uses event_id", () => {
    expect(toThreadToken({ id: "t1", thread_type: "event", event_id: "ev42" })).toBe("event:ev42");
  });

  it("group type uses group_id", () => {
    expect(toThreadToken({ id: "t1", thread_type: "group", group_id: "g7" })).toBe("group:g7");
  });

  it("direct type uses thread id", () => {
    expect(toThreadToken({ id: "t1", thread_type: "direct" })).toBe("direct:t1");
  });

  it("unknown type falls back to thread:id", () => {
    expect(toThreadToken({ id: "t1", thread_type: "unknown" })).toBe("thread:t1");
  });
});

// ── unread candidate logic ─────────────────────────────────────────────────
// This replicates the candidate-building logic from fetchUnreadThreadTokens
// so we can test the decision rules without Supabase.

type ParticipantRow = {
  thread_id?: string | null;
  last_read_at?: string | null;
  archived_at?: string | null;
};

function buildCandidates(
  participants: ParticipantRow[],
  threads: ThreadRow[]
) {
  const threadMap = new Map(threads.map((t) => [t.id!, t]));

  const active = participants.filter((row) => {
    const threadId = typeof row.thread_id === "string" ? row.thread_id : "";
    if (!threadId) return false;
    if (typeof row.archived_at === "string" && row.archived_at.trim().length > 0) return false;
    return true;
  });

  return active
    .map((row) => {
      const threadId = typeof row.thread_id === "string" ? row.thread_id : "";
      const thread = threadMap.get(threadId);
      if (!thread) return null;
      const lastMessageAt = toEpoch(thread.last_message_at);
      if (!lastMessageAt) return null;
      const lastReadAt = toEpoch(row.last_read_at);
      if (lastReadAt && lastMessageAt <= lastReadAt) return null;
      return { threadId, lastReadAt, thread };
    })
    .filter(Boolean);
}

describe("unread candidate building", () => {
  const thread: ThreadRow = {
    id: "t1",
    thread_type: "connection",
    connection_id: "c1",
    last_message_at: "2024-06-01T12:00:00Z",
  };

  it("includes thread with message newer than last_read_at", () => {
    const candidates = buildCandidates(
      [{ thread_id: "t1", last_read_at: "2024-06-01T10:00:00Z" }],
      [thread]
    );
    expect(candidates).toHaveLength(1);
  });

  it("excludes thread when last_read_at equals last_message_at", () => {
    const candidates = buildCandidates(
      [{ thread_id: "t1", last_read_at: "2024-06-01T12:00:00Z" }],
      [thread]
    );
    expect(candidates).toHaveLength(0);
  });

  it("excludes thread when last_read_at is newer than last_message_at", () => {
    const candidates = buildCandidates(
      [{ thread_id: "t1", last_read_at: "2024-06-01T13:00:00Z" }],
      [thread]
    );
    expect(candidates).toHaveLength(0);
  });

  it("includes thread when last_read_at is null (never read)", () => {
    const candidates = buildCandidates(
      [{ thread_id: "t1", last_read_at: null }],
      [thread]
    );
    expect(candidates).toHaveLength(1);
  });

  it("excludes archived threads", () => {
    const candidates = buildCandidates(
      [{ thread_id: "t1", last_read_at: null, archived_at: "2024-05-01T00:00:00Z" }],
      [thread]
    );
    expect(candidates).toHaveLength(0);
  });

  it("excludes thread not present in threadMap", () => {
    const candidates = buildCandidates(
      [{ thread_id: "missing", last_read_at: null }],
      [thread]
    );
    expect(candidates).toHaveLength(0);
  });
});

// ── incoming message check ─────────────────────────────────────────────────
// Replicates the final step: only mark unread if incoming > lastReadAt

function resolveUnreadTokens(
  candidates: Array<{ threadId: string; lastReadAt: number; thread: ThreadRow }>,
  latestIncomingByThread: Map<string, number>
): Set<string> {
  const unread = new Set<string>();
  for (const c of candidates) {
    const latestIncoming = latestIncomingByThread.get(c.threadId);
    if (!latestIncoming) continue;
    if (c.lastReadAt && latestIncoming <= c.lastReadAt) continue;
    const token = toThreadToken(c.thread);
    if (token) unread.add(token);
  }
  return unread;
}

describe("resolveUnreadTokens", () => {
  const thread: ThreadRow = { id: "t1", thread_type: "connection", connection_id: "c1" };
  const candidate = { threadId: "t1", lastReadAt: toEpoch("2024-06-01T10:00:00Z"), thread };

  it("marks thread unread when incoming message is newer than last_read_at", () => {
    const map = new Map([["t1", toEpoch("2024-06-01T12:00:00Z")]]);
    expect(resolveUnreadTokens([candidate], map)).toContain("conn:c1");
  });

  it("does NOT mark unread when incoming is older than last_read_at (user already read it)", () => {
    const map = new Map([["t1", toEpoch("2024-06-01T09:00:00Z")]]);
    expect(resolveUnreadTokens([candidate], map).size).toBe(0);
  });

  it("does NOT mark unread when no incoming message exists (user sent last message)", () => {
    expect(resolveUnreadTokens([candidate], new Map()).size).toBe(0);
  });

  it("handles multiple threads correctly", () => {
    const t2: ThreadRow = { id: "t2", thread_type: "direct" };
    const candidates = [
      candidate,
      { threadId: "t2", lastReadAt: 0, thread: t2 },
    ];
    const map = new Map([
      ["t1", toEpoch("2024-06-01T09:00:00Z")], // older → not unread
      ["t2", toEpoch("2024-06-01T12:00:00Z")], // newer → unread
    ]);
    const result = resolveUnreadTokens(candidates, map);
    expect(result.has("conn:c1")).toBe(false);
    expect(result.has("direct:t2")).toBe(true);
  });
});
