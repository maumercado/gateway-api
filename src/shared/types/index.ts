import type { FastifyRequest } from 'fastify';

import type { Tenant } from '../../modules/tenant/tenant.types.js';

export interface TenantContext {
  tenant: Tenant;
}

export type AuthenticatedRequest = FastifyRequest & TenantContext;

export interface UpstreamConfig {
  url: string;
  weight?: number;
  timeout?: number;
}

export interface RateLimitConfig {
  requestsPerSecond: number;
  burstSize?: number;
}

export interface HeaderTransform {
  add?: Record<string, string>;
  remove?: string[];
  set?: Record<string, string>;
}

export interface TransformConfig {
  request?: {
    headers?: HeaderTransform;
    pathRewrite?: {
      pattern: string;
      replacement: string;
    };
  };
  response?: {
    headers?: HeaderTransform;
  };
}
