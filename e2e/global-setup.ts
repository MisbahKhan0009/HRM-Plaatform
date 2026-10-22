import { fileURLToPath } from 'node:url';
import { createDb, schema, seedCompany, uuidv7 } from '@hrm/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { E2E_USERS } from './support/users';

/** Recreates the E2E database, applies migrations and seeds one company with a user per journey role. */
// biome-ignore lint/style/noDefaultExport: Playwright requires a default export for globalSetup
export default async function globalSetup() {
  const url = new URL(process.env.E2E_DATABASE_URL ?? 'postgres://hrm:hrm@localhost:5432/hrm_e2e');
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_e2e$/.test(name))
    throw new Error(`Refusing to recreate "${name}": E2E databases must end in _e2e`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const root = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  await root.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await root.unsafe(`CREATE DATABASE ${name}`);
  await root.end();

  const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL('../packages/db/migrations', import.meta.url)),
  });
  await client.end();

  const { db, sql } = createDb(url.toString());
  const { companyId } = await seedCompany(db, {
    companyId: uuidv7(),
    companyName: 'Big-Matrix Solutions',
    policyYear: 2026,
  });
  const roles = new Map(
    (await db.select().from(schema.roles).where(eq(schema.roles.companyId, companyId))).map((r) => [
      r.code,
      r.id,
    ]),
  );
  const employeeIds = new Map<string, string>();
  for (const u of E2E_USERS) {
    const userId = uuidv7();
    await db
      .insert(schema.users)
      .values({ id: userId, companyId, email: u.email, name: u.name, emailVerified: true, status: 'active' });
    for (const r of u.roles) {
      const roleId = roles.get(r);
      if (roleId) await db.insert(schema.userRoles).values({ userId, roleId });
    }
    if (u.employeeCode) {
      const employeeId = uuidv7();
      const [first, ...rest] = u.name.split(' ');
      await db.insert(schema.employees).values({
        id: employeeId,
        companyId,
        userId,
        employeeCode: u.employeeCode,
        firstName: first ?? u.name,
        lastName: rest.join(' ') || 'Test',
        status: 'active',
        joiningDate: '2024-01-01',
        managerId: u.managerKey ? (employeeIds.get(u.managerKey) ?? null) : null,
        workEmail: u.email,
      });
      employeeIds.set(u.key, employeeId);
    }
  }
  // The seeded codes bypass the API, so start the employee code sequence after them (BUSINESS-RULES §8).
  await db
    .insert(schema.codeSequences)
    .values({ companyId, scope: 'employee', nextValue: employeeIds.size + 1 })
    .onConflictDoUpdate({
      target: [schema.codeSequences.companyId, schema.codeSequences.scope],
      set: { nextValue: employeeIds.size + 1 },
    });
  await sql.end();
}
