import { createMiddleware } from 'hono/factory';
import { fixedClock, systemClock } from '../lib/clock';
import { createDeps } from '../lib/deps';
import type { AppEnv } from '../types';

/**
 * Creates the request's dependencies and closes the database after the response and any deferred work.
 * In tests (APP_ENV=test) an `X-Test-Now` header fixes the clock, so time-dependent rules are reproducible.
 */
export const withDeps = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const testNow = c.env.APP_ENV === 'test' ? c.req.header('X-Test-Now') : undefined;
    const clock = testNow ? fixedClock(new Date(testNow)) : systemClock;
    const deps = createDeps(c.env, clock, {
      requestId: c.get('requestId'),
      ipAddress: c.req.header('cf-connecting-ip') ?? null,
      userAgent: c.req.header('user-agent')?.slice(0, 500) ?? null,
    });
    c.set('deps', deps);
    try {
      await next();
    } finally {
      c.executionCtx.waitUntil(deps.close());
    }
  });
