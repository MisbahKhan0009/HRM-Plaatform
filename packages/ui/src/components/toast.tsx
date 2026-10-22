import { lazy, Suspense } from 'react';

// Sonner loads after first render instead of with the main bundle (PB-06). Toasts only follow user actions, by
// which time the Toaster is mounted.
const loadSonner = () => import('sonner');
const Sonner = lazy(() => loadSonner().then((m) => ({ default: m.Toaster })));

/** Toasts (COMPONENT-SPECS §21): bottom-right on desktop, top on mobile; errors stay until dismissed. */
export function Toaster() {
  return (
    <Suspense fallback={null}>
      <Sonner
        position="bottom-right"
        visibleToasts={3}
        toastOptions={{
          className: '!rounded-card !border !border-line-strong !bg-surface !text-text !font-sans',
        }}
      />
    </Suspense>
  );
}

export const notify = {
  success: (message: string) =>
    void loadSonner().then(({ toast }) => toast.success(message, { duration: 4000 })),
  info: (message: string) => void loadSonner().then(({ toast }) => toast(message, { duration: 6000 })),
  error: (message: string) =>
    void loadSonner().then(({ toast }) =>
      toast.error(message, { duration: Number.POSITIVE_INFINITY, closeButton: true }),
    ),
};
