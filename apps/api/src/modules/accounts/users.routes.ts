import { createRoute, z } from '@hono/zod-openapi';
import {
  IdParamSchema,
  InviteUserInputSchema,
  PermissionInfoSchema,
  paginated,
  ReplaceUserRolesInputSchema,
  RoleSchema,
  UpdateRoleInputSchema,
  type UserAction,
  UserActionInputSchema,
  UserDetailSchema,
  UserListQuerySchema,
  UserSummarySchema,
} from '@hrm/contracts';
import { jsonBody, jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { pageMeta } from '../../lib/pagination';
import { createRouter } from '../../lib/router';
import * as service from './users.service';

export const usersRoutes = createRouter();
const tags = ['accounts'];
const security = SESSION_SECURITY;

usersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/users',
    operationId: 'users.list',
    tags,
    security,
    'x-permission': 'user.manage',
    request: { query: UserListQuerySchema },
    responses: {
      200: jsonContent(paginated(UserSummarySchema), 'Users'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => {
    const q = c.req.valid('query');
    const result = await service.listUsers(c.var.deps, c.var.auth, q);
    return c.json({ data: result.items, page: pageMeta(q, result.total) }, 200);
  },
);

usersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/users/invitations',
    operationId: 'users.invite',
    tags,
    security,
    'x-permission': 'user.manage (+ role.manage when roleCodes is not empty), strong session',
    request: { body: jsonBody(InviteUserInputSchema) },
    responses: {
      201: jsonContent(UserDetailSchema, 'Invited; the invitation email is queued'),
      ...problemResponses(400, 401, 403, 409),
    },
  }),
  async (c) => {
    const dto = await service.inviteUser(c.var.deps, c.var.auth, c.req.valid('json'));
    c.header('Location', `/api/v1/users/${dto.id}`);
    return c.json(dto, 201);
  },
);

usersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/users/{id}/invitations/resend',
    operationId: 'users.resendInvitation',
    tags,
    security,
    'x-permission': 'user.manage',
    request: { params: IdParamSchema },
    responses: {
      200: jsonContent(UserDetailSchema, 'New invitation sent; earlier links no longer work'),
      ...problemResponses(401, 403, 404, 409),
    },
  }),
  async (c) => c.json(await service.resendInvitation(c.var.deps, c.var.auth, c.req.valid('param').id), 200),
);

usersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/users/{id}',
    operationId: 'users.get',
    tags,
    security,
    'x-permission': 'user.manage',
    request: { params: IdParamSchema },
    responses: { 200: jsonContent(UserDetailSchema, 'User'), ...problemResponses(400, 401, 403, 404) },
  }),
  async (c) => c.json(await service.getUser(c.var.deps, c.var.auth, c.req.valid('param').id), 200),
);

const ACTIONS: { action: UserAction; summary: string }[] = [
  { action: 'suspend', summary: '`active` → `suspended`; revokes all sessions' },
  { action: 'reactivate', summary: '`suspended` → `active`' },
  {
    action: 'deactivate',
    summary: '`invited`, `active` or `suspended` → `deactivated`; revokes all sessions',
  },
];

for (const { action, summary } of ACTIONS) {
  usersRoutes.openapi(
    createRoute({
      method: 'post',
      path: `/users/{id}/${action}`,
      operationId: `users.${action}`,
      tags,
      security,
      description: summary,
      'x-permission': 'user.manage, fresh strong session; not on your own account',
      request: { params: IdParamSchema, body: jsonBody(UserActionInputSchema) },
      responses: {
        200: jsonContent(UserDetailSchema, 'Updated'),
        ...problemResponses(400, 401, 403, 404, 409),
      },
    }),
    async (c) =>
      c.json(
        await service.changeUserStatus(
          c.var.deps,
          c.var.auth,
          c.req.valid('param').id,
          action,
          c.req.valid('json'),
        ),
        200,
      ),
  );
}

usersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/users/{id}/reset-auth',
    operationId: 'users.resetAuth',
    tags,
    security,
    description: 'Removes passkeys and the authenticator, revokes sessions and emails a sign-in link.',
    'x-permission': 'user.manage, fresh strong session; not on your own account',
    request: { params: IdParamSchema, body: jsonBody(UserActionInputSchema) },
    responses: {
      200: jsonContent(UserDetailSchema, 'Sign-in methods reset'),
      ...problemResponses(400, 401, 403, 404, 409, 422),
    },
  }),
  async (c) =>
    c.json(
      await service.resetAuth(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

usersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/users/{id}/roles',
    operationId: 'users.replaceRoles',
    tags,
    security,
    'x-permission': 'role.manage, fresh strong session; not on your own account',
    request: { params: IdParamSchema, body: jsonBody(ReplaceUserRolesInputSchema) },
    responses: {
      200: jsonContent(UserDetailSchema, 'Roles replaced'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) =>
    c.json(
      await service.replaceRoles(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

usersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/roles',
    operationId: 'roles.list',
    tags,
    security,
    'x-permission': 'role.manage | settings.read',
    responses: {
      200: jsonContent(z.object({ data: z.array(RoleSchema) }), 'Roles with permissions'),
      ...problemResponses(401, 403),
    },
  }),
  async (c) => c.json({ data: await service.listRoles(c.var.deps, c.var.auth) }, 200),
);

usersRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/roles/{id}',
    operationId: 'roles.update',
    tags,
    security,
    'x-permission': 'role.manage, fresh strong session',
    request: { params: IdParamSchema, body: jsonBody(UpdateRoleInputSchema) },
    responses: {
      200: jsonContent(RoleSchema, 'Updated'),
      ...problemResponses(400, 401, 403, 404, 409, 422),
    },
  }),
  async (c) =>
    c.json(
      await service.updateRole(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

usersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/permissions',
    operationId: 'permissions.list',
    tags,
    security,
    'x-permission': 'role.manage',
    responses: {
      200: jsonContent(z.object({ data: z.array(PermissionInfoSchema) }), 'Permission catalogue'),
      ...problemResponses(401, 403),
    },
  }),
  async (c) => c.json({ data: await service.listPermissions(c.var.deps, c.var.auth) }, 200),
);
