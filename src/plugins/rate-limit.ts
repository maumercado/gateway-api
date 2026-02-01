import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import {
  rateLimitHitsTotal,
  rateLimitRemaining,
} from '../shared/metrics/index.js';
import {
  checkRateLimit,
  getTenantRateLimitKey,
} from '../shared/rate-limiter/index.js';
import type { RateLimitConfig } from '../shared/types/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    rateLimit: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  requestsPerSecond: 100,
  burstSize: 150,
};

// eslint-disable-next-line @typescript-eslint/require-await
const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    'rateLimit',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const tenant = request.tenant;

      if (!tenant) {
        return;
      }

      const config = tenant.defaultRateLimit ?? DEFAULT_RATE_LIMIT;
      const key = getTenantRateLimitKey(tenant.id);

      const result = await checkRateLimit(key, config);

      // Track rate limit remaining in metrics
      rateLimitRemaining.set({ tenant_id: tenant.id }, result.remaining);

      reply.header('X-RateLimit-Limit', result.limit);
      reply.header('X-RateLimit-Remaining', result.remaining);
      reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

      if (!result.allowed) {
        // Track rate limit hit in metrics
        rateLimitHitsTotal.inc({ tenant_id: tenant.id });

        reply.header(
          'Retry-After',
          Math.ceil((result.resetAt - Date.now()) / 1000)
        );

        return reply.status(429).send({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        });
      }
    }
  );
};

export default fp(rateLimitPlugin, {
  name: 'rate-limit',
  dependencies: ['redis', 'tenant-auth'],
});
