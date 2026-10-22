import { cn } from '../cn';

// Brand signature elements (COMPONENT-SPECS §23); only on brand moments (APP-UI-ADAPTATION §2).
export function DotGrid({ className }: { className?: string }) {
  return <div className={cn('bm-dotgrid', className)} aria-hidden="true" />;
}

export function Glow({ second = true, className }: { second?: boolean; className?: string }) {
  return <div className={cn('bm-glow', second && 'bm-glow-2', className)} aria-hidden="true" />;
}

export function Eyebrow({ children, className }: { children: string; className?: string }) {
  return (
    <p className={cn('font-mono text-xs uppercase tracking-[0.13em] text-text-3', className)}>{children}</p>
  );
}

/** Company lockup for the theme; never recoloured. */
export function Logo({ theme, className }: { theme: 'ink' | 'paper'; className?: string }) {
  return (
    <img
      src={theme === 'paper' ? '/logo-paper.png' : '/logo-ink.png'}
      alt="Big-Matrix Solutions"
      className={cn('h-8 w-auto min-w-[120px]', className)}
    />
  );
}
