import type { Tx } from '@hrm/db';
import { sql } from 'drizzle-orm';

export type CodeScope = 'employee' | 'leave_request' | 'reimbursement_claim' | 'payroll_run';

/** Next number for a human-readable code, gap-free under concurrency (BUSINESS-RULES §8). */
export async function nextCodeNumber(tx: Tx, companyId: string, scope: CodeScope): Promise<number> {
  const rows = await tx.execute<{ n: string | number }>(sql`
    INSERT INTO code_sequences (company_id, scope, next_value) VALUES (${companyId}, ${scope}, 2)
    ON CONFLICT (company_id, scope) DO UPDATE SET next_value = code_sequences.next_value + 1
    RETURNING next_value - 1 AS n`);
  return Number(rows[0]?.n);
}

export const padded = (prefix: string, n: number, width: number) =>
  `${prefix}${String(n).padStart(width, '0')}`;
