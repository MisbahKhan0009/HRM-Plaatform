import { createFileRoute, redirect } from '@tanstack/react-router';

// The dashboard arrives with authentication in Stage 8; until then the start page is sign-in.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/sign-in' });
  },
});
