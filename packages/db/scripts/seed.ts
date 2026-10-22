// Usage: DATABASE_URL=... SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_NAME="Your Name" pnpm --filter @hrm/db db:seed
// Creates the baseline (company, roles, settings, schedule, leave types) and, optionally, the first admin.
import { createDb } from '../src/client';
import { seedBaseline } from '../src/seed';

const url = process.env.DATABASE_URL ?? 'postgres://hrm:hrm@localhost:5432/hrm';
const { db, sql } = createDb(url);
const email = process.env.SEED_ADMIN_EMAIL;
const result = await seedBaseline(db, {
  companyName: process.env.SEED_COMPANY_NAME ?? 'Big-Matrix Solutions',
  policyYear: Number(process.env.SEED_POLICY_YEAR ?? new Date().getUTCFullYear()),
  ...(email
    ? {
        admin: {
          email,
          name: process.env.SEED_ADMIN_NAME ?? 'Administrator',
          roleCodes: (process.env.SEED_ADMIN_ROLES ?? 'system_admin,hr_admin').split(','),
        },
      }
    : {}),
});
console.log(`Seeded company ${result.companyId}${result.adminUserId ? ' and the first admin' : ''}.`);
await sql.end();
