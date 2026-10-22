import { cn } from '@hrm/ui';
import { ChevronDown, Loader2, X } from 'lucide-react';
import { type KeyboardEvent, useId, useRef, useState } from 'react';

export type ComboboxOption = { value: string; label: string; hint?: string | undefined };

export type ComboboxProps = {
  id?: string | undefined;
  name?: string | undefined;
  'aria-label'?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean | undefined;
  /** Label of the selected option, shown when the list is closed. */
  selectedLabel: string;
  hasValue: boolean;
  options: ComboboxOption[];
  /** Text typed by the user; the parent filters `options` (locally or through the API). */
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (option: ComboboxOption | null) => void;
  onBlur?: (() => void) | undefined;
  loading?: boolean | undefined;
  placeholder?: string | undefined;
  /** Shown in the list when there is nothing to pick. */
  emptyText: string;
  className?: string | undefined;
  disabled?: boolean | undefined;
};

const popup =
  'absolute top-full right-0 left-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-card border border-line-strong bg-surface p-1 text-text';

const control =
  'h-10 w-full rounded-control border border-control-border bg-ground-2 pr-16 pl-3 text-[15px] text-text placeholder:text-text-3 transition-colors hover:border-text-2 disabled:bg-ground disabled:text-text-3 aria-[invalid=true]:border-bad';

/**
 * Searchable single-select (WAI-ARIA combobox with a listbox popup). Arrow keys move, Enter picks, Escape closes;
 * the clear button resets the value. Options come from the parent so the same control serves local lists
 * (departments, positions) and API search (employees).
 */
export function Combobox({
  id,
  name,
  selectedLabel,
  hasValue,
  options,
  query,
  onQueryChange,
  onSelect,
  onBlur,
  loading,
  placeholder,
  emptyText,
  className,
  disabled,
  ...aria
}: ComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const pick = (o: ComboboxOption | null) => {
    onSelect(o);
    onQueryChange('');
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && options[active]) {
        e.preventDefault();
        pick(options[active] ?? null);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        onQueryChange('');
      }
    }
  };

  const activeId = open && options[active] ? `${listId}-${active}` : undefined;
  return (
    <div className={cn('relative', className)}>
      <input
        ref={input}
        id={id}
        name={name}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        disabled={disabled}
        className={control}
        placeholder={hasValue ? selectedLabel : placeholder}
        value={open ? query : hasValue ? selectedLabel : ''}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          // Let a click on an option land before closing.
          window.setTimeout(() => {
            setOpen(false);
            onQueryChange('');
          }, 120);
          onBlur?.();
        }}
        onKeyDown={onKeyDown}
      />
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-0.5 text-text-2">
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {hasValue && !disabled ? (
          <button
            type="button"
            aria-label="Clear selection"
            className="grid size-6 cursor-pointer place-items-center rounded-control hover:bg-ground"
            onClick={() => {
              pick(null);
              input.current?.focus();
            }}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        <ChevronDown className="size-4" aria-hidden="true" />
      </div>
      {open && options.length ? (
        <div id={listId} role="listbox" aria-label={aria['aria-label'] ?? 'Options'} className={popup}>
          {options.map((o, i) => (
            // Keyboard is handled on the input through aria-activedescendant (WAI-ARIA combobox pattern).
            // biome-ignore lint/a11y/useKeyWithClickEvents: options are never focused; the input owns the keys
            <div
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              className={cn(
                'flex cursor-pointer flex-col rounded-control px-3 py-2 text-[15px]',
                i === active && 'bg-ground-2',
              )}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
            >
              <span>{o.label}</span>
              {o.hint ? <span className="text-sm text-text-2">{o.hint}</span> : null}
            </div>
          ))}
        </div>
      ) : open ? (
        <div id={listId} role="status" className={cn(popup, 'px-4 py-2 text-sm text-text-2')}>
          {emptyText}
        </div>
      ) : null}
    </div>
  );
}
