import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import * as tenantServiceModule from '../modules/tenant/tenant.service.js';
import type { CreateTenantInput, Tenant } from '../modules/tenant/tenant.types.js';

export interface TenantService {
  getTenantById(id: string): Promise<Tenant | null>;
  getTenantByName(name: string): Promise<Tenant | null>;
  getAllTenants(): Promise<Tenant[]>;
  getActiveTenants(): Promise<Tenant[]>;
  createTenant(input: CreateTenantInput): Promise<Tenant>;
  validateApiKey(apiKey: string): Promise<Tenant | null>;
  deactivateTenant(id: string): Promise<Tenant | null>;
  activateTenant(id: string): Promise<Tenant | null>;
  deleteTenant(id: string): Promise<boolean>;
}

declare module 'fastify' {
  interface FastifyInstance {
    tenantService: TenantService;
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
const tenantServicePlugin: FastifyPluginAsync = async (fastify) => {
  // Wrap the service module to expose it as a fastify decorator
  const service: TenantService = {
    getTenantById: tenantServiceModule.getTenantById,
    getTenantByName: tenantServiceModule.getTenantByName,
    getAllTenants: tenantServiceModule.getAllTenants,
    getActiveTenants: tenantServiceModule.getActiveTenants,
    createTenant: tenantServiceModule.createTenant,
    validateApiKey: tenantServiceModule.validateApiKey,
    deactivateTenant: tenantServiceModule.deactivateTenant,
    activateTenant: tenantServiceModule.activateTenant,
    deleteTenant: tenantServiceModule.deleteTenant,
  };

  fastify.decorate('tenantService', service);
  fastify.log.info('Tenant service registered');
};

export default fp(tenantServicePlugin, {
  name: 'tenant-service',
  dependencies: ['database', 'redis'],
});
