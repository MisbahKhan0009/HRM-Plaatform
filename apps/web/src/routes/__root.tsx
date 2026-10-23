import { Button, Eyebrow, Toaster } from '@hrm/ui';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, type ErrorComponentProps, Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StepUpDialog } from '../components/step-up-dialog';
import { ApiError } from '../lib/api/client';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
  notFoundComponent: NotFound,
  errorComponent: ErrorPage,
});

function Root() {
  return (
    <>
      <Outlet />
      <StepUpDialog />
      <Toaster />
    </>
  );
}

/** 404: a brand moment; the same page for records outside the user's scope (INFORMATION-ARCHITECTURE §1). */
export function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="bm-stage grid min-h-[70vh] place-items-center bg-ground p-8 text-text">
      <div className="bm-glow" aria-hidden="true" />
      <div className="bm-dotgrid" aria-hidden="true" />
      <div className="bm-stage-content flex max-w-xl flex-col gap-4">
        <Eyebrow>{t('notFound.eyebrow')}</Eyebrow>
        <h1 className="font-display text-5xl font-semibold tracking-tight">{t('notFound.title')}</h1>
        <p className="text-text-2">{t('errors.NOT_FOUND')}</p>
        <Button variant="secondary" asChild className="w-fit">
          <Link to="/dashboard">{t('notFound.action')} →</Link>
        </Button>
      </div>
    </main>
  );
}

function ErrorPage({ error }: ErrorComponentProps) {
  const { t } = useTranslation();
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <main className="bm-stage grid min-h-[70vh] place-items-center bg-ground p-8 text-text">
      <div className="bm-glow" aria-hidden="true" />
      <div className="bm-dotgrid" aria-hidden="true" />
      <div className="bm-stage-content flex max-w-xl flex-col gap-4">
        <Eyebrow>{t('errorPage.eyebrow')}</Eyebrow>
        <h1 className="font-display text-4xl font-semibold tracking-tight">{t('errorPage.title')}</h1>
        <p className="text-text-2">{t('errorPage.lede')}</p>
        {requestId ? (
          <p className="font-mono text-sm text-text-2">{t('common.requestId', { id: requestId })}</p>
        ) : null}
        <Button variant="primary" className="w-fit" onClick={() => window.location.reload()}>
          {t('common.reload')}
        </Button>
      </div>
    </main>
  );
}
