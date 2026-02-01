import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CircuitBreaker, createCircuitBreaker } from './index.js';

// Create mock Redis
const createMockRedis = () => ({
  get: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
});

describe('CircuitBreaker', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    vi.clearAllMocks();
  });

  describe('createCircuitBreaker', () => {
    it('should create a circuit breaker instance', () => {
      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000'
      );
      expect(cb).toBeInstanceOf(CircuitBreaker);
    });
  });

  describe('canExecute', () => {
    it('should allow execution when circuit is CLOSED', async () => {
      mockRedis.get.mockResolvedValue(null);

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000'
      );

      const canExecute = await cb.canExecute();
      expect(canExecute).toBe(true);
    });

    it('should allow execution when circuit breaker is disabled', async () => {
      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000',
        { enabled: false }
      );

      const canExecute = await cb.canExecute();
      expect(canExecute).toBe(true);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('should block execution when circuit is OPEN and timeout not passed', async () => {
      const status = {
        state: 'OPEN',
        failures: 5,
        successes: 0,
        lastFailureTime: Date.now(),
        lastStateChange: Date.now(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(status));

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000',
        { timeout: 30000 }
      );

      const canExecute = await cb.canExecute();
      expect(canExecute).toBe(false);
    });

    it('should allow execution and transition to HALF_OPEN when timeout passed', async () => {
      const status = {
        state: 'OPEN',
        failures: 5,
        successes: 0,
        lastFailureTime: Date.now() - 60000,
        lastStateChange: Date.now() - 60000,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(status));

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000',
        { timeout: 30000 }
      );

      const canExecute = await cb.canExecute();
      expect(canExecute).toBe(true);
      expect(mockRedis.setex).toHaveBeenCalled();

      // Verify state was set to HALF_OPEN
      const setexCall = mockRedis.setex.mock.calls[0]!;
      const statusJson = setexCall[2] as string;
      const savedStatus = JSON.parse(statusJson);
      expect(savedStatus.state).toBe('HALF_OPEN');
    });

    it('should allow execution when circuit is HALF_OPEN', async () => {
      const status = {
        state: 'HALF_OPEN',
        failures: 5,
        successes: 0,
        lastFailureTime: Date.now(),
        lastStateChange: Date.now(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(status));

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000'
      );

      const canExecute = await cb.canExecute();
      expect(canExecute).toBe(true);
    });
  });

  describe('recordSuccess', () => {
    it('should do nothing when disabled', async () => {
      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000',
        { enabled: false }
      );

      await cb.recordSuccess();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('should transition from HALF_OPEN to CLOSED after success threshold', async () => {
      const status = {
        state: 'HALF_OPEN',
        failures: 5,
        successes: 1,
        lastFailureTime: Date.now(),
        lastStateChange: Date.now(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(status));

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000',
        { successThreshold: 2 }
      );

      await cb.recordSuccess();

      const setexCall = mockRedis.setex.mock.calls[0]!;
      const statusJson = setexCall[2] as string;
      const savedStatus = JSON.parse(statusJson);
      expect(savedStatus.state).toBe('CLOSED');
      expect(savedStatus.failures).toBe(0);
    });

    it('should increment successes in HALF_OPEN state when threshold not reached', async () => {
      const status = {
        state: 'HALF_OPEN',
        failures: 5,
        successes: 0,
        lastFailureTime: Date.now(),
        lastStateChange: Date.now(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(status));

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000',
        { successThreshold: 3 }
      );

      await cb.recordSuccess();

      const setexCall = mockRedis.setex.mock.calls[0]!;
      const statusJson = setexCall[2] as string;
      const savedStatus = JSON.parse(statusJson);
      expect(savedStatus.state).toBe('HALF_OPEN');
      expect(savedStatus.successes).toBe(1);
    });

    it('should reset failures on success in CLOSED state', async () => {
      const status = {
        state: 'CLOSED',
        failures: 3,
        successes: 0,
        lastFailureTime: Date.now(),
        lastStateChange: Date.now(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(status));

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000'
      );

      await cb.recordSuccess();

      const setexCall = mockRedis.setex.mock.calls[0]!;
      const statusJson = setexCall[2] as string;
      const savedStatus = JSON.parse(statusJson);
      expect(savedStatus.failures).toBe(0);
    });
  });

  describe('recordFailure', () => {
    it('should do nothing when disabled', async () => {
      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000',
        { enabled: false }
      );

      await cb.recordFailure();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('should transition from HALF_OPEN to OPEN on any failure', async () => {
      const status = {
        state: 'HALF_OPEN',
        failures: 5,
        successes: 1,
        lastFailureTime: Date.now(),
        lastStateChange: Date.now(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(status));

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000'
      );

      await cb.recordFailure();

      const setexCall = mockRedis.setex.mock.calls[0]!;
      const statusJson = setexCall[2] as string;
      const savedStatus = JSON.parse(statusJson);
      expect(savedStatus.state).toBe('OPEN');
    });

    it('should transition from CLOSED to OPEN after failure threshold', async () => {
      const status = {
        state: 'CLOSED',
        failures: 4,
        successes: 0,
        lastFailureTime: Date.now(),
        lastStateChange: Date.now(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(status));

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000',
        { failureThreshold: 5 }
      );

      await cb.recordFailure();

      const setexCall = mockRedis.setex.mock.calls[0]!;
      const statusJson = setexCall[2] as string;
      const savedStatus = JSON.parse(statusJson);
      expect(savedStatus.state).toBe('OPEN');
      expect(savedStatus.failures).toBe(5);
    });

    it('should increment failures in CLOSED state when threshold not reached', async () => {
      const status = {
        state: 'CLOSED',
        failures: 2,
        successes: 0,
        lastFailureTime: null,
        lastStateChange: Date.now(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(status));

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000',
        { failureThreshold: 5 }
      );

      await cb.recordFailure();

      const setexCall = mockRedis.setex.mock.calls[0]!;
      const statusJson = setexCall[2] as string;
      const savedStatus = JSON.parse(statusJson);
      expect(savedStatus.state).toBe('CLOSED');
      expect(savedStatus.failures).toBe(3);
      expect(savedStatus.lastFailureTime).not.toBeNull();
    });
  });

  describe('reset', () => {
    it('should delete the Redis key', async () => {
      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000'
      );

      await cb.reset();
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });

  describe('getState', () => {
    it('should return current state', async () => {
      const status = {
        state: 'OPEN',
        failures: 5,
        successes: 0,
        lastFailureTime: Date.now(),
        lastStateChange: Date.now(),
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(status));

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000'
      );

      const state = await cb.getState();
      expect(state).toBe('OPEN');
    });

    it('should return CLOSED for new circuit', async () => {
      mockRedis.get.mockResolvedValue(null);

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000'
      );

      const state = await cb.getState();
      expect(state).toBe('CLOSED');
    });
  });

  describe('getStatus', () => {
    it('should return default status when no data in Redis', async () => {
      mockRedis.get.mockResolvedValue(null);

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000'
      );

      const status = await cb.getStatus();
      expect(status.state).toBe('CLOSED');
      expect(status.failures).toBe(0);
      expect(status.successes).toBe(0);
    });

    it('should return default status for invalid JSON', async () => {
      mockRedis.get.mockResolvedValue('invalid-json');

      const cb = createCircuitBreaker(
        mockRedis as never,
        'tenant-1',
        'route-1',
        'http://upstream:3000'
      );

      const status = await cb.getStatus();
      expect(status.state).toBe('CLOSED');
    });
  });
});
