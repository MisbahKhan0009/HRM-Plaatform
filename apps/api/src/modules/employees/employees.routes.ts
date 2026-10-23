import { createRoute, type z } from '@hono/zod-openapi';
import {
  ContractParamSchema,
  CreateEmployeeInputSchema,
  CreateEmploymentContractInputSchema,
  CreateEmploymentEventInputSchema,
  CreateProfileChangeRequestInputSchema,
  DecisionInputSchema,
  EffectiveActionInputSchema,
  EmployeeBasicSchema,
  EmployeeContactSchema,
  EmployeeDetailSchema,
  EmployeeFullSchema,
  EmployeeImportCommitInputSchema,
  EmployeeImportPreviewInputSchema,
  EmployeeImportPreviewSchema,
  EmployeeImportResultSchema,
  EmployeeListQuerySchema,
  EmployeeSelfSchema,
  EmploymentContractSchema,
  EmploymentEventSchema,
  HireEmployeeInputSchema,
  HistoryQuerySchema,
  IdParamSchema,
  ProfileChangeListQuerySchema,
  ProfileChangeRequestSchema,
  paginated,
  RejectInputSchema,
  SeparateEmployeeInputSchema,
  UpdateEmployeeContactInputSchema,
  UpdateEmployeeInputSchema,
  UpdateEmploymentContractInputSchema,
  VersionOnlyInputSchema,
} from '@hrm/contracts';
import { idempotent } from '../../lib/idempotency';
import { jsonBody, jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { processOutbox } from '../../lib/outbox';
import { createRouter } from '../../lib/router';
import * as importer from './employees.import';
import * as service from './employees.service';
import * as profileChanges from './profile-changes.service';

export const employeeRoutes = createRouter();
const tags = ['employees'];
const security = SESSION_SECURITY;
const MANAGE = 'employee.manage';

// Employees ---------------------------------------------------------------------------------------------------------

employeeRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/employees',
    operationId: 'employees.list',
    tags,
    security,
    'x-permission': 'employee.read.all | employee.read.team',
    request: { query: EmployeeListQuerySchema },
    responses: {
      200: jsonContent(paginated(EmployeeBasicSchema), 'Employees in scope'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.listEmployees(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

employeeRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/employees',
    operationId: 'employees.create',
    tags,
    security,
    'x-permission': MANAGE,
    request: { body: jsonBody(CreateEmployeeInputSchema) },
    responses: {
      201: jsonContent(EmployeeFullSchema, 'Created in draft'),
      ...problemResponses(400, 401, 403, 409),
    },
  }),
  async (c) => {
    const dto = await service.createEmployee(c.var.deps, c.var.auth, c.req.valid('json'));
    c.header('Location', `/api/v1/employees/${dto.id}`);
    return c.json(dto as z.infer<typeof EmployeeFullSchema>, 201);
  },
);

// Import routes are registered before `/employees/{id}` routes so the literal path wins.
employeeRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/employees/import/preview',
    operationId: 'employees.importPreview',
    tags,
    security,
    'x-permission': MANAGE,
    request: { body: jsonBody(EmployeeImportPreviewInputSchema) },
    responses: {
      200: jsonContent(EmployeeImportPreviewSchema, 'Mapping, row errors and duplicates; nothing saved'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await importer.previewImport(c.var.deps, c.var.auth, c.req.valid('json')), 200),
);

employeeRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/employees/import/commit',
    operationId: 'employees.importCommit',
    tags,
    security,
    'x-permission': MANAGE,
    middleware: [idempotent('employees.import.commit')] as const,
    request: { body: jsonBody(EmployeeImportCommitInputSchema) },
    responses: {
      200: jsonContent(EmployeeImportResultSchema, 'Valid rows created; the others reported'),
      ...problemResponses(400, 401, 403, 409),
    },
  }),
  async (c) => c.json(await importer.commitImport(c.var.deps, c.var.auth, c.req.valid('json')), 200),
);

employeeRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/employees/{id}',
    operationId: 'employees.get',
    tags,
    security,
    'x-permission': 'employee.read.all | employee.read.team | employee.read.own',
    request: { params: IdParamSchema },
    responses: {
      200: jsonContent(EmployeeDetailSchema, 'EmployeeFull, EmployeeBasic or EmployeeSelf by permission'),
      ...problemResponses(401, 403, 404),
    },
  }),
  async (c) => c.json(await service.getEmployee(c.var.deps, c.var.auth, c.req.valid('param').id), 200),
);

employeeRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/employees/{id}',
    operationId: 'employees.update',
    tags,
    security,
    'x-permission': MANAGE,
    request: { params: IdParamSchema, body: jsonBody(UpdateEmployeeInputSchema) },
    responses: {
      200: jsonContent(EmployeeFullSchema, 'Updated'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const dto = await service.updateEmployee(
      c.var.deps,
      c.var.auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    return c.json(dto as z.infer<typeof EmployeeFullSchema>, 200);
  },
);

// Contact -----------------------------------------------------------------------------------------------------------

employeeRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/employees/{id}/contact',
    operationId: 'employees.getContact',
    tags,
    security,
    'x-permission': 'employee.contact.read.all | own',
    request: { params: IdParamSchema },
    responses: {
      200: jsonContent(EmployeeContactSchema, 'Restricted contact data (access is audited)'),
      ...problemResponses(401, 403, 404),
    },
  }),
  async (c) => c.json(await service.getContact(c.var.deps, c.var.auth, c.req.valid('param').id), 200),
);

employeeRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/employees/{id}/contact',
    operationId: 'employees.updateContact',
    tags,
    security,
    'x-permission': MANAGE,
    request: { params: IdParamSchema, body: jsonBody(UpdateEmployeeContactInputSchema) },
    responses: {
      200: jsonContent(EmployeeContactSchema, 'Updated; version 0 creates the record'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) =>
    c.json(
      await service.updateContact(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

// History and employment events -------------------------------------------------------------------------------------

employeeRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/employees/{id}/history',
    operationId: 'employees.history',
    tags,
    security,
    'x-permission': 'employee.read.all | employee.read.team (no salary_changed) | own',
    request: { params: IdParamSchema, query: HistoryQuerySchema },
    responses: {
      200: jsonContent(paginated(EmploymentEventSchema), 'Employment events, newest first'),
      ...problemResponses(400, 401, 403, 404),
    },
  }),
  async (c) =>
    c.json(
      await service.listHistory(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('query')),
      200,
    ),
);

employeeRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/employees/{id}/employment-events',
    operationId: 'employees.createEmploymentEvent',
    tags,
    security,
    'x-permission': MANAGE,
    request: { params: IdParamSchema, body: jsonBody(CreateEmploymentEventInputSchema) },
    responses: {
      201: jsonContent(EmploymentEventSchema, 'Applied (date today or earlier) or scheduled'),
      ...problemResponses(400, 401, 403, 404, 409, 422),
    },
  }),
  async (c) =>
    c.json(
      await service.createEmploymentEvent(
        c.var.deps,
        c.var.auth,
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      201,
    ),
);

// Lifecycle actions (DOMAIN-MODEL §5.2) -----------------------------------------------------------------------------

const lifecycle = <S extends z.ZodType>(
  path: string,
  operationId: string,
  body: S,
  description: string,
  extra: { fresh?: boolean } = {},
) =>
  createRoute({
    method: 'post',
    path: `/employees/{id}/${path}`,
    operationId,
    tags,
    security,
    'x-permission': extra.fresh ? `${MANAGE} (fresh strong auth)` : MANAGE,
    request: { params: IdParamSchema, body: jsonBody(body) },
    responses: {
      200: jsonContent(EmployeeFullSchema, description),
      ...problemResponses(400, 401, 403, 404, 409, 422),
    },
  });

const full = (dto: unknown) => dto as z.infer<typeof EmployeeFullSchema>;

employeeRoutes.openapi(
  lifecycle('start-preboarding', 'employees.startPreboarding', VersionOnlyInputSchema, 'draft → preboarding'),
  async (c) =>
    c.json(
      full(
        await service.runLifecycleAction(c.var.deps, c.var.auth, c.req.valid('param').id, {
          action: 'start_preboarding',
          input: c.req.valid('json'),
        }),
      ),
      200,
    ),
);

