import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';

const TONE = {
  info: { className: 'bg-accent-tint', Icon: Info },
  ok: { className: 'bg-ok-tint', Icon: CheckCircle2 },
  warn: { className: 'bg-warn-tint', Icon: AlertTriangle },
  bad: { className: 'bg-bad-tint', Icon: AlertCircle },
} as const;

/** Inline alert (COMPONENT-SPECS §21): tone fill, icon, text in `text`. `role="alert"` only for errors after an action. */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
  assertive = false,
  className,
}: {
  tone?: keyof typeof TONE;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  assertive?: boolean;
  className?: string;
}) {
  const { className: fill, Icon } = TONE[tone];
  const iconColor = { info: 'text-accent-text', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' }[tone];
  return (
    <div
      role={assertive ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-card px-4 py-3 text-[15px] text-text', fill, className)}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', iconColor)} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
