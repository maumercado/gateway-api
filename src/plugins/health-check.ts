import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import {
  createHealthCheckManager,
  type HealthCheckManager,
} from '../shared/health-check/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    healthChecker: HealthCheckManager;
  }
}

const healthCheckPlugin: FastifyPluginAsync = (fastify) => {
  const healthChecker = createHealthCheckManager(fastify.redis);

  fastify.decorate('healthChecker', healthChecker);

  // Start health checks when server is ready
  fastify.addHook('onReady', () => {
    healthChecker.startAll();
    fastify.log.info('Health check manager started');
  });

  // Stop health checks on close
  fastify.addHook('onClose', () => {
    healthChecker.stopAll();
    fastify.log.info('Health check manager stopped');
  });

  return Promise.resolve();
};

export default fp(healthCheckPlugin, {
  name: 'health-check',
  dependencies: ['redis', 'routing-service'],
});
