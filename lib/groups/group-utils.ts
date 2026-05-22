// Utility functions for group operations

export type GroupRole = "host" | "member";
export type GroupChatMode = "discussion" | "broadcast";

export function normalizeGroupChatMode(value: unknown): GroupChatMode {
  if (value === "broadcast") return "broadcast";
  return "discussion";
}

export function getGroupRoleLabel(role: GroupRole): string {
  if (role === "host") return "Admin";
  return "Member";
}

export function getGroupChatModeLabel(mode: GroupChatMode): string {
  if (mode === "broadcast") return "Broadcast";
  return "Discussion";
}

export function canUserManageGroup(userRole: GroupRole | null): boolean {
  return userRole === "host";
}

export function canUserEditGroup(userRole: GroupRole | null): boolean {
  return userRole === "host";
}

export function canUserDeleteGroup(userRole: GroupRole | null): boolean {
  return userRole === "host";
}

export function canUserInviteToGroup(userRole: GroupRole | null): boolean {
  return userRole === "host";
}

export function validateGroupTitle(title: string): { valid: boolean; error?: string } {
  const trimmed = title.trim();
  if (!trimmed) return { valid: false, error: "Group name is required" };
  if (trimmed.length < 3) return { valid: false, error: "Group name must be at least 3 characters" };
  if (trimmed.length > 100) return { valid: false, error: "Group name must be less than 100 characters" };
  return { valid: true };
}

export function validateGroupDescription(description: string): { valid: boolean; error?: string } {
  const trimmed = description.trim();
  if (!trimmed) return { valid: false, error: "Description is required" };
  if (trimmed.length < 10) return { valid: false, error: "Description must be at least 10 characters" };
  if (trimmed.length > 1000) return { valid: false, error: "Description must be less than 1000 characters" };
  return { valid: true };
}
