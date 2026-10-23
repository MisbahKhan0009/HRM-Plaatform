import { createRoute } from '@hono/zod-openapi';
import {
  AcceptInvitationResultSchema,
  CurrentUserSchema,
  InvitationInfoSchema,
  InvitationTokenParamSchema,
  StepUpTotpInputSchema,
  UpdatePreferencesInputSchema,
} from '@hrm/contracts';
import { recordAudit } from '../../lib/audit';
import { jsonBody, jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { AppError } from '../../lib/problem';
import { createRouter } from '../../lib/router';
import { acceptInvitation, currentUser, invitationInfo, updatePreferences } from './auth.service';

export const authRoutes = createRouter();

authRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/auth/me',
    operationId: 'auth.me',
    tags: ['accounts'],
    security: SESSION_SECURITY,
    responses: { 200: jsonContent(CurrentUserSchema, 'The signed-in user'), ...problemResponses(401, 403) },
  }),
  async (c) => c.json(await currentUser(c.var.deps, c.var.auth), 200),
);

authRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/auth/me/preferences',
    operationId: 'auth.updatePreferences',
    tags: ['accounts'],
    security: SESSION_SECURITY,
    request: { body: jsonBody(UpdatePreferencesInputSchema) },
    responses: { 200: jsonContent(CurrentUserSchema, 'Updated user'), ...problemResponses(400, 401, 403) },
  }),
  async (c) => c.json(await updatePreferences(c.var.deps, c.var.auth, c.req.valid('json')), 200),
);

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/step-up/totp',
    operationId: 'auth.stepUpTotp',
    tags: ['accounts'],
    description:
      'Verifies an authenticator code (6 digits) or a backup code on the current session and marks it strong. ' +
      'Passkey step-up is a passkey sign-in (`/auth/passkey/verify-authentication`), which replaces the session.',
    security: SESSION_SECURITY,
    request: { body: jsonBody(StepUpTotpInputSchema) },
    responses: {
      200: jsonContent(CurrentUserSchema, 'Session is now strong'),
      ...problemResponses(400, 401, 403, 429),
    },
  }),
  async (c) => {
    const { deps, auth } = c.var;
    const { code } = c.req.valid('json');
    // Forward to Better Auth so its TOTP check, backup-code consumption and rate limits apply; its after-hook sets
    // strong_auth_at on the session.
    const path = /^\d{6}$/.test(code) ? 'verify-totp' : 'verify-backup-code';
    const headers = new Headers(c.req.raw.headers);
    headers.set('Content-Type', 'application/json');
    const res = await deps.auth().handler(
      new Request(`${new URL(c.req.url).origin}/api/v1/auth/two-factor/${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code }),
      }),
    );
    if (res.status === 429) {
      throw new AppError('RATE_LIMITED', 'Too many attempts', undefined, [], {
        'Retry-After': res.headers.get('X-Retry-After') ?? '600',
      });
    }
    if (!res.ok) throw new AppError('TOTP_INVALID', 'Code not accepted');
    await recordAudit(deps.db, auth.actor, {
      action: 'user.step_up_completed',
      category: 'security',
      entityType: 'user',
      entityId: auth.userId,
      metadata: { method: path === 'verify-totp' ? 'totp' : 'backup_code' },
    });
    for (const cookie of res.headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true });
    (auth.session as { strongAuthAt: Date | null }).strongAuthAt = deps.clock.now();
    return c.json(await currentUser(deps, auth), 200);
  },
);

authRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/auth/invitations/{token}',
    operationId: 'auth.invitationInfo',
    tags: ['accounts'],
    request: { params: InvitationTokenParamSchema },
    responses: { 200: jsonContent(InvitationInfoSchema, 'Open invitation'), ...problemResponses(400, 404) },
  }),
  async (c) => c.json(await invitationInfo(c.var.deps, c.req.valid('param').token), 200),
);

authRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/auth/invitations/{token}/accept',
    operationId: 'auth.acceptInvitation',
    tags: ['accounts'],
    request: { params: InvitationTokenParamSchema },
    responses: {
      200: jsonContent(AcceptInvitationResultSchema, 'Accepted; a sign-in code was emailed'),
      ...problemResponses(400, 403, 404),
    },
  }),
  async (c) => c.json(await acceptInvitation(c.var.deps, c.req.valid('param').token), 200),
);
