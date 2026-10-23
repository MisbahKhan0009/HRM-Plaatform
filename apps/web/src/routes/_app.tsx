import { createFileRoute, Outlet, redirect, useRouterState } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';
import { meQuery, needsEnrolment, needsStepUp } from '../lib/auth/me';

/**
 * Authenticated layout (ARCHITECTURE §3): signed-out users go to sign-in with a redirect back; privileged users
 * without a strong factor are held at the enrolment gate; a weak privileged session goes to the two-factor step.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: '/sign-in', search: { redirect: location.href } });
    const atGate = location.pathname === '/me/security';
    if (needsEnrolment(me) && !atGate) throw redirect({ to: '/me/security', search: { enrol: true } });
    if (!needsEnrolment(me) && needsStepUp(me) && !atGate)
      throw redirect({ to: '/sign-in/two-factor', search: { redirect: location.href } });
    return { me };
  },
  component: AppLayout,
});

function AppLayout() {
  const enrol = useRouterState({
    select: (s) =>
      s.location.pathname === '/me/security' && (s.location.search as { enrol?: boolean }).enrol === true,
  });
  return (
    <AppShell enrolOnly={enrol}>
      <Outlet />
    </AppShell>
  );
}
