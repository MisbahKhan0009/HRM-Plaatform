import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** Runs in Node before the Workers pool starts: recreates the test database and applies all migrations. */
// biome-ignore lint/style/noDefaultExport: Vitest requires a default export for globalSetup
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://hrm:hrm@localhost:5432/hrm_test');
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(name))
    throw new Error(`Refusing to recreate "${name}": test databases must end in _test`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const root = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  await root.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await root.unsafe(`CREATE DATABASE ${name}`);
  await root.end();

  const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
  });
  await client.end();
}
