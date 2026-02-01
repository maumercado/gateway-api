import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { RoutingRepository } from './routing.repository.js';
import { createRoutingService, type RoutingService } from './routing.service.js';
import type { RouteRow } from './routing.schema.js';

// Mock load balancer
vi.mock('../../shared/load-balancer/index.js', () => ({
  selectUpstream: vi.fn((upstreams) => upstreams[0]),
}));

const createMockRoute = (overrides: Partial<RouteRow> = {}): RouteRow => ({
  id: 'route-1',
  tenantId: 'tenant-1',
  method: 'GET',
  path: '/api/users',
  pathType: 'exact',
  upstreams: [{ url: 'http://upstream:3000' }],
  loadBalancing: 'round-robin',
  transform: null,
  resilience: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function createMockRepository(): RoutingRepository {
  return {
    findRouteById: vi.fn(),
    findRoutesByTenantId: vi.fn(),
    findActiveRoutesByTenantId: vi.fn(),
    createRoute: vi.fn(),
    updateRoute: vi.fn(),
    deleteRoute: vi.fn(),
    deleteRoutesByTenantId: vi.fn(),
  };
}

describe('Routing Service', () => {
  let mockRepository: RoutingRepository;
  let routingService: RoutingService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository = createMockRepository();
    routingService = createRoutingService({ repository: mockRepository });
  });

  describe('getRouteById', () => {
    it('should return route when found', async () => {
      const mockRoute = createMockRoute();
      vi.mocked(mockRepository.findRouteById).mockResolvedValue(mockRoute);

      const result = await routingService.getRouteById('route-1');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('route-1');
    });

    it('should return null when not found', async () => {
      vi.mocked(mockRepository.findRouteById).mockResolvedValue(null);

      const result = await routingService.getRouteById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('createRoute', () => {
    it('should create route with default values', async () => {
      const mockRoute = createMockRoute();
      vi.mocked(mockRepository.createRoute).mockResolvedValue(mockRoute);

      const result = await routingService.createRoute({
        tenantId: 'tenant-1',
        method: 'GET',
        path: '/api/users',
        upstreams: [{ url: 'http://upstream:3000' }],
      });

      expect(mockRepository.createRoute).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        method: 'GET',
        path: '/api/users',
        pathType: 'exact',
        upstreams: [{ url: 'http://upstream:3000' }],
        loadBalancing: 'round-robin',
        transform: null,
        resilience: null,
      });
      expect(result.id).toBe('route-1');
    });
  });

  describe('matchRoute', () => {
    describe('exact path matching', () => {
      it('should match exact path', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ path: '/api/users', pathType: 'exact' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users');

        expect(result).not.toBeNull();
        expect(result?.route.path).toBe('/api/users');
      });

      it('should not match different path', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ path: '/api/users', pathType: 'exact' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/posts');

        expect(result).toBeNull();
      });

      it('should not match path with extra segments', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ path: '/api/users', pathType: 'exact' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users/123');

        expect(result).toBeNull();
      });
    });

    describe('prefix path matching', () => {
      it('should match exact prefix path', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ path: '/api', pathType: 'prefix' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api');

        expect(result).not.toBeNull();
      });

      it('should match path with prefix', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ path: '/api', pathType: 'prefix' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users');

        expect(result).not.toBeNull();
      });

      it('should match nested path with prefix', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ path: '/api', pathType: 'prefix' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users/123/profile');

        expect(result).not.toBeNull();
      });

      it('should not match partial prefix', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ path: '/api', pathType: 'prefix' }),
        ]);

        // "/apiv2" should not match "/api" prefix
        const result = await routingService.matchRoute('tenant-1', 'GET', '/apiv2');

        expect(result).toBeNull();
      });
    });

    describe('regex path matching', () => {
      it('should match simple regex pattern', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ path: '/api/users/\\d+', pathType: 'regex' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users/123');

        expect(result).not.toBeNull();
      });

      it('should not match when regex does not match', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ path: '/api/users/\\d+', pathType: 'regex' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users/abc');

        expect(result).toBeNull();
      });

      it('should match complex regex pattern', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({
            path: '/api/(users|posts)/[a-f0-9-]+',
            pathType: 'regex',
          }),
        ]);

        const result = await routingService.matchRoute(
          'tenant-1',
          'GET',
          '/api/users/550e8400-e29b-41d4-a716-446655440000'
        );

        expect(result).not.toBeNull();
      });

      it('should return null for invalid regex pattern', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ path: '[invalid(regex', pathType: 'regex' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/test');

        expect(result).toBeNull();
      });
    });

    describe('method matching', () => {
      it('should match specific method', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ method: 'POST' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'POST', '/api/users');

        expect(result).not.toBeNull();
      });

      it('should not match different method', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ method: 'POST' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users');

        expect(result).toBeNull();
      });

      it('should match wildcard method', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ method: '*' }),
        ]);

        const getResult = await routingService.matchRoute('tenant-1', 'GET', '/api/users');
        const postResult = await routingService.matchRoute('tenant-1', 'POST', '/api/users');
        const deleteResult = await routingService.matchRoute('tenant-1', 'DELETE', '/api/users');

        expect(getResult).not.toBeNull();
        expect(postResult).not.toBeNull();
        expect(deleteResult).not.toBeNull();
      });
    });

    describe('route priority', () => {
      it('should match first route when multiple routes match', async () => {
        vi.mocked(mockRepository.findActiveRoutesByTenantId).mockResolvedValue([
          createMockRoute({ id: 'route-1', path: '/api', pathType: 'prefix' }),
          createMockRoute({ id: 'route-2', path: '/api/users', pathType: 'exact' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users');

        // First matching route wins
        expect(result?.route.id).toBe('route-1');
      });
    });
  });
});
