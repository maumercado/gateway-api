import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';
import { config } from '../config/index.js';
import { logger } from '../logger/index.js';


const queryClient = postgres(config.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
});

export const db = drizzle(queryClient, { schema });

export async function closeDatabase(): Promise<void> {
  logger.info('Closing database connection...');
  await queryClient.end();
  logger.info('Database connection closed');
}

export { schema };
