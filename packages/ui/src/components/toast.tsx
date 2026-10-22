import { Toaster as Sonner, toast } from 'sonner';

/** Toasts (COMPONENT-SPECS §21): bottom-right on desktop, top on mobile; errors stay until dismissed. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      visibleToasts={3}
      toastOptions={{
        className: '!rounded-card !border !border-line-strong !bg-surface !text-text !font-sans',
      }}
    />
  );
}

export const notify = {
  success: (message: string) => toast.success(message, { duration: 4000 }),
  info: (message: string) => toast(message, { duration: 6000 }),
  error: (message: string) => toast.error(message, { duration: Number.POSITIVE_INFINITY, closeButton: true }),
};
