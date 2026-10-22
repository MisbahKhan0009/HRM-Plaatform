import { pgEnum } from 'drizzle-orm/pg-core';

// Enum values are canonical: docs/03-architecture/DOMAIN-MODEL.md §4. Adding a value is an additive migration.
export const userStatus = pgEnum('user_status', ['invited', 'active', 'suspended', 'deactivated']);
export const themeEnum = pgEnum('theme', ['ink', 'paper']);
export const settingScope = pgEnum('setting_scope', ['technical', 'hr', 'payroll']);
export const holidayType = pgEnum('holiday_type', ['public', 'festival', 'company', 'optional']);
export const employeeStatus = pgEnum('employee_status', [
  'draft',
  'preboarding',
  'probation',
  'active',
  'notice_period',
  'separated',
  'archived',
]);
export const employmentEventType = pgEnum('employment_event_type', [
  'hired',
  'confirmed',
  'promoted',
  'transferred',
  'manager_changed',
  'position_changed',
  'salary_changed',
  'status_changed',
  'separated',
  'rehired',
]);
export const contractType = pgEnum('contract_type', [
  'permanent',
  'probation',
  'fixed_term',
  'intern',
  'consultant',
]);
export const attendanceEventType = pgEnum('attendance_event_type', [
  'check_in',
  'check_out',
  'manual_entry',
  'correction',
]);
export const attendanceSource = pgEnum('attendance_source', ['web', 'manual', 'correction', 'system']);
export const attendanceStatus = pgEnum('attendance_status', [
  'present',
  'short_hours',
  'missed_core',
  'missing_punch',
  'absent',
  'on_leave',
  'holiday',
  'weekend',
  'not_employed',
]);
export const leaveUnit = pgEnum('leave_unit', ['day', 'half_day']);
export const halfDayPart = pgEnum('half_day_part', ['first_half', 'second_half']);
export const leaveLedgerType = pgEnum('leave_ledger_type', [
  'grant',
  'accrual',
  'reservation',
  'reservation_release',
  'usage',
  'adjustment',
  'reversal',
  'carry_forward',
  'expiry',
]);
export const payrollRunStatus = pgEnum('payroll_run_status', [
  'draft',
  'calculated',
  'submitted',
  'returned',
  'approved',
  'locked',
  'paid',
  'reconciled',
]);
export const payrollLineKind = pgEnum('payroll_line_kind', ['earning', 'deduction']);
export const payrollLineCode = pgEnum('payroll_line_code', [
  'base_salary',
  'proration_adjustment',
  'reimbursement',
  'addition',
  'deduction',
  'arrears',
]);
export const adjustmentType = pgEnum('adjustment_type', ['addition', 'deduction']);
export const paymentMethod = pgEnum('payment_method', ['cash', 'cheque']);
export const paymentStatus = pgEnum('payment_status', ['unpaid', 'paid', 'failed', 'cancelled']);
export const documentCategory = pgEnum('document_category', [
  'identity',
  'contract',
  'certificate',
  'payslip',
  'receipt',
  'policy',
  'other',
]);
export const approvalSubjectType = pgEnum('approval_subject_type', [
  'leave_request',
  'attendance_correction',
  'reimbursement_claim',
  'profile_change',
  'payroll_run',
  'payroll_adjustment',
]);
export const approvalStepDecision = pgEnum('approval_step_decision', [
  'pending',
  'approved',
  'rejected',
  'skipped',
]);
