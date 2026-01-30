import { eq } from 'drizzle-orm';

import { tenants, type NewTenant, type TenantRow } from './tenant.schema.js';
import { db } from '../../shared/database/client.js';


export async function findTenantById(id: string): Promise<TenantRow | null> {
  const result = await db.select().from(tenants).where(eq(tenants.id, id));
  return result[0] ?? null;
}

export async function findTenantByName(
  name: string
): Promise<TenantRow | null> {
  const result = await db.select().from(tenants).where(eq(tenants.name, name));
  return result[0] ?? null;
}

export async function findAllTenants(): Promise<TenantRow[]> {
  return db.select().from(tenants);
}

export async function findActiveTenants(): Promise<TenantRow[]> {
  return db.select().from(tenants).where(eq(tenants.isActive, true));
}

export async function createTenant(data: NewTenant): Promise<TenantRow> {
  const result = await db.insert(tenants).values(data).returning();
  return result[0]!;
}

export async function updateTenant(
  id: string,
  data: Partial<Omit<NewTenant, 'id'>>
): Promise<TenantRow | null> {
  const result = await db
    .update(tenants)
    .set(data)
    .where(eq(tenants.id, id))
    .returning();
  return result[0] ?? null;
}

export async function deleteTenant(id: string): Promise<boolean> {
  const result = await db
    .delete(tenants)
    .where(eq(tenants.id, id))
    .returning({ id: tenants.id });
  return result.length > 0;
}
