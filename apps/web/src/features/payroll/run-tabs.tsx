import { type FieldError, type PayrollFlag, type PayrollRun, payrollFlagValues } from '@hrm/contracts';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  LoadingBlock,
  Pagination,
  Select,
  StatBar,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CheckCircle2, ListChecks, Scale, ScrollText, SlidersHorizontal, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useErrorMessage } from '../../lib/api/errors';
import { canAny, useCan, useMe } from '../../lib/auth/me';
import { formatDateTime, formatMonth, todayIso } from '../../lib/format';
import { payrollQueries } from './api';
import { BLOCKING_FLAGS, FLAG_LABEL, FlagBadges, flagMessage, Money, StatusLabel } from './components';
import type { RunPageSearch } from './search';

const ITEM_PAGE = 50;

function LoadError({ what, error, retry }: { what: string; error: unknown; retry: () => void }) {
  const message = useErrorMessage();
  return (
    <Alert
      tone="bad"
      action={
        <Button size="sm" variant="secondary" onClick={retry}>
          Try again
        </Button>
      }
    >
      We couldn't load {what}. {message(error)}
    </Alert>
  );
}

// Items ---------------------------------------------------------------------------------------------------------------

export function ItemsTab({
  run,
  search,
  onSearch,
}: {
  run: PayrollRun;
  search: RunPageSearch;
  onSearch: (s: Partial<RunPageSearch>) => void;
}) {
  const flag = payrollFlagValues.includes(search.flag as PayrollFlag)
    ? (search.flag as PayrollFlag)
    : undefined;
  const items = useQuery(payrollQueries.items(run.id, { page: search.page, pageSize: ITEM_PAGE, flag }));
  if (!run.totals && !flag) {
    return (
      <EmptyState
        icon={Users}
        title="No items yet"
        description="Items appear once the run is calculated: one per employee employed during the period."
      />
    );
  }
  return (
    <TableContainer
      toolbar={
        <Select
          aria-label="Filter by flag"
          className="w-64"
          value={flag ?? ''}
          onChange={(e) => onSearch({ flag: e.target.value || undefined, page: 1 })}
        >
          <option value="">All employees</option>
          {payrollFlagValues.map((f) => (
            <option key={f} value={f}>
              {FLAG_LABEL[f]}
            </option>
          ))}
        </Select>
      }
      footer={
        <p className="text-sm text-text-2">Amounts in BDT (৳). Select an employee to see line items.</p>
      }
    >
      {items.isPending ? (
        <div className="p-4">
          <LoadingBlock label="items" />
        </div>
      ) : items.isError ? (
        <div className="p-4">
          <LoadError what="items" error={items.error} retry={() => void items.refetch()} />
        </div>
      ) : !items.data.data.length ? (
        <EmptyState
          icon={Users}
          variant="no-results"
          title="No items match"
          description="Clear the flag filter to see every employee."
          className="border-0"
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>Employee</TH>
                <TH numeric>Days</TH>
                <TH numeric>Gross</TH>
                <TH numeric>Deductions</TH>
                <TH numeric>Net pay</TH>
                <TH>Flags</TH>
                <TH>Payment</TH>
              </tr>
            </THead>
            <TBody>
              {items.data.data.map((i) => (
                <TR key={i.id} className="cursor-pointer" onClick={() => onSearch({ item: i.id })}>
                  <TD>
                    <button
                      type="button"
                      className="cursor-pointer text-left hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSearch({ item: i.id });
                      }}
                    >
                      {i.employee.name}{' '}
                      <span className="font-mono text-sm text-text-2">{i.employee.employeeCode}</span>
                    </button>
                  </TD>
                  <TD numeric>
                    {i.daysEmployed} / {i.daysInPeriod}
                  </TD>
                  <TD numeric>
                    <Money amount={i.grossAmount.amount} />
                  </TD>
                  <TD numeric>
                    <Money amount={i.deductionAmount.amount} />
                  </TD>
                  <TD numeric>
                    <Money amount={i.netAmount.amount} className="font-semibold" />
                  </TD>
                  <TD>
                    <FlagBadges flags={i.validationFlags} />
                  </TD>
                  <TD>
                    <StatusLabel status={i.paymentStatus} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="border-t border-line px-4 py-2">
            <Pagination
              page={items.data.page.number}
              pageSize={items.data.page.size}
              totalItems={items.data.page.totalItems}
              onPage={(page) => onSearch({ page })}
            />
          </div>
        </>
      )}
    </TableContainer>
  );
}

// Validation ----------------------------------------------------------------------------------------------------------

/** BUSINESS-RULES 6.5; the blocking list comes from the 422 `errors[]` of the last submit (CONTENT-STYLE §6). */
export function ValidationTab({
  run,
  blocking,
  onSearch,
}: {
  run: PayrollRun;
  blocking: FieldError[];
  onSearch: (s: Partial<RunPageSearch>) => void;
}) {
  const canPrepare = useCan('payroll.prepare');
  const checkable = canPrepare && (run.status === 'calculated' || run.status === 'submitted');
  const checks = useQuery({ ...payrollQueries.validation(run.id, run.version), enabled: checkable });
  const summary = checks.data?.summary ?? run.validation;
  const nameOf = (itemId: string) =>
    checks.data?.items.find((i) => i.payrollItemId === itemId)?.employee.name ?? 'An employee';

  if (!summary || !run.totals) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No checks yet"
        description="Checks run automatically after calculation: missing salary structures, negative net pay, joiners, leavers and large changes."
      />
    );
  }
  const flagged = checks.data?.items ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatBar
          className="flex-1"
          stats={[
            { label: 'Blocking', value: summary.blockingItems },
            { label: 'Warnings', value: summary.warningItems },
          ]}
        />
        {checkable ? (
          <Button variant="secondary" loading={checks.isFetching} onClick={() => void checks.refetch()}>
            Run checks
          </Button>
        ) : null}
      </div>
      {blocking.length ? (
        <Alert tone="bad" title="Submit is blocked" assertive>
          <ul className="mt-1 list-disc pl-5">
            {blocking.map((e) => (
              <li key={`${e.path}-${e.code}`}>
                {flagMessage(e.code, nameOf(e.path.replace('/items/', '')))}
              </li>
            ))}
          </ul>
        </Alert>
      ) : summary.blockingItems > 0 ? (
        <Alert tone="bad">
          {summary.blockingItems} {summary.blockingItems === 1 ? 'employee has' : 'employees have'} blocking
          errors. Fix them and recalculate before submitting.
        </Alert>
      ) : (
        <Alert tone="ok">No blocking errors. Review the warnings before submitting.</Alert>
      )}
      {checks.isError ? (
        <LoadError what="validation results" error={checks.error} retry={() => void checks.refetch()} />
      ) : null}
      {flagged.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
          {flagged.map((i) =>
            i.flags.map((f) => (
              <li key={`${i.payrollItemId}-${f}`} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <Badge tone={BLOCKING_FLAGS.includes(f) ? 'bad' : 'warn'}>
                  {BLOCKING_FLAGS.includes(f) ? 'Blocking' : 'Warning'}
                </Badge>
                <p className="min-w-0 flex-1">{flagMessage(f, i.employee.name)}</p>
                <button
                  type="button"
                  className="cursor-pointer text-sm text-accent-text underline"
                  onClick={() => onSearch({ item: i.payrollItemId })}
                >
                  Open item
                </button>
              </li>
            )),
          )}
        </ul>
      ) : Object.keys(summary.byFlag).length ? (
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
          {Object.entries(summary.byFlag).map(([f, count]) => (
            <li key={f} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                {FLAG_LABEL[f as PayrollFlag] ?? f}: {count} {count === 1 ? 'employee' : 'employees'}
              </span>
              <button
                type="button"
                className="cursor-pointer text-sm text-accent-text underline"
                onClick={() => onSearch({ tab: 'items', flag: f, page: 1 })}
              >
                Show employees
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Adjustments ---------------------------------------------------------------------------------------------------------

export function AdjustmentsTab({ run }: { run: PayrollRun }) {
  const list = useQuery(payrollQueries.adjustments({ page: 1, pageSize: 100, periodId: run.period.id }));
  return (
    <TableContainer
      toolbar={
        <p className="flex-1 text-sm text-text-2">
          Approved adjustments for {formatMonth(run.period.year, run.period.month)} are included when the run
          is calculated. Approved transport claims are included automatically.
        </p>
      }
      footer={
        <Button variant="text" asChild>
          <Link to="/payroll/adjustments">Manage adjustments</Link>
        </Button>
      }
    >
      {list.isPending ? (
        <div className="p-4">
          <LoadingBlock label="adjustments" />
        </div>
      ) : list.isError ? (
        <div className="p-4">
          <LoadError what="adjustments" error={list.error} retry={() => void list.refetch()} />
        </div>
      ) : !list.data.data.length ? (
        <EmptyState
          icon={SlidersHorizontal}
          variant="no-results"
          title="No adjustments for this period"
          className="border-0"
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Employee</TH>
              <TH>Type</TH>
              <TH numeric>Amount</TH>
              <TH>Reason</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {list.data.data.map((a) => (
              <TR key={a.id}>
                <TD>
                  {a.employee.name}{' '}
                  <span className="font-mono text-sm text-text-2">{a.employee.employeeCode}</span>
                </TD>
                <TD className="capitalize">{a.lineCode}</TD>
                <TD numeric>
                  <Money amount={a.type === 'deduction' ? `-${a.amount.amount}` : a.amount.amount} />
                </TD>
                <TD className="max-w-xs truncate" title={a.reason}>
                  {a.reason}
                </TD>
                <TD>
                  <StatusLabel status={a.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </TableContainer>
  );
}

// Reconciliation ------------------------------------------------------------------------------------------------------

const EXCEPTION_LABEL: Record<string, string> = {
  unpaid: 'Unpaid',
  payment_failed: 'Payment failed',
  payment_cancelled: 'Payment cancelled',
};

export function ReconciliationTab({ run }: { run: PayrollRun }) {
  const rec = useQuery({ ...payrollQueries.reconciliation(run.id), enabled: Boolean(run.totals) });
  if (!run.totals) {
    return (
      <EmptyState
        icon={Scale}
        title="Nothing to reconcile yet"
        description="Reconciliation starts after payments."
      />
    );
  }
  if (rec.isPending) return <LoadingBlock label="reconciliation" />;
  if (rec.isError)
    return <LoadError what="reconciliation" error={rec.error} retry={() => void rec.refetch()} />;
  const d = rec.data;
  const exceptions = d.items.filter((i) => i.exceptions.length || i.outstanding.amount !== '0.00');
  return (
    <div className="flex flex-col gap-4">
      <StatBar
        stats={[
          {
            label: 'Net pay due',
            value: <Money amount={d.totals.net.amount} className="text-xl sm:text-2xl" />,
          },
          { label: 'Paid', value: <Money amount={d.totals.paid.amount} className="text-xl sm:text-2xl" /> },
          {
            label: 'Outstanding',
            value: <Money amount={d.totals.outstanding.amount} className="text-xl sm:text-2xl" />,
          },
        ]}
      />
      {d.balanced ? (
        <Alert tone="ok">Gross, deductions, net and payments match.</Alert>
      ) : (
        <Alert tone="warn">Payments don't match net pay yet. Check the highlighted employees.</Alert>
      )}
      {exceptions.length ? (
        <TableContainer>
          <Table>
            <THead>
              <tr>
                <TH>Employee</TH>
                <TH numeric>Net pay</TH>
                <TH numeric>Paid</TH>
                <TH numeric>Outstanding</TH>
                <TH>Exceptions</TH>
              </tr>
            </THead>
            <TBody>
              {exceptions.map((i) => (
                <TR key={i.payrollItemId}>
                  <TD>
                    {i.employee.name}{' '}
                    <span className="font-mono text-sm text-text-2">{i.employee.employeeCode}</span>
                  </TD>
                  <TD numeric>
                    <Money amount={i.net.amount} />
                  </TD>
                  <TD numeric>
                    <Money amount={i.paid.amount} />
                  </TD>
                  <TD numeric>
                    <Money amount={i.outstanding.amount} />
                  </TD>
                  <TD>
                    <span className="flex flex-wrap gap-1">
                      {i.exceptions.map((e) => (
                        <Badge key={e} tone={e === 'unpaid' ? 'warn' : 'bad'}>
                          {EXCEPTION_LABEL[e] ?? e}
                        </Badge>
                      ))}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      ) : (
        <p className="flex items-center gap-2 text-text-2">
          <CheckCircle2 className="size-4 text-ok" aria-hidden="true" />
          Every employee's payment matches their net pay.
        </p>
      )}
    </div>
  );
}

// History -------------------------------------------------------------------------------------------------------------

const ACTION_LABEL: Record<string, string> = {
  'payroll_run.created': 'Created',
  'payroll_run.calculated': 'Calculated',
  'payroll_run.submitted': 'Submitted for approval',
  'payroll_run.returned': 'Returned to draft',
  'payroll_run.approved': 'Approved',
  'payroll_run.locked': 'Locked',
  'payroll_run.paid': 'Marked as paid',
  'payroll_run.reconciled': 'Reconciled',
  'payslips.published': 'Payslips published',
};

/** Audit trail of the run (COMPONENT-SPECS §16); without an audit permission, the run's own timestamps. */
export function HistoryTab({ run }: { run: PayrollRun }) {
  const me = useMe();
  const canAudit = canAny(me, ['audit.read.payroll', 'audit.read.all']);
  const { t } = useTranslation();
  const to = todayIso();
  const start = run.createdAt.slice(0, 10);
  const oldest = new Date(Date.parse(`${to}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const from = start < oldest ? oldest : start;
  const audit = useQuery({ ...payrollQueries.history(run.id, from, to), enabled: canAudit });
  type Entry = { at: string; label: string; who?: string | null; note?: string | null | undefined };
  const entries: Entry[] = canAudit
    ? (audit.data?.data ?? []).map((e) => ({
        at: e.occurredAt,
        label: ACTION_LABEL[e.action] ?? e.action.replace(/^[a-z_]+\./, '').replaceAll('_', ' '),
        who: e.actorName,
        note: [e.metadata?.reason, e.metadata?.note, e.metadata?.comment].find(
          (v): v is string => typeof v === 'string' && v.length > 0,
        ),
      }))
    : (
        [
          ['createdAt', 'Created'],
          ['calculatedAt', 'Calculated'],
          ['submittedAt', 'Submitted for approval'],
          ['approvedAt', run.selfApproved ? 'Approved (self-approved)' : 'Approved'],
          ['lockedAt', 'Locked'],
          ['payslipsPublishedAt', 'Payslips published'],
        ] as const
      )
        .filter(([k]) => run[k])
        .map(([k, label]) => ({ at: run[k] as string, label }))
        .reverse();
  if (canAudit && audit.isPending) return <LoadingBlock label="history" />;
  if (canAudit && audit.isError)
    return <LoadError what="history" error={audit.error} retry={() => void audit.refetch()} />;
  if (!entries.length) return <EmptyState icon={ScrollText} variant="no-results" title="No history yet" />;
  return (
    <ol
      className="flex max-w-3xl flex-col gap-4"
      aria-label={`History, current status ${t(`status.${run.status}`)}`}
    >
      {entries.map((e, i) => (
        <li key={`${e.at}-${i}`} className="relative flex gap-3 pl-5">
          <span
            className={`absolute top-1.5 left-0 size-2 rounded-full ${i === 0 ? 'bg-accent' : 'bg-line-strong'}`}
            aria-hidden="true"
          />
          <div className="flex flex-col gap-1">
            <p>
              <span className="font-medium">{e.label}</span>
              {e.who ? <span className="text-text-2"> by {e.who}</span> : null}
            </p>
            <time dateTime={e.at} className="text-sm text-text-2">
              {formatDateTime(e.at)}
            </time>
            {e.note ? (
              <blockquote className="rounded-control bg-ground-2 px-3 py-2 text-[15px]">{e.note}</blockquote>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
