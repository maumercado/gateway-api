import { selectUpstream } from '../../shared/load-balancer/index.js';

import * as routingRepository from './routing.repository.js';
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
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getRouteById(id: string): Promise<Route | null> {
  const row = await routingRepository.findRouteById(id);
  return row ? mapToRoute(row) : null;
}

export async function getRoutesByTenantId(tenantId: string): Promise<Route[]> {
  const rows = await routingRepository.findRoutesByTenantId(tenantId);
  return rows.map(mapToRoute);
}

export async function getActiveRoutesByTenantId(
  tenantId: string
): Promise<Route[]> {
  const rows = await routingRepository.findActiveRoutesByTenantId(tenantId);
  return rows.map(mapToRoute);
}

export async function createRoute(input: CreateRouteInput): Promise<Route> {
  const row = await routingRepository.createRoute({
    tenantId: input.tenantId,
    method: input.method,
    path: input.path,
    pathType: input.pathType ?? 'exact',
    upstreams: input.upstreams,
    loadBalancing: input.loadBalancing ?? 'round-robin',
    transform: input.transform ?? null,
  });

  return mapToRoute(row);
}

export async function updateRoute(
  id: string,
  data: Partial<Omit<CreateRouteInput, 'tenantId'>> & { isActive?: boolean }
): Promise<Route | null> {
  const row = await routingRepository.updateRoute(id, data);
  return row ? mapToRoute(row) : null;
}

export async function deleteRoute(id: string): Promise<boolean> {
  return routingRepository.deleteRoute(id);
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

export async function matchRoute(
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
}
