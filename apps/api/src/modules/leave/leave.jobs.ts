import type { Tx } from '@hrm/db';
import { carryForwardExpiryDate } from '@hrm/domain';
import { type SQL, sql } from 'drizzle-orm';
import type { DailyContext, DailyStep } from '../../jobs/dispatcher';

/*
 * Leave postings of the daily dispatcher (BUSINESS-RULES §5, JOBS-AND-OUTBOX §3). Each step is one or two set-based
 * statements (ADR-0009: no per-employee loops in the Worker) that insert ledger entries and move `leave_balances` in
 * the same statement. The SQL mirrors the pure functions in `@hrm/domain` (accrual.ts); tests check both agree.
 * Idempotency: `job_runs` per run key, the unique index `leave_ledger_accrual_once_uq` for accrual, carry-forward and
 * expiry, and a NOT EXISTS guard for grants.
 */

/** UUID v7 in SQL (DOMAIN-MODEL §2): a random v4 with the millisecond timestamp in the first 48 bits. */
const UUID_V7 = sql.raw(
  `encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid`,
);

const jobRunId = (ctx: DailyContext, job: string, runKey: string) =>
  sql`(SELECT id FROM job_runs WHERE company_id = ${ctx.companyId} AND job = ${job} AND run_key = ${runKey})`;

/** Policies of a method in force on `date`, for active leave types of the company. */
const policiesOn = (ctx: DailyContext, method: string, date: string) => sql`
  SELECT p.* FROM leave_policies p JOIN leave_types t ON t.id = p.leave_type_id AND t.is_active
  WHERE p.company_id = ${ctx.companyId} AND p.allocation_method = ${method}
    AND p.effective_from <= ${date}::date AND (p.effective_to IS NULL OR p.effective_to >= ${date}::date)`;

/** BUSINESS-RULES 5.1: employed, in an eligible status and past `eligibility_after_days` on `date`. */
const eligibleOn = (ctx: DailyContext, date: string) => sql`
  e.company_id = ${ctx.companyId} AND e.joining_date IS NOT NULL AND e.status = ANY(pol.eligible_statuses)
  AND e.joining_date + pol.eligibility_after_days <= ${date}::date
  AND (e.separation_date IS NULL OR e.separation_date >= ${date}::date)`;

/**
 * Inserts the candidate rows of `source` (columns employee_id, leave_type_id, leave_year, type, amount,
 * effective_date, policy_id) as ledger entries and adds them to the balance projection (BUSINESS-RULES 4.1).
 * Returns the number of entries posted.
 */
