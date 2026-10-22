import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Request id (echoed as X-Request-Id, used in logs and problem bodies) and the
 * API-wide response headers from API-STANDARDS §11.
 */
export const requestContext = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const incoming = c.req.header('X-Request-Id');
    const requestId = incoming && ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
    c.set('requestId', requestId);
    await next();
    c.header('X-Request-Id', requestId);
    c.header('Cache-Control', 'no-store');
  });
