import { createRoute } from '@hono/zod-openapi';
import {
  AttendanceReportQuerySchema,
  AttendanceReportRowSchema,
  DeductionsSummarySchema,
  DirectoryQuerySchema,
  DirectoryRowSchema,
  HeadcountQuerySchema,
  HeadcountRowSchema,
  HeadcountSummarySchema,
  LeaveReportQuerySchema,
  LeaveReportRowSchema,
  PaymentReconciliationRowSchema,
  PayrollDeductionRowSchema,
  PayrollDeductionsQuerySchema,
  PayrollRegisterRowSchema,
  PayrollRunReportQuerySchema,
  PayrollRunReportSummarySchema,
  paginated,
  ReconciliationSummarySchema,
  ReimbursementReportQuerySchema,
  ReimbursementReportRowSchema,
  ReimbursementSummarySchema,
  ReportExportInputSchema,
  reportPage,
} from '@hrm/contracts';
import { jsonBody, jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { createRouter } from '../../lib/router';
import * as service from './reports.service';

export const reportRoutes = createRouter();
const tags = ['reports'];
const security = SESSION_SECURITY;

reportRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/reports/headcount',
    operationId: 'reports.headcount',
    tags,
    security,
    'x-permission': 'report.hr',
    request: { query: HeadcountQuerySchema },
    responses: {
      200: jsonContent(reportPage(HeadcountRowSchema, HeadcountSummarySchema), 'Headcount by group'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.headcount(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

reportRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/reports/directory',
    operationId: 'reports.directory',
    tags,
    security,
    'x-permission': 'report.hr | report.team',
    'x-scope': 'all | team',
    request: { query: DirectoryQuerySchema },
    responses: {
      200: jsonContent(paginated(DirectoryRowSchema), 'Employee directory'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.directory(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

reportRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/reports/attendance',
    operationId: 'reports.attendance',
    tags,
    security,
    'x-permission': 'report.hr | report.team',
    'x-scope': 'all | team',
    request: { query: AttendanceReportQuerySchema },
    responses: {
      200: jsonContent(paginated(AttendanceReportRowSchema), 'Attendance per employee over the range'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.attendance(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

reportRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/reports/leave',
    operationId: 'reports.leave',
    tags,
    security,
    'x-permission': 'report.hr | report.team',
    'x-scope': 'all | team',
    request: { query: LeaveReportQuerySchema },
    responses: {
      200: jsonContent(paginated(LeaveReportRowSchema), 'Leave balances and leave taken'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.leave(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

reportRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/reports/payroll-register',
    operationId: 'reports.payrollRegister',
    tags,
    security,
    'x-permission': 'report.payroll',
    request: { query: PayrollRunReportQuerySchema },
    responses: {
      200: jsonContent(
        reportPage(PayrollRegisterRowSchema, PayrollRunReportSummarySchema),
        'Payroll register of one run',
      ),
      ...problemResponses(400, 401, 403, 404),
    },
  }),
  async (c) => c.json(await service.payrollRegister(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

reportRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/reports/payroll-deductions',
    operationId: 'reports.payrollDeductions',
    tags,
    security,
    'x-permission': 'report.payroll',
    request: { query: PayrollDeductionsQuerySchema },
    responses: {
      200: jsonContent(
        reportPage(PayrollDeductionRowSchema, DeductionsSummarySchema),
        'Deduction lines of one run, or of a year’s approved runs',
      ),
      ...problemResponses(400, 401, 403, 404),
    },
  }),
  async (c) => c.json(await service.payrollDeductions(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

reportRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/reports/payment-reconciliation',
    operationId: 'reports.paymentReconciliation',
    tags,
    security,
    'x-permission': 'report.payroll',
    request: { query: PayrollRunReportQuerySchema },
    responses: {
      200: jsonContent(
        reportPage(PaymentReconciliationRowSchema, ReconciliationSummarySchema),
        'Net pay against payments per item',
      ),
      ...problemResponses(400, 401, 403, 404),
    },
  }),
  async (c) => c.json(await service.paymentReconciliation(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

reportRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/reports/reimbursements',
    operationId: 'reports.reimbursements',
    tags,
    security,
    'x-permission': 'report.payroll | report.hr',
    request: { query: ReimbursementReportQuerySchema },
    responses: {
      200: jsonContent(
        reportPage(ReimbursementReportRowSchema, ReimbursementSummarySchema),
        'Reimbursement claims by expense date',
      ),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.reimbursements(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

reportRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/reports/exports',
    operationId: 'reports.export',
    tags,
    security,
    'x-permission': 'the report’s permission',
    request: { body: jsonBody(ReportExportInputSchema) },
    responses: {
      204: { description: 'Recorded in the audit log' },
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => {
    await service.recordExport(c.var.deps, c.var.auth, c.req.valid('json'));
    return c.body(null, 204);
  },
);
