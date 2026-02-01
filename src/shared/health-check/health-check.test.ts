import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HealthChecker, createHealthCheckManager } from './index.js';

// Create mock Redis
const createMockRedis = () => ({
  get: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
});

describe('Health Check Module', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    vi.clearAllMocks();
  });

  describe('HealthChecker', () => {
    describe('getStatus', () => {
      it('should return default status when no data in Redis', async () => {
        mockRedis.get.mockResolvedValue(null);

        const checker = new HealthChecker(
          mockRedis as never,
          'tenant-1',
          'route-1',
          { url: 'http://upstream:3000' },
          { enabled: true, endpoint: '/health', intervalMs: 30000, timeoutMs: 5000 }
        );

        const status = await checker.getStatus();

        expect(status.healthy).toBe(true);
        expect(status.consecutiveSuccesses).toBe(0);
        expect(status.consecutiveFailures).toBe(0);
      });

      it('should return stored status from Redis', async () => {
        const storedStatus = {
          healthy: false,
          consecutiveSuccesses: 0,
          consecutiveFailures: 3,
          lastCheckTime: Date.now(),
          lastSuccessTime: null,
          lastFailureTime: Date.now(),
        };
        mockRedis.get.mockResolvedValue(JSON.stringify(storedStatus));

        const checker = new HealthChecker(
          mockRedis as never,
          'tenant-1',
          'route-1',
          { url: 'http://upstream:3000' },
          { enabled: true, endpoint: '/health', intervalMs: 30000, timeoutMs: 5000 }
        );

        const status = await checker.getStatus();

        expect(status.healthy).toBe(false);
        expect(status.consecutiveFailures).toBe(3);
      });
    });

    describe('isHealthy', () => {
      it('should return true when health check is disabled', async () => {
        const checker = new HealthChecker(
          mockRedis as never,
          'tenant-1',
          'route-1',
          { url: 'http://upstream:3000' },
          { enabled: false, endpoint: '/health', intervalMs: 30000, timeoutMs: 5000 }
        );

        const isHealthy = await checker.isHealthy();

        expect(isHealthy).toBe(true);
        expect(mockRedis.get).not.toHaveBeenCalled();
      });

      it('should return status from Redis when enabled', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify({ healthy: true }));

        const checker = new HealthChecker(
          mockRedis as never,
          'tenant-1',
          'route-1',
          { url: 'http://upstream:3000' },
          { enabled: true, endpoint: '/health', intervalMs: 30000, timeoutMs: 5000 }
        );

        const isHealthy = await checker.isHealthy();

        expect(isHealthy).toBe(true);
      });
    });

    describe('start/stop', () => {
      it('should start periodic checks when enabled', () => {
        vi.useFakeTimers();

        const checker = new HealthChecker(
          mockRedis as never,
          'tenant-1',
          'route-1',
          { url: 'http://upstream:3000' },
          { enabled: true, endpoint: '/health', intervalMs: 30000, timeoutMs: 5000 }
        );

        checker.start();

        // Should not throw
        checker.stop();

        vi.useRealTimers();
      });

      it('should not start when disabled', () => {
        const checker = new HealthChecker(
          mockRedis as never,
          'tenant-1',
          'route-1',
          { url: 'http://upstream:3000' },
          { enabled: false, endpoint: '/health', intervalMs: 30000, timeoutMs: 5000 }
        );

        checker.start();
        checker.stop();

        // Should not throw
      });
    });

    describe('reset', () => {
      it('should delete the Redis key and stop checks', async () => {
        const checker = new HealthChecker(
          mockRedis as never,
          'tenant-1',
          'route-1',
          { url: 'http://upstream:3000' },
          { enabled: true, endpoint: '/health', intervalMs: 30000, timeoutMs: 5000 }
        );

        await checker.reset();

        expect(mockRedis.del).toHaveBeenCalled();
      });
    });
  });

  describe('HealthCheckManager', () => {
    describe('registerUpstream', () => {
      it('should create and return a new checker', () => {
        const manager = createHealthCheckManager(mockRedis as never);

        const checker = manager.registerUpstream(
          'tenant-1',
          'route-1',
          { url: 'http://upstream:3000' },
          { enabled: true, endpoint: '/health', intervalMs: 30000, timeoutMs: 5000 }
        );

        expect(checker).toBeInstanceOf(HealthChecker);
      });

      it('should return existing checker if already registered', () => {
        const manager = createHealthCheckManager(mockRedis as never);

        const checker1 = manager.registerUpstream(
          'tenant-1',
          'route-1',
          { url: 'http://upstream:3000' }
        );

        const checker2 = manager.registerUpstream(
          'tenant-1',
          'route-1',
          { url: 'http://upstream:3000' }
        );

        expect(checker1).toBe(checker2);
      });
    });

    describe('getChecker', () => {
      it('should return undefined for unregistered upstream', () => {
        const manager = createHealthCheckManager(mockRedis as never);

        const checker = manager.getChecker('tenant-1', 'route-1', 'http://unknown:3000');

        expect(checker).toBeUndefined();
      });

      it('should return registered checker', () => {
        const manager = createHealthCheckManager(mockRedis as never);

        manager.registerUpstream(
          'tenant-1',
          'route-1',
          { url: 'http://upstream:3000' }
        );

        const checker = manager.getChecker('tenant-1', 'route-1', 'http://upstream:3000');

        expect(checker).toBeDefined();
      });
    });

    describe('isUpstreamHealthy', () => {
      it('should return true for unregistered upstream', async () => {
        const manager = createHealthCheckManager(mockRedis as never);

        const isHealthy = await manager.isUpstreamHealthy(
          'tenant-1',
          'route-1',
          'http://unknown:3000'
        );

        expect(isHealthy).toBe(true);
      });
    });

    describe('startAll/stopAll', () => {
      it('should start and stop all registered checkers', () => {
        const manager = createHealthCheckManager(mockRedis as never);

        manager.registerUpstream(
          'tenant-1',
          'route-1',
          { url: 'http://upstream1:3000' },
          { enabled: true, endpoint: '/health', intervalMs: 30000, timeoutMs: 5000 }
        );

        manager.registerUpstream(
          'tenant-1',
          'route-2',
          { url: 'http://upstream2:3000' },
          { enabled: true, endpoint: '/health', intervalMs: 30000, timeoutMs: 5000 }
        );

        // Should not throw
        manager.startAll();
        manager.stopAll();
      });
    });

    describe('unregisterUpstream', () => {
      it('should remove and stop the checker', () => {
        const manager = createHealthCheckManager(mockRedis as never);

        manager.registerUpstream(
          'tenant-1',
          'route-1',
          { url: 'http://upstream:3000' }
        );

        manager.unregisterUpstream('tenant-1', 'route-1', 'http://upstream:3000');

        const checker = manager.getChecker('tenant-1', 'route-1', 'http://upstream:3000');
        expect(checker).toBeUndefined();
      });
    });

    describe('clear', () => {
      it('should stop and remove all checkers', () => {
        const manager = createHealthCheckManager(mockRedis as never);

        manager.registerUpstream(
          'tenant-1',
          'route-1',
          { url: 'http://upstream:3000' }
        );

        manager.clear();

        const checker = manager.getChecker('tenant-1', 'route-1', 'http://upstream:3000');
        expect(checker).toBeUndefined();
      });
    });
  });
});
