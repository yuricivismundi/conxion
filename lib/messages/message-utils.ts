// Utility functions for message operations

export type MessagingState = "active" | "inactive" | "archived";
export type ThreadStatus = "pending" | "accepted" | "active" | "completed" | "declined" | "cancelled";

export function normalizeMessagingState(value: unknown, fallback: MessagingState = "inactive"): MessagingState {
  if (value === "active") return "active";
  if (value === "archived") return "archived";
  if (value === "inactive") return "inactive";
  return fallback;
}

export function isThreadActive(status: ThreadStatus): boolean {
  return status === "active" || status === "accepted" || status === "completed";
}

export function canArchiveThread(status: MessagingState): boolean {
  return status === "active" || status === "inactive";
}

export function canUnarchiveThread(status: MessagingState): boolean {
  return status === "archived";
}

export function formatMessagePreview(message: string, maxChars = 60): string {
  const trimmed = message.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars) + "…";
}

export function getThreadInitials(displayName: string | null): string {
  if (!displayName || displayName.trim() === "") return "?";
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function calculateMessageTTL(createdAt: string | Date): { expired: boolean; remainingMs: number } {
  const created = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const now = Date.now();
  const createdMs = created.getTime();
  const ageMs = now - createdMs;

  // Messages expire after 30 days
  const expiryMs = 30 * 24 * 60 * 60 * 1000;
  const remainingMs = Math.max(0, expiryMs - ageMs);

  return {
    expired: remainingMs === 0,
    remainingMs,
  };
}

export function shouldShowRecentLabel(createdAt: string | Date): boolean {
  const created = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const now = Date.now();
  const ageMs = now - created.getTime();

  // Show "recent" label for messages less than 24 hours old
  return ageMs < 24 * 60 * 60 * 1000;
}
