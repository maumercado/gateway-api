import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';

import { tenantAuthMiddleware } from './middleware/tenant-auth.js';
import { handleProxy } from './modules/routing/routing.handler.js';
import type { Tenant } from './modules/tenant/tenant.types.js';
import { config } from './shared/config/index.js';
import { closeDatabase } from './shared/database/client.js';
import { logger } from './shared/logger/index.js';
import { closeRedis, connectRedis } from './shared/redis/client.js';

interface ProxyRequest {
  Params: Record<string, string>;
  tenant: Tenant;
}

export async function createGateway() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  // Register plugins
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Health check endpoint (no auth required)
  app.get('/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // Ready check endpoint (no auth required)
  app.get('/ready', async (_request, reply) => {
    // Could add database/redis connectivity checks here
    return reply.send({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  });

  // Proxy routes - require tenant authentication
  app.route<ProxyRequest>({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'],
    url: '/*',
    preHandler: [tenantAuthMiddleware],
    handler: async (request, reply) => {
      if (!request.tenant) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Tenant not authenticated',
        });
      }

      return handleProxy(
        request as typeof request & { tenant: Tenant },
        reply
      );
    },
  });

  return app;
}

export async function startGateway() {
  const app = await createGateway();

  // Connect to Redis
  await connectRedis();
  logger.info('Connected to Redis');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');

    try {
      await app.close();
      logger.info('Fastify server closed');

      await closeRedis();
      await closeDatabase();

      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Start the server
  try {
    await app.listen({
      port: config.PORT,
      host: '0.0.0.0',
    });

    logger.info(
      { port: config.PORT, env: config.NODE_ENV },
      'API Gateway started'
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }

  return app;
}
