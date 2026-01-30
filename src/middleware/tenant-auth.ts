import type { FastifyReply, FastifyRequest } from 'fastify';

import { validateApiKey } from '../modules/tenant/tenant.service.js';
import type { Tenant } from '../modules/tenant/tenant.types.js';
import { logger } from '../shared/logger/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: Tenant;
  }
}

export async function tenantAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'];

  if (!apiKey || typeof apiKey !== 'string') {
    logger.debug({ ip: request.ip }, 'Missing or invalid X-API-Key header');
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing or invalid X-API-Key header',
    });
  }

  const tenant = await validateApiKey(apiKey);

  if (!tenant) {
    logger.debug({ ip: request.ip }, 'Invalid API key');
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid API key',
    });
  }

  if (!tenant.isActive) {
    logger.debug({ tenantId: tenant.id }, 'Tenant is inactive');
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Tenant account is inactive',
    });
  }

  logger.debug({ tenantId: tenant.id, tenantName: tenant.name }, 'Tenant authenticated');

  request.tenant = tenant;
}
