import type { EmployeeBasic, PayrollFlag, PayrollRun } from '@hrm/contracts';
import { Badge, cn, SearchInput, StatusBadge } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api, StepUpCancelledError } from '../../lib/api/client';
import { formatMoney, formatMonth } from '../../lib/format';
import type { Page } from './api';

/** Money in mono tabular figures (COMPONENT-SPECS §22); the amount stays a decimal string. */
export function Money({ amount, className }: { amount: string; className?: string }) {
  return (
    <span
      className={cn(
        'font-mono whitespace-nowrap tabular-nums',
        amount.startsWith('-') && 'text-bad',
        className,
      )}
    >
      {formatMoney(amount)}
    </span>
  );
}

export function StatusLabel({ status, label }: { status: string; label?: string }) {
  const { t, i18n } = useTranslation();
  const key = `status.${status}`;
  const text = label ?? (i18n.exists(key) ? t(key) : status.replaceAll('_', ' '));
  return <StatusBadge status={status} label={text} />;
}

export function SelfApprovedBadge() {
  return (
    <Badge tone="warn" icon={<ShieldAlert className="size-3" aria-hidden="true" />}>
      Self-approved
    </Badge>
  );
}

export const runTitle = (run: Pick<PayrollRun, 'period' | 'runType'>) =>
  `${formatMonth(run.period.year, run.period.month)} payroll${run.runType === 'off_cycle' ? ' (off-cycle)' : ''}`;

export const RUN_TYPE_LABEL = { regular: 'Regular', off_cycle: 'Off-cycle' } as const;

/** Flags that block `submit` (BUSINESS-RULES 6.5). */
export const BLOCKING_FLAGS: readonly PayrollFlag[] = [
  'no_salary_structure',
  'negative_net',
  'currency_mismatch',
];

export const FLAG_LABEL: Record<PayrollFlag, string> = {
  no_salary_structure: 'No salary structure',
  negative_net: 'Negative net',
  currency_mismatch: 'Currency mismatch',
  zero_net: 'Zero net',
  joiner: 'Joiner',
  leaver: 'Leaver',
  net_change_over_threshold: 'Net change over threshold',
  large_reimbursement: 'Large reimbursement',
};

/** One-line explanation per flag with the employee's name (CONTENT-STYLE §6). */
export function flagMessage(flag: string, name: string): string {
  switch (flag) {
    case 'no_salary_structure':
      return `${name} has no approved salary structure for this period. Add one, then recalculate.`;
    case 'negative_net':
      return `${name}'s net pay is below zero. Check their deductions and adjustments.`;
    case 'currency_mismatch':
      return `${name} has an amount that isn't in BDT. Correct it, then recalculate.`;
    case 'zero_net':
      return `${name}'s net pay is zero.`;
    case 'joiner':
      return `${name} joined during this period and is paid for the days employed.`;
    case 'leaver':
      return `${name} leaves during this period and is paid for the days employed.`;
    case 'net_change_over_threshold':
      return `${name}'s net pay changed more than the warning threshold since last month. Review before submitting.`;
    case 'large_reimbursement':
      return `${name} has a large reimbursement in this run. Review before submitting.`;
    default:
      return `${name}: ${flag.replaceAll('_', ' ')}.`;
  }
}

export function FlagBadges({ flags }: { flags: readonly PayrollFlag[] }) {
  if (!flags.length) return <span className="text-text-3">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} tone={BLOCKING_FLAGS.includes(f) ? 'bad' : 'warn'}>
          {FLAG_LABEL[f]}
        </Badge>
      ))}
    </span>
  );
}

/** The user closed the step-up dialog: nothing changed, so no message (ARCHITECTURE §3). */
export const isStepUpCancel = (err: unknown) => err instanceof StepUpCancelledError;
export const errorCode = (err: unknown) => (err instanceof ApiError ? err.code : null);

/** Small employee search (no shared picker exists yet): `GET /employees?q=`, at least 2 characters. */
export function EmployeePicker({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  ariaLabel,
}: {
  id: string;
  /** When the picker has no visible label (a toolbar filter). */
  ariaLabel?: string;
  value: { id: string; name: string; employeeCode: string } | null;
  onChange: (v: { id: string; name: string; employeeCode: string } | null) => void;
  invalid?: boolean;
  describedBy?: string | undefined;
}) {
  const [q, setQ] = useState('');
  const listId = useId();
  const term = q.trim();
  const results = useQuery({
    queryKey: ['employees', 'picker', term],
    queryFn: () =>
      api.get<Page<EmployeeBasic>>('/employees', {
        query: { q: term, pageSize: 8, status: 'active,probation,notice_period,preboarding' },
      }),
    enabled: term.length >= 2,
  });
  if (value) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-control border border-control-border bg-ground-2 px-3">
        <span id={id} className="truncate">
          {value.name} <span className="font-mono text-sm text-text-2">{value.employeeCode}</span>
        </span>
        <button
          type="button"
          className="cursor-pointer text-sm text-accent-text underline"
          onClick={() => onChange(null)}
        >
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <SearchInput
        id={id}
        value={q}
        placeholder="Search by name or code"
        aria-invalid={invalid ?? false}
        aria-describedby={describedBy}
        aria-controls={term.length >= 2 ? listId : undefined}
        {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
        autoComplete="off"
        onChange={(e) => setQ(e.target.value)}
        onClear={() => setQ('')}
      />
      {term.length >= 2 ? (
        <ul id={listId} className="flex max-h-56 flex-col overflow-y-auto rounded-control border border-line">
          {results.data?.data.length ? (
            results.data.data.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left hover:bg-ground-2"
                  onClick={() => {
                    onChange({ id: e.id, name: e.displayName, employeeCode: e.employeeCode });
                    setQ('');
                  }}
                >
                  <span className="truncate">{e.displayName}</span>
                  <span className="font-mono text-sm text-text-2">{e.employeeCode}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-text-2">
              {results.isPending ? 'Searching…' : 'No employees match.'}
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
