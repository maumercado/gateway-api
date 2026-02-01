import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

import type { CircuitBreakerState } from '../types/index.js';

// Create a custom registry for gateway metrics
export const metricsRegistry = new Registry();

// Collect default Node.js metrics (memory, CPU, etc.)
collectDefaultMetrics({ register: metricsRegistry });

// Histogram buckets for latency measurements (in seconds)
// Fine granularity at low latencies (1ms-10s range)
const LATENCY_BUCKETS = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

// ============================================================================
// HTTP Request Metrics
// ============================================================================

/**
 * Total number of HTTP requests received by the gateway
 */
export const httpRequestsTotal = new Counter({
  name: 'gateway_http_requests_total',
  help: 'Total number of HTTP requests received',
  labelNames: ['tenant_id', 'method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

/**
 * HTTP request duration histogram (seconds)
 */
export const httpRequestDurationSeconds = new Histogram({
  name: 'gateway_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['tenant_id', 'method', 'route'] as const,
  buckets: LATENCY_BUCKETS,
  registers: [metricsRegistry],
});

/**
 * Number of currently active connections
 */
export const activeConnections = new Gauge({
  name: 'gateway_active_connections',
  help: 'Number of currently active connections',
  registers: [metricsRegistry],
});

// ============================================================================
// Upstream Request Metrics
// ============================================================================

/**
 * Total number of upstream requests made
 */
export const upstreamRequestsTotal = new Counter({
  name: 'gateway_upstream_requests_total',
  help: 'Total number of requests made to upstream services',
  labelNames: ['tenant_id', 'upstream', 'method', 'status_code'] as const,
  registers: [metricsRegistry],
});

/**
 * Upstream request duration histogram (seconds)
 */
export const upstreamRequestDurationSeconds = new Histogram({
  name: 'gateway_upstream_request_duration_seconds',
  help: 'Duration of upstream requests in seconds',
  labelNames: ['tenant_id', 'upstream', 'method', 'status_code'] as const,
  buckets: LATENCY_BUCKETS,
  registers: [metricsRegistry],
});

// ============================================================================
// Circuit Breaker Metrics
// ============================================================================

/**
 * Current circuit breaker state
 * Values: 0 = CLOSED, 1 = OPEN, 2 = HALF_OPEN
 */
export const circuitBreakerState = new Gauge({
  name: 'gateway_circuit_breaker_state',
  help: 'Current circuit breaker state (0=closed, 1=open, 2=half_open)',
  labelNames: ['tenant_id', 'route_id', 'upstream'] as const,
  registers: [metricsRegistry],
});

/**
 * Total number of circuit breaker state transitions
 */
export const circuitBreakerTransitionsTotal = new Counter({
  name: 'gateway_circuit_breaker_transitions_total',
  help: 'Total number of circuit breaker state transitions',
  labelNames: ['tenant_id', 'route_id', 'upstream', 'from_state', 'to_state'] as const,
  registers: [metricsRegistry],
});

// ============================================================================
// Rate Limiting Metrics
// ============================================================================

/**
 * Total number of rate limit hits (requests blocked due to rate limiting)
 */
export const rateLimitHitsTotal = new Counter({
  name: 'gateway_rate_limit_hits_total',
  help: 'Total number of requests blocked by rate limiting',
  labelNames: ['tenant_id'] as const,
  registers: [metricsRegistry],
});

/**
 * Current remaining rate limit allowance
 */
export const rateLimitRemaining = new Gauge({
  name: 'gateway_rate_limit_remaining',
  help: 'Current remaining rate limit allowance for a tenant',
  labelNames: ['tenant_id'] as const,
  registers: [metricsRegistry],
});

// ============================================================================
// Health Check Metrics
// ============================================================================

/**
 * Current health status of upstream services
 * Values: 0 = unhealthy, 1 = healthy
 */
export const healthCheckStatus = new Gauge({
  name: 'gateway_health_check_status',
  help: 'Current health status of upstream services (0=unhealthy, 1=healthy)',
  labelNames: ['tenant_id', 'route_id', 'upstream'] as const,
  registers: [metricsRegistry],
});

// ============================================================================
// Retry Metrics
// ============================================================================

/**
 * Total number of retry attempts made
 */
export const retryAttemptsTotal = new Counter({
  name: 'gateway_retry_attempts_total',
  help: 'Total number of retry attempts made for failed upstream requests',
  labelNames: ['tenant_id', 'route_id', 'attempt'] as const,
  registers: [metricsRegistry],
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert circuit breaker state to numeric value for Prometheus gauge
 */
export function circuitBreakerStateToNumber(state: CircuitBreakerState): number {
  switch (state) {
    case 'CLOSED':
      return 0;
    case 'OPEN':
      return 1;
    case 'HALF_OPEN':
      return 2;
    default:
      return 0;
  }
}

/**
 * Convert numeric value back to circuit breaker state
 */
export function numberToCircuitBreakerState(value: number): CircuitBreakerState {
  switch (value) {
    case 0:
      return 'CLOSED';
    case 1:
      return 'OPEN';
    case 2:
      return 'HALF_OPEN';
    default:
      return 'CLOSED';
  }
}

/**
 * Normalize upstream URL for use as a label
 * Removes protocol and trailing slashes for cleaner labels
 */
export function normalizeUpstreamLabel(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
  metricsRegistry.resetMetrics();
}

/**
 * Get all metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}

/**
 * Get the content type for Prometheus metrics
 */
export function getMetricsContentType(): string {
  return metricsRegistry.contentType;
}
