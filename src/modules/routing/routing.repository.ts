import { and, eq } from 'drizzle-orm';

import { routes, type NewRoute, type RouteRow } from './routing.schema.js';
import type { Database } from '../../shared/database/client.js';

export interface RoutingRepository {
  findRouteById(id: string): Promise<RouteRow | null>;
  findRoutesByTenantId(tenantId: string): Promise<RouteRow[]>;
  findActiveRoutesByTenantId(tenantId: string): Promise<RouteRow[]>;
  createRoute(data: NewRoute): Promise<RouteRow>;
  updateRoute(id: string, data: Partial<Omit<NewRoute, 'id'>>): Promise<RouteRow | null>;
  deleteRoute(id: string): Promise<boolean>;
  deleteRoutesByTenantId(tenantId: string): Promise<number>;
}

export function createRoutingRepository(db: Database): RoutingRepository {
  return {
    async findRouteById(id: string): Promise<RouteRow | null> {
      const result = await db.select().from(routes).where(eq(routes.id, id));
      return result[0] ?? null;
    },

    async findRoutesByTenantId(tenantId: string): Promise<RouteRow[]> {
      return db.select().from(routes).where(eq(routes.tenantId, tenantId));
    },

    async findActiveRoutesByTenantId(tenantId: string): Promise<RouteRow[]> {
      return db
        .select()
        .from(routes)
        .where(and(eq(routes.tenantId, tenantId), eq(routes.isActive, true)));
    },

    async createRoute(data: NewRoute): Promise<RouteRow> {
      const result = await db.insert(routes).values(data).returning();
      return result[0]!;
    },

    async updateRoute(
      id: string,
      data: Partial<Omit<NewRoute, 'id'>>
    ): Promise<RouteRow | null> {
      const result = await db
        .update(routes)
        .set(data)
        .where(eq(routes.id, id))
        .returning();
      return result[0] ?? null;
    },

    async deleteRoute(id: string): Promise<boolean> {
      const result = await db
        .delete(routes)
        .where(eq(routes.id, id))
        .returning({ id: routes.id });
      return result.length > 0;
    },

    async deleteRoutesByTenantId(tenantId: string): Promise<number> {
      const result = await db
        .delete(routes)
        .where(eq(routes.tenantId, tenantId))
        .returning({ id: routes.id });
      return result.length;
    },
  };
}
