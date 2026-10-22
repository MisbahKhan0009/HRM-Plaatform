import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../types';
import { problemResponse } from './problem';

/** Zod issue path to a JSON Pointer; query and path parameters are prefixed (API-STANDARDS §7). */
function pointer(target: string, path: PropertyKey[]) {
  const p = path.map(String).join('/');
  return target === 'json' || target === 'form' ? `/${p}` : `${target}/${p}`;
}

/** Every module router validates the same way: failures become 400 VALIDATION_FAILED with field errors. */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problemResponse(c, 'VALIDATION_FAILED', {
          title: 'Invalid input',
          errors: result.error.issues.map((i) => ({
            path: pointer(result.target, i.path),
            code: i.code,
            message: i.message,
          })),
        });
      }
    },
  });
}
