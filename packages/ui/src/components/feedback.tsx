import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { DotGrid, Glow } from './brand';

/** Empty state (COMPONENT-SPECS §13): a brand moment for first use; quiet (no dot grid) for no results. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'first-use',
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  variant?: 'first-use' | 'no-results';
  className?: string;
}) {
  const brand = variant === 'first-use';
  return (
    <div className={cn('bm-stage rounded-card border border-line bg-surface', className)}>
      {brand ? (
        <>
          <Glow />
          <DotGrid />
        </>
      ) : null}
      <div className="bm-stage-content flex flex-col items-center gap-3 px-6 py-12 text-center">
        <Icon className="size-10 text-text-2" strokeWidth={1.5} aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {description ? <p className="max-w-md text-text-2">{description}</p> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

/** Skeleton block (§14); the container carries aria-busy and a hidden label. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-control bg-ground-2', className)} aria-hidden="true" />;
}

export function LoadingBlock({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}