async function postSet(tx: Tx, ctx: DailyContext, jobRun: SQL, source: SQL, withConflictGuard: boolean) {
  const rows = await tx.execute<{ n: number }>(sql`
    WITH src AS (${source}),
    ins AS (
      INSERT INTO leave_ledger_entries
        (id, company_id, employee_id, leave_type_id, leave_year, type, amount, effective_date, policy_id, job_run_id)
      SELECT ${UUID_V7}, ${ctx.companyId}, employee_id, leave_type_id, leave_year, type::leave_ledger_type,
        amount, effective_date, policy_id, ${jobRun}
      FROM src WHERE amount <> 0
      ${
        withConflictGuard
          ? sql`ON CONFLICT (employee_id, leave_type_id, type, effective_date)
              WHERE type IN ('accrual', 'carry_forward', 'expiry') DO NOTHING`
          : sql``
      }
      RETURNING employee_id, leave_type_id, leave_year, type, amount
    ),
    agg AS (
      SELECT employee_id, leave_type_id, leave_year,
        sum(CASE WHEN type IN ('grant', 'accrual', 'carry_forward') THEN amount ELSE 0 END) AS entitled,
        sum(CASE WHEN type IN ('adjustment', 'expiry') THEN amount ELSE 0 END) AS adjusted,
        count(*) AS n
      FROM ins GROUP BY employee_id, leave_type_id, leave_year
    ),
    upd AS (
      INSERT INTO leave_balances (employee_id, leave_type_id, leave_year, company_id, entitled, adjusted)
      SELECT employee_id, leave_type_id, leave_year, ${ctx.companyId}, entitled, adjusted FROM agg
      ON CONFLICT (employee_id, leave_type_id, leave_year) DO UPDATE SET
        entitled = leave_balances.entitled + EXCLUDED.entitled,
        adjusted = leave_balances.adjusted + EXCLUDED.adjusted,
        updated_at = now(),
        version = leave_balances.version + 1
      RETURNING 1
    )
    SELECT coalesce((SELECT sum(n) FROM agg), 0)::int AS n, (SELECT count(*) FROM upd) AS balances`);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Annual grants for the leave year of `date` (BUSINESS-RULES 5.1): everyone eligible on `date` who has no grant this
 * year yet. Eligible before 1 January: the full entitlement; eligible during the year: prorated by remaining months
 * (eligibility month counts on or before the 15th), rounded down to 0.5, unless `prorate_first_year` is off.
 */
function grantsFor(ctx: DailyContext, date: string) {
  const year = Number(date.slice(0, 4));
  const yearStart = `${year}-01-01`;
  return sql`
    SELECT e.id AS employee_id, pol.leave_type_id, ${year}::smallint AS leave_year, 'grant' AS type,
      CASE
        WHEN NOT pol.prorate_first_year OR e.joining_date + pol.eligibility_after_days <= ${yearStart}::date
          THEN pol.annual_entitlement
        ELSE floor(pol.annual_entitlement * (
          12 - extract(month FROM e.joining_date + pol.eligibility_after_days)
          + CASE WHEN extract(day FROM e.joining_date + pol.eligibility_after_days) <= 15 THEN 1 ELSE 0 END
        ) / 12 * 2) / 2
      END AS amount,
      ${date}::date AS effective_date, pol.id AS policy_id
    FROM (${policiesOn(ctx, 'annual_grant', date)}) pol
    JOIN employees e ON ${eligibleOn(ctx, date)}
    WHERE coalesce(pol.annual_entitlement, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM leave_ledger_entries g
        WHERE g.employee_id = e.id AND g.leave_type_id = pol.leave_type_id AND g.leave_year = ${year}
          AND g.type = 'grant')`;
}

/** `leave.accrue`, 1st of each month: monthly and per-days-worked accrual for the previous month (BUSINESS-RULES 5.2, 5.3). */
export const leaveAccrueStep: DailyStep = {
  job: 'leave.accrue',
  runsOn: (today) => today.endsWith('-01'),
  runKey: (ctx) => ctx.yesterday.slice(0, 7),
  async run(tx, ctx) {
    const monthEnd = ctx.yesterday;
    const year = Number(monthEnd.slice(0, 4));
    const jobRun = jobRunId(ctx, 'leave.accrue', leaveAccrueStep.runKey(ctx));
    const capped = (amount: SQL) => sql`
      CASE WHEN pol.max_balance IS NULL THEN ${amount}
        ELSE LEAST(${amount}, GREATEST(pol.max_balance - coalesce(b.available, 0), 0)) END`;
    const balanceJoin = sql`LEFT JOIN leave_balances b
      ON b.employee_id = e.id AND b.leave_type_id = pol.leave_type_id AND b.leave_year = ${year}`;

    const monthly = await postSet(
      tx,
      ctx,
      jobRun,
      sql`
        SELECT e.id AS employee_id, pol.leave_type_id, ${year}::smallint AS leave_year, 'accrual' AS type,
          ${capped(sql`pol.accrual_per_month`)} AS amount, ${monthEnd}::date AS effective_date, pol.id AS policy_id
        FROM (${policiesOn(ctx, 'monthly_accrual', monthEnd)}) pol
        JOIN employees e ON ${eligibleOn(ctx, monthEnd)}
        ${balanceJoin}
        WHERE coalesce(pol.accrual_per_month, 0) > 0`,
      true,
    );

    const earned = sql`floor((
        SELECT count(*) FROM attendance_records ar
        WHERE ar.employee_id = e.id AND ar.work_date BETWEEN ${`${year}-01-01`}::date AND ${monthEnd}::date
          AND ar.status IN ('present', 'short_hours', 'missed_core')
      ) / pol.days_worked_per_unit * 2) / 2`;
    const already = sql`(
        SELECT coalesce(sum(l.amount), 0) FROM leave_ledger_entries l
        WHERE l.employee_id = e.id AND l.leave_type_id = pol.leave_type_id AND l.leave_year = ${year}
          AND l.type = 'accrual')`;
    const perDays = await postSet(
      tx,
      ctx,
      jobRun,
      sql`
        SELECT * FROM (
          SELECT e.id AS employee_id, pol.leave_type_id, ${year}::smallint AS leave_year, 'accrual' AS type,
            ${capped(sql`(${earned} - ${already})`)} AS amount, ${monthEnd}::date AS effective_date,
            pol.id AS policy_id
          FROM (${policiesOn(ctx, 'per_days_worked', monthEnd)}) pol
          JOIN employees e ON ${eligibleOn(ctx, monthEnd)}
          ${balanceJoin}
        ) x WHERE amount > 0`,
      true,
    );
    return { items: monthly + perDays, details: { monthEnd, monthly, perDaysWorked: perDays } };
  },
};

/** `leave.year_end`, 1 January: expiry and carry-forward of the old year, then the new year's grants (BUSINESS-RULES 5.4). */
export const leaveYearEndStep: DailyStep = {
  job: 'leave.year_end',
  runsOn: (today) => today.endsWith('-01-01'),
  runKey: (ctx) => ctx.today.slice(0, 4),
  async run(tx, ctx) {
    const year = Number(ctx.today.slice(0, 4));
    const old = year - 1;
    const oldEnd = `${old}-12-31`;
    const jobRun = jobRunId(ctx, 'leave.year_end', leaveYearEndStep.runKey(ctx));
    const governing = sql`
      SELECT DISTINCT ON (p.leave_type_id) p.leave_type_id, p.id, p.max_carry_forward
      FROM leave_policies p
      WHERE p.company_id = ${ctx.companyId} AND p.effective_from <= ${oldEnd}::date
        AND (p.effective_to IS NULL OR p.effective_to >= ${`${old}-01-01`}::date)
      ORDER BY p.leave_type_id, p.effective_from DESC`;
    // Steps 1–2: remaining = available; carry = min(remaining, max_carry_forward), NULL meaning none.
    const remaining = sql`
      SELECT b.employee_id, b.leave_type_id, b.available AS remaining,
        LEAST(b.available, coalesce(g.max_carry_forward, 0)) AS carry, g.id AS policy_id
      FROM leave_balances b LEFT JOIN (${governing}) g ON g.leave_type_id = b.leave_type_id
      WHERE b.company_id = ${ctx.companyId} AND b.leave_year = ${old} AND b.available > 0`;
    const moved = await postSet(
      tx,
      ctx,
      jobRun,
      sql`
        SELECT employee_id, leave_type_id, ${old}::smallint AS leave_year, 'expiry' AS type,
          -(remaining - carry) AS amount, ${oldEnd}::date AS effective_date, policy_id
        FROM (${remaining}) r WHERE remaining - carry > 0
        UNION ALL
        SELECT employee_id, leave_type_id, ${year}::smallint, 'carry_forward', carry, ${ctx.today}::date, policy_id
        FROM (${remaining}) r WHERE carry > 0`,
      true,
    );
    const granted = await postSet(tx, ctx, jobRun, grantsFor(ctx, ctx.today), false);
    return { items: moved + granted, details: { year, carryAndExpiry: moved, grants: granted } };
  },
};

/**
 * `leave.carry_forward_expiry`: on the expiry date (`carry_forward_expiry_months` after 1 January), expire the carried
 * days not yet used: `max(0, carry - usage since 1 January)` (BUSINESS-RULES 5.4). Usage consumes carried days first.
 */
export const leaveCarryForwardExpiryStep: DailyStep = {
  job: 'leave.carry_forward_expiry',
  runsOn: (today) => today.endsWith('-01') && !today.endsWith('-01-01'),
  runKey: (ctx) => ctx.today,
  async run(tx, ctx) {
    const year = Number(ctx.today.slice(0, 4));
    const months = Number(ctx.today.slice(5, 7)) - 1;
    if (carryForwardExpiryDate(year, months) !== ctx.today) return { items: 0 };
    // JOBS-AND-OUTBOX §3.1: one look at the small policies table before touching balances.
    const due = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM (${policiesOnAny(ctx, ctx.today)}) pol
      WHERE pol.carry_forward_expiry_months = ${months}`);
    if (!due[0]?.n) return { items: 0 };
    const jobRun = jobRunId(ctx, 'leave.carry_forward_expiry', ctx.today);
    const expired = await postSet(
      tx,
      ctx,
      jobRun,
      sql`
        SELECT * FROM (
          SELECT b.employee_id, b.leave_type_id, ${year}::smallint AS leave_year, 'expiry' AS type,
            -LEAST(GREATEST(cf.carry - b.used, 0), GREATEST(b.available, 0)) AS amount,
            ${ctx.today}::date AS effective_date, pol.id AS policy_id
          FROM (${policiesOnAny(ctx, ctx.today)}) pol
          JOIN leave_balances b ON b.leave_type_id = pol.leave_type_id AND b.leave_year = ${year}
            AND b.company_id = ${ctx.companyId}
          JOIN (
            SELECT employee_id, leave_type_id, sum(amount) AS carry FROM leave_ledger_entries
            WHERE company_id = ${ctx.companyId} AND leave_year = ${year} AND type = 'carry_forward'
            GROUP BY employee_id, leave_type_id
          ) cf ON cf.employee_id = b.employee_id AND cf.leave_type_id = b.leave_type_id
          WHERE pol.carry_forward_expiry_months = ${months}
        ) x WHERE amount < 0`,
      true,
    );
    return { items: expired, details: { year, months } };
  },
};

/** Policies of any method in force on `date`. */
const policiesOnAny = (ctx: DailyContext, date: string) => sql`
  SELECT p.* FROM leave_policies p JOIN leave_types t ON t.id = p.leave_type_id AND t.is_active
  WHERE p.company_id = ${ctx.companyId}
    AND p.effective_from <= ${date}::date AND (p.effective_to IS NULL OR p.effective_to >= ${date}::date)`;

/**
 * `leave.eligibility_grants`, daily: the first `annual_grant` of employees who became eligible during the year
 * (BUSINESS-RULES 5.1), and any grant still missing for someone already eligible (for example after go-live).
 */
export const leaveEligibilityGrantsStep: DailyStep = {
  job: 'leave.eligibility_grants',
  runsOn: () => true,
  runKey: (ctx) => ctx.today,
  async run(tx, ctx) {
    const jobRun = jobRunId(ctx, 'leave.eligibility_grants', ctx.today);
    const granted = await postSet(tx, ctx, jobRun, grantsFor(ctx, ctx.today), false);
    return { items: granted };
  },
};

/** In dispatcher order: December accrual must post before the year end reads the old year's balances. */
export const LEAVE_DAILY_STEPS: readonly DailyStep[] = [
  leaveAccrueStep,
  leaveYearEndStep,
  leaveCarryForwardExpiryStep,
  leaveEligibilityGrantsStep,
];
