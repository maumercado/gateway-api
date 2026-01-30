import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';

import { redis, connectRedis, closeRedis } from '../shared/redis/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  // Connect to Redis
  await connectRedis();
  fastify.log.info('Redis connection established');

  // Decorate fastify with the shared redis instance
  fastify.decorate('redis', redis);

  // Handle graceful shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing Redis connection...');
    await closeRedis();
    fastify.log.info('Redis connection closed');
  });
};

export default fp(redisPlugin, {
  name: 'redis',
});
