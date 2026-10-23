import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../cn';
import { Button } from './button';
import { Select } from './field';

// COMPONENT-SPECS §7, TABLES-AND-LISTS.md: scrolls inside its container, never the page.
export function TableContainer({
  toolbar,
  footer,
  children,
  className,
}: {
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        {/* `relative` keeps absolutely positioned content (sr-only labels) inside the scroll area, so it can't widen
            the page; the scroll area is focusable so keyboard users can scroll it (WCAG 2.1.1). */}
        <div
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
          tabIndex={0}
          className="relative overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
        >
          {children}
        </div>
      </div>
      {footer}
    </div>
  );
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-[15px]', className)} {...props} />;
}

export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-ground-2" {...props} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('border-b border-line last:border-b-0 hover:bg-ground-2/60', className)} {...props} />
  );
}

export function TH({
  className,
  numeric,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-10 px-4 text-left font-mono text-[11px] font-medium uppercase tracking-[0.13em] whitespace-nowrap text-text-3',
        numeric && 'text-right',
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  numeric,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn('h-11 px-4 align-middle', numeric && 'text-right font-mono tabular-nums', className)}
      {...props}
    />
  );
}

/** Sortable header button with aria-sort on the cell (§7). */
export function SortHeader({
  label,
  direction,
  onSort,
  numeric,
}: {
  label: string;
  direction: 'asc' | 'desc' | null;
  onSort: () => void;
  numeric?: boolean;
}) {
  const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <TH
      numeric={numeric ?? false}
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
    >
      <button
        type="button"
        onClick={onSort}
        className="inline-flex cursor-pointer items-center gap-1 uppercase hover:text-text"
      >
        {label}
        <Icon className="size-3.5" aria-hidden="true" />
      </button>
    </TH>
  );
}

/** Pagination (§9): range text, page size, previous/next. */
export function Pagination({
  page,
  pageSize,
  totalItems,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  onPage: (p: number) => void;
  onPageSize?: (s: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-2"
    >
      <span className="font-mono tabular-nums">
        {from} to {to} of {totalItems}
      </span>
      <div className="flex items-center gap-2">
        {onPageSize ? (
          <Select
            aria-label="Rows per page"
            className="h-8 w-20 text-sm"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        ) : null}
        <Button
          variant="icon"
          size="icon-sm"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          variant="icon"
          size="icon-sm"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
