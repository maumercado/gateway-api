import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import type { UpstreamConfig } from '../../shared/types/index.js';
import { tenants } from '../tenant/tenant.schema.js';

export const pathTypeEnum = pgEnum('path_type', ['exact', 'prefix', 'regex']);

export const loadBalancingEnum = pgEnum('load_balancing', [
  'round-robin',
  'weighted',
  'random',
]);

export const routes = pgTable('routes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  method: varchar('method', { length: 10 }).notNull(),
  path: varchar('path', { length: 1024 }).notNull(),
  pathType: pathTypeEnum('path_type').notNull().default('exact'),
  upstreams: jsonb('upstreams').$type<UpstreamConfig[]>().notNull(),
  loadBalancing: loadBalancingEnum('load_balancing')
    .notNull()
    .default('round-robin'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type RouteRow = typeof routes.$inferSelect;
export type NewRoute = typeof routes.$inferInsert;
