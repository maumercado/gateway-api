import { redis } from '../redis/client.js';
import type { RateLimitConfig } from '../types/index.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

const DEFAULT_WINDOW_MS = 1000; // 1 second window

/**
 * Sliding window rate limiter using Redis
 * Uses a sorted set to track request timestamps
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = DEFAULT_WINDOW_MS;
  const windowStart = now - windowMs;
  const limit = config.burstSize ?? config.requestsPerSecond;

  const redisKey = `ratelimit:${key}`;

  // Use a pipeline for atomic operations
  const pipeline = redis.pipeline();

  // Remove old entries outside the window
  pipeline.zremrangebyscore(redisKey, 0, windowStart);

  // Count current requests in window
  pipeline.zcard(redisKey);

  // Add current request with timestamp as score
  pipeline.zadd(redisKey, now, `${now}:${Math.random()}`);

  // Set expiry on the key
  pipeline.expire(redisKey, Math.ceil(windowMs / 1000) + 1);

  const results = await pipeline.exec();

  // Get the count before adding current request
  const currentCount = (results?.[1]?.[1] as number) ?? 0;

  const allowed = currentCount < limit;
  const remaining = Math.max(0, limit - currentCount - 1);

  // Get the oldest entry to calculate reset time
  const oldestEntries = await redis.zrange(redisKey, 0, 0, 'WITHSCORES');
  const oldestTimestamp = oldestEntries[1]
    ? parseInt(oldestEntries[1], 10)
    : now;
  const resetAt = oldestTimestamp + windowMs;

  if (!allowed) {
    // Remove the request we just added since it's not allowed
    await redis.zremrangebyscore(redisKey, now, now + 1);
  }

  return {
    allowed,
    remaining,
    resetAt,
    limit,
  };
}

/**
 * Generate rate limit key for a tenant
 */
export function getTenantRateLimitKey(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/**
 * Generate rate limit key for a specific route
 */
export function getRouteRateLimitKey(
  tenantId: string,
  routeId: string
): string {
  return `tenant:${tenantId}:route:${routeId}`;
}
