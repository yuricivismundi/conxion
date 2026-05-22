// Comprehensive rate limiting for API endpoints

import { buildRateLimitKey, consumeRateLimit } from "./rate-limit";

export type RateLimitRule = {
  windowMs: number; // Time window in milliseconds
  limit: number; // Max requests per window
  keyPrefix: string; // Unique key prefix
};

// Standard rate limit rules by endpoint category
export const RATE_LIMIT_RULES = {
  // Authentication: 5 attempts per 15 min
  auth: { windowMs: 15 * 60 * 1000, limit: 5, keyPrefix: "auth" },

  // Activity creation: 50 per hour
  activity_create: { windowMs: 60 * 60 * 1000, limit: 50, keyPrefix: "activity:create" },

  // Activity actions: 100 per hour
  activity_action: { windowMs: 60 * 60 * 1000, limit: 100, keyPrefix: "activity:action" },

  // Event creation: 10 per day
  event_create: { windowMs: 24 * 60 * 60 * 1000, limit: 10, keyPrefix: "event:create" },

  // Event search/list: 500 per hour (generous for browsing)
  event_list: { windowMs: 60 * 60 * 1000, limit: 500, keyPrefix: "event:list" },

  // Group creation: 5 per day
  group_create: { windowMs: 24 * 60 * 60 * 1000, limit: 5, keyPrefix: "group:create" },

  // Group actions: 100 per hour
  group_action: { windowMs: 60 * 60 * 1000, limit: 100, keyPrefix: "group:action" },

  // Booking creation: 20 per day
  booking_create: { windowMs: 24 * 60 * 60 * 1000, limit: 20, keyPrefix: "booking:create" },

  // Booking actions: 50 per day
  booking_action: { windowMs: 24 * 60 * 60 * 1000, limit: 50, keyPrefix: "booking:action" },

  // Service inquiry: 10 per day
  inquiry_create: { windowMs: 24 * 60 * 60 * 1000, limit: 10, keyPrefix: "inquiry:create" },

  // Message send: 500 per hour (users send lots of messages)
  message_send: { windowMs: 60 * 60 * 1000, limit: 500, keyPrefix: "message:send" },

  // Profile update: 50 per day
  profile_update: { windowMs: 24 * 60 * 60 * 1000, limit: 50, keyPrefix: "profile:update" },

  // Search/list endpoints: 1000 per hour (read-heavy)
  list_endpoint: { windowMs: 60 * 60 * 1000, limit: 1000, keyPrefix: "list" },

  // Direct invites (bypass): 5 per day
  direct_invite: { windowMs: 24 * 60 * 60 * 1000, limit: 5, keyPrefix: "direct-invite" },
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds?: number;
};

export function checkRateLimit(
  req: Request,
  userId: string | null,
  rule: RateLimitRule
): RateLimitResult {
  if (!userId) {
    // For unauthenticated endpoints, use IP address
    userId = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "anonymous";
  }

  const key = buildRateLimitKey(req, rule.keyPrefix, userId);
  const result = consumeRateLimit({ key, limit: rule.limit, windowMs: rule.windowMs });

  return {
    allowed: result.ok,
    remaining: Math.max(0, result.remainingRequests),
    resetAt: new Date(Date.now() + result.windowMs),
    retryAfterSeconds: result.ok ? undefined : result.retryAfterSec,
  };
}

export function createRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil(result.resetAt.getTime() / 1000)),
  };

  if (result.retryAfterSeconds) {
    headers["Retry-After"] = String(result.retryAfterSeconds);
  }

  return headers;
}
