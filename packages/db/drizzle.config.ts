import { defineConfig } from 'drizzle-kit';

// Migrations are generated SQL, committed and reviewed (DATABASE-CONVENTIONS.md). Run as role hrm_owner.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://hrm:hrm@localhost:5432/hrm' },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
