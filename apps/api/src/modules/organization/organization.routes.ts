import { createRoute, z } from '@hono/zod-openapi';
import {
  ActiveFilterQuerySchema,
  CompanySchema,
  CreateDepartmentInputSchema,
  CreateHolidayInputSchema,
  CreatePositionInputSchema,
  CreateScheduleAssignmentInputSchema,
  CreateWorkScheduleInputSchema,
  DepartmentSchema,
  HolidayQuerySchema,
  HolidaySchema,
  IdParamSchema,
  PositionSchema,
  ScheduleAssignmentSchema,
  UpdateCompanyInputSchema,
  UpdateDepartmentInputSchema,
  UpdateHolidayInputSchema,
  UpdatePositionInputSchema,
  UpdateWorkScheduleInputSchema,
  WorkScheduleSchema,
} from '@hrm/contracts';
import { jsonBody, jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { createRouter } from '../../lib/router';
import * as service from './organization.service';

export const organizationRoutes = createRouter();
const tags = ['organization'];
const security = SESSION_SECURITY;
const list = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) });

// Company
organizationRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/company',
    operationId: 'company.get',
    tags,
    security,
    responses: { 200: jsonContent(CompanySchema, 'Company profile'), ...problemResponses(401, 403) },
  }),
  async (c) => c.json(await service.getCompany(c.var.deps, c.var.auth), 200),
);

organizationRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/company',
    operationId: 'company.update',
    tags,
    security,
    'x-permission': 'settings.hr.manage',
    request: { body: jsonBody(UpdateCompanyInputSchema) },
    responses: { 200: jsonContent(CompanySchema, 'Updated'), ...problemResponses(400, 401, 403, 409) },
  }),
  async (c) => c.json(await service.updateCompany(c.var.deps, c.var.auth, c.req.valid('json')), 200),
);

// Departments
organizationRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/departments',
    operationId: 'departments.list',
    tags,
    security,
    request: { query: ActiveFilterQuerySchema },
    responses: {
      200: jsonContent(list(DepartmentSchema), 'Departments'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) =>
    c.json(
      {
        data: await service.listDepartments(
          c.var.deps,
          c.var.auth,
          c.req.valid('query').includeInactive ?? false,
        ),
      },
      200,
    ),
);

organizationRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/departments',
    operationId: 'departments.create',
    tags,
    security,
    'x-permission': 'org.manage',
    request: { body: jsonBody(CreateDepartmentInputSchema) },
    responses: { 201: jsonContent(DepartmentSchema, 'Created'), ...problemResponses(400, 401, 403, 409) },
  }),
  async (c) => {
    const dto = await service.createDepartment(c.var.deps, c.var.auth, c.req.valid('json'));
    c.header('Location', `/api/v1/departments/${dto.id}`);
    return c.json(dto, 201);
  },
);

organizationRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/departments/{id}',
    operationId: 'departments.update',
    tags,
    security,
    'x-permission': 'org.manage',
    request: { params: IdParamSchema, body: jsonBody(UpdateDepartmentInputSchema) },
    responses: {
      200: jsonContent(DepartmentSchema, 'Updated'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) =>
    c.json(
      await service.updateDepartment(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

// Positions
organizationRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/positions',
    operationId: 'positions.list',
    tags,
    security,
    request: { query: ActiveFilterQuerySchema },
    responses: { 200: jsonContent(list(PositionSchema), 'Positions'), ...problemResponses(400, 401, 403) },
  }),
  async (c) =>
    c.json(
      {
        data: await service.listPositions(
          c.var.deps,
          c.var.auth,
          c.req.valid('query').includeInactive ?? false,
        ),
      },
      200,
    ),
);

organizationRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/positions',
    operationId: 'positions.create',
    tags,
    security,
    'x-permission': 'org.manage',
    request: { body: jsonBody(CreatePositionInputSchema) },
    responses: { 201: jsonContent(PositionSchema, 'Created'), ...problemResponses(400, 401, 403, 409) },
  }),
  async (c) => {
    const dto = await service.createPosition(c.var.deps, c.var.auth, c.req.valid('json'));
    c.header('Location', `/api/v1/positions/${dto.id}`);
    return c.json(dto, 201);
  },
);

organizationRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/positions/{id}',
    operationId: 'positions.update',
    tags,
    security,
    'x-permission': 'org.manage',
    request: { params: IdParamSchema, body: jsonBody(UpdatePositionInputSchema) },
    responses: { 200: jsonContent(PositionSchema, 'Updated'), ...problemResponses(400, 401, 403, 404, 409) },
  }),
  async (c) =>
    c.json(
      await service.updatePosition(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

// Work schedules
organizationRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/work-schedules',
    operationId: 'workSchedules.list',
    tags,
    security,
    'x-permission': 'attendance.read.* | attendance.manage',
    responses: {
      200: jsonContent(list(WorkScheduleSchema), 'Work schedules'),
      ...problemResponses(401, 403),
    },
  }),
  async (c) => c.json({ data: await service.listWorkSchedules(c.var.deps, c.var.auth) }, 200),
);

organizationRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/work-schedules',
    operationId: 'workSchedules.create',
    tags,
    security,
    'x-permission': 'attendance.manage',
    request: { body: jsonBody(CreateWorkScheduleInputSchema) },
    responses: { 201: jsonContent(WorkScheduleSchema, 'Created'), ...problemResponses(400, 401, 403) },
  }),
  async (c) => {
    const dto = await service.createWorkSchedule(c.var.deps, c.var.auth, c.req.valid('json'));
    c.header('Location', `/api/v1/work-schedules/${dto.id}`);
    return c.json(dto, 201);
  },
);

organizationRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/work-schedules/{id}',
    operationId: 'workSchedules.update',
    tags,
    security,
    'x-permission': 'attendance.manage',
    request: { params: IdParamSchema, body: jsonBody(UpdateWorkScheduleInputSchema) },
    responses: {
      200: jsonContent(WorkScheduleSchema, 'Updated'),
      ...problemResponses(400, 401, 403, 404, 409, 422),
    },
  }),
  async (c) =>
    c.json(
      await service.updateWorkSchedule(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

organizationRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/schedule-assignments',
    operationId: 'scheduleAssignments.create',
    tags,
    security,
    'x-permission': 'attendance.manage',
    request: { body: jsonBody(CreateScheduleAssignmentInputSchema) },
    responses: {
      201: jsonContent(ScheduleAssignmentSchema, 'Created; the previous open assignment ends the day before'),
      ...problemResponses(400, 401, 403, 422),
    },
  }),
  async (c) =>
    c.json(await service.createScheduleAssignment(c.var.deps, c.var.auth, c.req.valid('json')), 201),
);

// Holidays
organizationRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/holidays',
    operationId: 'holidays.list',
    tags,
    security,
    request: { query: HolidayQuerySchema },
    responses: { 200: jsonContent(list(HolidaySchema), 'Holidays'), ...problemResponses(400, 401, 403) },
  }),
  async (c) =>
    c.json({ data: await service.listHolidays(c.var.deps, c.var.auth, c.req.valid('query').year) }, 200),
);

organizationRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/holidays',
    operationId: 'holidays.create',
    tags,
    security,
    'x-permission': 'settings.hr.manage',
    request: { body: jsonBody(CreateHolidayInputSchema) },
    responses: { 201: jsonContent(HolidaySchema, 'Created'), ...problemResponses(400, 401, 403, 409) },
  }),
  async (c) => c.json(await service.createHoliday(c.var.deps, c.var.auth, c.req.valid('json')), 201),
);

organizationRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/holidays/{id}',
    operationId: 'holidays.update',
    tags,
    security,
    'x-permission': 'settings.hr.manage',
    request: { params: IdParamSchema, body: jsonBody(UpdateHolidayInputSchema) },
    responses: { 200: jsonContent(HolidaySchema, 'Updated'), ...problemResponses(400, 401, 403, 404, 409) },
  }),
  async (c) =>
    c.json(
      await service.updateHoliday(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

organizationRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/holidays/{id}',
    operationId: 'holidays.delete',
    tags,
    security,
    'x-permission': 'settings.hr.manage',
    request: { params: IdParamSchema },
    responses: { 204: { description: 'Deleted' }, ...problemResponses(401, 403, 404, 422) },
  }),
  async (c) => {
    await service.deleteHoliday(c.var.deps, c.var.auth, c.req.valid('param').id);
    return c.body(null, 204);
  },
);