employeeRoutes.openapi(
  lifecycle('hire', 'employees.hire', HireEmployeeInputSchema, '→ probation or active on effectiveDate'),
  async (c) =>
    c.json(
      full(
        await service.runLifecycleAction(c.var.deps, c.var.auth, c.req.valid('param').id, {
          action: 'hire',
          input: c.req.valid('json'),
        }),
      ),
      200,
    ),
);

employeeRoutes.openapi(
  lifecycle('confirm', 'employees.confirm', EffectiveActionInputSchema, 'probation → active'),
  async (c) =>
    c.json(
      full(
        await service.runLifecycleAction(c.var.deps, c.var.auth, c.req.valid('param').id, {
          action: 'confirm',
          input: c.req.valid('json'),
        }),
      ),
      200,
    ),
);

employeeRoutes.openapi(
  lifecycle('start-notice', 'employees.startNotice', EffectiveActionInputSchema, 'active → notice_period'),
  async (c) =>
    c.json(
      full(
        await service.runLifecycleAction(c.var.deps, c.var.auth, c.req.valid('param').id, {
          action: 'start_notice',
          input: c.req.valid('json'),
        }),
      ),
      200,
    ),
);

employeeRoutes.openapi(
  lifecycle('separate', 'employees.separate', SeparateEmployeeInputSchema, '→ separated on separationDate', {
    fresh: true,
  }),
  async (c) =>
    c.json(
      full(
        await service.runLifecycleAction(c.var.deps, c.var.auth, c.req.valid('param').id, {
          action: 'separate',
          input: c.req.valid('json'),
        }),
      ),
      200,
    ),
);

employeeRoutes.openapi(
  lifecycle('rehire', 'employees.rehire', EffectiveActionInputSchema, 'separated → active'),
  async (c) =>
    c.json(
      full(
        await service.runLifecycleAction(c.var.deps, c.var.auth, c.req.valid('param').id, {
          action: 'rehire',
          input: c.req.valid('json'),
        }),
      ),
      200,
    ),
);

employeeRoutes.openapi(
  lifecycle('archive', 'employees.archive', VersionOnlyInputSchema, 'separated → archived'),
  async (c) =>
    c.json(
      full(
        await service.runLifecycleAction(c.var.deps, c.var.auth, c.req.valid('param').id, {
          action: 'archive',
          input: c.req.valid('json'),
        }),
      ),
      200,
    ),
);

// Contracts (FR-DOC-009) --------------------------------------------------------------------------------------------

employeeRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/employees/{id}/contracts',
    operationId: 'employees.listContracts',
    tags,
    security,
    'x-permission': 'employee.read.all | own',
    request: { params: IdParamSchema, query: HistoryQuerySchema },
    responses: {
      200: jsonContent(paginated(EmploymentContractSchema), 'Contracts, newest first'),
      ...problemResponses(400, 401, 403, 404),
    },
  }),
  async (c) =>
    c.json(
      await service.listContracts(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('query')),
      200,
    ),
);

employeeRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/employees/{id}/contracts',
    operationId: 'employees.createContract',
    tags,
    security,
    'x-permission': MANAGE,
    request: { params: IdParamSchema, body: jsonBody(CreateEmploymentContractInputSchema) },
    responses: {
      201: jsonContent(EmploymentContractSchema, 'Created'),
      ...problemResponses(400, 401, 403, 404),
    },
  }),
  async (c) =>
    c.json(
      await service.createContract(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      201,
    ),
);

employeeRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/employees/{id}/contracts/{contractId}',
    operationId: 'employees.updateContract',
    tags,
    security,
    'x-permission': MANAGE,
    request: { params: ContractParamSchema, body: jsonBody(UpdateEmploymentContractInputSchema) },
    responses: {
      200: jsonContent(EmploymentContractSchema, 'Updated'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const { id, contractId } = c.req.valid('param');
    return c.json(
      await service.updateContract(c.var.deps, c.var.auth, id, contractId, c.req.valid('json')),
      200,
    );
  },
);

