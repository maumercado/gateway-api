import 'dotenv/config';

import { hash } from 'bcrypt';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { routes } from '../src/modules/routing/routing.schema.js';
import { tenants } from '../src/modules/tenant/tenant.schema.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/api_gateway';

const queryClient = postgres(DATABASE_URL);
const db = drizzle(queryClient);

async function seed() {
  console.log('Seeding database...');

  // Create test tenant
  const testApiKey = 'test-api-key-12345';
  const apiKeyHash = await hash(testApiKey, 12);

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: 'test-tenant',
      apiKeyHash,
      isActive: true,
    })
    .returning();

  console.log('Created tenant:', tenant?.name);
  console.log('API Key:', testApiKey);

  // Create a test route that proxies to httpbin.org
  const [route] = await db
    .insert(routes)
    .values({
      tenantId: tenant!.id,
      method: '*',
      path: '/test',
      pathType: 'prefix',
      upstreams: [{ url: 'https://httpbin.org', timeout: 10000 }],
      loadBalancing: 'round-robin',
      isActive: true,
    })
    .returning();

  console.log('Created route:', route?.path, '-> https://httpbin.org');

  await queryClient.end();
  console.log('Done!');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
