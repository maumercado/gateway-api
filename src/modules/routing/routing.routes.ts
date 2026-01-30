import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const upstreamSchema = z.object({
  url: z.string().url(),
  weight: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
});

const headerTransformSchema = z.object({
  add: z.record(z.string(), z.string()).optional(),
  remove: z.array(z.string()).optional(),
  set: z.record(z.string(), z.string()).optional(),
});

const transformSchema = z.object({
  request: z
    .object({
      headers: headerTransformSchema.optional(),
      pathRewrite: z
        .object({
          pattern: z.string(),
          replacement: z.string(),
        })
        .optional(),
    })
    .optional(),
  response: z
    .object({
      headers: headerTransformSchema.optional(),
    })
    .optional(),
});

const createRouteSchema = z.object({
  tenantId: z.string().uuid(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', '*']),
  path: z.string().min(1).max(1024),
  pathType: z.enum(['exact', 'prefix', 'regex']).optional(),
  upstreams: z.array(upstreamSchema).min(1),
  loadBalancing: z.enum(['round-robin', 'weighted', 'random']).optional(),
  transform: transformSchema.nullable().optional(),
});

const updateRouteSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', '*']).optional(),
  path: z.string().min(1).max(1024).optional(),
  pathType: z.enum(['exact', 'prefix', 'regex']).optional(),
  upstreams: z.array(upstreamSchema).min(1).optional(),
  loadBalancing: z.enum(['round-robin', 'weighted', 'random']).optional(),
  transform: transformSchema.nullable().optional(),
  isActive: z.boolean().optional(),
});

type CreateRouteBody = z.infer<typeof createRouteSchema>;
type UpdateRouteBody = z.infer<typeof updateRouteSchema>;

interface RouteParams {
  id: string;
}

interface TenantParams {
  tenantId: string;
}

// eslint-disable-next-line @typescript-eslint/require-await
export const routingRoutes: FastifyPluginAsync = async (app) => {
  const { tenantService, routingService } = app;

  // List routes for a tenant
  app.get<{ Params: TenantParams }>(
    '/tenants/:tenantId/routes',
    async (request, reply) => {
      const tenant = await tenantService.getTenantById(request.params.tenantId);

      if (!tenant) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Tenant not found',
        });
      }

      const routes = await routingService.getRoutesByTenantId(
        request.params.tenantId
      );

      return reply.send({ data: routes });
    }
  );

  // Get route by ID
  app.get<{ Params: RouteParams }>('/routes/:id', async (request, reply) => {
    const route = await routingService.getRouteById(request.params.id);

    if (!route) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Route not found',
      });
    }

    return reply.send({ data: route });
  });

  // Create route
  app.post<{ Body: CreateRouteBody }>('/routes', async (request, reply) => {
    const parseResult = createRouteSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: parseResult.error.flatten(),
      });
    }

    const tenant = await tenantService.getTenantById(parseResult.data.tenantId);
    if (!tenant) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Tenant not found',
      });
    }

    if (parseResult.data.pathType === 'regex') {
      try {
        new RegExp(parseResult.data.path);
      } catch {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid regex pattern',
        });
      }
    }

    const route = await routingService.createRoute(parseResult.data);

    return reply.status(201).send({ data: route });
  });

  // Update route
  app.patch<{ Params: RouteParams; Body: UpdateRouteBody }>(
    '/routes/:id',
    async (request, reply) => {
      const parseResult = updateRouteSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid request body',
          details: parseResult.error.flatten(),
        });
      }

      const existing = await routingService.getRouteById(request.params.id);
      if (!existing) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Route not found',
        });
      }

      const pathType = parseResult.data.pathType ?? existing.pathType;
      const path = parseResult.data.path ?? existing.path;

      if (pathType === 'regex') {
        try {
          new RegExp(path);
        } catch {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Invalid regex pattern',
          });
        }
      }

      const route = await routingService.updateRoute(
        request.params.id,
        parseResult.data
      );

      return reply.send({ data: route });
    }
  );

  // Delete route
  app.delete<{ Params: RouteParams }>('/routes/:id', async (request, reply) => {
    const deleted = await routingService.deleteRoute(request.params.id);

    if (!deleted) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Route not found',
      });
    }

    return reply.status(204).send();
  });
};