// Self-service ------------------------------------------------------------------------------------------------------

employeeRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/me/profile',
    operationId: 'me.profile',
    tags,
    security,
    'x-permission': 'employee.read.own',
    responses: {
      200: jsonContent(EmployeeSelfSchema, 'The caller’s own employee record'),
      ...problemResponses(401, 403, 404),
    },
  }),
  async (c) =>
    c.json((await service.getMyProfile(c.var.deps, c.var.auth)) as z.infer<typeof EmployeeSelfSchema>, 200),
);

employeeRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/profile-change-requests',
    operationId: 'profileChangeRequests.list',
    tags,
    security,
    'x-permission': 'profile_change.review.all | own',
    request: { query: ProfileChangeListQuerySchema },
    responses: {
      200: jsonContent(paginated(ProfileChangeRequestSchema), 'Requests in scope'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) =>
    c.json(await profileChanges.listProfileChanges(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

employeeRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/profile-change-requests',
    operationId: 'profileChangeRequests.create',
    tags,
    security,
    'x-permission': 'profile_change.request.own',
    request: { body: jsonBody(CreateProfileChangeRequestInputSchema) },
    responses: {
      201: jsonContent(ProfileChangeRequestSchema, 'Pending; HR is notified'),
      ...problemResponses(400, 401, 403, 409),
    },
  }),
  async (c) => {
    const { request, outboxIds } = await profileChanges.createProfileChange(
      c.var.deps,
      c.var.auth,
      c.req.valid('json'),
    );
    c.var.deps.defer(processOutbox(c.var.deps, outboxIds));
    return c.json(request, 201);
  },
);

employeeRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/profile-change-requests/{id}',
    operationId: 'profileChangeRequests.get',
    tags,
    security,
    'x-permission': 'profile_change.review.all | own',
    request: { params: IdParamSchema },
    responses: {
      200: jsonContent(ProfileChangeRequestSchema, 'One request'),
      ...problemResponses(400, 401, 403, 404),
    },
  }),
  async (c) =>
    c.json(await profileChanges.getProfileChange(c.var.deps, c.var.auth, c.req.valid('param').id), 200),
);

const decide = (action: 'approve' | 'reject') =>
  createRoute({
    method: 'post',
    path: `/profile-change-requests/{id}/${action}`,
    operationId: `profileChangeRequests.${action}`,
    tags,
    security,
    'x-permission': 'profile_change.review.all',
    request: {
      params: IdParamSchema,
      body: jsonBody(action === 'approve' ? DecisionInputSchema : RejectInputSchema),
    },
    responses: {
      200: jsonContent(
        ProfileChangeRequestSchema,
        action === 'approve' ? 'Approved; changes applied' : 'Rejected',
      ),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  });

employeeRoutes.openapi(decide('approve'), async (c) => {
  const { request, outboxIds } = await profileChanges.decideProfileChange(
    c.var.deps,
    c.var.auth,
    c.req.valid('param').id,
    'approved',
    c.req.valid('json'),
  );
  c.var.deps.defer(processOutbox(c.var.deps, outboxIds));
  return c.json(request, 200);
});

employeeRoutes.openapi(decide('reject'), async (c) => {
  const { request, outboxIds } = await profileChanges.decideProfileChange(
    c.var.deps,
    c.var.auth,
    c.req.valid('param').id,
    'rejected',
    c.req.valid('json') as z.infer<typeof RejectInputSchema>,
  );
  c.var.deps.defer(processOutbox(c.var.deps, outboxIds));
  return c.json(request, 200);
});

employeeRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/profile-change-requests/{id}/withdraw',
    operationId: 'profileChangeRequests.withdraw',
    tags,
    security,
    'x-permission': 'own',
    request: { params: IdParamSchema, body: jsonBody(VersionOnlyInputSchema) },
    responses: {
      200: jsonContent(ProfileChangeRequestSchema, 'Withdrawn'),
      ...problemResponses(400, 401, 404, 409),
    },
  }),
  async (c) =>
    c.json(
      await profileChanges.withdrawProfileChange(
        c.var.deps,
        c.var.auth,
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      200,
    ),
);
