import type { CurrentUser, Permission } from '@hrm/contracts';
import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';
import { ApiError, api } from '../api/client';

/** `GET /auth/me`; null when signed out (ARCHITECTURE §3). */
export const meQuery = queryOptions({
  queryKey: ['auth', 'me'] as const,
  queryFn: async (): Promise<CurrentUser | null> => {
    try {
      return await api.get<CurrentUser>('/auth/me');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === 'ACCOUNT_SUSPENDED')) return null;
      throw err;
    }
  },
  staleTime: 5 * 60_000,
});

export const can = (me: CurrentUser | null | undefined, permission: Permission) =>
  Boolean(me?.permissions.includes(permission));
export const canAny = (me: CurrentUser | null | undefined, permissions: readonly Permission[]) =>
  permissions.some((p) => can(me, p));

export function useMe() {
  return useQuery(meQuery).data ?? null;
}

export function useCan(...permissions: Permission[]) {
  return canAny(useMe(), permissions);
}

/** Route guard: the same 404 as the API gives for records outside the user's scope (INFORMATION-ARCHITECTURE §2). */
export async function requireAny(queryClient: QueryClient, permissions: readonly Permission[]) {
  const me = await queryClient.ensureQueryData(meQuery);
  if (!canAny(me, permissions)) throw notFound();
  return me;
}

/** A privileged role on a weak session, with no strong factor yet: route to the enrolment gate (USER-FLOWS 1.3). */
export const needsEnrolment = (me: CurrentUser) =>
  me.session.mfaRequired && !me.enrolment.hasPasskey && !me.enrolment.hasTotp;
export const needsStepUp = (me: CurrentUser) => me.session.mfaRequired && !me.session.strongAuth;
