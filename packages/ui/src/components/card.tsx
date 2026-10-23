import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

// COMPONENT-SPECS §11: surface, 1px line, radius lg, no shadows.
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('rounded-card border border-line bg-surface p-4 sm:p-6', className)} {...props} />
  );
}

export function CardHeader({
  label,
  title,
  actions,
  id,
}: {
  label?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        {label ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.13em] text-text-3">{label}</p>
        ) : null}
        <h2 id={id} className="font-display text-[17px] font-semibold text-text">
          {title}
        </h2>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export interface Stat {
  label: string;
  value: ReactNode;
}

/** Brand StatBar adapted for the app: 2 to 4 equal cells with an accent tick (§11). */
export function StatBar({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 overflow-hidden rounded-card border border-line-strong sm:flex',
        className,
      )}
    >
      {stats.map((s) => (
        <div
          key={s.label}
          className="relative flex min-w-0 flex-1 flex-col gap-1 border-line-strong p-4 not-last:border-r max-sm:border-b"
        >
          <span className="absolute top-0 left-4 h-0.5 w-5 bg-accent" aria-hidden="true" />
          <dt className="order-2 text-xs text-text-3">{s.label}</dt>
          <dd className="order-1 font-mono text-[28px] leading-tight tabular-nums text-text">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function KeyValueList({
  items,
  className,
}: {
  items: { label: ReactNode; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(140px,max-content)_1fr]', className)}>
      {items.map((item, i) => (
        <div key={i} className="contents">
          <dt className="font-mono text-[11px] uppercase tracking-[0.13em] text-text-3 sm:pt-0.5">
            {item.label}
          </dt>
          <dd className="min-w-0 text-[15px] text-text">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
