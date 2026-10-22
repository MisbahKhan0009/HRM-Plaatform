import type { QueryClient } from '@tanstack/react-query';
import { meQuery, needsEnrolment, needsStepUp } from './me';

/** Only same-origin app paths are accepted as redirect targets (no open redirect). */
export function safeRedirect(target: unknown): string {
  return typeof target === 'string' &&
    target.startsWith('/') &&
    !target.startsWith('//') &&
    !target.startsWith('/api/')
    ? target
    : '/dashboard';
}

/** Where to go after a sign-in step (USER-FLOWS 1.2–1.3). */
export async function nextAfterSignIn(queryClient: QueryClient, redirect: unknown) {
  await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
  const me = await queryClient.fetchQuery(meQuery);
  if (!me) return { to: '/sign-in' as const };
  if (needsEnrolment(me)) return { to: '/me/security' as const, search: { enrol: true } };
  if (needsStepUp(me))
    return { to: '/sign-in/two-factor' as const, search: { redirect: safeRedirect(redirect) } };
  return { to: safeRedirect(redirect) };
}
