import type { LeaveBalance, LeaveLedgerEntry, LeavePolicy, LeaveRequestDto, LeaveType } from '@hrm/contracts';
import type { schema } from '@hrm/db';
import { isoOrNull, stamp } from '../../lib/dto';
import type { LeavePolicyRow, LeaveRequestView, LeaveTypeRow } from './leave.repository';

// Per-view mappers (API-STANDARDS §13): responses are built here, never by serializing a row.

const qty = (v: string | null) => v;

export const toPolicy = (r: LeavePolicyRow): LeavePolicy => ({
  id: r.id,
  leaveTypeId: r.leaveTypeId,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
  allocationMethod: r.allocationMethod as LeavePolicy['allocationMethod'],
  annualEntitlement: qty(r.annualEntitlement),
  accrualPerMonth: qty(r.accrualPerMonth),
  daysWorkedPerUnit: qty(r.daysWorkedPerUnit),
  prorateFirstYear: r.prorateFirstYear,
  eligibilityAfterDays: r.eligibilityAfterDays,
  eligibleStatuses: r.eligibleStatuses,
  maxCarryForward: qty(r.maxCarryForward),
  maxBalance: qty(r.maxBalance),
  carryForwardExpiryMonths: r.carryForwardExpiryMonths,
  allowNegativeBalance: r.allowNegativeBalance,
  maxConsecutiveDays: qty(r.maxConsecutiveDays),
  minNoticeDays: r.minNoticeDays,
  ...stamp(r),
});

export const toLeaveType = (r: LeaveTypeRow, policy: LeavePolicyRow | null): LeaveType => ({
  id: r.id,
  code: r.code,
  name: r.name,
  isPaid: r.isPaid,
  allowsHalfDay: r.allowsHalfDay,
  requiresReason: r.requiresReason,
  requiresDocumentAfterDays: qty(r.requiresDocumentAfterDays),
  colorToken: r.colorToken,
  isActive: r.isActive,
  sortOrder: r.sortOrder,
  currentPolicy: policy ? toPolicy(policy) : null,
  ...stamp(r),
});

export const toLeaveRequest = (v: LeaveRequestView): LeaveRequestDto => {
  const r = v.request;
  return {
    id: r.id,
    requestNumber: r.requestNumber,
    employeeId: r.employeeId,
    employeeCode: v.employeeCode,
    employeeName: v.employeeName,
    leaveTypeId: r.leaveTypeId,
    leaveTypeCode: v.leaveTypeCode,
    leaveTypeName: v.leaveTypeName,
    startDate: r.startDate,
    endDate: r.endDate,
    unit: r.unit,
    halfDayPart: r.halfDayPart,
    requestedUnits: r.requestedUnits,
    reason: r.reason,
    status: r.status as LeaveRequestDto['status'],
    submittedAt: isoOrNull(r.submittedAt),
    decidedAt: isoOrNull(r.decidedAt),
    decisionComment: r.decisionComment,
    cancellationReason: r.cancellationReason,
    onBehalf: r.onBehalfBy !== null,
    ...stamp(r),
  };
};

export const toBalance = (r: Omit<LeaveBalance, 'year'>, year: number): LeaveBalance => ({
  employeeId: r.employeeId,
  employeeCode: r.employeeCode,
  employeeName: r.employeeName,
  leaveTypeId: r.leaveTypeId,
  leaveTypeCode: r.leaveTypeCode,
  leaveTypeName: r.leaveTypeName,
  year,
  entitled: fixed(r.entitled),
  used: fixed(r.used),
  reserved: fixed(r.reserved),
  adjusted: fixed(r.adjusted),
  available: fixed(r.available),
});

/** Numeric text from Postgres (`0`, `7.50`) as a 2-place string. */
function fixed(v: string) {
  const [i = '0', f = ''] = v.split('.');
  return `${i}.${f.padEnd(2, '0').slice(0, 2)}`;
}

export const toLedgerEntry = (r: {
  entry: typeof schema.leaveLedgerEntries.$inferSelect;
  leaveTypeCode: string;
  requestNumber: string | null;
}): LeaveLedgerEntry => ({
  id: r.entry.id,
  employeeId: r.entry.employeeId,
  leaveTypeId: r.entry.leaveTypeId,
  leaveTypeCode: r.leaveTypeCode,
  year: r.entry.leaveYear,
  type: r.entry.type,
  amount: r.entry.amount,
  effectiveDate: r.entry.effectiveDate,
  leaveRequestId: r.entry.leaveRequestId,
  requestNumber: r.requestNumber,
  reversesEntryId: r.entry.reversesEntryId,
  reason: r.entry.reason,
  createdAt: r.entry.createdAt.toISOString(),
});
