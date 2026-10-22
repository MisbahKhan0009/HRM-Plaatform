// Usage (staging or local only): DATABASE_URL=... pnpm --filter @hrm/db db:seed:demo
// Run db:seed first. Adds synthetic departments, positions, employees with users and approved salaries.
import { createDb } from '../src/client';
import { companies } from '../src/schema';
import { seedDemo } from '../src/seed-demo';

const url = process.env.DATABASE_URL ?? 'postgres://hrm:hrm@localhost:5432/hrm';
if (/neon\.tech/.test(url) && process.env.SEED_DEMO_CONFIRM !== 'staging') {
  console.error('Refusing to seed demo data into a Neon database without SEED_DEMO_CONFIRM=staging.');
  process.exit(1);
}
const { db, sql } = createDb(url);
const [company] = await db.select({ id: companies.id }).from(companies).limit(1);
if (!company) {
  console.error('No company found: run db:seed first.');
  process.exit(1);
}
const result = await seedDemo(db, company.id, process.env.SEED_DEMO_EMAIL_DOMAIN ?? 'demo.example');
console.log(result.skipped ? 'Employees already exist; demo seed skipped.' : `Seeded ${result.employees} demo employees.`);
await sql.end();
