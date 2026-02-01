import { eq } from 'drizzle-orm';

import { tenants, type NewTenant, type TenantRow } from './tenant.schema.js';
import type { Database } from '../../shared/database/client.js';

export interface TenantRepository {
  findTenantById(id: string): Promise<TenantRow | null>;
  findTenantByName(name: string): Promise<TenantRow | null>;
  findAllTenants(): Promise<TenantRow[]>;
  findActiveTenants(): Promise<TenantRow[]>;
  createTenant(data: NewTenant): Promise<TenantRow>;
  updateTenant(id: string, data: Partial<Omit<NewTenant, 'id'>>): Promise<TenantRow | null>;
  deleteTenant(id: string): Promise<boolean>;
}

export function createTenantRepository(db: Database): TenantRepository {
  return {
    async findTenantById(id: string): Promise<TenantRow | null> {
      const result = await db.select().from(tenants).where(eq(tenants.id, id));
      return result[0] ?? null;
    },

    async findTenantByName(name: string): Promise<TenantRow | null> {
      const result = await db.select().from(tenants).where(eq(tenants.name, name));
      return result[0] ?? null;
    },

    async findAllTenants(): Promise<TenantRow[]> {
      return db.select().from(tenants);
    },

    async findActiveTenants(): Promise<TenantRow[]> {
      return db.select().from(tenants).where(eq(tenants.isActive, true));
    },

    async createTenant(data: NewTenant): Promise<TenantRow> {
      const result = await db.insert(tenants).values(data).returning();
      return result[0]!;
    },

    async updateTenant(
      id: string,
      data: Partial<Omit<NewTenant, 'id'>>
    ): Promise<TenantRow | null> {
      const result = await db
        .update(tenants)
        .set(data)
        .where(eq(tenants.id, id))
        .returning();
      return result[0] ?? null;
    },

    async deleteTenant(id: string): Promise<boolean> {
      const result = await db
        .delete(tenants)
        .where(eq(tenants.id, id))
        .returning({ id: tenants.id });
      return result.length > 0;
    },
  };
}
