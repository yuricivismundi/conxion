export type ConnectionStatus = "pending" | "accepted" | "blocked" | "declined";

export type ConnectionVisibilityRow = {
  id: string;
  requester_id: string;
  target_id: string;
  status: ConnectionStatus | string;
  blocked_by?: string | null;
};

export type DerivedConnectionState =
  | { status: "none" }
  | { status: "pending"; role: "requester" | "target"; id: string }
  | { status: "accepted"; id: string }
  | { status: "blocked"; id: string };

export function isConnectionParticipant(conn: ConnectionVisibilityRow, userId: string) {
  return conn.requester_id === userId || conn.target_id === userId;
}

export function getOtherUserId(conn: ConnectionVisibilityRow, userId: string) {
  if (conn.requester_id === userId) return conn.target_id;
  if (conn.target_id === userId) return conn.requester_id;
  return "";
}

export function isBlockedConnection(conn: ConnectionVisibilityRow) {
  return conn.status === "blocked" || Boolean(conn.blocked_by);
}

export function isVisibleAcceptedConnection(conn: ConnectionVisibilityRow, userId: string) {
  return isConnectionParticipant(conn, userId) && conn.status === "accepted" && !isBlockedConnection(conn);
}

export function isIncomingPendingConnection(conn: ConnectionVisibilityRow, userId: string) {
  return isConnectionParticipant(conn, userId) && conn.status === "pending" && conn.target_id === userId;
}

export function isOutgoingPendingConnection(conn: ConnectionVisibilityRow, userId: string) {
  return isConnectionParticipant(conn, userId) && conn.status === "pending" && conn.requester_id === userId;
}

export function deriveConnectionState(
  rows: ConnectionVisibilityRow[],
  myUserId: string,
  otherUserId: string
): DerivedConnectionState {
  const pairRows = rows.filter((r) => {
    const pairA = r.requester_id === myUserId && r.target_id === otherUserId;
    const pairB = r.requester_id === otherUserId && r.target_id === myUserId;
    return pairA || pairB;
  });

  if (!pairRows.length) return { status: "none" };

  const blocked = pairRows.find((r) => isBlockedConnection(r));
  if (blocked?.id) return { status: "blocked", id: blocked.id };

  const accepted = pairRows.find((r) => r.status === "accepted");
  if (accepted?.id) return { status: "accepted", id: accepted.id };

  const incoming = pairRows.find((r) => r.status === "pending" && r.target_id === myUserId);
  if (incoming?.id) return { status: "pending", role: "target", id: incoming.id };

  const outgoing = pairRows.find((r) => r.status === "pending" && r.requester_id === myUserId);
  if (outgoing?.id) return { status: "pending", role: "requester", id: outgoing.id };

  return { status: "none" };
}
