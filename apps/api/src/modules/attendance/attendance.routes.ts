import { createRoute } from '@hono/zod-openapi';
import {
  AttendanceCorrectionListQuerySchema,
  AttendanceCorrectionSchema,
  AttendanceDayDetailSchema,
  AttendanceDayParamSchema,
  AttendanceListQuerySchema,
  AttendanceRecordSchema,
  AttendanceSummaryQuerySchema,
  AttendanceSummaryRowSchema,
  CreateAttendanceCorrectionInputSchema,
  CreateManualEntryInputSchema,
  DecisionInputSchema,
  IdParamSchema,
  MyAttendanceQuerySchema,
  MyAttendanceResponseSchema,
  PunchInputSchema,
  PunchResultSchema,
  paginated,
  RejectInputSchema,
  WithdrawAttendanceCorrectionInputSchema,
} from '@hrm/contracts';
import { jsonBody, jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { processOutbox } from '../../lib/outbox';
import { createRouter } from '../../lib/router';
import * as service from './attendance.service';
import * as corrections from './attendance-corrections.service';

export const attendanceRoutes = createRouter();
const tags = ['attendance'];
const security = SESSION_SECURITY;
const punchBody = {
  required: false,
  content: { 'application/json': { schema: PunchInputSchema } },
};

// Self-service punches (FR-ATT-001, FR-ATT-012)
attendanceRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/attendance/check-in',
    operationId: 'attendance.checkIn',
    tags,
    security,
    'x-permission': 'attendance.check_in.own',
    request: { body: punchBody },
    responses: {
      201: jsonContent(PunchResultSchema, 'Checked in'),
      ...problemResponses(401, 403, 409, 429),
    },
  }),
  async (c) => c.json(await service.checkIn(c.var.deps, c.var.auth), 201),
);

attendanceRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/attendance/check-out',
    operationId: 'attendance.checkOut',
    tags,
    security,
    'x-permission': 'attendance.check_in.own',
    request: { body: punchBody },
    responses: {
      201: jsonContent(PunchResultSchema, 'Checked out'),
      ...problemResponses(401, 403, 409, 429),
    },
  }),
  async (c) => c.json(await service.checkOut(c.var.deps, c.var.auth), 201),
);

// Reads
attendanceRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/attendance/me',
    operationId: 'attendance.me',
    tags,
    security,
    'x-permission': 'attendance.read.own',
    request: { query: MyAttendanceQuerySchema },
    responses: {
      200: jsonContent(MyAttendanceResponseSchema, 'Own records and today'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.myAttendance(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

attendanceRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/attendance/summary',
    operationId: 'attendance.summary',
    tags,
    security,
    'x-permission': 'attendance.read.all | attendance.read.team | attendance.read.own',
    request: { query: AttendanceSummaryQuerySchema },
    responses: {
      200: jsonContent(paginated(AttendanceSummaryRowSchema), 'Counts per status per employee'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.summary(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

attendanceRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/attendance/corrections',
    operationId: 'attendanceCorrections.list',
    tags,
    security,
    'x-permission': 'attendance.correction.review.all | attendance.correction.review.team | own',
    request: { query: AttendanceCorrectionListQuerySchema },
    responses: {
      200: jsonContent(paginated(AttendanceCorrectionSchema), 'Corrections'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await corrections.listCorrections(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

attendanceRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/attendance',
    operationId: 'attendance.list',
    tags,
    security,
    'x-permission': 'attendance.read.all | attendance.read.team',
    request: { query: AttendanceListQuerySchema },
    responses: {
      200: jsonContent(paginated(AttendanceRecordSchema), 'Records'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.listRecords(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

attendanceRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/attendance/{employeeId}/{workDate}',
    operationId: 'attendance.day',
    tags,
    security,
    'x-permission': 'attendance.read.all | attendance.read.team | attendance.read.own',
    request: { params: AttendanceDayParamSchema },
    responses: {
      200: jsonContent(AttendanceDayDetailSchema, 'Record and all events'),
      ...problemResponses(400, 401, 403, 404),
    },
  }),
  async (c) => {
    const { employeeId, workDate } = c.req.valid('param');
    return c.json(await service.getDay(c.var.deps, c.var.auth, employeeId, workDate), 200);
  },
);

// Manual entries (FR-ATT-009)
attendanceRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/attendance/manual-entries',
    operationId: 'attendance.createManualEntry',
    tags,
    security,
    'x-permission': 'attendance.manage',
    request: { body: jsonBody(CreateManualEntryInputSchema) },
    responses: {
      201: jsonContent(AttendanceDayDetailSchema, 'Recorded; the day is recomputed'),
      ...problemResponses(400, 401, 403, 422),
    },
  }),
  async (c) => c.json(await service.createManualEntry(c.var.deps, c.var.auth, c.req.valid('json')), 201),
);

// Corrections (FR-ATT-006, FR-ATT-007)
attendanceRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/attendance/corrections',
    operationId: 'attendanceCorrections.create',
    tags,
    security,
    'x-permission': 'attendance.correction.request.own',
    request: { body: jsonBody(CreateAttendanceCorrectionInputSchema) },
    responses: {
      201: jsonContent(AttendanceCorrectionSchema, 'Pending correction'),
      ...problemResponses(400, 401, 403, 409, 422),
    },
  }),
  async (c) => {
    const { correction, outboxIds } = await corrections.requestCorrection(
      c.var.deps,
      c.var.auth,
      c.req.valid('json'),
    );
    c.var.deps.defer(processOutbox(c.var.deps, outboxIds));
    return c.json(correction, 201);
  },
);

const decisionRoute = (action: 'approve' | 'reject') =>
  createRoute({
    method: 'post',
    path: `/attendance/corrections/{id}/${action}`,
    operationId: `attendanceCorrections.${action}`,
    tags,
    security,
    'x-permission': 'attendance.correction.review.team | attendance.correction.review.all',
    request: {
      params: IdParamSchema,
      body: jsonBody(action === 'approve' ? DecisionInputSchema : RejectInputSchema),
    },
    responses: {
      200: jsonContent(AttendanceCorrectionSchema, action === 'approve' ? 'Approved' : 'Rejected'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  });

attendanceRoutes.openapi(decisionRoute('approve'), async (c) => {
  const { correction, outboxIds } = await corrections.decideCorrection(
    c.var.deps,
    c.var.auth,
    c.req.valid('param').id,
    'approved',
    c.req.valid('json'),
  );
  c.var.deps.defer(processOutbox(c.var.deps, outboxIds));
  return c.json(correction, 200);
});

attendanceRoutes.openapi(decisionRoute('reject'), async (c) => {
  const { correction, outboxIds } = await corrections.decideCorrection(
    c.var.deps,
    c.var.auth,
    c.req.valid('param').id,
    'rejected',
    c.req.valid('json'),
  );
  c.var.deps.defer(processOutbox(c.var.deps, outboxIds));
  return c.json(correction, 200);
});

attendanceRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/attendance/corrections/{id}/withdraw',
    operationId: 'attendanceCorrections.withdraw',
    tags,
    security,
    'x-permission': 'attendance.correction.request.own (own request)',
    request: { params: IdParamSchema, body: jsonBody(WithdrawAttendanceCorrectionInputSchema) },
    responses: {
      200: jsonContent(AttendanceCorrectionSchema, 'Withdrawn'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) =>
    c.json(
      await corrections.withdrawCorrection(
        c.var.deps,
        c.var.auth,
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      200,
    ),
);
