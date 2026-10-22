import { OpenAPIHono } from '@hono/zod-openapi';
import { secureHeaders } from 'hono/secure-headers';
import { problemResponse, toProblem } from './lib/problem';
import { requestContext } from './middleware/request-context';
import { healthRoutes } from './modules/health/health.routes';
import type { AppEnv } from './types';

export const app = new OpenAPIHono<AppEnv>({
  // Zod validation failures become 400 VALIDATION_FAILED problems (API-STANDARDS §7).
  defaultHook: (result, c) => {
    if (!result.success) {
      return problemResponse(c, 'VALIDATION_FAILED', {
        title: 'Invalid input',
        errors: result.error.issues.map((i) => ({
          path: `/${i.path.join('/')}`,
          code: i.code,
          message: i.message,
        })),
      });
    }
  },
});

app.use('/api/*', requestContext());
app.use('/api/*', secureHeaders({ referrerPolicy: 'strict-origin-when-cross-origin' }));

app.route('/api/v1', healthRoutes);

app.doc31('/api/v1/openapi.json', (c) => ({
  openapi: '3.1.0',
  info: { title: 'Big-Matrix HRM API', version: c.env.APP_VERSION },
}));

app.notFound((c) => problemResponse(c, 'NOT_FOUND', { title: 'Not found' }));
app.onError((err, c) => {
  const problem = toProblem(err);
  if (problem.status >= 500)
    console.error(JSON.stringify({ level: 'error', requestId: c.get('requestId'), msg: err.message }));
  return problemResponse(c, problem.code, problem);
});
