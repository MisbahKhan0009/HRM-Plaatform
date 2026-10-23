import { lazy, Suspense } from 'react';

// Sonner loads after first render instead of with the main bundle (PB-06). Toasts only follow user actions, by
// which time the Toaster is mounted.
type SonnerModule = typeof import('sonner');
let sonner: SonnerModule | undefined;
const loadSonner = () =>
  import('sonner').then((m) => {
    sonner = m;
    return m;
  });
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

/** Shows the toast at once when Sonner is loaded (always the case after first render), else as soon as it is. */
function show(fn: (m: SonnerModule) => void) {
  if (sonner) fn(sonner);
  else void loadSonner().then(fn);
}

export const notify = {
  success: (message: string) => show(({ toast }) => toast.success(message, { duration: 4000 })),
  info: (message: string) => show(({ toast }) => toast(message, { duration: 6000 })),
  error: (message: string) =>
    show(({ toast }) => toast.error(message, { duration: Number.POSITIVE_INFINITY, closeButton: true })),
};
