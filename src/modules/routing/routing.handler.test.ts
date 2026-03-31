import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { handleProxy } from './routing.handler.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSelectUpstream = vi.fn();
vi.mock('../../shared/load-balancer/index.js', () => ({
  selectUpstream: (...args: unknown[]) => mockSelectUpstream(...args),
}));

const mockCircuitBreaker = {
  canExecute: vi.fn().mockResolvedValue(true),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
  recordFailure: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../../shared/circuit-breaker/index.js', () => ({
  createCircuitBreaker: vi.fn(() => mockCircuitBreaker),
}));

vi.mock('../../shared/metrics/index.js', () => ({
  upstreamRequestsTotal: { inc: vi.fn() },
  upstreamRequestDurationSeconds: { observe: vi.fn() },
  normalizeUpstreamLabel: vi.fn((url: string) => url),
  retryAttemptsTotal: { inc: vi.fn() },
}));

vi.mock('../../shared/transformer/index.js', () => ({
  transformRequest: vi.fn((headers: unknown, url: string) => ({ headers, path: url })),
  transformResponseHeaders: vi.fn((headers: unknown) => headers),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT = { id: 'tenant-1', name: 'Test', isActive: true };
const UPSTREAM = { url: 'http://upstream:3000' };
const ROUTE = {
  id: 'route-1',
  tenantId: 'tenant-1',
  method: 'GET',
  path: '/api',
  pathType: 'exact' as const,
  upstreams: [UPSTREAM],
  loadBalancing: 'round-robin' as const,
  transform: null,
  resilience: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeFetchResponse(
  status: number,
  body: string,
  headers: Record<string, string> = { 'content-type': 'application/json' }
): Response {
  const res = new Response(body, { status, headers });
  return res;
}

async function buildApp(overrides: {
  matchRoute?: ReturnType<typeof vi.fn>;
  isUpstreamHealthy?: ReturnType<typeof vi.fn>;
  healthCheckerEnabled?: boolean;
}): Promise<FastifyInstance> {
  const mockMatchRoute = overrides.matchRoute ?? vi.fn().mockResolvedValue({ route: ROUTE });
  const mockIsUpstreamHealthy = overrides.isUpstreamHealthy ?? vi.fn().mockResolvedValue(true);

  const app = Fastify({ logger: false });

  // Register the infra decorators the handler needs via server
  await app.register(
    fp(async (fastify) => {
      fastify.decorate('routingService', { matchRoute: mockMatchRoute });
      fastify.decorate('redis', {});
      fastify.decorate(
        'healthChecker',
        overrides.healthCheckerEnabled === false
          ? null
          : { isUpstreamHealthy: mockIsUpstreamHealthy }
      );
    })
  );

  // Register tenant on every request
  app.addHook('preHandler', async (request) => {
    (request as typeof request & { tenant: typeof TENANT }).tenant = TENANT;
  });

  app.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    url: '/*',
    handler: async (request, reply) => {
      return handleProxy(request as Parameters<typeof handleProxy>[0], reply);
    },
  });

  await app.ready();
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectUpstream.mockReturnValue(UPSTREAM);
    mockCircuitBreaker.canExecute.mockResolvedValue(true);
  });

  describe('Route matching', () => {
    it('returns 404 when no route matches', async () => {
      const app = await buildApp({ matchRoute: vi.fn().mockResolvedValue(null) });

      const res = await app.inject({ method: 'GET', url: '/not-found', headers: {} });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('Not Found');

      await app.close();
    });
  });

  describe('Happy path', () => {
    it('proxies request and streams response', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(200, JSON.stringify({ ok: true })));
      const app = await buildApp({});

      const res = await app.inject({ method: 'GET', url: '/api' });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true });

      await app.close();
    });

    it('calls selectUpstream with route upstreams and strategy', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(200, '{}'));
      const app = await buildApp({});

      await app.inject({ method: 'GET', url: '/api' });

      expect(mockSelectUpstream).toHaveBeenCalledWith(
        ROUTE.upstreams,
        ROUTE.loadBalancing,
        ROUTE.id
      );

      await app.close();
    });

    it('returns empty body for 204 No Content', async () => {
      const res204 = new Response(null, { status: 204 });
      mockFetch.mockResolvedValue(res204);
      const app = await buildApp({});

      const res = await app.inject({ method: 'GET', url: '/api' });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');

      await app.close();
    });
  });

  describe('Health-check failover', () => {
    const UPSTREAM_A = { url: 'http://upstream-a:3000' };
    const UPSTREAM_B = { url: 'http://upstream-b:3000' };
    const ROUTE_MULTI = {
      ...ROUTE,
      upstreams: [UPSTREAM_A, UPSTREAM_B],
      resilience: {
        healthCheck: { enabled: true, endpoint: '/health', intervalMs: 30000, timeoutMs: 5000 },
      },
    };

    it('returns 503 when all upstreams are unhealthy', async () => {
      const app = await buildApp({
        matchRoute: vi.fn().mockResolvedValue({ route: ROUTE_MULTI }),
        isUpstreamHealthy: vi.fn().mockResolvedValue(false),
      });

      const res = await app.inject({ method: 'GET', url: '/api' });

      expect(res.statusCode).toBe(503);
      expect(res.json().message).toContain('All upstream services are unhealthy');
      // Load balancer should NOT have been called — no healthy candidates
      expect(mockSelectUpstream).not.toHaveBeenCalled();

      await app.close();
    });

    it('routes only to healthy upstreams when one is unhealthy', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(200, '{}'));

      // UPSTREAM_A unhealthy, UPSTREAM_B healthy
      const isUpstreamHealthy = vi.fn().mockImplementation(
        (_tenantId: string, _routeId: string, url: string) => url === UPSTREAM_B.url
      );

      const app = await buildApp({
        matchRoute: vi.fn().mockResolvedValue({ route: ROUTE_MULTI }),
        isUpstreamHealthy,
      });

      await app.inject({ method: 'GET', url: '/api' });

      // selectUpstream should receive only the healthy upstream
      expect(mockSelectUpstream).toHaveBeenCalledWith(
        [UPSTREAM_B],
        ROUTE_MULTI.loadBalancing,
        ROUTE_MULTI.id
      );

      await app.close();
    });

    it('uses all upstreams when health checks are disabled', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(200, '{}'));
      const app = await buildApp({ healthCheckerEnabled: false });

      await app.inject({ method: 'GET', url: '/api' });

      expect(mockSelectUpstream).toHaveBeenCalledWith(
        ROUTE.upstreams,
        ROUTE.loadBalancing,
        ROUTE.id
      );

      await app.close();
    });

    it('uses fallback when all upstreams are unhealthy and fallback is configured', async () => {
      const ROUTE_WITH_FALLBACK = {
        ...ROUTE_MULTI,
        resilience: {
          ...ROUTE_MULTI.resilience,
          fallback: {
            enabled: true,
            statusCode: 503,
            contentType: 'application/json' as const,
            body: '{"error":"degraded"}',
          },
        },
      };

      const app = await buildApp({
        matchRoute: vi.fn().mockResolvedValue({ route: ROUTE_WITH_FALLBACK }),
        isUpstreamHealthy: vi.fn().mockResolvedValue(false),
      });

      const res = await app.inject({ method: 'GET', url: '/api' });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('degraded');

      await app.close();
    });
  });

  describe('Circuit breaker', () => {
    it('returns 503 when circuit is open', async () => {
      mockCircuitBreaker.canExecute.mockResolvedValue(false);

      const ROUTE_CB = {
        ...ROUTE,
        resilience: {
          circuitBreaker: { enabled: true, failureThreshold: 5, successThreshold: 2, timeout: 30000 },
        },
      };

      const app = await buildApp({ matchRoute: vi.fn().mockResolvedValue({ route: ROUTE_CB }) });

      const res = await app.inject({ method: 'GET', url: '/api' });

      expect(res.statusCode).toBe(503);
      expect(res.json().message).toContain('Circuit breaker is open');

      await app.close();
    });

    it('records circuit breaker success on 2xx response', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(200, '{}'));

      const ROUTE_CB = {
        ...ROUTE,
        resilience: {
          circuitBreaker: { enabled: true, failureThreshold: 5, successThreshold: 2, timeout: 30000 },
        },
      };

      const app = await buildApp({ matchRoute: vi.fn().mockResolvedValue({ route: ROUTE_CB }) });

      await app.inject({ method: 'GET', url: '/api' });

      expect(mockCircuitBreaker.recordSuccess).toHaveBeenCalled();

      await app.close();
    });

    it('records circuit breaker failure on 5xx response', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(500, '{"error":"oops"}'));

      const ROUTE_CB = {
        ...ROUTE,
        resilience: {
          circuitBreaker: { enabled: true, failureThreshold: 5, successThreshold: 2, timeout: 30000 },
        },
      };

      const app = await buildApp({ matchRoute: vi.fn().mockResolvedValue({ route: ROUTE_CB }) });

      await app.inject({ method: 'GET', url: '/api' });

      expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();

      await app.close();
    });
  });

  describe('Error handling', () => {
    it('returns 504 on upstream timeout', async () => {
      mockFetch.mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      const app = await buildApp({});

      const res = await app.inject({ method: 'GET', url: '/api' });

      expect(res.statusCode).toBe(504);
      expect(res.json().error).toBe('Gateway Timeout');

      await app.close();
    });

    it('returns 502 on upstream connection error', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const app = await buildApp({});

      const res = await app.inject({ method: 'GET', url: '/api' });

      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe('Bad Gateway');

      await app.close();
    });

    it('returns fallback on timeout when configured', async () => {
      mockFetch.mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' }));

      const ROUTE_FALLBACK = {
        ...ROUTE,
        resilience: {
          fallback: {
            enabled: true,
            statusCode: 503,
            contentType: 'application/json' as const,
            body: '{"error":"unavailable"}',
          },
        },
      };

      const app = await buildApp({ matchRoute: vi.fn().mockResolvedValue({ route: ROUTE_FALLBACK }) });

      const res = await app.inject({ method: 'GET', url: '/api' });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('unavailable');

      await app.close();
    });
  });

  describe('Path handling', () => {
    it('appends remaining path for prefix routes', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(200, '{}'));

      const PREFIX_ROUTE = { ...ROUTE, path: '/api', pathType: 'prefix' as const };
      const app = await buildApp({
        matchRoute: vi.fn().mockResolvedValue({ route: PREFIX_ROUTE }),
      });

      await app.inject({ method: 'GET', url: '/api/users/123' });

      const calledUrl = (mockFetch.mock.calls[0] as [string, ...unknown[]])[0];
      expect(calledUrl).toContain('/users/123');

      await app.close();
    });

    it('preserves query string', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(200, '{}'));
      const app = await buildApp({});

      await app.inject({ method: 'GET', url: '/api?foo=bar&baz=1' });

      const calledUrl = (mockFetch.mock.calls[0] as [string, ...unknown[]])[0];
      expect(calledUrl).toContain('foo=bar');

      await app.close();
    });
  });
});
