import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import { config } from '../shared/config/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    adminAuth: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
const adminAuthPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    'adminAuth',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const apiKey = request.headers['x-admin-key'];

      if (!apiKey || typeof apiKey !== 'string') {
        request.log.debug({ ip: request.ip }, 'Missing or invalid X-Admin-Key header');
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Missing or invalid X-Admin-Key header',
        });
      }

      if (apiKey !== config.ADMIN_API_KEY) {
        request.log.debug({ ip: request.ip }, 'Invalid admin API key');
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid admin API key',
        });
      }

      request.log.debug('Admin authenticated');
    }
  );
};

export default fp(adminAuthPlugin, {
  name: 'admin-auth',
});
