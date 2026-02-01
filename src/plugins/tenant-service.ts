import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { createTenantRepository } from '../modules/tenant/tenant.repository.js';
import { createTenantService, type TenantService } from '../modules/tenant/tenant.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    tenantService: TenantService;
  }
}

const tenantServicePlugin: FastifyPluginAsync = (fastify) => {
  const repository = createTenantRepository(fastify.db);
  const service = createTenantService({
    repository,
    redis: fastify.redis,
  });

  fastify.decorate('tenantService', service);
  fastify.log.info('Tenant service registered');

  return Promise.resolve();
};

export default fp(tenantServicePlugin, {
  name: 'tenant-service',
  dependencies: ['database', 'redis'],
});
