export type GroupChatMode = "broadcast" | "discussion";
export type GroupCoverStatus = "pending" | "approved" | "rejected";
export type GroupStatus = "active" | "archived";
export type GroupMemberRole = "host" | "member";

export type GroupRecord = {
  id: string;
  hostUserId: string;
  title: string;
  description: string | null;
  chatMode: GroupChatMode;
  city: string | null;
  country: string | null;
  coverUrl: string | null;
  coverStatus: GroupCoverStatus;
  maxMembers: number;
  inviteToken: string | null;
  status: GroupStatus;
  createdAt: string;
  updatedAt: string;
};

export type GroupMemberRecord = {
  id: string;
  groupId: string;
  userId: string;
  role: GroupMemberRole;
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(row: Record<string, unknown>, key: string, fallback = "") {
  const v = row[key];
  return typeof v === "string" ? v : fallback;
}

function pickNullableString(row: Record<string, unknown>, key: string) {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v : null;
}

function pickNumber(row: Record<string, unknown>, key: string, fallback: number) {
  const v = row[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function normalizeChatMode(raw: string): GroupChatMode {
  return raw === "broadcast" ? "broadcast" : "discussion";
}

function normalizeCoverStatus(raw: string): GroupCoverStatus {
  if (raw === "approved" || raw === "rejected") return raw;
  return "pending";
}

function normalizeStatus(raw: string): GroupStatus {
  return raw === "archived" ? "archived" : "active";
}

function normalizeRole(raw: string): GroupMemberRole {
  return raw === "host" ? "host" : "member";
}

export function mapGroupRows(rows: unknown[]): GroupRecord[] {
  return rows
    .map((raw) => {
      const row = asRecord(raw);
      const id = pickString(row, "id");
      const hostUserId = pickString(row, "host_user_id");
      const createdAt = pickString(row, "created_at");
      const updatedAt = pickString(row, "updated_at");
      if (!id || !hostUserId || !createdAt || !updatedAt) return null;
      return {
        id,
        hostUserId,
        title: pickString(row, "title") || "Untitled Group",
        description: pickNullableString(row, "description"),
        chatMode: normalizeChatMode(pickString(row, "chat_mode")),
        city: pickNullableString(row, "city"),
        country: pickNullableString(row, "country"),
        coverUrl: pickNullableString(row, "cover_url"),
        coverStatus: normalizeCoverStatus(pickString(row, "cover_status")),
        maxMembers: pickNumber(row, "max_members", 25),
        inviteToken: pickNullableString(row, "invite_token"),
        status: normalizeStatus(pickString(row, "status")),
        createdAt,
        updatedAt,
      } satisfies GroupRecord;
    })
    .filter((g): g is GroupRecord => Boolean(g));
}

export function mapGroupMemberRows(rows: unknown[]): GroupMemberRecord[] {
  return rows
    .map((raw) => {
      const row = asRecord(raw);
      const id = pickString(row, "id");
      const groupId = pickString(row, "group_id");
      const userId = pickString(row, "user_id");
      const createdAt = pickString(row, "created_at");
      const updatedAt = pickString(row, "updated_at");
      if (!id || !groupId || !userId || !createdAt || !updatedAt) return null;
      return {
        id,
        groupId,
        userId,
        role: normalizeRole(pickString(row, "role")),
        joinedAt: pickString(row, "joined_at") || createdAt,
        createdAt,
        updatedAt,
      } satisfies GroupMemberRecord;
    })
    .filter((m): m is GroupMemberRecord => Boolean(m));
}
