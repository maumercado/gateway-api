import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkRateLimit, getTenantRateLimitKey, getRouteRateLimitKey } from './index.js';

// The global setup.ts mocks ../shared/redis/client.js.
// We import the mock so we can control redis.eval per-test.
import { redis } from '../redis/client.js';

const mockRedis = redis as {
  eval: ReturnType<typeof vi.fn>;
};

describe('Rate Limiter', () => {
  describe('getTenantRateLimitKey', () => {
    it('should generate correct key for tenant', () => {
      const key = getTenantRateLimitKey('tenant-123');
      expect(key).toBe('tenant:tenant-123');
    });

    it('should handle UUID tenant IDs', () => {
      const key = getTenantRateLimitKey('550e8400-e29b-41d4-a716-446655440000');
      expect(key).toBe('tenant:550e8400-e29b-41d4-a716-446655440000');
    });
  });

  describe('getRouteRateLimitKey', () => {
    it('should generate correct key for route', () => {
      const key = getRouteRateLimitKey('tenant-123', 'route-456');
      expect(key).toBe('tenant:tenant-123:route:route-456');
    });

    it('should handle UUID IDs', () => {
      const key = getRouteRateLimitKey(
        '550e8400-e29b-41d4-a716-446655440000',
        '660e8400-e29b-41d4-a716-446655440001'
      );
      expect(key).toBe(
        'tenant:550e8400-e29b-41d4-a716-446655440000:route:660e8400-e29b-41d4-a716-446655440001'
      );
    });
  });

  describe('checkRateLimit', () => {
    const config = { requestsPerSecond: 10, burstSize: 10 };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should allow request when under the limit', async () => {
      const now = Date.now();
      // Lua returns [allowed=1, remaining=9, oldest_score=now, limit=10]
      mockRedis.eval.mockResolvedValue([1, 9, now, 10]);

      const result = await checkRateLimit('tenant:test', config);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.limit).toBe(10);
    });

    it('should deny request when at the limit', async () => {
      const now = Date.now();
      // Lua returns [allowed=0, remaining=0, oldest_score=now, limit=10]
      mockRedis.eval.mockResolvedValue([0, 0, now, 10]);

      const result = await checkRateLimit('tenant:test', config);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should compute resetAt from oldest_score + 1000ms window', async () => {
      const oldestScore = Date.now() - 500; // 500ms into the window
      mockRedis.eval.mockResolvedValue([1, 5, oldestScore, 10]);

      const result = await checkRateLimit('tenant:test', config);

      expect(result.resetAt).toBe(oldestScore + 1000);
    });

    it('should call redis.eval with the correct key and arguments', async () => {
      const now = Date.now();
      mockRedis.eval.mockResolvedValue([1, 9, now, 10]);

      await checkRateLimit('my-key', config);

      // First arg = script, second = numkeys=1, third = the key
      const call = mockRedis.eval.mock.calls[0] as unknown[];
      expect(call[1]).toBe(1); // numkeys
      expect(call[2]).toBe('ratelimit:my-key'); // KEYS[1]
    });

    it('should use burstSize as limit when provided', async () => {
      const now = Date.now();
      mockRedis.eval.mockResolvedValue([1, 149, now, 150]);

      const result = await checkRateLimit('tenant:test', {
        requestsPerSecond: 100,
        burstSize: 150,
      });

      expect(result.limit).toBe(150);
    });

    it('should fall back to requestsPerSecond when no burstSize', async () => {
      const now = Date.now();
      mockRedis.eval.mockResolvedValue([1, 99, now, 100]);

      const result = await checkRateLimit('tenant:test', {
        requestsPerSecond: 100,
      });

      expect(result.limit).toBe(100);
    });
  });
});
