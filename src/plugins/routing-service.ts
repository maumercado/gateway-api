import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import * as routingServiceModule from '../modules/routing/routing.service.js';
import type {
  CreateRouteInput,
  MatchedRoute,
  Route,
} from '../modules/routing/routing.types.js';

export interface RoutingService {
  getRouteById(id: string): Promise<Route | null>;
  getRoutesByTenantId(tenantId: string): Promise<Route[]>;
  getActiveRoutesByTenantId(tenantId: string): Promise<Route[]>;
  createRoute(input: CreateRouteInput): Promise<Route>;
  updateRoute(
    id: string,
    data: Partial<Omit<CreateRouteInput, 'tenantId'>> & { isActive?: boolean }
  ): Promise<Route | null>;
  deleteRoute(id: string): Promise<boolean>;
  matchRoute(tenantId: string, method: string, path: string): Promise<MatchedRoute | null>;
}

declare module 'fastify' {
  interface FastifyInstance {
    routingService: RoutingService;
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
const routingServicePlugin: FastifyPluginAsync = async (fastify) => {
  // Wrap the service module to expose it as a fastify decorator
  const service: RoutingService = {
    getRouteById: routingServiceModule.getRouteById,
    getRoutesByTenantId: routingServiceModule.getRoutesByTenantId,
    getActiveRoutesByTenantId: routingServiceModule.getActiveRoutesByTenantId,
    createRoute: routingServiceModule.createRoute,
    updateRoute: routingServiceModule.updateRoute,
    deleteRoute: routingServiceModule.deleteRoute,
    matchRoute: routingServiceModule.matchRoute,
  };

  fastify.decorate('routingService', service);
  fastify.log.info('Routing service registered');
};

export default fp(routingServicePlugin, {
  name: 'routing-service',
  dependencies: ['database'],
});
