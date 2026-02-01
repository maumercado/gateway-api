import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';

import { handleProxy } from './modules/routing/routing.handler.js';
import { routingRoutes } from './modules/routing/routing.routes.js';
import { tenantRoutes } from './modules/tenant/tenant.routes.js';
import type { Tenant } from './modules/tenant/tenant.types.js';
import adminAuthPlugin from './plugins/admin-auth.js';
import databasePlugin from './plugins/database.js';
import healthCheckPlugin from './plugins/health-check.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import redisPlugin from './plugins/redis.js';
import routingServicePlugin from './plugins/routing-service.js';
import tenantAuthPlugin from './plugins/tenant-auth.js';
import tenantServicePlugin from './plugins/tenant-service.js';
import { config } from './shared/config/index.js';

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

  // Register infrastructure plugins (order matters due to dependencies)
  await app.register(databasePlugin);
  await app.register(redisPlugin);

  // Register service plugins
  await app.register(tenantServicePlugin);
  await app.register(routingServicePlugin);
  await app.register(healthCheckPlugin);

  // Register core plugins
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Register auth plugins (these depend on infrastructure plugins)
  await app.register(tenantAuthPlugin);
  await app.register(rateLimitPlugin);
  await app.register(adminAuthPlugin);

  // Health check endpoint (no auth required)
  app.get('/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // Ready check endpoint (no auth required)
  app.get('/ready', async (_request, reply) => {
    return reply.send({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  });

  // Admin API routes - use prefix and preHandler
  await app.register(
    async (adminApp) => {
      adminApp.addHook('preHandler', adminApp.adminAuth);
      await adminApp.register(tenantRoutes);
      await adminApp.register(routingRoutes);
    },
    { prefix: '/admin' }
  );

  // Proxy routes - require tenant authentication and rate limiting
  app.route<ProxyRequest>({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'],
    url: '/*',
    preHandler: [app.tenantAuth, app.rateLimit],
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

  // Graceful shutdown is handled by plugin onClose hooks
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Received shutdown signal');

    try {
      await app.close(); // This triggers all onClose hooks
      app.log.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'Error during shutdown');
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

    app.log.info(
      { port: config.PORT, env: config.NODE_ENV },
      'API Gateway started'
    );
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }

  return app;
}
