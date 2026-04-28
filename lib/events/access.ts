export type EventAccessType = "public" | "request" | "private_group";
export type EventChatMode = "none" | "broadcast" | "discussion";

export const EVENT_ACCESS_TYPE_OPTIONS: Array<{
  value: EventAccessType;
  label: string;
  helper: string;
}> = [
  {
    value: "public",
    label: "Public Event",
    helper: "Visible in discovery. Members can join directly. Organisers post updates.",
  },
  {
    value: "request",
    label: "Request Event",
    helper: "Visible in discovery. Members request approval before joining. Organisers post updates.",
  },
  {
    value: "private_group",
    label: "Private Group",
    helper: "Hidden from discovery. Share it directly and plan your dance life together.",
  },
];

export const PRIVATE_GROUP_CHAT_MODE_OPTIONS: Array<{
  value: Extract<EventChatMode, "broadcast" | "discussion">;
  label: string;
  helper: string;
}> = [
  {
    value: "discussion",
    label: "Discussion",
    helper: "All members can chat inside the group.",
  },
  {
    value: "broadcast",
    label: "Broadcast",
    helper: "Only organisers post updates. Members read only.",
  },
];

export function normalizeEventAccessType(raw: string | null | undefined, legacyVisibility?: string | null | undefined): EventAccessType {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "request") return "request";
  if (normalized === "private_group") return "private_group";
  if (normalized === "public") return "public";
  return (legacyVisibility ?? "").trim().toLowerCase() === "private" ? "request" : "public";
}

export function normalizeEventChatMode(raw: string | null | undefined, accessType: EventAccessType): EventChatMode {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "broadcast" || normalized === "discussion") {
    return normalized;
  }

  if (accessType === "private_group") return "discussion";
  return "broadcast";
}

export function legacyVisibilityFromAccessType(accessType: EventAccessType): "public" | "private" {
  return accessType === "private_group" ? "private" : "public";
}

export function eventAccessTypeLabel(accessType: EventAccessType) {
  if (accessType === "request") return "Request Event";
  if (accessType === "private_group") return "Private Group";
  return "Public Event";
}

export function eventAccessTypeShortLabel(accessType: EventAccessType) {
  if (accessType === "request") return "Request";
  if (accessType === "private_group") return "Private Group";
  return "Public";
}

export function eventThreadTabLabel(accessType: EventAccessType, chatMode?: EventChatMode | null) {
  return accessType === "private_group" || chatMode === "discussion" ? "Chat" : "Updates";
}

export function isEventDiscoverable(accessType: EventAccessType) {
  return accessType !== "private_group";
}

export function canPostToEventThread(params: {
  accessType: EventAccessType;
  chatMode: EventChatMode;
  isHost: boolean;
  isAdmin?: boolean;
}) {
  if (params.isAdmin || params.isHost) return true;
  return params.chatMode === "discussion";
}
