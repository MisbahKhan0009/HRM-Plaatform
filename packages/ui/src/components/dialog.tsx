import { X } from 'lucide-react';
import { AlertDialog as AD, Dialog as D } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { cn } from '../cn';
import { Button } from './button';
import { Input } from './field';

// COMPONENT-SPECS §12: surface, line-strong border, radius lg, ink backdrop at 60 % in both themes.
const overlay = 'fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--bm-ink)_60%,transparent)]';
const panel =
  'fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-card border border-line-strong bg-surface p-6 text-text';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Dialog({ open, onOpenChange, title, description, children, footer, wide }: DialogProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content
          className={cn(panel, wide ? 'max-w-[640px]' : 'max-w-[480px]')}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-4">
            <D.Title className="font-display text-xl font-semibold">{title}</D.Title>
            <D.Close asChild>
              <Button variant="icon" size="icon-sm" aria-label="Close">
                <X aria-hidden="true" />
              </Button>
            </D.Close>
          </div>
          {description ? <D.Description className="text-text-2">{description}</D.Description> : null}
          {children}
          {footer ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
          ) : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** The consequence in plain words. */
  description: ReactNode;
  /** Verb label, for example "Reject request". */
  confirmLabel: string;
  cancelLabel?: string;
  /** destructive for deletes/rejections, primary for financial confirmations (§12). */
  tone?: 'destructive' | 'primary';
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  /** Level 3: summary block (StatBar or key-value list). */
  summary?: ReactNode;
  /** Level 4: the user must type this exact text before confirming. */
  typeToConfirm?: string;
  children?: ReactNode;
}

/** Confirmation levels 2 to 4 (COMPONENT-SPECS §12). Focus starts on the least destructive button. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'destructive',
  onConfirm,
  loading,
  summary,
  typeToConfirm,
  children,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const blocked = typeToConfirm !== undefined && typed !== typeToConfirm;
  return (
    <AD.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped('');
        onOpenChange(o);
      }}
    >
      <AD.Portal>
        <AD.Overlay className={overlay} />
        <AD.Content className={cn(panel, 'max-w-[480px]')}>
          <AD.Title className="font-display text-xl font-semibold">{title}</AD.Title>
          <AD.Description className="text-text-2">{description}</AD.Description>
          {summary}
          {children}
          {typeToConfirm !== undefined ? (
            <div className="flex flex-col gap-1.5 text-sm font-medium">
              <label htmlFor="type-to-confirm">
                Type <span className="font-mono">{typeToConfirm}</span> to confirm
              </label>
              <Input
                id="type-to-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
              />
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AD.Cancel asChild>
              <Button variant="secondary">{cancelLabel}</Button>
            </AD.Cancel>
            <Button
              variant={tone}
              loading={loading ?? false}
              disabled={blocked}
              onClick={(e) => {
                e.preventDefault();
                void onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}

/** Side sheet (navigation drawer on small screens, forms on mobile). */
export function Sheet({
  open,
  onOpenChange,
  title,
  side = 'left',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  side?: 'left' | 'right';
  children: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content
          aria-describedby={undefined}
          className={cn(
            'fixed inset-y-0 z-50 flex w-[min(320px,85vw)] flex-col overflow-y-auto border-line-strong bg-ground text-text',
            side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
          )}
        >
          <D.Title className="sr-only">{title}</D.Title>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
