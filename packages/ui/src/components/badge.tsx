import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';

export type Tone = 'neutral' | 'warn' | 'ok' | 'bad' | 'info' | 'locked';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ground-2 text-text-2',
  warn: 'bg-warn-tint text-warn',
  ok: 'bg-ok-tint text-ok',
  bad: 'bg-bad-tint text-bad',
  info: 'bg-accent-tint text-accent-text',
  locked: 'bg-ground-2 text-text',
};

// COMPONENT-SPECS §10: status → tone. Text is always present (NFR-UX-003).
const STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  invited: 'neutral',
  not_employed: 'neutral',
  weekend: 'neutral',
  withdrawn: 'neutral',
  cancelled: 'neutral',
  skipped: 'neutral',
  pending: 'warn',
  submitted: 'warn',
  cancellation_pending: 'warn',
  calculated: 'warn',
  returned: 'warn',
  preboarding: 'warn',
  probation: 'warn',
  notice_period: 'warn',
  missing_punch: 'warn',
  short_hours: 'warn',
  missed_core: 'warn',
  unpaid: 'warn',
  processing: 'warn',
  open: 'warn',
  approved: 'ok',
  active: 'ok',
  present: 'ok',
  paid: 'ok',
  reconciled: 'ok',
  included: 'ok',
  applied: 'ok',
  sent: 'ok',
  succeeded: 'ok',
  rejected: 'bad',
  failed: 'bad',
  dead: 'bad',
  absent: 'bad',
  separated: 'bad',
  suspended: 'bad',
  deactivated: 'bad',
  on_leave: 'info',
  holiday: 'info',
  locked: 'locked',
  archived: 'locked',
};

export const toneFor = (status: string): Tone => STATUS_TONE[status] ?? 'neutral';

export function Badge({
  tone = 'neutral',
  children,
  className,
  icon,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-pill px-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {tone === 'locked' ? (
        <Lock className="size-3" aria-hidden="true" />
      ) : (
        (icon ?? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />)
      )}
      {children}
    </span>
  );
}

/** A status badge whose tone follows the status value; `label` is the translated text. */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label: string;
  className?: string;
}) {
  return (
    <Badge tone={toneFor(status)} {...(className ? { className } : {})}>
      {label}
    </Badge>
  );
}
