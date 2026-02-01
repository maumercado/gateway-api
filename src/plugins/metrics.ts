import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { Registry } from 'prom-client';

import { config } from '../shared/config/index.js';
import {
  activeConnections,
  getMetrics,
  getMetricsContentType,
  httpRequestDurationSeconds,
  httpRequestsTotal,
  metricsRegistry,
} from '../shared/metrics/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    metricsRegistry: Registry;
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  // Check if metrics are enabled
  if (!config.METRICS_ENABLED) {
    fastify.log.info('Metrics collection is disabled');
    return;
  }

  // Decorate fastify with the metrics registry
  fastify.decorate('metricsRegistry', metricsRegistry);

  // Track request start time
  // eslint-disable-next-line @typescript-eslint/require-await
  fastify.addHook('onRequest', async (request) => {
    // Increment active connections
    activeConnections.inc();

    // Store request start time for duration calculation
    request.startTime = process.hrtime.bigint();
  });

  // Track request completion
  fastify.addHook('onResponse', async (request, reply) => {
    // Decrement active connections
    activeConnections.dec();

    // Calculate request duration in seconds
    const endTime = process.hrtime.bigint();
    const startTime = request.startTime ?? endTime;
    const durationNs = Number(endTime - startTime);
    const durationSeconds = durationNs / 1e9;

    // Get tenant ID from request (may be undefined for non-tenant routes)
    const tenantId = request.tenant?.id ?? 'none';
    const method = request.method;
    const statusCode = reply.statusCode.toString();

    // Normalize the route for the label
    // Use the matched route pattern if available, otherwise the URL path
    const route = request.routeOptions?.url ?? request.url.split('?')[0] ?? '/';

    // Record metrics
    httpRequestsTotal.inc({
      tenant_id: tenantId,
      method,
      route,
      status_code: statusCode,
    });

    httpRequestDurationSeconds.observe(
      {
        tenant_id: tenantId,
        method,
        route,
      },
      durationSeconds
    );
  });

  // Expose /metrics endpoint (no authentication required for Prometheus scraping)
  fastify.get('/metrics', async (_request, reply) => {
    const metrics = await getMetrics();
    return reply
      .type(getMetricsContentType())
      .send(metrics);
  });

  fastify.log.info('Metrics plugin registered');
};

// Extend FastifyRequest to store start time
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: bigint;
  }
}

export default fp(metricsPlugin, {
  name: 'metrics',
  dependencies: ['redis'],
});
