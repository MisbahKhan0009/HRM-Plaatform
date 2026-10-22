import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

/**
 * Page header (COMPONENT-SPECS §17): breadcrumb, h1, human code, status badge, actions (primary rightmost).
 * Focus moves to the h1 after navigation and the document title follows it (ACCESSIBILITY §5).
 */
export function PageHeader({
  title,
  breadcrumb,
  code,
  status,
  actions,
  description,
}: {
  title: string;
  breadcrumb?: { label: string; to: string };
  code?: string;
  status?: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
}) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · Big-Matrix HRM`;
    h1.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <header className="mb-6 flex flex-col gap-3">
      {breadcrumb ? (
        <Link
          to={breadcrumb.to}
          className="inline-flex w-fit items-center gap-1 text-sm text-text-2 hover:text-text"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {breadcrumb.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1
              ref={h1}
              tabIndex={-1}
              className="font-display text-[28px] leading-tight font-semibold tracking-tight outline-none sm:text-[32px]"
            >
              {title}
            </h1>
            {code ? <span className="font-mono text-text-2">{code}</span> : null}
            {status}
          </div>
          {description ? <p className="max-w-3xl text-text-2">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
