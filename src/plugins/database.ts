import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { db, closeDatabase, type Database } from '../shared/database/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
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
