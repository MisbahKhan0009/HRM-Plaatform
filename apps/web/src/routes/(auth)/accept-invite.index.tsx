import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { z } from 'zod';

// The invitation email links to `/accept-invite?token=…` (notifications `email.invitation`); the page lives at
// `/accept-invite/$token`, so the query form forwards there.
export const Route = createFileRoute('/(auth)/accept-invite/')({
  validateSearch: z.object({ token: z.string().min(1).max(512).optional().catch(undefined) }),
  beforeLoad: ({ search }) => {
    if (!search.token) throw notFound();
    throw redirect({ to: '/accept-invite/$token', params: { token: search.token }, replace: true });
  },
});
