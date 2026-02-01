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

// Circuit Breaker Types
export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number; // Failures before opening (default: 5)
  successThreshold: number; // Successes to close from half-open (default: 2)
  timeout: number; // Ms before OPEN -> HALF_OPEN (default: 30000)
}

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  lastStateChange: number;
}

// Retry Policy Types
export interface RetryConfig {
  enabled: boolean;
  maxRetries: number; // Max attempts (default: 3)
  baseDelayMs: number; // Base delay (default: 1000)
  maxDelayMs?: number; // Max delay cap (default: 30000)
  retryableStatusCodes?: number[]; // (default: [500, 502, 503, 504])
}

// Timeout Types
export interface TimeoutConfig {
  default: number; // Default timeout in ms
  byMethod?: {
    GET?: number;
    POST?: number;
    PUT?: number;
    DELETE?: number;
    PATCH?: number;
    HEAD?: number;
  };
}

// Health Check Types
export interface HealthCheckConfig {
  enabled: boolean;
  endpoint: string; // e.g., "/health"
  intervalMs: number; // Check interval (min 5000)
  timeoutMs: number;
  healthyThreshold?: number; // Successes to mark healthy (default: 2)
  unhealthyThreshold?: number; // Failures to mark unhealthy (default: 3)
}

export interface HealthStatus {
  healthy: boolean;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  lastCheckTime: number | null;
  lastSuccessTime: number | null;
  lastFailureTime: number | null;
}

// Fallback Types
export interface FallbackConfig {
  enabled: boolean;
  statusCode: number;
  contentType: 'application/json' | 'text/plain' | 'text/html';
  body: string;
}

// Route-level Resilience Configuration
export interface ResilienceConfig {
  circuitBreaker?: CircuitBreakerConfig;
  retry?: RetryConfig;
  timeout?: TimeoutConfig;
  healthCheck?: HealthCheckConfig;
  fallback?: FallbackConfig;
}
