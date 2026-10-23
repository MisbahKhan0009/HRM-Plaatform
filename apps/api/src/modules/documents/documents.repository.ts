import type { DocumentCategory } from '@hrm/contracts';
import { type Queryable, schema, type Tx } from '@hrm/db';
import { and, desc, eq, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { DocumentReadAccess } from './documents.policy';

const { documents, documentVersions, employees, users } = schema;

/** Visibility of a document row for a caller (documents.policy `DocumentReadAccess`). */
export function visibleTo(access: DocumentReadAccess): SQL {
  if (access.all) return sql`true`;
  const parts: (SQL | undefined)[] = [
    and(isNull(documents.employeeId), eq(documents.category, 'policy'), eq(documents.isRestricted, false)),
  ];
  if (access.payroll) parts.push(and(isNotNull(documents.employeeId), eq(documents.category, 'payslip')));
  if (access.ownEmployeeId)
    parts.push(and(eq(documents.employeeId, access.ownEmployeeId), eq(documents.isRestricted, false)));
  if (access.receiptReview) {
    const attached = sql`EXISTS (SELECT 1 FROM reimbursement_claims rc WHERE rc.receipt_document_id = ${documents.id})`;
    if (access.receiptReview === 'all') parts.push(and(eq(documents.category, 'receipt'), attached));
    else {
      const team = sql`(WITH RECURSIVE team AS (
          SELECT id, 1 AS depth FROM employees WHERE manager_id = ${access.receiptReview.teamOf}
          UNION ALL SELECT e.id, t.depth + 1 FROM employees e JOIN team t ON e.manager_id = t.id WHERE t.depth < 50
        ) SELECT id FROM team)`;
      parts.push(and(eq(documents.category, 'receipt'), attached, sql`${documents.employeeId} IN ${team}`));
    }
  }
  return or(...parts) as SQL;
}

const versionColumns = {
  version: documentVersions.version,
  fileName: documentVersions.fileName,
  mimeType: documentVersions.mimeType,
  sizeBytes: documentVersions.sizeBytes,
  sha256: documentVersions.sha256,
  uploadedAt: documentVersions.uploadedAt,
  uploadedByName: users.name,
};

const listColumns = { document: documents, current: versionColumns, total: sql<number>`count(*) OVER ()` };

function listQuery(db: Queryable, where: SQL | undefined, limit: number, offset: number) {
  return db
    .select(listColumns)
    .from(documents)
    .innerJoin(
      documentVersions,
      and(
        eq(documentVersions.documentId, documents.id),
        eq(documentVersions.version, documents.currentVersion),
      ),
    )
    .leftJoin(users, eq(users.id, documentVersions.uploadedBy))
    .where(where)
    .orderBy(desc(documents.createdAt), desc(documents.id))
    .limit(limit)
    .offset(offset);
}

export interface ListFilter {
  companyId: string;
  access: DocumentReadAccess;
  category?: DocumentCategory | undefined;
  limit: number;
  offset: number;
}

export function listEmployeeDocuments(db: Queryable, employeeId: string, f: ListFilter) {
  return listQuery(
    db,
    and(
      eq(documents.companyId, f.companyId),
      eq(documents.employeeId, employeeId),
      eq(documents.status, 'active'),
      f.category ? eq(documents.category, f.category) : undefined,
      visibleTo(f.access),
    ),
    f.limit,
    f.offset,
  );
}

export function listCompanyDocuments(db: Queryable, f: ListFilter) {
  return listQuery(
    db,
    and(
      eq(documents.companyId, f.companyId),
      isNull(documents.employeeId),
      eq(documents.status, 'active'),
      f.category ? eq(documents.category, f.category) : undefined,
      visibleTo(f.access),
    ),
    f.limit,
    f.offset,
  );
}

/** One document the caller may see; deleted documents are visible only with `document.read.all`. */
export async function findVisible(db: Queryable, companyId: string, id: string, access: DocumentReadAccess) {
  const [row] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.id, id),
        access.all ? undefined : eq(documents.status, 'active'),
        visibleTo(access),
      ),
    );
  return row ?? null;
}

