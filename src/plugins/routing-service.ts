import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { createRoutingRepository } from '../modules/routing/routing.repository.js';
import { createRoutingService, type RoutingService } from '../modules/routing/routing.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    routingService: RoutingService;
  }
}

const routingServicePlugin: FastifyPluginAsync = (fastify) => {
  const repository = createRoutingRepository(fastify.db);
  const service = createRoutingService({ repository });

  fastify.decorate('routingService', service);
  fastify.log.info('Routing service registered');

  return Promise.resolve();
};

export default fp(routingServicePlugin, {
  name: 'routing-service',
  dependencies: ['database'],
});
