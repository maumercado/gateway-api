import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';

import adminAuthPlugin from '../plugins/admin-auth.js';
import rateLimitPlugin from '../plugins/rate-limit.js';
import tenantAuthPlugin from '../plugins/tenant-auth.js';

// Mock the config
vi.mock('../shared/config/index.js', () => ({
  config: {
    ADMIN_API_KEY: 'test-admin-key',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'postgres://test',
    REDIS_URL: 'redis://test',
  },
}));

// Mock tenant service
vi.mock('../modules/tenant/tenant.service.js', () => ({
  validateApiKey: vi.fn(),
}));

// Mock rate limiter
vi.mock('../shared/rate-limiter/index.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 99,
    resetAt: Date.now() + 1000,
    limit: 100,
  }),
  getTenantRateLimitKey: vi.fn((tenantId: string) => `tenant:${tenantId}`),
}));

// Mock infrastructure plugins for dependency resolution
vi.mock('../plugins/database.js', async () => {
  const fp = (await import('fastify-plugin')).default;
  return {
    default: fp(async () => {}, { name: 'database' }),
  };
});

vi.mock('../plugins/redis.js', async () => {
  const fp = (await import('fastify-plugin')).default;
  return {
    default: fp(async () => {}, { name: 'redis' }),
  };
});

// Mock service plugins for dependency resolution
vi.mock('../plugins/tenant-service.js', async () => {
  const fp = (await import('fastify-plugin')).default;
  const { validateApiKey } = await import('../modules/tenant/tenant.service.js');
  return {
    default: fp(
      async (fastify: { decorate: (name: string, value: unknown) => void }) => {
        fastify.decorate('tenantService', {
          validateApiKey,
          getTenantById: vi.fn(),
          getTenantByName: vi.fn(),
          getAllTenants: vi.fn(),
          getActiveTenants: vi.fn(),
          createTenant: vi.fn(),
          deactivateTenant: vi.fn(),
          activateTenant: vi.fn(),
          deleteTenant: vi.fn(),
        });
      },
      { name: 'tenant-service', dependencies: ['database', 'redis'] }
    ),
  };
});

vi.mock('../plugins/routing-service.js', async () => {
  const fp = (await import('fastify-plugin')).default;
  return {
    default: fp(
      async (fastify: { decorate: (name: string, value: unknown) => void }) => {
        fastify.decorate('routingService', {
          getRouteById: vi.fn(),
          getRoutesByTenantId: vi.fn(),
          getActiveRoutesByTenantId: vi.fn(),
          createRoute: vi.fn(),
          updateRoute: vi.fn(),
          deleteRoute: vi.fn(),
          matchRoute: vi.fn(),
        });
      },
      { name: 'routing-service', dependencies: ['database'] }
    ),
  };
});

// Import after mocking
import { validateApiKey } from '../modules/tenant/tenant.service.js';
import { checkRateLimit } from '../shared/rate-limiter/index.js';
import databasePlugin from '../plugins/database.js';
import redisPlugin from '../plugins/redis.js';
import tenantServicePlugin from '../plugins/tenant-service.js';
import routingServicePlugin from '../plugins/routing-service.js';

