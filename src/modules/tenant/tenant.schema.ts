import { boolean, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import type { RateLimitConfig } from '../../shared/types/index.js';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  apiKeyHash: varchar('api_key_hash', { length: 255 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  defaultRateLimit: jsonb('default_rate_limit').$type<RateLimitConfig>(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type TenantRow = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
