# Audit log

Status: **Accepted**, 2026-10-22. Normative. Implements FR-AUD-001 to FR-AUD-005, FR-ORG-006, FR-DOC-007, FR-SET-005 and NFR-SEC-007. Table definition: `docs/03-architecture/DATA-MODEL.md` section 1 (`audit_logs`).

## 1. Principles

- The audit log is the business record of who did what. Diagnostic logs (Workers Logs) are separate and short-lived.
- Every audited action writes its row **in the same transaction** as the change, through `AuditService.record(tx, event)`. A change without its audit row cannot commit.
- The table is append-only: the `hrm_app` role has `INSERT, SELECT` only, so no application endpoint can change or delete history (FR-AUD-003).
- Read access is split by category and permission (section 5).

## 2. Event shape

```ts
interface AuditEvent {
  action: AuditAction;            // 'leave_request.approved'
  category: 'business' | 'payroll' | 'security' | 'technical';
  entityType: string;             // 'leave_request'
  entityId: string | null;
  employeeId: string | null;      // subject employee, used for scoped reads
  metadata: Record<string, unknown>;  // redacted, see section 4
}
```

`actor_user_id`, `actor_type`, `request_id`, `ip_address` and `user_agent` come from the request context automatically; jobs write `actor_type = 'system'`.

Metadata conventions:

- Field changes: `{ "changes": { "departmentId": { "from": "...", "to": "..." } } }`, listing changed fields only.
- Transitions: `{ "from": "pending", "to": "approved", "comment": "..." }`.
- Exceptions: `{ "selfApproved": true, "note": "..." }` (D-007), `{ "onBehalf": true }` (D-014).

## 3. Event catalogue

| Action | Category | When |
|---|---|---|
| `user.signed_in`, `user.sign_in_failed` | security | Sign-in success; failed OTP/passkey/TOTP (with reason code, no code values) |
| `user.signed_out` | security | Sign-out |
| `user.step_up_completed` | security | Session upgraded to strong |
| `user.invited`, `user.invitation_resent`, `user.invitation_accepted` | security | Invitation flow |
| `user.suspended`, `user.reactivated`, `user.deactivated` | security | Account state |
| `user.auth_reset` | security | Admin reset of passkeys and TOTP |
| `user.passkey_added`, `user.passkey_removed`, `user.totp_enabled`, `user.totp_disabled`, `user.backup_codes_regenerated` | security | Factor changes |
| `role.granted`, `role.revoked`, `role.permissions_changed` | security | FR-AUD-002, FR-SET-005 |
| `settings.changed` | technical / business / payroll by key scope | Any setting (FR-ORG-006); metadata has old and new value |
| `company.updated`, `department.*`, `position.*`, `work_schedule.*`, `schedule_assignment.created`, `holiday.*` | business | Organization configuration (FR-ORG-006) |
| `employee.created`, `employee.updated`, `employee.status_changed`, `employee.archived`, `employee.imported` | business | Lifecycle (FR-AUD-002) |
| `employee.contact_updated` | business | Field names only, never values |
| `employee.contact_viewed` | business | Reading restricted contact data |
| `employment_event.created`, `employment_event.applied`, `employment_event.cancelled` | business | Effective-dated history |
| `contract.created`, `contract.updated` | business | |
| `profile_change.requested`, `.approved`, `.rejected`, `.withdrawn` | business | |
| `attendance.manual_entry_created` | business | FR-ATT-009 |
| `attendance_correction.requested`, `.approved`, `.rejected`, `.withdrawn` | business | FR-ATT-008 |
| `leave_type.*`, `leave_policy.created` | business | |
| `leave_request.created`, `.approved`, `.rejected`, `.withdrawn`, `.cancellation_requested`, `.cancelled`, `.cancellation_rejected` | business | |
| `leave_balance.adjusted` | business | With amount and reason |
| `reimbursement_claim.submitted`, `.approved`, `.rejected`, `.withdrawn` | business | |
| `salary_structure.created`, `salary_structure.approved` | payroll | Old and new gross amounts (FR-AUD-002) |
| `payroll_run.created`, `.calculated`, `.submitted`, `.returned`, `.approved`, `.locked`, `.paid`, `.reconciled` | payroll | Totals and employee count; `selfApproved` flag |
| `payroll_adjustment.created`, `.approved`, `.rejected`, `.applied` | payroll | |
| `payroll_payment.recorded`, `payroll_payment.cancelled` | payroll | Amount, method, cheque number |
| `payslips.published` | payroll | Run id and count |
| `payslip.viewed` | payroll | Each view of a payslip by anyone other than its owner, and the owner's first view |
| `document.uploaded`, `document.version_added`, `document.deleted` | business | |
| `document.downloaded` | business | Restricted categories (`identity`, `contract`, `payslip`) and any download by someone other than the subject employee (FR-DOC-007) |
| `report.exported` | business / payroll | Report name, filters, row count (FR-REP-005) |
| `job.failed`, `outbox.message_dead` | technical | Background failures |

A new audited action is added to this table and to the `AuditAction` union in `@hrm/contracts` in the same PR.

## 4. Redaction rules (FR-AUD-004)

Metadata never contains:

- OTP codes, TOTP secrets, backup codes, session tokens, invitation tokens, cookies;
- national ID numbers, personal phone numbers, addresses, dates of birth (record the field name only: `{ "changes": { "nationalIdNumber": "changed" } }`);
- document contents, or full payroll snapshots.

Salary amounts appear only in `payroll`-category events, which only payroll-authorized readers can see (section 5). `AuditService` runs a redaction pass over metadata using a deny-list of keys from `@hrm/contracts/audit-redaction.ts`, so a developer mistake does not leak a secret.

## 5. Reading the log (FR-AUD-005)

`GET /audit-logs` (API-CATALOGUE section 13) filters by `from`/`to` (required, at most 366 days), `actorUserId`, `action` (prefix match, for example `payroll_run.`), `entityType`, `entityId`, `employeeId`.

| Permission | Categories visible |
|---|---|
| `audit.read.all` | business, payroll, security |
| `audit.read.payroll` | payroll |
| `audit.read.technical` | technical, security (actor and action only; metadata of business events hidden) |

Managers and employees see their own request history through the subject's endpoints (approval steps, request status), not through `/audit-logs` (SECURITY-MODEL matrix "Own request history").

## 6. Integrity checks

- A nightly sub-step of `maintenance.prune` counts audit rows for the previous day by category and stores the counts in `job_runs.items` metadata, so a sudden drop to zero is visible on the health page.
- Restore drills (`docs/08-operations/BACKUP-AND-RESTORE.md`) compare audit row counts between production and the restored copy.
