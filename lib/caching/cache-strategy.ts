// Response caching strategy for common queries

// In-memory cache (can be replaced with Redis)
const memoryCache = new Map<string, { data: unknown; expiresAt: number }>();

export type CacheConfig = {
  key: string;
  ttlSeconds: number;
  generator: () => Promise<unknown>;
};

// Standard cache TTLs
export const CACHE_TTL = {
  // User profiles - changes infrequently
  profile: 5 * 60, // 5 minutes

  // Thread info - rarely changes
  thread: 10 * 60, // 10 minutes

  // Pagination results - stale data acceptable
  pagination: 2 * 60, // 2 minutes

  // FAQ/help articles - static content
  staticContent: 60 * 60, // 1 hour

  // User activity summary - moderate freshness
  activitySummary: 5 * 60, // 5 minutes

  // Search results - moderate freshness
  searchResults: 3 * 60, // 3 minutes

  // Event/group info - moderate changes
  eventInfo: 10 * 60, // 10 minutes
  groupInfo: 10 * 60, // 10 minutes

  // Billing info - user-specific, moderate freshness
  billingInfo: 15 * 60, // 15 minutes

  // Rate limit data - very fresh (1 min)
  rateLimitData: 60, // 1 minute
};

export async function getCachedOrGenerate<T>(config: CacheConfig): Promise<T> {
  const now = Date.now();

  // Check cache
  const cached = memoryCache.get(config.key);
  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  // Generate new data
  const data = await config.generator();

  // Store in cache
  memoryCache.set(config.key, {
    data,
    expiresAt: now + config.ttlSeconds * 1000,
  });

  return data as T;
}

export function invalidateCache(keyPattern: string | string[]): void {
  const patterns = Array.isArray(keyPattern) ? keyPattern : [keyPattern];

  memoryCache.forEach((_, key) => {
    if (patterns.some((p) => key.includes(p))) {
      memoryCache.delete(key);
    }
  });
}

export function clearCache(): void {
  memoryCache.clear();
}

// Cleanup expired cache entries periodically
if (typeof window === "undefined") {
  setInterval(() => {
    const now = Date.now();
    const keysToDelete: string[] = [];

    memoryCache.forEach((record, key) => {
      if (record.expiresAt <= now) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => memoryCache.delete(key));
  }, 60 * 1000); // Run every minute
}

// Cache key builders
export function buildProfileCacheKey(userId: string): string {
  return `profile:${userId}`;
}

export function buildThreadCacheKey(threadId: string): string {
  return `thread:${threadId}`;
}

export function buildThreadListCacheKey(userId: string, filter: string): string {
  return `threadlist:${userId}:${filter}`;
}

export function buildEventCacheKey(eventId: string): string {
  return `event:${eventId}`;
}

export function buildGroupCacheKey(groupId: string): string {
  return `group:${groupId}`;
}

export function buildUserActivitiesCacheKey(userId: string, filter: string): string {
  return `activities:${userId}:${filter}`;
}
