import type { ApprovalDetail, ApprovalSubjectType, ApprovalSummary, Permission } from '@hrm/contracts';
import { inList, type Queryable } from '@hrm/db';
import { type SQL, sql } from 'drizzle-orm';

type Row = {
  id: string;
  subject_type: ApprovalSubjectType;
  subject_id: string;
  state: ApprovalSummary['state'];
  requester_id: string;
  requester_name: string;
  employee_id: string | null;
  employee_name: string | null;
  employee_code: string | null;
  created_at: string;
  updated_at: string;
  total: string;
};

const SELECT = sql`
  SELECT ar.id, ar.subject_type,
    coalesce(ar.leave_request_id, ar.attendance_correction_id, ar.reimbursement_claim_id, ar.profile_change_request_id,
             ar.payroll_run_id, ar.payroll_adjustment_id) AS subject_id,
    ar.state, ru.id AS requester_id, ru.name AS requester_name,
    e.id AS employee_id, coalesce(e.preferred_name, e.first_name) || ' ' || e.last_name AS employee_name, e.employee_code,
    to_char(ar.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
    to_char(ar.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at,
    count(*) OVER () AS total
  FROM approval_requests ar
  JOIN users ru ON ru.id = ar.requester_user_id
  LEFT JOIN employees e ON e.id = ar.subject_employee_id`;

function toSummary(r: Row): ApprovalSummary {
  return {
    id: r.id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    state: r.state,
    requester: { id: r.requester_id, name: r.requester_name },
    subjectEmployee: r.employee_id
      ? { id: r.employee_id, name: r.employee_name ?? '', employeeCode: r.employee_code ?? '' }
      : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function page(db: Queryable, where: SQL, limit: number, offset: number) {
  const rows = await db.execute<Row>(
    sql`${SELECT} WHERE ${where} ORDER BY ar.created_at DESC, ar.id LIMIT ${limit} OFFSET ${offset}`,
  );
  return { items: rows.map(toSummary), total: Number(rows[0]?.total ?? 0) };
}

const typeFilter = (t?: ApprovalSubjectType) => (t ? sql` AND ar.subject_type = ${t}` : sql``);

/**
 * Pending steps the user may decide: assigned to them, or to a permission they hold. Requests they raised are
 * excluded except payroll, where the preparer may self-approve with a justification (D-007).
 */
export function inbox(
  db: Queryable,
  input: {
    companyId: string;
    userId: string;
    permissions: Permission[];
    subjectType?: ApprovalSubjectType;
    limit: number;
    offset: number;
  },
) {
  const perms = input.permissions.length ? input.permissions : ['__none__'];
  return page(
    db,
    sql`ar.company_id = ${input.companyId} AND ar.state = 'open'
      AND EXISTS (SELECT 1 FROM approval_steps s WHERE s.approval_request_id = ar.id AND s.decision = 'pending'
        AND (s.approver_user_id = ${input.userId} OR s.approver_permission IN (${inList(perms)})))
      AND (ar.requester_user_id <> ${input.userId} OR ar.subject_type IN ('payroll_run', 'payroll_adjustment'))${typeFilter(input.subjectType)}`,
    input.limit,
    input.offset,
  );
}

/** Requests the user raised (FR-ESS: own request history). */
export function mine(
  db: Queryable,
  input: {
    companyId: string;
    userId: string;
    subjectType?: ApprovalSubjectType;
    limit: number;
    offset: number;
  },
) {
  return page(
    db,
    sql`ar.company_id = ${input.companyId} AND ar.requester_user_id = ${input.userId}${typeFilter(input.subjectType)}`,
    input.limit,
    input.offset,
  );
}

export async function findDetail(db: Queryable, companyId: string, id: string) {
  const rows = await db.execute<Row>(sql`${SELECT} WHERE ar.company_id = ${companyId} AND ar.id = ${id}`);
  const row = rows[0];
  if (!row) return null;
  const steps = await db.execute<{
    sequence: number;
    decision: ApprovalDetail['steps'][number]['decision'];
    approver_user_id: string | null;
    approver_name: string | null;
    approver_permission: string | null;
    decided_by_name: string | null;
    decided_at: string | null;
    comment: string | null;
    on_behalf: boolean;
  }>(sql`
    SELECT s.sequence, s.decision, s.approver_user_id, au.name AS approver_name, s.approver_permission,
      du.name AS decided_by_name,
      to_char(s.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS decided_at, s.comment, s.on_behalf
    FROM approval_steps s
    LEFT JOIN users au ON au.id = s.approver_user_id
    LEFT JOIN users du ON du.id = s.decided_by
    WHERE s.approval_request_id = ${id} ORDER BY s.sequence`);
  return { summary: toSummary(row), steps };
}