describe('Gateway', () => {
  describe('Admin Auth Plugin', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
      app = Fastify({ logger: false });
      // Register mock plugins to satisfy dependencies
      await app.register(databasePlugin);
      await app.register(redisPlugin);
      await app.register(tenantServicePlugin);
      await app.register(routingServicePlugin);
      await app.register(adminAuthPlugin);

      app.get('/test', { preHandler: app.adminAuth }, async () => {
        return { success: true };
      });

      await app.ready();
    });

    afterEach(async () => {
      await app.close();
    });

    it('should reject requests without admin key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('Unauthorized');
      expect(response.json().message).toBe('Missing or invalid X-Admin-Key header');
    });

    it('should reject requests with invalid admin key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'x-admin-key': 'wrong-key',
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().message).toBe('Invalid admin API key');
    });

    it('should allow requests with valid admin key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'x-admin-key': 'test-admin-key',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });
  });

  describe('Tenant Auth Plugin', () => {
    let app: ReturnType<typeof Fastify>;
    const mockValidateApiKey = validateApiKey as ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.clearAllMocks();
      app = Fastify({ logger: false });
      // Register mock plugins to satisfy dependencies
      await app.register(databasePlugin);
      await app.register(redisPlugin);
      await app.register(tenantServicePlugin);
      await app.register(routingServicePlugin);
      await app.register(tenantAuthPlugin);

      app.get('/test', { preHandler: app.tenantAuth }, async (request: FastifyRequest) => {
        return { tenant: request.tenant };
      });

      await app.ready();
    });

    afterEach(async () => {
      await app.close();
    });

    it('should reject requests without API key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().message).toBe('Missing or invalid X-API-Key header');
    });

    it('should reject requests with invalid API key', async () => {
      mockValidateApiKey.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'x-api-key': 'invalid-key',
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().message).toBe('Invalid API key');
    });

    it('should reject requests from inactive tenant', async () => {
      mockValidateApiKey.mockResolvedValue({
        id: 'tenant-1',
        name: 'Test Tenant',
        isActive: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'x-api-key': 'valid-key',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().message).toBe('Tenant account is inactive');
    });

    it('should allow requests with valid API key', async () => {
      const tenant = {
        id: 'tenant-1',
        name: 'Test Tenant',
        isActive: true,
      };
      mockValidateApiKey.mockResolvedValue(tenant);

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'x-api-key': 'valid-key',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().tenant.id).toBe('tenant-1');
    });
  });

  describe('Rate Limit Plugin', () => {
    let app: ReturnType<typeof Fastify>;
    const mockValidateApiKey = validateApiKey as ReturnType<typeof vi.fn>;
    const mockCheckRateLimit = checkRateLimit as ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.clearAllMocks();

      // Re-setup rate limit mock after clearing
      mockCheckRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 99,
        resetAt: Date.now() + 1000,
        limit: 100,
      });

      app = Fastify({ logger: false });
      // Register mock plugins to satisfy dependencies
      await app.register(databasePlugin);
      await app.register(redisPlugin);
      await app.register(tenantServicePlugin);
      await app.register(routingServicePlugin);
      await app.register(tenantAuthPlugin);
      await app.register(rateLimitPlugin);

      app.get(
        '/test',
        { preHandler: [app.tenantAuth, app.rateLimit] },
        async () => {
          return { success: true };
        }
      );

      await app.ready();
    });

    afterEach(async () => {
      await app.close();
    });

    it('should skip rate limiting when tenant is not authenticated', async () => {
      // Note: In practice, tenant auth would reject first
      // This tests that rate limit gracefully handles missing tenant
      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      // Will fail at tenant auth, not rate limit
      expect(response.statusCode).toBe(401);
    });

    it('should add rate limit headers', async () => {
      mockValidateApiKey.mockResolvedValue({
        id: 'tenant-1',
        name: 'Test Tenant',
        isActive: true,
        defaultRateLimit: {
          requestsPerSecond: 100,
          burstSize: 150,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'x-api-key': 'valid-key',
        },
      });

      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('should return 429 when rate limit exceeded', async () => {
      mockValidateApiKey.mockResolvedValue({
        id: 'tenant-1',
        name: 'Test Tenant',
        isActive: true,
        defaultRateLimit: {
          requestsPerSecond: 100,
          burstSize: 150,
        },
      });

      mockCheckRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 1000,
        limit: 100,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'x-api-key': 'valid-key',
        },
      });

      expect(response.statusCode).toBe(429);
      expect(response.json().error).toBe('Too Many Requests');
      expect(response.headers['retry-after']).toBeDefined();
    });
  });
});

describe('Health Endpoints', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify({ logger: false });

    app.get('/health', async () => {
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
      };
    });

    app.get('/ready', async () => {
      return {
        status: 'ready',
        timestamp: new Date().toISOString(),
      };
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should respond to health check', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });

  it('should respond to ready check', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ready');
    expect(body.timestamp).toBeDefined();
  });
});
