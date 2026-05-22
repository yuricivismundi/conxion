// Rate limit for directInvite activity creation to prevent abuse
// Limits: 5 per day per user to bypass connection requirements

const DIRECT_INVITE_KEY_PREFIX = "activity:direct-invite";
const DAILY_LIMIT = 5;
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory store for rate limiting (in production, use Redis)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function checkDirectInviteRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: Date | null } {
  const key = `${DIRECT_INVITE_KEY_PREFIX}:${userId}`;
  const now = Date.now();
  let record = rateLimitStore.get(key);

  // Initialize or reset if expired
  if (!record || record.resetAt <= now) {
    record = { count: 0, resetAt: now + WINDOW_MS };
    rateLimitStore.set(key, record);
  }

  const remaining = Math.max(0, DAILY_LIMIT - record.count);
  const allowed = remaining > 0;

  if (allowed) {
    record.count++;
  }

  return {
    allowed,
    remaining: Math.max(0, remaining - 1),
    resetAt: new Date(record.resetAt),
  };
}

// Clean up expired entries periodically
if (typeof window === "undefined") {
  // Server-side: cleanup every hour
  setInterval(() => {
    const now = Date.now();
    const keysToDelete: string[] = [];
    rateLimitStore.forEach((record, key) => {
      if (record.resetAt <= now) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((key) => rateLimitStore.delete(key));
  }, 60 * 60 * 1000);
}
