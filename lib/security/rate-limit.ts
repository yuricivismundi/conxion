type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type ConsumeRateLimitParams = {
  key: string;
  limit: number;
  windowMs: number;
};

type ConsumeRateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
  resetAt: number;
};

declare global {
  var __cxRateLimitStore: Map<string, RateLimitBucket> | undefined;
  var __cxRateLimitSweepAt: number | undefined;
}

function getStore() {
  if (!globalThis.__cxRateLimitStore) {
    globalThis.__cxRateLimitStore = new Map<string, RateLimitBucket>();
  }
  return globalThis.__cxRateLimitStore;
}

function sweepExpiredBuckets(nowMs: number) {
  const lastSweep = globalThis.__cxRateLimitSweepAt ?? 0;
  if (nowMs - lastSweep < 60_000) return;

  const store = getStore();
  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= nowMs) {
      store.delete(key);
    }
  }
  globalThis.__cxRateLimitSweepAt = nowMs;
}

export function getClientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim().slice(0, 128);
  return "unknown";
}

export function buildRateLimitKey(req: Request, scope: string, userId?: string | null) {
  const ip = getClientIp(req);
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 128);
  const principal = typeof userId === "string" && userId.trim() ? userId.trim() : "";
  return principal ? `${scope}:user:${principal}` : `${scope}:ip:${ip}:ua:${ua}`;
}

export function consumeRateLimit(params: ConsumeRateLimitParams): ConsumeRateLimitResult {
  const limit = Math.max(1, Math.floor(params.limit));
  const windowMs = Math.max(1_000, Math.floor(params.windowMs));
  const nowMs = Date.now();

  sweepExpiredBuckets(nowMs);
  const store = getStore();
  const existing = store.get(params.key);

  if (!existing || existing.resetAt <= nowMs) {
    const resetAt = nowMs + windowMs;
    store.set(params.key, { count: 1, resetAt });
    return {
      ok: true,
      limit,
      remaining: Math.max(0, limit - 1),
      retryAfterSec: 0,
      resetAt,
    };
  }

  if (existing.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000));
    return {
      ok: false,
      limit,
      remaining: 0,
      retryAfterSec,
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  store.set(params.key, existing);
  return {
    ok: true,
    limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSec: 0,
    resetAt: existing.resetAt,
  };
}
