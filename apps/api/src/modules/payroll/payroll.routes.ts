import { createRoute } from '@hono/zod-openapi';
import {
  AdjustmentQuerySchema,
  ApprovePayrollInputSchema,
  CancelPaymentInputSchema,
  CreateAdjustmentInputSchema,
  CreatePayrollPeriodInputSchema,
  CreatePayrollRunInputSchema,
  CreateSalaryStructureInputSchema,
  IdParamSchema,
  ImportPaymentsInputSchema,
  ImportPaymentsQuerySchema,
  OwnPayslipQuerySchema,
  PaymentIdParamSchema,
  PaymentImportResultSchema,
  PayrollAdjustmentSchema,
  PayrollItemDetailSchema,
  PayrollItemQuerySchema,
  PayrollItemSchema,
  PayrollPaymentSchema,
  PayrollPeriodQuerySchema,
  PayrollPeriodSchema,
  PayrollRunQuerySchema,
  PayrollRunSchema,
  PayrollValidationSchema,
  PayslipDataSchema,
  PayslipQuerySchema,
  PayslipSummarySchema,
  PublishPayslipsResultSchema,
  paginated,
  ReconciliationSchema,
  RecordPaymentInputSchema,
  RejectInputSchema,
  ReturnPayrollRunInputSchema,
  RunItemParamSchema,
  SalaryStructureQuerySchema,
  SalaryStructureSchema,
  VersionInputSchema,
} from '@hrm/contracts';
import { idempotent } from '../../lib/idempotency';
import { jsonBody, jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { processOutbox } from '../../lib/outbox';
import { createRouter } from '../../lib/router';
import * as adjustments from './adjustments.service';
import * as payments from './payments.service';
import * as service from './payroll.service';
import * as payslips from './payslips.service';
import * as salary from './salary.service';

export const payrollRoutes = createRouter();
const tags = ['payroll'];
const security = SESSION_SECURITY;

// Salary structures --------------------------------------------------------------------------------------------------

payrollRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/salary-structures',
    operationId: 'salaryStructures.list',
    tags,
    security,
    'x-permission': 'compensation.read.all | compensation.read.own',
    request: { query: SalaryStructureQuerySchema },
    responses: {
      200: jsonContent(paginated(SalaryStructureSchema), 'Salary structures in your scope'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await salary.listStructures(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/salary-structures',
    operationId: 'salaryStructures.create',
    tags,
    security,
    'x-permission': 'compensation.manage',
    request: { body: jsonBody(CreateSalaryStructureInputSchema) },
    responses: {
      201: jsonContent(SalaryStructureSchema, 'Draft structure'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => {
    const dto = await salary.createStructure(c.var.deps, c.var.auth, c.req.valid('json'));
    c.header('Location', `/api/v1/salary-structures/${dto.id}`);
    return c.json(dto, 201);
  },
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/salary-structures/{id}/approve',
    operationId: 'salaryStructures.approve',
    tags,
    security,
    'x-permission': 'compensation.manage',
    request: { params: IdParamSchema, body: jsonBody(VersionInputSchema) },
    responses: {
      200: jsonContent(SalaryStructureSchema, 'Approved'),
      ...problemResponses(400, 401, 403, 404, 409, 422),
    },
  }),
  async (c) =>
    c.json(
      await salary.approveStructure(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

// Periods ------------------------------------------------------------------------------------------------------------

payrollRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/payroll/periods',
    operationId: 'payrollPeriods.list',
    tags,
    security,
    'x-permission': 'payroll.read.all',
    request: { query: PayrollPeriodQuerySchema },
    responses: {
      200: jsonContent(paginated(PayrollPeriodSchema), 'Periods'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.listPeriods(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/periods',
    operationId: 'payrollPeriods.create',
    tags,
    security,
    'x-permission': 'payroll.prepare',
    request: { body: jsonBody(CreatePayrollPeriodInputSchema) },
    responses: { 201: jsonContent(PayrollPeriodSchema, 'Created'), ...problemResponses(400, 401, 403, 409) },
  }),
  async (c) => {
    const dto = await service.createPeriod(c.var.deps, c.var.auth, c.req.valid('json'));
    c.header('Location', `/api/v1/payroll/periods/${dto.id}`);
    return c.json(dto, 201);
  },
);

// Runs ---------------------------------------------------------------------------------------------------------------

payrollRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/payroll/runs',
    operationId: 'payrollRuns.list',
    tags,
    security,
    'x-permission': 'payroll.read.all',
    request: { query: PayrollRunQuerySchema },
    responses: { 200: jsonContent(paginated(PayrollRunSchema), 'Runs'), ...problemResponses(400, 401, 403) },
  }),
  async (c) => c.json(await service.listRuns(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/runs',
    operationId: 'payrollRuns.create',
    tags,
    security,
    'x-permission': 'payroll.prepare',
    middleware: [idempotent('payroll.runs.create')] as const,
    request: { body: jsonBody(CreatePayrollRunInputSchema) },
    responses: {
      201: jsonContent(PayrollRunSchema, 'Draft run'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const dto = await service.createRun(c.var.deps, c.var.auth, c.req.valid('json'));
    c.header('Location', `/api/v1/payroll/runs/${dto.id}`);
    return c.json(dto, 201);
  },
);

payrollRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/payroll/runs/{id}',
    operationId: 'payrollRuns.get',
    tags,
    security,
    'x-permission': 'payroll.read.all',
    request: { params: IdParamSchema },
    responses: {
      200: jsonContent(PayrollRunSchema, 'Run with totals and validation summary'),
      ...problemResponses(401, 403, 404),
    },
  }),
  async (c) => c.json(await service.getRun(c.var.deps, c.var.auth, c.req.valid('param').id), 200),
);

payrollRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/payroll/runs/{id}/items',
    operationId: 'payrollRuns.items',
    tags,
    security,
    'x-permission': 'payroll.read.all',
    request: { params: IdParamSchema, query: PayrollItemQuerySchema },
    responses: {
      200: jsonContent(paginated(PayrollItemSchema), 'Items'),
      ...problemResponses(400, 401, 403, 404),
    },
  }),
  async (c) =>
    c.json(
      await service.listItems(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('query')),
      200,
    ),
);

payrollRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/payroll/runs/{id}/items/{itemId}',
    operationId: 'payrollRuns.item',
    tags,
    security,
    'x-permission': 'payroll.read.all',
    request: { params: RunItemParamSchema },
    responses: {
      200: jsonContent(PayrollItemDetailSchema, 'Item, lines and snapshot'),
      ...problemResponses(401, 403, 404),
    },
  }),
  async (c) => {
    const p = c.req.valid('param');
    return c.json(await service.getItem(c.var.deps, c.var.auth, p.id, p.itemId), 200);
  },
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/runs/{id}/calculate',
    operationId: 'payrollRuns.calculate',
    tags,
    security,
    'x-permission': 'payroll.prepare',
    middleware: [idempotent('payroll.runs.calculate')] as const,
    request: { params: IdParamSchema, body: jsonBody(VersionInputSchema) },
    responses: {
      200: jsonContent(PayrollRunSchema, 'Calculated'),
      ...problemResponses(400, 401, 403, 404, 409, 422),
    },
  }),
  async (c) =>
    c.json(
      await service.calculateRun(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/runs/{id}/validate',
    operationId: 'payrollRuns.validate',
    tags,
    security,
    'x-permission': 'payroll.prepare',
    request: { params: IdParamSchema },
    responses: {
      200: jsonContent(PayrollValidationSchema, 'Validation results'),
      ...problemResponses(401, 403, 404, 409),
    },
  }),
  async (c) => c.json(await service.validateRun(c.var.deps, c.var.auth, c.req.valid('param').id), 200),
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/runs/{id}/submit',
    operationId: 'payrollRuns.submit',
    tags,
    security,
    'x-permission': 'payroll.prepare',
    middleware: [idempotent('payroll.runs.submit')] as const,
    request: { params: IdParamSchema, body: jsonBody(VersionInputSchema) },
    responses: {
      200: jsonContent(PayrollRunSchema, 'Submitted'),
      ...problemResponses(400, 401, 403, 404, 409, 422),
    },
  }),
  async (c) => {
    const { deps, auth } = c.var;
    const { run, outboxIds } = await service.submitRun(
      deps,
      auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    deps.defer(processOutbox(deps, outboxIds));
    return c.json(run, 200);
  },
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/runs/{id}/return',
    operationId: 'payrollRuns.return',
    tags,
    security,
    'x-permission': 'payroll.approve',
    request: { params: IdParamSchema, body: jsonBody(ReturnPayrollRunInputSchema) },
    responses: {
      200: jsonContent(PayrollRunSchema, 'Returned to draft'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const { deps, auth } = c.var;
    const { run, outboxIds } = await service.returnRun(
      deps,
      auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    deps.defer(processOutbox(deps, outboxIds));
    return c.json(run, 200);
  },
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/runs/{id}/approve',
    operationId: 'payrollRuns.approve',
    tags,
    security,
    'x-permission': 'payroll.approve',
    middleware: [idempotent('payroll.runs.approve')] as const,
    request: { params: IdParamSchema, body: jsonBody(ApprovePayrollInputSchema) },
    responses: {
      200: jsonContent(PayrollRunSchema, 'Approved'),
      ...problemResponses(400, 401, 403, 404, 409, 422),
    },
  }),
  async (c) => {
    const { deps, auth } = c.var;
    const { run, outboxIds } = await service.approveRun(
      deps,
      auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    deps.defer(processOutbox(deps, outboxIds));
    return c.json(run, 200);
  },
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/runs/{id}/lock',
    operationId: 'payrollRuns.lock',
    tags,
    security,
    'x-permission': 'payroll.lock',
    middleware: [idempotent('payroll.runs.lock')] as const,
    request: { params: IdParamSchema, body: jsonBody(VersionInputSchema) },
    responses: {
      200: jsonContent(PayrollRunSchema, 'Locked'),
      ...problemResponses(400, 401, 403, 404, 409, 422),
    },
  }),
  async (c) =>
    c.json(await service.lockRun(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')), 200),
);

// Payments -----------------------------------------------------------------------------------------------------------

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/runs/{id}/payments',
    operationId: 'payrollRuns.recordPayment',
    tags,
    security,
    'x-permission': 'payroll.pay',
    middleware: [idempotent('payroll.payments.record')] as const,
    request: { params: IdParamSchema, body: jsonBody(RecordPaymentInputSchema) },
    responses: {
      201: jsonContent(PayrollPaymentSchema, 'Recorded'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) =>
    c.json(
      await payments.recordPayment(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      201,
    ),
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/runs/{id}/payments/import',
    operationId: 'payrollRuns.importPayments',
    tags,
    security,
    'x-permission': 'payroll.pay',
    middleware: [idempotent('payroll.payments.import')] as const,
    request: {
      params: IdParamSchema,
      query: ImportPaymentsQuerySchema,
      body: jsonBody(ImportPaymentsInputSchema),
    },
    responses: {
      200: jsonContent(PaymentImportResultSchema, 'Preview or result'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) =>
    c.json(
      await payments.importPayments(
        c.var.deps,
        c.var.auth,
        c.req.valid('param').id,
        c.req.valid('json'),
        c.req.valid('query').dryRun ?? false,
      ),
      200,
    ),
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/payments/{paymentId}/cancel',
    operationId: 'payrollPayments.cancel',
    tags,
    security,
    'x-permission': 'payroll.pay',
    request: { params: PaymentIdParamSchema, body: jsonBody(CancelPaymentInputSchema) },
    responses: {
      200: jsonContent(PayrollPaymentSchema, 'Cancelled'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) =>
    c.json(
      await payments.cancelPayment(
        c.var.deps,
        c.var.auth,
        c.req.valid('param').paymentId,
        c.req.valid('json'),
      ),
      200,
    ),
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/runs/{id}/mark-paid',
    operationId: 'payrollRuns.markPaid',
    tags,
    security,
    'x-permission': 'payroll.pay',
    request: { params: IdParamSchema, body: jsonBody(VersionInputSchema) },
    responses: { 200: jsonContent(PayrollRunSchema, 'Paid'), ...problemResponses(400, 401, 403, 404, 409) },
  }),
  async (c) =>
    c.json(
      await payments.markPaid(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/runs/{id}/reconcile',
    operationId: 'payrollRuns.reconcile',
    tags,
    security,
    'x-permission': 'payroll.pay',
    request: { params: IdParamSchema, body: jsonBody(VersionInputSchema) },
    responses: {
      200: jsonContent(PayrollRunSchema, 'Reconciled'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) =>
    c.json(
      await payments.reconcileRun(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

payrollRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/payroll/runs/{id}/reconciliation',
    operationId: 'payrollRuns.reconciliation',
    tags,
    security,
    'x-permission': 'payroll.read.all',
    request: { params: IdParamSchema },
    responses: {
      200: jsonContent(ReconciliationSchema, 'Reconciliation'),
      ...problemResponses(401, 403, 404),
    },
  }),
  async (c) => c.json(await payments.getReconciliation(c.var.deps, c.var.auth, c.req.valid('param').id), 200),
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/runs/{id}/publish-payslips',
    operationId: 'payrollRuns.publishPayslips',
    tags,
    security,
    'x-permission': 'payroll.pay',
    middleware: [idempotent('payroll.payslips.publish')] as const,
    request: { params: IdParamSchema },
    responses: {
      200: jsonContent(PublishPayslipsResultSchema, 'Published'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const { deps, auth } = c.var;
    const { result, outboxIds } = await payments.publishPayslips(deps, auth, c.req.valid('param').id);
    deps.defer(processOutbox(deps, outboxIds));
    return c.json(result, 200);
  },
);

// Adjustments --------------------------------------------------------------------------------------------------------

payrollRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/payroll/adjustments',
    operationId: 'payrollAdjustments.list',
    tags,
    security,
    'x-permission': 'payroll.read.all',
    request: { query: AdjustmentQuerySchema },
    responses: {
      200: jsonContent(paginated(PayrollAdjustmentSchema), 'Adjustments'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await adjustments.listAdjustments(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/adjustments',
    operationId: 'payrollAdjustments.create',
    tags,
    security,
    'x-permission': 'payroll.prepare',
    middleware: [idempotent('payroll.adjustments.create')] as const,
    request: { body: jsonBody(CreateAdjustmentInputSchema) },
    responses: {
      201: jsonContent(PayrollAdjustmentSchema, 'Pending'),
      ...problemResponses(400, 401, 403, 409),
    },
  }),
  async (c) => {
    const { deps, auth } = c.var;
    const { adjustment, outboxIds } = await adjustments.createAdjustment(deps, auth, c.req.valid('json'));
    deps.defer(processOutbox(deps, outboxIds));
    c.header('Location', `/api/v1/payroll/adjustments/${adjustment.id}`);
    return c.json(adjustment, 201);
  },
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/adjustments/{id}/approve',
    operationId: 'payrollAdjustments.approve',
    tags,
    security,
    'x-permission': 'payroll.approve',
    request: { params: IdParamSchema, body: jsonBody(ApprovePayrollInputSchema) },
    responses: {
      200: jsonContent(PayrollAdjustmentSchema, 'Approved'),
      ...problemResponses(400, 401, 403, 404, 409, 422),
    },
  }),
  async (c) => {
    const { deps, auth } = c.var;
    const { adjustment, outboxIds } = await adjustments.approveAdjustment(
      deps,
      auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    deps.defer(processOutbox(deps, outboxIds));
    return c.json(adjustment, 200);
  },
);

payrollRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/payroll/adjustments/{id}/reject',
    operationId: 'payrollAdjustments.reject',
    tags,
    security,
    'x-permission': 'payroll.approve',
    request: { params: IdParamSchema, body: jsonBody(RejectInputSchema) },
    responses: {
      200: jsonContent(PayrollAdjustmentSchema, 'Rejected'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const { deps, auth } = c.var;
    const { adjustment, outboxIds } = await adjustments.rejectAdjustment(
      deps,
      auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    deps.defer(processOutbox(deps, outboxIds));
    return c.json(adjustment, 200);
  },
);

// Payslips -----------------------------------------------------------------------------------------------------------

payrollRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/payroll/payslips/me',
    operationId: 'payslips.mine',
    tags,
    security,
    'x-permission': 'payslip.read.own',
    request: { query: OwnPayslipQuerySchema },
    responses: {
      200: jsonContent(paginated(PayslipSummarySchema), 'Your published payslips'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await payslips.listOwnPayslips(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

payrollRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/payroll/payslips',
    operationId: 'payslips.list',
    tags,
    security,
    'x-permission': 'payslip.read.all',
    request: { query: PayslipQuerySchema },
    responses: {
      200: jsonContent(paginated(PayslipSummarySchema), 'Published payslips'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await payslips.listPayslips(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

payrollRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/payroll/payslips/{id}',
    operationId: 'payslips.get',
    tags,
    security,
    'x-permission': 'payslip.read.all | payslip.read.own',
    request: { params: IdParamSchema },
    responses: { 200: jsonContent(PayslipDataSchema, 'Payslip data'), ...problemResponses(401, 404) },
  }),
  async (c) => c.json(await payslips.getPayslip(c.var.deps, c.var.auth, c.req.valid('param').id), 200),
);
