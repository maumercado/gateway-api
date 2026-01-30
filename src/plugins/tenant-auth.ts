import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import type { Tenant } from '../modules/tenant/tenant.types.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: Tenant;
  }

  interface FastifyInstance {
    tenantAuth: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
const tenantAuthPlugin: FastifyPluginAsync = async (fastify) => {
  const { tenantService } = fastify;

  fastify.decorate(
    'tenantAuth',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const apiKey = request.headers['x-api-key'];

      if (!apiKey || typeof apiKey !== 'string') {
        request.log.debug({ ip: request.ip }, 'Missing or invalid X-API-Key header');
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Missing or invalid X-API-Key header',
        });
      }

      const tenant = await tenantService.validateApiKey(apiKey);

      if (!tenant) {
        request.log.debug({ ip: request.ip }, 'Invalid API key');
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid API key',
        });
      }

      if (!tenant.isActive) {
        request.log.debug({ tenantId: tenant.id }, 'Tenant is inactive');
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Tenant account is inactive',
        });
      }

      request.log.debug(
        { tenantId: tenant.id, tenantName: tenant.name },
        'Tenant authenticated'
      );

      request.tenant = tenant;
    }
  );
};

export default fp(tenantAuthPlugin, {
  name: 'tenant-auth',
  dependencies: ['tenant-service'],
});
