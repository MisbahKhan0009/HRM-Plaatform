import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Creates a Drizzle client. In the Worker the connection string comes from the Hyperdrive binding
 * (`env.HYPERDRIVE.connectionString`); create one client per request and never share it across requests.
 */
export function createDb(connectionString: string) {
  const sql = postgres(connectionString, {
    max: 5,
    fetch_types: false, // Hyperdrive: avoids an extra round trip per connection
    prepare: true,
  });
  return { db: drizzle(sql, { schema, casing: 'snake_case' }), sql };
}

export type Db = ReturnType<typeof createDb>['db'];
