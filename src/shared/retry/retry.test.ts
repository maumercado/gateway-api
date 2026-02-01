import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  calculateDelay,
  isRetryableStatusCode,
  isRetryableError,
  withRetry,
  mergeRetryConfig,
} from './index.js';

describe('Retry Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateDelay', () => {
    it('should calculate exponential delay', () => {
      const delay0 = calculateDelay(0, 1000, 30000);
      const delay1 = calculateDelay(1, 1000, 30000);
      const delay2 = calculateDelay(2, 1000, 30000);

      // Base delay (with jitter between 1000-1250)
      expect(delay0).toBeGreaterThanOrEqual(1000);
      expect(delay0).toBeLessThanOrEqual(1250);

      // 2x base (with jitter between 2000-2500)
      expect(delay1).toBeGreaterThanOrEqual(2000);
      expect(delay1).toBeLessThanOrEqual(2500);

      // 4x base (with jitter between 4000-5000)
      expect(delay2).toBeGreaterThanOrEqual(4000);
      expect(delay2).toBeLessThanOrEqual(5000);
    });

    it('should cap delay at maxDelay', () => {
      const delay = calculateDelay(10, 1000, 5000);

      // Should be capped at 5000 (with jitter between 5000-6250)
      expect(delay).toBeLessThanOrEqual(6250);
    });
  });

  describe('isRetryableStatusCode', () => {
    it('should return true for default retryable codes', () => {
      expect(isRetryableStatusCode(500)).toBe(true);
      expect(isRetryableStatusCode(502)).toBe(true);
      expect(isRetryableStatusCode(503)).toBe(true);
      expect(isRetryableStatusCode(504)).toBe(true);
    });

    it('should return false for non-retryable codes', () => {
      expect(isRetryableStatusCode(200)).toBe(false);
      expect(isRetryableStatusCode(400)).toBe(false);
      expect(isRetryableStatusCode(401)).toBe(false);
      expect(isRetryableStatusCode(404)).toBe(false);
    });

    it('should use custom retryable codes when provided', () => {
      expect(isRetryableStatusCode(429, [429, 503])).toBe(true);
      expect(isRetryableStatusCode(500, [429, 503])).toBe(false);
    });
  });

  describe('isRetryableError', () => {
    it('should return true for AbortError', () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for connection errors', () => {
      expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
      expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
      expect(isRetryableError(new Error('ENOTFOUND'))).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      expect(isRetryableError(new Error('Some other error'))).toBe(false);
    });
  });

  describe('mergeRetryConfig', () => {
    it('should return default config when no overrides', () => {
      const config = mergeRetryConfig();
      expect(config.enabled).toBe(true);
      expect(config.maxRetries).toBe(3);
      expect(config.baseDelayMs).toBe(1000);
    });

    it('should merge custom config with defaults', () => {
      const config = mergeRetryConfig({ maxRetries: 5 });
      expect(config.enabled).toBe(true);
      expect(config.maxRetries).toBe(5);
      expect(config.baseDelayMs).toBe(1000);
    });
  });

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn);

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue('success');

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.attempts).toBe(2);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should return failure after all retries exhausted', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await withRetry(fn, { maxRetries: 2, baseDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('ECONNREFUSED');
      expect(result.attempts).toBe(3); // initial + 2 retries
    });

    it('should not retry when disabled', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await withRetry(fn, { enabled: false });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should not retry non-retryable errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Validation failed'));

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
    });

    it('should call onRetry callback', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue('success');
      const onRetry = vi.fn();

      await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }, onRetry);

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 0 }),
        expect.any(Number)
      );
    });
  });
});
