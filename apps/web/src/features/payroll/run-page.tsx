import type { FieldError, PayrollRun, PayrollRunStatus } from '@hrm/contracts';
import { Alert, cn, StatBar, TabPanel, Tabs } from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/page-header';
import { formatDateRange, formatDateTime } from '../../lib/format';
import { payrollQueries } from './api';
import { Money, RUN_TYPE_LABEL, runTitle, SelfApprovedBadge, StatusLabel } from './components';
import { ItemDrawer } from './item-drawer';
import { RunActions } from './run-actions';
import { PaymentsTab } from './run-payments';
import { AdjustmentsTab, HistoryTab, ItemsTab, ReconciliationTab, ValidationTab } from './run-tabs';
import type { RunPageSearch, RunTab } from './search';

const STEPS: PayrollRunStatus[] = [
  'draft',
  'calculated',
  'submitted',
  'approved',
  'locked',
  'paid',
  'reconciled',
];
const LOCKED: PayrollRunStatus[] = ['locked', 'paid', 'reconciled'];

/** Status stepper from the PayrollRun artboard: done, current, upcoming. */
function Stepper({ status }: { status: PayrollRunStatus }) {
  const { t } = useTranslation();
  const current = STEPS.indexOf(status === 'returned' ? 'draft' : status);
  return (
    <ol aria-label="Run progress" className="flex flex-wrap gap-x-1 gap-y-2 text-sm">
      {STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5 rounded-pill border px-2.5 py-1',
            i < current && 'border-line text-text-2',
            i === current && 'border-accent bg-accent-tint text-text',
            i > current && 'border-line text-text-3',
          )}
        >
          {i < current ? <Check className="size-3.5" aria-hidden="true" /> : null}
          {t(`status.${s}`)}
          {i < current ? <span className="sr-only"> (done)</span> : null}
        </li>
      ))}
    </ol>
  );
}

// SCREEN-INVENTORY 9.2: header, totals, next step, tabs.
export function PayrollRunPage({
  runId,
  search,
  onSearch,
}: {
  runId: string;
  search: RunPageSearch;
  onSearch: (s: Partial<RunPageSearch>) => void;
}) {
  const { data: run } = useSuspenseQuery(payrollQueries.run(runId));
  const [actionError, setActionError] = useState<ReactNode | null>(null);
  const [blocking, setBlocking] = useState<FieldError[]>([]);
  const tabs: { value: RunTab; label: ReactNode }[] = [
    { value: 'items', label: <TabLabel text="Items" count={run.employeeCount} /> },
    {
      value: 'validation',
      label: (
        <TabLabel
          text="Validation"
          count={run.validation ? run.validation.blockingItems + run.validation.warningItems : null}
        />
      ),
    },
    { value: 'adjustments', label: 'Adjustments' },
    { value: 'payments', label: 'Payments' },
    { value: 'reconciliation', label: 'Reconciliation' },
    { value: 'history', label: 'History' },
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={runTitle(run)}
        breadcrumb={{ label: 'Payroll runs', to: '/payroll' }}
        code={run.runNumber}
        status={
          <>
            <StatusLabel status={run.status} />
            {run.selfApproved ? <SelfApprovedBadge /> : null}
          </>
        }
        description={
          <>
            {RUN_TYPE_LABEL[run.runType]} run · {formatDateRange(run.period.startDate, run.period.endDate)}
            {run.calculatedAt ? <> · Calculated {formatDateTime(run.calculatedAt)}</> : null}
          </>
        }
        actions={
          <RunActions
            run={run}
            onError={setActionError}
            onBlocking={setBlocking}
            onTab={(tab) => onSearch({ tab: tab as RunTab })}
          />
        }
      />
      <Stepper status={run.status} />
      {actionError ? (
        <Alert tone="bad" assertive>
          {actionError}
        </Alert>
      ) : null}
      <RunNotices run={run} />
      {run.totals ? (
        <StatBar
          stats={[
            { label: 'Employees', value: run.employeeCount ?? 0 },
            {
              label: 'Gross',
              value: <Money amount={run.totals.gross.amount} className="text-xl sm:text-2xl" />,
            },
            {
              label: 'Deductions',
              value: <Money amount={run.totals.deductions.amount} className="text-xl sm:text-2xl" />,
            },
            {
              label: 'Net pay',
              value: <Money amount={run.totals.net.amount} className="text-xl sm:text-2xl" />,
            },
          ]}
        />
      ) : (
        <Alert tone="info">
          Calculate the run to build items and totals from approved salary structures.
        </Alert>
      )}
      <Tabs value={search.tab} onValueChange={(v) => onSearch({ tab: v as RunTab, page: 1 })} tabs={tabs}>
        <TabPanel value="items">
          <ItemsTab run={run} search={search} onSearch={onSearch} />
        </TabPanel>
        <TabPanel value="validation">
          <ValidationTab run={run} blocking={blocking} onSearch={onSearch} />
        </TabPanel>
        <TabPanel value="adjustments">
          <AdjustmentsTab run={run} />
        </TabPanel>
        <TabPanel value="payments">
          <PaymentsTab run={run} />
        </TabPanel>
        <TabPanel value="reconciliation">
          <ReconciliationTab run={run} />
        </TabPanel>
        <TabPanel value="history">
          <HistoryTab run={run} />
        </TabPanel>
      </Tabs>
      {search.item ? (
        <ItemDrawer runId={run.id} itemId={search.item} onClose={() => onSearch({ item: undefined })} />
      ) : null}
    </div>
  );
}

function TabLabel({ text, count }: { text: string; count: number | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {text}
      {count ? <span className="font-mono text-xs text-text-3">{count}</span> : null}
    </span>
  );
}

function RunNotices({ run }: { run: PayrollRun }) {
  return (
    <>
      {LOCKED.includes(run.status) ? (
        <Alert tone="info">This run is locked. Corrections go into an adjustment in a later run.</Alert>
      ) : null}
      {run.returnedReason && run.status === 'draft' ? (
        <Alert tone="warn" title="Returned to draft">
          {run.returnedReason}
        </Alert>
      ) : null}
      {run.selfApproved && run.selfApprovalNote ? (
        <Alert tone="warn" title="Self-approved">
          {run.selfApprovalNote}
        </Alert>
      ) : null}
      {run.payslipsPublishedAt ? (
        <Alert tone="ok">Payslips published {formatDateTime(run.payslipsPublishedAt)}.</Alert>
      ) : null}
    </>
  );
}
