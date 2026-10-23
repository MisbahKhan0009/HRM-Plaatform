import { createMiddleware } from 'hono/factory';
import { problemResponse } from '../lib/problem';
import type { AppEnv } from '../types';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Every state-changing request must come from the app origin (AUTH-IMPLEMENTATION §8): `Origin` must equal
 * APP_ORIGIN, and requests without it are rejected. SameSite=Lax cookies are the second layer.
 */
export const csrf = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (SAFE.has(c.req.method)) return next();
    if (c.req.header('Origin') !== c.env.APP_ORIGIN) {
      return problemResponse(c, 'CSRF_ORIGIN_MISMATCH', { title: 'Origin not allowed' });
    }
    return next();
  });
