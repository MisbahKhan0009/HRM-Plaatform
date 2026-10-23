import type {
  PayrollAdjustment,
  PayrollFlag,
  PayrollItem,
  PayrollPayment,
  PayrollPeriod,
  PayrollRun,
  PayslipSummary,
  SalaryStructure,
} from '@hrm/contracts';
import { toMoneyString } from '@hrm/domain';
import { isoOrNull, stamp } from '../../lib/dto';
import type * as repo from './payroll.repository';

/** Money on the wire (API-STANDARDS §3): a 2-decimal string, never a number. */
export const money = (amount: string | null | undefined) => ({
  amount: toMoneyString(amount ?? '0'),
  currency: 'BDT' as const,
});

const employee = (id: string, code: string, name: string) => ({ id, employeeCode: code, name });

export const toStructure = (v: repo.StructureView): SalaryStructure => ({
  id: v.structure.id,
  employee: employee(v.structure.employeeId, v.employeeCode, v.employeeName),
  grossAmount: money(v.structure.grossAmount),
  effectiveFrom: v.structure.effectiveFrom,
  effectiveTo: v.structure.effectiveTo,
  status: v.structure.status as SalaryStructure['status'],
  reason: v.structure.reason,
  approvedAt: isoOrNull(v.structure.approvedAt),
  ...stamp(v.structure),
});

export const toPeriod = (p: repo.PeriodRow): PayrollPeriod => ({
  id: p.id,
  year: p.year,
  month: p.month,
  startDate: p.startDate,
  endDate: p.endDate,
  status: p.status as PayrollPeriod['status'],
  ...stamp(p),
});

export const toRun = (v: repo.RunView): PayrollRun => {
  const r = v.run;
  return {
    id: r.id,
    runNumber: r.runNumber,
    period: {
      id: v.period.id,
      year: v.period.year,
      month: v.period.month,
      startDate: v.period.startDate,
      endDate: v.period.endDate,
    },
    runType: r.runType as PayrollRun['runType'],
    status: r.status,
    calculationRuleVersion: r.calculationRuleVersion,
    calculatedAt: isoOrNull(r.calculatedAt),
    submittedAt: isoOrNull(r.submittedAt),
    preparedBy: r.preparedBy,
    preparedByName: r.preparedBy ? v.preparedByName : null,
    approvedAt: isoOrNull(r.approvedAt),
    approvedBy: r.approvedBy,
    approvedByName: r.approvedBy ? v.approvedByName : null,
    selfApproved: r.selfApproved,
    selfApprovalNote: r.selfApprovalNote,
    returnedReason: r.returnedReason,
    lockedAt: isoOrNull(r.lockedAt),
    payslipsPublishedAt: isoOrNull(r.payslipsPublishedAt),
    employeeCount: r.employeeCount,
    totals:
      r.totalNet === null
        ? null
        : { gross: money(r.totalGross), deductions: money(r.totalDeductions), net: money(r.totalNet) },
    ...stamp(r),
  };
};

export const toItem = (v: repo.ItemView): PayrollItem => ({
  id: v.item.id,
  runId: v.item.payrollRunId,
  employee: employee(v.item.employeeId, v.employeeCode, v.employeeName),
  grossAmount: money(v.item.grossAmount),
  deductionAmount: money(v.item.deductionAmount),
  netAmount: money(v.item.netAmount),
  daysEmployed: v.item.daysEmployed,
  daysInPeriod: v.item.daysInPeriod,
  validationFlags: v.item.validationFlags as PayrollFlag[],
  paymentStatus: v.item.paymentStatus as PayrollItem['paymentStatus'],
  ...stamp(v.item),
});

export const toPayment = (v: repo.PaymentView): PayrollPayment => ({
  id: v.payment.id,
  payrollItemId: v.payment.payrollItemId,
  employee: employee(v.employeeId, v.employeeCode, v.employeeName),
  method: v.payment.method,
  amount: money(v.payment.amount),
  paidOn: v.payment.paidOn,
  chequeNumber: v.payment.chequeNumber,
  reference: v.payment.reference,
  acknowledgedByName: v.payment.acknowledgedByName,
  status: v.payment.status,
  cancelledReason: v.payment.cancelledReason,
  ...stamp(v.payment),
});

export const toAdjustment = (v: repo.AdjustmentView): PayrollAdjustment => {
  const a = v.adjustment;
  return {
    id: a.id,
    employee: employee(a.employeeId, v.employeeCode, v.employeeName),
    type: a.type,
    lineCode: a.lineCode as PayrollAdjustment['lineCode'],
    amount: money(a.amount),
    reason: a.reason,
    targetPeriodId: a.targetPeriodId,
    correctsPayrollItemId: a.correctsPayrollItemId,
    status: a.status as PayrollAdjustment['status'],
    decidedAt: isoOrNull(a.decidedAt),
    selfApproved: a.selfApproved,
    selfApprovalNote: a.selfApprovalNote,
    appliedPayrollItemId: a.appliedPayrollItemId,
    createdByUserId: a.createdBy,
    createdByName: a.createdBy ? v.createdByName : null,
    ...stamp(a),
  };
};

export const toPayslipSummary = (v: repo.PayslipView): PayslipSummary => ({
  id: v.payslip.id,
  employee: employee(v.payslip.employeeId, v.employeeCode, v.employeeName),
  period: { id: v.period.id, year: v.period.year, month: v.period.month },
  runNumber: v.runNumber,
  runType: v.runType as PayslipSummary['runType'],
  netAmount: money(v.item.netAmount),
  publishedAt: v.payslip.publishedAt.toISOString(),
  firstViewedAt: isoOrNull(v.payslip.firstViewedAt),
});
