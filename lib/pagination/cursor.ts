// Cursor-based pagination utilities
// Cursor is base64-encoded JSON: { id: string; sortValue: any }

export function encodeCursor(id: string, sortValue: unknown): string {
  return Buffer.from(JSON.stringify({ id, sortValue })).toString("base64");
}

export function decodeCursor(cursor: string): { id: string; sortValue: unknown } | null {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export type PaginationParams = {
  limit?: number;
  cursor?: string | null;
};

export type PaginationResponse<T> = {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
};

export function validatePaginationLimit(limit: unknown, defaultLimit = 50, maxLimit = 500): number {
  const parsed = typeof limit === "number" ? limit : parseInt(String(limit), 10);
  if (Number.isNaN(parsed) || parsed < 1) return defaultLimit;
  if (parsed > maxLimit) return maxLimit;
  return parsed;
}
