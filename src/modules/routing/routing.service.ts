
import * as routingRepository from './routing.repository.js';
import type { RouteRow } from './routing.schema.js';
import type {
  CreateRouteInput,
  MatchedRoute,
  Route,
} from './routing.types.js';
import type { UpstreamConfig } from '../../shared/types/index.js';

function mapToRoute(row: RouteRow): Route {
  return {
    id: row.id,
    tenantId: row.tenantId,
    method: row.method,
    path: row.path,
    pathType: row.pathType,
    upstreams: row.upstreams,
    loadBalancing: row.loadBalancing,
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
  });

  return mapToRoute(row);
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
      // Regex matching is out of scope for Phase 1
      return false;

    default:
      return false;
  }
}

function selectUpstream(
  upstreams: UpstreamConfig[],
  _loadBalancing: Route['loadBalancing']
): UpstreamConfig {
  // For Phase 1, just return the first upstream
  // Load balancing algorithms will be implemented in Phase 2
  return upstreams[0]!;
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

    // Found a match
    const upstream = selectUpstream(route.upstreams, route.loadBalancing);

    return {
      route,
      upstream,
    };
  }

  return null;
}
