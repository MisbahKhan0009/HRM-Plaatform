import { type FocusEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '../cn';

/**
 * Visual label for an icon control (COMPONENT-SPECS §11). The control keeps its own `aria-label`, so the tooltip is
 * hidden from assistive technology. Shows on hover after 300 ms and on keyboard focus; Escape dismisses it
 * (WCAG 1.4.13). Deliberately small: no positioning engine, it sits below the control.
 */
export function Tooltip({
  content,
  children,
  align = 'center',
}: {
  content: ReactNode;
  children: ReactNode;
  align?: 'center' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: tracks hover and focus of the wrapped control; not itself interactive
    <span
      className="relative inline-flex"
      onPointerEnter={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setOpen(true), 300);
      }}
      onPointerLeave={hide}
      onFocus={(e: FocusEvent<HTMLSpanElement>) => {
        if (e.target.matches(':focus-visible')) setOpen(true);
      }}
      onBlur={hide}
      onPointerDown={hide}
    >
      {children}
      {open ? (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-full z-50 mt-1.5 whitespace-nowrap rounded-control border border-line-strong bg-surface px-2 py-1 text-sm text-text',
            align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2',
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
