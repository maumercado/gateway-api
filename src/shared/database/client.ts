import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { config } from '../config/index.js';
import * as schema from './schema.js';

const queryClient = postgres(config.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
});

export const db = drizzle(queryClient, { schema });

// Use a more generic type that's compatible with the plugin's declaration
export type Database = ReturnType<typeof drizzle<typeof schema>>;

export async function closeDatabase(): Promise<void> {
  await queryClient.end();
}

export { schema };
