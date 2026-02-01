import { describe, it, expect, beforeEach } from 'vitest';

import {
  circuitBreakerStateToNumber,
  numberToCircuitBreakerState,
  normalizeUpstreamLabel,
  resetMetrics,
  getMetrics,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  activeConnections,
  upstreamRequestsTotal,
  upstreamRequestDurationSeconds,
  circuitBreakerState,
  circuitBreakerTransitionsTotal,
  rateLimitHitsTotal,
  rateLimitRemaining,
  healthCheckStatus,
  retryAttemptsTotal,
} from './index.js';

describe('Metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe('circuitBreakerStateToNumber', () => {
    it('should convert CLOSED to 0', () => {
      expect(circuitBreakerStateToNumber('CLOSED')).toBe(0);
    });

    it('should convert OPEN to 1', () => {
      expect(circuitBreakerStateToNumber('OPEN')).toBe(1);
    });

    it('should convert HALF_OPEN to 2', () => {
      expect(circuitBreakerStateToNumber('HALF_OPEN')).toBe(2);
    });
  });

  describe('numberToCircuitBreakerState', () => {
    it('should convert 0 to CLOSED', () => {
      expect(numberToCircuitBreakerState(0)).toBe('CLOSED');
    });

    it('should convert 1 to OPEN', () => {
      expect(numberToCircuitBreakerState(1)).toBe('OPEN');
    });

    it('should convert 2 to HALF_OPEN', () => {
      expect(numberToCircuitBreakerState(2)).toBe('HALF_OPEN');
    });

    it('should default to CLOSED for unknown values', () => {
      expect(numberToCircuitBreakerState(99)).toBe('CLOSED');
    });
  });

  describe('normalizeUpstreamLabel', () => {
    it('should remove http:// prefix', () => {
      expect(normalizeUpstreamLabel('http://example.com')).toBe('example.com');
    });

    it('should remove https:// prefix', () => {
      expect(normalizeUpstreamLabel('https://example.com')).toBe('example.com');
    });

    it('should remove trailing slash', () => {
      expect(normalizeUpstreamLabel('https://example.com/')).toBe('example.com');
    });

    it('should preserve port numbers', () => {
      expect(normalizeUpstreamLabel('http://example.com:8080')).toBe(
        'example.com:8080'
      );
    });

    it('should preserve path', () => {
      expect(normalizeUpstreamLabel('https://example.com/api/v1')).toBe(
        'example.com/api/v1'
      );
    });
  });

  describe('HTTP request metrics', () => {
    it('should increment httpRequestsTotal counter', async () => {
      httpRequestsTotal.inc({
        tenant_id: 'tenant-1',
        method: 'GET',
        route: '/api/test',
        status_code: '200',
      });

      const metrics = await getMetrics();
      expect(metrics).toContain('gateway_http_requests_total');
      expect(metrics).toContain('tenant_id="tenant-1"');
      expect(metrics).toContain('method="GET"');
      expect(metrics).toContain('status_code="200"');
    });

    it('should observe httpRequestDurationSeconds histogram', async () => {
      httpRequestDurationSeconds.observe(
        {
          tenant_id: 'tenant-1',
          method: 'GET',
          route: '/api/test',
        },
        0.125
      );

      const metrics = await getMetrics();
      expect(metrics).toContain('gateway_http_request_duration_seconds');
      expect(metrics).toContain('gateway_http_request_duration_seconds_bucket');
    });

    it('should track activeConnections gauge', async () => {
      activeConnections.inc();
      activeConnections.inc();
      activeConnections.dec();

      const metrics = await getMetrics();
      expect(metrics).toContain('gateway_active_connections 1');
    });
  });

  describe('Upstream request metrics', () => {
    it('should increment upstreamRequestsTotal counter', async () => {
      upstreamRequestsTotal.inc({
        tenant_id: 'tenant-1',
        upstream: 'api.example.com:8080',
        method: 'POST',
        status_code: '201',
      });

      const metrics = await getMetrics();
      expect(metrics).toContain('gateway_upstream_requests_total');
      expect(metrics).toContain('upstream="api.example.com:8080"');
    });

    it('should observe upstreamRequestDurationSeconds histogram', async () => {
      upstreamRequestDurationSeconds.observe(
        {
          tenant_id: 'tenant-1',
          upstream: 'api.example.com',
          method: 'GET',
          status_code: '200',
        },
        0.05
      );

      const metrics = await getMetrics();
      expect(metrics).toContain('gateway_upstream_request_duration_seconds');
    });
  });

  describe('Circuit breaker metrics', () => {
    it('should set circuitBreakerState gauge', async () => {
      circuitBreakerState.set(
        {
          tenant_id: 'tenant-1',
          route_id: 'route-1',
          upstream: 'api.example.com',
        },
        1 // OPEN
      );

      const metrics = await getMetrics();
      expect(metrics).toContain('gateway_circuit_breaker_state');
      expect(metrics).toContain('route_id="route-1"');
    });

    it('should increment circuitBreakerTransitionsTotal counter', async () => {
      circuitBreakerTransitionsTotal.inc({
        tenant_id: 'tenant-1',
        route_id: 'route-1',
        upstream: 'api.example.com',
        from_state: 'CLOSED',
        to_state: 'OPEN',
      });

      const metrics = await getMetrics();
      expect(metrics).toContain('gateway_circuit_breaker_transitions_total');
      expect(metrics).toContain('from_state="CLOSED"');
      expect(metrics).toContain('to_state="OPEN"');
    });
  });

  describe('Rate limiting metrics', () => {
    it('should increment rateLimitHitsTotal counter', async () => {
      rateLimitHitsTotal.inc({ tenant_id: 'tenant-1' });
      rateLimitHitsTotal.inc({ tenant_id: 'tenant-1' });

      const metrics = await getMetrics();
      expect(metrics).toContain('gateway_rate_limit_hits_total');
    });

    it('should set rateLimitRemaining gauge', async () => {
      rateLimitRemaining.set({ tenant_id: 'tenant-1' }, 95);

      const metrics = await getMetrics();
      expect(metrics).toContain('gateway_rate_limit_remaining');
    });
  });

  describe('Health check metrics', () => {
    it('should set healthCheckStatus gauge', async () => {
      healthCheckStatus.set(
        {
          tenant_id: 'tenant-1',
          route_id: 'route-1',
          upstream: 'api.example.com',
        },
        1 // healthy
      );

      const metrics = await getMetrics();
      expect(metrics).toContain('gateway_health_check_status');
    });
  });

  describe('Retry metrics', () => {
    it('should increment retryAttemptsTotal counter', async () => {
      retryAttemptsTotal.inc({
        tenant_id: 'tenant-1',
        route_id: 'route-1',
        attempt: '1',
      });

      const metrics = await getMetrics();
      expect(metrics).toContain('gateway_retry_attempts_total');
      expect(metrics).toContain('attempt="1"');
    });
  });

  describe('resetMetrics', () => {
    it('should reset all metrics', async () => {
      httpRequestsTotal.inc({
        tenant_id: 'tenant-1',
        method: 'GET',
        route: '/test',
        status_code: '200',
      });
      activeConnections.inc();

      resetMetrics();

      const metrics = await getMetrics();
      // After reset, counters should be at 0 (not appearing or showing 0)
      expect(metrics).not.toContain('gateway_http_requests_total{');
    });
  });

  describe('getMetrics', () => {
    it('should return Prometheus-formatted metrics', async () => {
      const metrics = await getMetrics();

      // Should contain HELP and TYPE comments
      expect(metrics).toContain('# HELP');
      expect(metrics).toContain('# TYPE');

      // Should contain default Node.js metrics
      expect(metrics).toContain('nodejs_');
      expect(metrics).toContain('process_');
    });
  });
});
