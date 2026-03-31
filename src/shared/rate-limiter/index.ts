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
 * Lua script for atomic sliding window rate limiting.
 *
 * All operations — expire old entries, count, conditionally add, get oldest
 * for reset time — execute in a single atomic round trip.
 *
 * KEYS[1]: sorted set key
 * ARGV[1]: current timestamp (ms)
 * ARGV[2]: window start timestamp (ms, = now - windowMs)
 * ARGV[3]: rate limit (max requests per window)
 * ARGV[4]: unique member string for this request
 * ARGV[5]: TTL in seconds for key expiry
 *
 * Returns: [allowed (0|1), remaining, oldest_score, limit]
 */
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_start = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local ttl = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

local count = redis.call('ZCARD', key)
local allowed = 0
local remaining = 0

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, ttl)
  allowed = 1
  remaining = limit - count - 1
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldest_score = now
if #oldest >= 2 then
  oldest_score = tonumber(oldest[2])
end

return {allowed, remaining, oldest_score, limit}
`;

/**
 * Sliding window rate limiter using Redis sorted sets.
 * Uses an atomic Lua script — single round trip, no race conditions.
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
  const member = `${now}:${Math.random()}`;
  const ttl = Math.ceil(windowMs / 1000) + 1;

  const result = await redis.eval(
    RATE_LIMIT_SCRIPT,
    1,
    redisKey,
    now,
    windowStart,
    limit,
    member,
    ttl
  ) as [number, number, number, number];

  const [allowedInt, remaining, oldestScore] = result;

  return {
    allowed: allowedInt === 1,
    remaining,
    resetAt: oldestScore + windowMs,
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
