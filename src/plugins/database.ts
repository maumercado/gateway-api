import type { FastifyPluginAsync } from 'fastify';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import fp from 'fastify-plugin';

import { db, closeDatabase, schema } from '../shared/database/client.js';

type DatabaseSchema = typeof schema;

declare module 'fastify' {
  interface FastifyInstance {
    db: PostgresJsDatabase<DatabaseSchema>;
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
const databasePlugin: FastifyPluginAsync = async (fastify) => {
  // Decorate fastify with the shared db instance
  fastify.decorate('db', db);
  fastify.log.info('Database client registered');

  // Handle graceful shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing database connection...');
    await closeDatabase();
    fastify.log.info('Database connection closed');
  });
};

export default fp(databasePlugin, {
  name: 'database',
});
