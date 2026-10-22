import { OpenAPIHono } from '@hono/zod-openapi';
import { secureHeaders } from 'hono/secure-headers';
import { problemResponse, toProblem } from './lib/problem';
import { csrf } from './middleware/csrf';
import { withDeps } from './middleware/deps';
import { requestContext } from './middleware/request-context';
import { session } from './middleware/session';
import { authRoutes } from './modules/accounts/auth.routes';
import { approvalRoutes } from './modules/approvals/approvals.routes';
import { attendanceRoutes } from './modules/attendance/attendance.routes';
import { healthRoutes } from './modules/health/health.routes';
import { organizationRoutes } from './modules/organization/organization.routes';
import type { AppEnv } from './types';

export const app = new OpenAPIHono<AppEnv>();

app.use('/api/*', requestContext());
app.use('/api/*', secureHeaders({ referrerPolicy: 'strict-origin-when-cross-origin' }));
app.use('/api/v1/*', csrf());
app.use('/api/v1/*', withDeps());
app.use('/api/v1/*', session());

if (__TEST_ROUTES__) {
  // Dropped from staging and production builds (wrangler `define`); also inert unless APP_ENV is "test".
  app.all('/api/v1/__test/*', async (c, next) => {
    if (c.env.APP_ENV !== 'test') return next();
    const { handleTestRoute } = await import('./test-routes');
    return (await handleTestRoute(c)) ?? next();
  });
}

app.route('/api/v1', healthRoutes);
app.route('/api/v1', authRoutes);
app.route('/api/v1', approvalRoutes);
app.route('/api/v1', organizationRoutes);
app.route('/api/v1', attendanceRoutes);

// Better Auth serves the rest of /auth/* (sign-in, passkeys, TOTP, sessions); our routes above match first.
app.on(['GET', 'POST'], '/api/v1/auth/*', (c) => c.var.deps.auth().handler(c.req.raw));

app.openAPIRegistry.registerComponent('securitySchemes', 'sessionCookie', {
  type: 'apiKey',
  in: 'cookie',
  name: '__Secure-hrm.session_token',
  description: 'Better Auth session cookie (HttpOnly). Obtained by signing in.',
});

app.doc31('/api/v1/openapi.json', (c) => ({
  openapi: '3.1.0',
  info: { title: 'Big-Matrix HRM API', version: c.env.APP_VERSION },
}));

app.notFound((c) => problemResponse(c, 'NOT_FOUND', { title: 'Not found' }));
app.onError((err, c) => {
  const problem = toProblem(err);
  if (problem.status >= 500) {
    console.error(
      JSON.stringify({
        level: 'error',
        requestId: c.get('requestId'),
        msg: err.message,
        stack: err.stack?.slice(0, 2000),
      }),
    );
  }
  return problemResponse(c, problem.code, problem, problem.headers);
});
