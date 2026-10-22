import { AlertCircle, Search, X } from 'lucide-react';
import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { cn } from '../cn';

// COMPONENT-SPECS §3: label above, control, hint, error (icon + text, never colour alone).
const control =
  'w-full rounded-control border border-control-border bg-ground-2 px-3 text-[15px] text-text placeholder:text-text-3 transition-colors hover:border-text-2 disabled:bg-ground disabled:text-text-3 aria-[invalid=true]:border-bad';

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  optional?: boolean;
  /** Render function receiving the ids to wire into the control. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

export function Field({ label, hint, error, optional, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
        {optional ? <span className="font-normal text-text-2"> (optional)</span> : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p id={hintId} className="text-sm text-text-2">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-bad">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, 'h-10', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-24 py-2.5', className)} {...props} />;
}

/** Native select styled like an input: accessible on every device without a custom listbox (§4, ≤ 10 options). */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        control,
        'h-10 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/** Six-digit one-time code: one field, numeric keyboard, OTP autofill (§3 CodeInput). */
export function CodeInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      className={cn(control, 'h-12 text-center font-mono text-2xl tracking-[0.5em]', className)}
      {...props}
    />
  );
}

/** Money input: ৳ prefix, mono, right-aligned; the value stays a decimal string (§3 MoneyInput, ADR-0006). */
export function MoneyInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-text-2"
        aria-hidden="true"
      >
        ৳
      </span>
      <input
        inputMode="decimal"
        className={cn(control, 'h-10 pl-8 text-right font-mono tabular-nums', className)}
        {...props}
      />
    </div>
  );
}

export function SearchInput({
  className,
  onClear,
  value,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { onClear?: () => void }) {
  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-3"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        className={cn(control, 'h-10 pr-9 pl-9 [&::-webkit-search-cancel-button]:appearance-none')}
        {...props}
      />
      {value && onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-control text-text-2 hover:bg-ground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function Checkbox({
  className,
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-[15px]', className)}>
      <input
        type="checkbox"
        className="size-4 rounded border-control-border accent-[var(--action)]"
        {...props}
      />
      {label}
    </label>
  );
}
