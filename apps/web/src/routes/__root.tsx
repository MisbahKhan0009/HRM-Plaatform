import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  notFoundComponent: NotFound,
});

function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="bm-stage grid min-h-screen place-items-center p-8">
      <div className="bm-stage-content flex max-w-xl flex-col gap-4">
        <p className="font-mono text-xs uppercase tracking-[0.13em] text-text-3">Error 404</p>
        <h1 className="font-display text-5xl font-semibold tracking-tight">This page isn't here</h1>
        <p className="text-text-2">{t('errors.NOT_FOUND')}</p>
        <Link to="/" className="text-link underline">
          Go to the start
        </Link>
      </div>
    </main>
  );
}
