// Utility functions for event operations

export type EventAccessType = "public" | "request_join" | "private_group";
export type EventChatMode = "discussion" | "broadcast";

export function normalizeEventAccessType(value: unknown): EventAccessType {
  if (value === "request_join") return "request_join";
  if (value === "private_group") return "private_group";
  return "public";
}

export function normalizeEventChatMode(value: unknown): EventChatMode {
  if (value === "broadcast") return "broadcast";
  return "discussion";
}

export function getEventAccessTypeLabel(type: EventAccessType): string {
  if (type === "request_join") return "Request to Join";
  if (type === "private_group") return "Private Group";
  return "Public";
}

export function getEventChatModeLabel(mode: EventChatMode): string {
  if (mode === "broadcast") return "Broadcast";
  return "Discussion";
}

export function shouldAllowRSVP(accessType: EventAccessType): boolean {
  return accessType === "public" || accessType === "request_join";
}

export function shouldAllowPrivateChat(accessType: EventAccessType, isAttending: boolean): boolean {
  // Private events don't auto-enable chat; only attendees can chat in events
  return isAttending && accessType !== "private_group";
}

export function validateEventWindow(
  startsAt: string,
  endsAt: string | null
): { valid: boolean; error?: string } {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) {
    return { valid: false, error: "Invalid start date" };
  }

  if (endsAt) {
    const end = new Date(endsAt);
    if (Number.isNaN(end.getTime())) {
      return { valid: false, error: "Invalid end date" };
    }
    if (end.getTime() <= start.getTime()) {
      return { valid: false, error: "End time must be after start time" };
    }
  }

  return { valid: true };
}
