import type { UpstreamConfig } from '../../shared/types/index.js';

export type PathType = 'exact' | 'prefix' | 'regex';
export type LoadBalancing = 'round-robin' | 'weighted' | 'random';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | '*';

export interface Route {
  id: string;
  tenantId: string;
  method: string;
  path: string;
  pathType: PathType;
  upstreams: UpstreamConfig[];
  loadBalancing: LoadBalancing;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRouteInput {
  tenantId: string;
  method: HttpMethod;
  path: string;
  pathType?: PathType;
  upstreams: UpstreamConfig[];
  loadBalancing?: LoadBalancing;
}

export interface MatchedRoute {
  route: Route;
  upstream: UpstreamConfig;
  pathParams?: Record<string, string>;
}