export async function findById(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.id, id)));
  return row ?? null;
}

export async function findForUpdate(tx: Tx, companyId: string, id: string) {
  const [row] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.id, id)))
    .for('update');
  return row ?? null;
}

export function listVersions(db: Queryable, documentId: string) {
  return db
    .select({ ...versionColumns, storageKey: documentVersions.storageKey })
    .from(documentVersions)
    .leftJoin(users, eq(users.id, documentVersions.uploadedBy))
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.version))
    .limit(1000);
}

export async function findVersion(db: Queryable, documentId: string, version: number) {
  const [row] = await db
    .select()
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.version, version)));
  return row ?? null;
}

export async function employeeExists(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, id)));
  return Boolean(row);
}

export async function insertDocument(tx: Tx, values: typeof documents.$inferInsert) {
  await tx.insert(documents).values(values);
}

export async function insertVersion(tx: Tx, values: typeof documentVersions.$inferInsert) {
  await tx.insert(documentVersions).values(values);
}

export async function updateDocument(
  tx: Tx,
  id: string,
  values: Partial<typeof documents.$inferInsert>,
): Promise<void> {
  await tx
    .update(documents)
    .set({ ...values, version: sql`${documents.version} + 1` })
    .where(eq(documents.id, id));
}

export type ExpiringItem = {
  employee_name: string;
  title: string;
  expires_on: string;
  days_left: number;
};

/**
 * Documents and contracts that expire exactly 30, 14, 7 or 0 days after `today` (FR-DOC-006, JOBS-AND-OUTBOX §3).
 * Exact days make the reminder idempotent: an item enters each window on one day only. Uses the partial expiry
 * indexes on `documents` and `employment_contracts`.
 */
export function expiringItems(tx: Tx, companyId: string, today: string) {
  const days = sql`(${today}::date, ${today}::date + 7, ${today}::date + 14, ${today}::date + 30)`;
  const name = sql`coalesce(e.preferred_name, e.first_name) || ' ' || e.last_name`;
  return tx.execute<ExpiringItem>(sql`
    SELECT * FROM (
      SELECT coalesce(${name}, 'Company') AS employee_name, d.title,
        d.expiry_date::text AS expires_on, (d.expiry_date - ${today}::date)::int AS days_left
      FROM documents d LEFT JOIN employees e ON e.id = d.employee_id
      WHERE d.company_id = ${companyId} AND d.status = 'active' AND d.expiry_date IN ${days}
      UNION ALL
      SELECT ${name}, 'Employment contract (' || replace(c.type::text, '_', ' ') || ')',
        c.end_date::text, (c.end_date - ${today}::date)::int
      FROM employment_contracts c JOIN employees e ON e.id = c.employee_id
      WHERE c.company_id = ${companyId} AND c.status = 'active' AND c.end_date IN ${days}
    ) due
    ORDER BY days_left, expires_on, employee_name, title
    LIMIT 200`);
}

/** Active users who hold `document.manage` through an explicit or derived role (SECURITY-MODEL §2). */
export async function documentManagers(tx: Tx, companyId: string) {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT DISTINCT u.id FROM users u
    JOIN roles ro ON ro.company_id = u.company_id AND ro.is_active
    JOIN role_permissions rp ON rp.role_id = ro.id AND rp.permission_code = 'document.manage'
    WHERE u.company_id = ${companyId} AND u.status = 'active' AND (
      (NOT ro.is_derived AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = ro.id))
      OR (ro.code = 'employee' AND EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id))
      OR (ro.code = 'manager' AND EXISTS (
        SELECT 1 FROM employees e JOIN employees r ON r.manager_id = e.id AND r.status NOT IN ('separated', 'archived')
        WHERE e.user_id = u.id))
    )
    ORDER BY u.id
    LIMIT 100`);
  return rows.map((r) => r.id);
}
