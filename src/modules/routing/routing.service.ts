import { selectUpstream } from '../../shared/load-balancer/index.js';

import type { RoutingRepository } from './routing.repository.js';
import type { RouteRow } from './routing.schema.js';
import type { CreateRouteInput, MatchedRoute, Route } from './routing.types.js';

function mapToRoute(row: RouteRow): Route {
  return {
    id: row.id,
    tenantId: row.tenantId,
    method: row.method,
    path: row.path,
    pathType: row.pathType,
    upstreams: row.upstreams,
    loadBalancing: row.loadBalancing,
    transform: row.transform ?? null,
    resilience: row.resilience ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function matchPath(
  routePath: string,
  requestPath: string,
  pathType: Route['pathType']
): boolean {
  switch (pathType) {
    case 'exact':
      return routePath === requestPath;

    case 'prefix':
      return (
        requestPath === routePath || requestPath.startsWith(`${routePath}/`)
      );

    case 'regex':
      try {
        const regex = new RegExp(`^${routePath}$`);
        return regex.test(requestPath);
      } catch {
        // Invalid regex pattern
        return false;
      }

    default:
      return false;
  }
}

export interface RoutingServiceDeps {
  repository: RoutingRepository;
}

export interface RoutingService {
  getRouteById(id: string): Promise<Route | null>;
  getRoutesByTenantId(tenantId: string): Promise<Route[]>;
  getActiveRoutesByTenantId(tenantId: string): Promise<Route[]>;
  createRoute(input: CreateRouteInput): Promise<Route>;
  updateRoute(
    id: string,
    data: Partial<Omit<CreateRouteInput, 'tenantId'>> & { isActive?: boolean }
  ): Promise<Route | null>;
  deleteRoute(id: string): Promise<boolean>;
  matchRoute(tenantId: string, method: string, path: string): Promise<MatchedRoute | null>;
}

export function createRoutingService(deps: RoutingServiceDeps): RoutingService {
  const { repository } = deps;

  async function getActiveRoutesByTenantId(tenantId: string): Promise<Route[]> {
    const rows = await repository.findActiveRoutesByTenantId(tenantId);
    return rows.map(mapToRoute);
  }

  return {
    async getRouteById(id: string): Promise<Route | null> {
      const row = await repository.findRouteById(id);
      return row ? mapToRoute(row) : null;
    },

    async getRoutesByTenantId(tenantId: string): Promise<Route[]> {
      const rows = await repository.findRoutesByTenantId(tenantId);
      return rows.map(mapToRoute);
    },

    getActiveRoutesByTenantId,

    async createRoute(input: CreateRouteInput): Promise<Route> {
      const row = await repository.createRoute({
        tenantId: input.tenantId,
        method: input.method,
        path: input.path,
        pathType: input.pathType ?? 'exact',
        upstreams: input.upstreams,
        loadBalancing: input.loadBalancing ?? 'round-robin',
        transform: input.transform ?? null,
        resilience: input.resilience ?? null,
      });

      return mapToRoute(row);
    },

    async updateRoute(
      id: string,
      data: Partial<Omit<CreateRouteInput, 'tenantId'>> & { isActive?: boolean }
    ): Promise<Route | null> {
      const row = await repository.updateRoute(id, data);
      return row ? mapToRoute(row) : null;
    },

    async deleteRoute(id: string): Promise<boolean> {
      return repository.deleteRoute(id);
    },

    async matchRoute(
      tenantId: string,
      method: string,
      path: string
    ): Promise<MatchedRoute | null> {
      const routes = await getActiveRoutesByTenantId(tenantId);

      // Find matching route
      for (const route of routes) {
        // Check method match (wildcard '*' matches all methods)
        if (route.method !== '*' && route.method !== method) {
          continue;
        }

        // Check path match
        if (!matchPath(route.path, path, route.pathType)) {
          continue;
        }

        // Found a match - select upstream using load balancing strategy
        const upstream = selectUpstream(
          route.upstreams,
          route.loadBalancing,
          route.id
        );

        return {
          route,
          upstream,
        };
      }

      return null;
    },
  };
}
