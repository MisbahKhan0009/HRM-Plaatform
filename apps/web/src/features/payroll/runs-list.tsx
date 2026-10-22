import { type PayrollRun, payrollRunStatusValues } from '@hrm/contracts';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  LoadingBlock,
  Pagination,
  Select,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Banknote, Plus } from 'lucide-react';
import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PageHeader } from '../../components/page-header';
import { useErrorMessage } from '../../lib/api/errors';
import { useCan } from '../../lib/auth/me';
import { formatDateRange, formatMonth, todayIso } from '../../lib/format';
import { FormError, FormField, useZodForm } from '../../lib/forms';
import { payrollQueries, type RunListParams, useCreatePeriod, useCreateRun } from './api';
import {
  errorCode,
  isStepUpCancel,
  Money,
  RUN_TYPE_LABEL,
  SelfApprovedBadge,
  StatusLabel,
} from './components';

type Navigate = (search: RunListParams) => void;

// INFORMATION-ARCHITECTURE §1 `/payroll`, SCREEN-INVENTORY 9.1.
export function PayrollRunsPage({ params, onSearch }: { params: RunListParams; onSearch: Navigate }) {
  const { t } = useTranslation();
  const canPrepare = useCan('payroll.prepare');
  const [creating, setCreating] = useState(false);
  const year = Number(todayIso().slice(0, 4));
  const periods = useQuery(payrollQueries.periods());
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payroll runs"
        description="One regular run per month. Locked runs can't be edited; corrections go into a later run as adjustments."
        actions={
          canPrepare ? (
            <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setCreating(true)}>
              Create payroll run
            </Button>
          ) : null
        }
      />
      <TableContainer
        toolbar={
          <>
            <Select
              aria-label="Period"
              className="w-48"
              value={params.periodId ?? ''}
              onChange={(e) => onSearch({ ...params, page: 1, periodId: e.target.value || undefined })}
            >
              <option value="">All periods</option>
              {periods.data?.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {formatMonth(p.year, p.month)}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Status"
              className="w-44"
              value={params.status ?? ''}
              onChange={(e) =>
                onSearch({ ...params, page: 1, status: (e.target.value || undefined) as never })
              }
            >
              <option value="">All statuses</option>
              {payrollRunStatusValues
                .filter((s) => s !== 'returned')
                .map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
            </Select>
          </>
        }
      >
        <Suspense fallback={<LoadingBlock label="payroll runs" />}>
          <RunsTable
            params={params}
            onSearch={onSearch}
            onCreate={canPrepare ? () => setCreating(true) : null}
          />
        </Suspense>
      </TableContainer>
      {periods.data?.data.length ? (
        <section aria-labelledby="periods-h" className="flex flex-col gap-3">
          <h2 id="periods-h" className="font-display text-[17px] font-semibold">
            Periods
          </h2>
          <ul className="flex flex-wrap gap-2">
            {periods.data.data.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-sm"
              >
                <span>{formatMonth(p.year, p.month)}</span>
                <span className="text-text-2">{formatDateRange(p.startDate, p.endDate)}</span>
                <StatusLabel
                  status={p.status === 'closed' ? 'locked' : 'open'}
                  label={p.status === 'closed' ? 'Closed' : 'Open'}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {creating ? <NewRunDialog defaultYear={year} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function RunsTable({
  params,
  onSearch,
  onCreate,
}: {
  params: RunListParams;
  onSearch: Navigate;
  onCreate: (() => void) | null;
}) {
  const { data } = useSuspenseQuery(payrollQueries.runs(params));
  if (!data.data.length) {
    const filtered = Boolean(params.status || params.periodId);
    return (
      <EmptyState
        icon={Banknote}
        variant={filtered ? 'no-results' : 'first-use'}
        title={filtered ? 'No runs match these filters' : 'No payroll runs yet'}
        description={
          filtered
            ? 'Clear a filter to see more runs.'
            : 'Create the first run for a month, then calculate it from approved salary structures.'
        }
        action={
          !filtered && onCreate ? (
            <Button variant="primary" onClick={onCreate}>
              Create payroll run
            </Button>
          ) : undefined
        }
        className="border-0"
      />
    );
  }
  return (
    <>
      <Table>
        <THead>
          <tr>
            <TH>Run</TH>
            <TH>Period</TH>
            <TH>Type</TH>
            <TH>Status</TH>
            <TH numeric>Employees</TH>
            <TH numeric>Net pay</TH>
          </tr>
        </THead>
        <TBody>
          {data.data.map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </TBody>
      </Table>
      <div className="border-t border-line px-4 py-2">
        <Pagination
          page={data.page.number}
          pageSize={data.page.size}
          totalItems={data.page.totalItems}
          onPage={(page) => onSearch({ ...params, page })}
          onPageSize={(pageSize) => onSearch({ ...params, page: 1, pageSize })}
        />
      </div>
    </>
  );
}

function RunRow({ run }: { run: PayrollRun }) {
  return (
    <TR>
      <TD>
        <Link
          to="/payroll/runs/$runId"
          params={{ runId: run.id }}
          className="font-mono text-accent-text underline-offset-4 hover:underline"
        >
          {run.runNumber}
        </Link>
      </TD>
      <TD>{formatMonth(run.period.year, run.period.month)}</TD>
      <TD>{RUN_TYPE_LABEL[run.runType]}</TD>
      <TD>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusLabel status={run.status} />
          {run.selfApproved ? <SelfApprovedBadge /> : null}
        </span>
      </TD>
      <TD numeric>{run.employeeCount ?? '—'}</TD>
      <TD numeric>{run.totals ? <Money amount={run.totals.net.amount} /> : '—'}</TD>
    </TR>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const NewRunSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  runType: z.enum(['regular', 'off_cycle']),
});

/** USER-FLOWS 7 step 1: find or create the period, then create the run with an Idempotency-Key. */
function NewRunDialog({ defaultYear, onClose }: { defaultYear: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const createPeriod = useCreatePeriod();
  const createRun = useCreateRun();
  const [formError, setFormError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ label: string; runId: string | null } | null>(null);
  const form = useZodForm(NewRunSchema, {
    year: defaultYear,
    month: Number(todayIso().slice(5, 7)),
    runType: 'regular',
  });
  const busy = createPeriod.isPending || createRun.isPending || form.formState.isSubmitting;

  const submit = form.handleSubmit(async ({ year, month, runType }) => {
    setFormError(null);
    setExisting(null);
    let periodId: string | undefined;
    try {
      const findPeriod = async () =>
        (await queryClient.fetchQuery({ ...payrollQueries.periods(year), staleTime: 0 })).data.find(
          (p) => p.month === month,
        );
      periodId = (await findPeriod())?.id;
      if (!periodId) {
        try {
          periodId = (await createPeriod.mutateAsync({ year, month })).id;
        } catch (err) {
          // Someone created it meanwhile: use theirs.
          periodId = (await findPeriod())?.id;
          if (!periodId) throw err;
        }
      }
      const run = await createRun.mutateAsync({ periodId, runType });
      onClose();
      void navigate({ to: '/payroll/runs/$runId', params: { runId: run.id } });
    } catch (err) {
      if (isStepUpCancel(err)) return;
      if (errorCode(err) === 'PAYROLL_RUN_EXISTS' && periodId) {
        const runs = await queryClient
          .fetchQuery(payrollQueries.runs({ page: 1, pageSize: 25, periodId }))
          .catch(() => null);
        const match = runs?.data.find((r) => r.runType === 'regular');
        setExisting({ label: formatMonth(year, month), runId: match?.id ?? null });
        return;
      }
      setFormError(errorMessage(err));
    }
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create payroll run"
      description="The run starts as a draft. Calculate it to build items from approved salary structures."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Create payroll run
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      {existing ? (
        <Alert tone="bad" assertive>
          A regular run for {existing.label} already exists.{' '}
          {existing.runId ? (
            <Link
              to="/payroll/runs/$runId"
              params={{ runId: existing.runId }}
              className="font-medium underline"
              onClick={onClose}
            >
              Open it
            </Link>
          ) : null}
        </Alert>
      ) : null}
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="month"
            label="Month"
            render={(p) => (
              <Select {...p} onChange={(e) => p.onChange(Number(e.target.value))}>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {formatMonth(2000, m).replace(' 2000', '')}
                  </option>
                ))}
              </Select>
            )}
          />
          <FormField
            control={form.control}
            name="year"
            label="Year"
            render={(p) => (
              <Select {...p} onChange={(e) => p.onChange(Number(e.target.value))}>
                {[defaultYear - 1, defaultYear, defaultYear + 1].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="runType"
          label="Run type"
          hint="Off-cycle runs are for one-off payments after the regular run."
          render={(p) => (
            <Select {...p}>
              <option value="regular">Regular</option>
              <option value="off_cycle">Off-cycle</option>
            </Select>
          )}
        />
      </form>
    </Dialog>
  );
}
