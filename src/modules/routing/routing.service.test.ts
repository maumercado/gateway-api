import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the repository
vi.mock('./routing.repository.js', () => ({
  findRouteById: vi.fn(),
  findRoutesByTenantId: vi.fn(),
  findActiveRoutesByTenantId: vi.fn(),
  createRoute: vi.fn(),
  updateRoute: vi.fn(),
  deleteRoute: vi.fn(),
}));

// Mock load balancer
vi.mock('../../shared/load-balancer/index.js', () => ({
  selectUpstream: vi.fn((upstreams) => upstreams[0]),
}));

import * as routingRepository from './routing.repository.js';
import * as routingService from './routing.service.js';
import type { RouteRow } from './routing.schema.js';

const mockFindActiveRoutesByTenantId = routingRepository.findActiveRoutesByTenantId as ReturnType<typeof vi.fn>;
const mockFindRouteById = routingRepository.findRouteById as ReturnType<typeof vi.fn>;
const mockCreateRoute = routingRepository.createRoute as ReturnType<typeof vi.fn>;

const createMockRoute = (overrides: Partial<RouteRow> = {}): RouteRow => ({
  id: 'route-1',
  tenantId: 'tenant-1',
  method: 'GET',
  path: '/api/users',
  pathType: 'exact',
  upstreams: [{ url: 'http://upstream:3000' }],
  loadBalancing: 'round-robin',
  transform: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('Routing Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getRouteById', () => {
    it('should return route when found', async () => {
      const mockRoute = createMockRoute();
      mockFindRouteById.mockResolvedValue(mockRoute);

      const result = await routingService.getRouteById('route-1');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('route-1');
    });

    it('should return null when not found', async () => {
      mockFindRouteById.mockResolvedValue(null);

      const result = await routingService.getRouteById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('createRoute', () => {
    it('should create route with default values', async () => {
      const mockRoute = createMockRoute();
      mockCreateRoute.mockResolvedValue(mockRoute);

      const result = await routingService.createRoute({
        tenantId: 'tenant-1',
        method: 'GET',
        path: '/api/users',
        upstreams: [{ url: 'http://upstream:3000' }],
      });

      expect(mockCreateRoute).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        method: 'GET',
        path: '/api/users',
        pathType: 'exact',
        upstreams: [{ url: 'http://upstream:3000' }],
        loadBalancing: 'round-robin',
        transform: null,
      });
      expect(result.id).toBe('route-1');
    });
  });

  describe('matchRoute', () => {
    describe('exact path matching', () => {
      it('should match exact path', async () => {
        mockFindActiveRoutesByTenantId.mockResolvedValue([
          createMockRoute({ path: '/api/users', pathType: 'exact' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users');

        expect(result).not.toBeNull();
        expect(result?.route.path).toBe('/api/users');
      });

      it('should not match different path', async () => {
        mockFindActiveRoutesByTenantId.mockResolvedValue([
          createMockRoute({ path: '/api/users', pathType: 'exact' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/posts');

        expect(result).toBeNull();
      });

      it('should not match path with extra segments', async () => {
        mockFindActiveRoutesByTenantId.mockResolvedValue([
          createMockRoute({ path: '/api/users', pathType: 'exact' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users/123');

        expect(result).toBeNull();
      });
    });

    describe('prefix path matching', () => {
      it('should match exact prefix path', async () => {
        mockFindActiveRoutesByTenantId.mockResolvedValue([
          createMockRoute({ path: '/api', pathType: 'prefix' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api');

        expect(result).not.toBeNull();
      });

      it('should match path with prefix', async () => {
        mockFindActiveRoutesByTenantId.mockResolvedValue([
          createMockRoute({ path: '/api', pathType: 'prefix' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users');

        expect(result).not.toBeNull();
      });

      it('should match nested path with prefix', async () => {
        mockFindActiveRoutesByTenantId.mockResolvedValue([
          createMockRoute({ path: '/api', pathType: 'prefix' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users/123/profile');

        expect(result).not.toBeNull();
      });

      it('should not match partial prefix', async () => {
        mockFindActiveRoutesByTenantId.mockResolvedValue([
          createMockRoute({ path: '/api', pathType: 'prefix' }),
        ]);

        // "/apiv2" should not match "/api" prefix
        const result = await routingService.matchRoute('tenant-1', 'GET', '/apiv2');

        expect(result).toBeNull();
      });
    });

    describe('regex path matching', () => {
      it('should match simple regex pattern', async () => {
        mockFindActiveRoutesByTenantId.mockResolvedValue([
          createMockRoute({ path: '/api/users/\\d+', pathType: 'regex' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users/123');

        expect(result).not.toBeNull();
      });

      it('should not match when regex does not match', async () => {
        mockFindActiveRoutesByTenantId.mockResolvedValue([
          createMockRoute({ path: '/api/users/\\d+', pathType: 'regex' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users/abc');

        expect(result).toBeNull();
      });

      it('should match complex regex pattern', async () => {
        mockFindActiveRoutesByTenantId.mockResolvedValue([
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
        mockFindActiveRoutesByTenantId.mockResolvedValue([
          createMockRoute({ path: '[invalid(regex', pathType: 'regex' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/test');

        expect(result).toBeNull();
      });
    });

    describe('method matching', () => {
      it('should match specific method', async () => {
        mockFindActiveRoutesByTenantId.mockResolvedValue([
          createMockRoute({ method: 'POST' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'POST', '/api/users');

        expect(result).not.toBeNull();
      });

      it('should not match different method', async () => {
        mockFindActiveRoutesByTenantId.mockResolvedValue([
          createMockRoute({ method: 'POST' }),
        ]);

        const result = await routingService.matchRoute('tenant-1', 'GET', '/api/users');

        expect(result).toBeNull();
      });

      it('should match wildcard method', async () => {
        mockFindActiveRoutesByTenantId.mockResolvedValue([
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
        mockFindActiveRoutesByTenantId.mockResolvedValue([
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
