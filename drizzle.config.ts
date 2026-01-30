import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/shared/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/api_gateway',
  },
  verbose: true,
  strict: true,
});
