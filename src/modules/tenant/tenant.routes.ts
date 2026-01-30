import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const createTenantSchema = z.object({
  name: z.string().min(1).max(255),
  apiKey: z.string().min(16),
  defaultRateLimit: z
    .object({
      requestsPerSecond: z.number().int().positive(),
      burstSize: z.number().int().positive().optional(),
    })
    .optional(),
});

const updateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  isActive: z.boolean().optional(),
  defaultRateLimit: z
    .object({
      requestsPerSecond: z.number().int().positive(),
      burstSize: z.number().int().positive().optional(),
    })
    .nullable()
    .optional(),
});

type CreateTenantBody = z.infer<typeof createTenantSchema>;
type UpdateTenantBody = z.infer<typeof updateTenantSchema>;

interface TenantParams {
  id: string;
}

// eslint-disable-next-line @typescript-eslint/require-await
export const tenantRoutes: FastifyPluginAsync = async (app) => {
  const { tenantService } = app;

  // List all tenants
  app.get('/tenants', async (_request, reply) => {
    const tenants = await tenantService.getAllTenants();
    return reply.send({ data: tenants });
  });

  // Get tenant by ID
  app.get<{ Params: TenantParams }>('/tenants/:id', async (request, reply) => {
    const tenant = await tenantService.getTenantById(request.params.id);

    if (!tenant) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Tenant not found',
      });
    }

    return reply.send({ data: tenant });
  });

  // Create tenant
  app.post<{ Body: CreateTenantBody }>('/tenants', async (request, reply) => {
    const parseResult = createTenantSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: parseResult.error.flatten(),
      });
    }

    const existing = await tenantService.getTenantByName(parseResult.data.name);
    if (existing) {
      return reply.status(409).send({
        error: 'Conflict',
        message: 'Tenant with this name already exists',
      });
    }

    const tenant = await tenantService.createTenant(parseResult.data);

    return reply.status(201).send({
      data: tenant,
      apiKey: parseResult.data.apiKey,
    });
  });

  // Update tenant
  app.patch<{ Params: TenantParams; Body: UpdateTenantBody }>(
    '/tenants/:id',
    async (request, reply) => {
      const parseResult = updateTenantSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid request body',
          details: parseResult.error.flatten(),
        });
      }

      const tenant = await tenantService.getTenantById(request.params.id);
      if (!tenant) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Tenant not found',
        });
      }

      const { isActive } = parseResult.data;

      if (isActive === true) {
        await tenantService.activateTenant(request.params.id);
      } else if (isActive === false) {
        await tenantService.deactivateTenant(request.params.id);
      }

      const updated = await tenantService.getTenantById(request.params.id);

      return reply.send({ data: updated });
    }
  );

  // Delete tenant
  app.delete<{ Params: TenantParams }>(
    '/tenants/:id',
    async (request, reply) => {
      const deleted = await tenantService.deleteTenant(request.params.id);

      if (!deleted) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Tenant not found',
        });
      }

      return reply.status(204).send();
    }
  );
};
