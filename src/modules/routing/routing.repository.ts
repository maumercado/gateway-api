import { and, eq } from 'drizzle-orm';

import { routes, type NewRoute, type RouteRow } from './routing.schema.js';
import { db } from '../../shared/database/client.js';


export async function findRouteById(id: string): Promise<RouteRow | null> {
  const result = await db.select().from(routes).where(eq(routes.id, id));
  return result[0] ?? null;
}

export async function findRoutesByTenantId(
  tenantId: string
): Promise<RouteRow[]> {
  return db.select().from(routes).where(eq(routes.tenantId, tenantId));
}

export async function findActiveRoutesByTenantId(
  tenantId: string
): Promise<RouteRow[]> {
  return db
    .select()
    .from(routes)
    .where(and(eq(routes.tenantId, tenantId), eq(routes.isActive, true)));
}

export async function createRoute(data: NewRoute): Promise<RouteRow> {
  const result = await db.insert(routes).values(data).returning();
  return result[0]!;
}

export async function updateRoute(
  id: string,
  data: Partial<Omit<NewRoute, 'id'>>
): Promise<RouteRow | null> {
  const result = await db
    .update(routes)
    .set(data)
    .where(eq(routes.id, id))
    .returning();
  return result[0] ?? null;
}

export async function deleteRoute(id: string): Promise<boolean> {
  const result = await db
    .delete(routes)
    .where(eq(routes.id, id))
    .returning({ id: routes.id });
  return result.length > 0;
}

export async function deleteRoutesByTenantId(tenantId: string): Promise<number> {
  const result = await db
    .delete(routes)
    .where(eq(routes.tenantId, tenantId))
    .returning({ id: routes.id });
  return result.length;
}
