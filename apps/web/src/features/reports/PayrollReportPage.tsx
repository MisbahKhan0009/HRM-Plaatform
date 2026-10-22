import type {
  DeductionsSummarySchema,
  PaymentReconciliationRow,
  PayrollDeductionRow,
  PayrollRegisterRow,
  PayrollRun,
  PayrollRunReportSummarySchema,
  ReconciliationSummarySchema,
} from '@hrm/contracts';
import { EmptyState, Select, TabPanel, Tabs } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { Banknote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { PageHeader } from '../../components/page-header';
import { api } from '../../lib/api/client';
import { formatDate, formatMoney, formatMonth, todayIso } from '../../lib/format';
import { type ReportParams, reportQueries } from './api';
import { employeeColumns, type ReportColumn } from './columns';
import { YearFilter } from './filters';
import { FilterField, ReportView } from './ReportView';

const route = getRouteApi('/_app/reports/payroll');
type RegisterSummary = z.infer<typeof PayrollRunReportSummarySchema>;
type ReconSummary = z.infer<typeof ReconciliationSummarySchema>;
type DeductionsSummary = z.infer<typeof DeductionsSummarySchema>;
export type PayrollTab = 'register' | 'deductions' | 'reconciliation';

const money = <Row,>(key: string, header: string, get: (r: Row) => string): ReportColumn<Row> => ({
  key,
  header,
  type: 'money',
  numeric: true,
  width: 14,
  value: get,
  render: (r) => formatMoney(get(r)),
});

function usePayrollRuns() {
  return useQuery({
    queryKey: ['payroll', 'runs', 'options'],
    queryFn: () =>
      api.get<{ data: PayrollRun[] }>('/payroll/runs', { query: { pageSize: 100 } }).then((r) => r.data),
    staleTime: 60_000,
  });
}

const runLabel = (r: PayrollRun) => `${formatMonth(r.period.year, r.period.month)} · ${r.runNumber}`;

// FR-REP-003: payroll register, deductions and payment reconciliation, as tabs of one page.
export function PayrollReportPage() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/reports/payroll' });
  const runs = usePayrollRuns();
  const thisYear = Number(todayIso().slice(0, 4));
  const set = (patch: Partial<typeof search>) => void navigate({ search: { ...search, ...patch, page: 1 } });
  const paging = {
    onPage: (page: number) => void navigate({ search: { ...search, page } }),
    onPageSize: (pageSize: number) => void navigate({ search: { ...search, page: 1, pageSize } }),
  };
  const run = runs.data?.find((r) => r.id === search.runId);
  const base = { page: search.page, pageSize: search.pageSize };
  const runParams: ReportParams = { ...base, runId: search.runId };
  const deductionParams: ReportParams = search.runId ? runParams : { ...base, year: search.year };

  const register = useQuery(
    reportQueries.page<PayrollRegisterRow, RegisterSummary>(
      'payroll_register',
      runParams,
      search.tab === 'register' && Boolean(search.runId),
    ),
  );
  const recon = useQuery(
    reportQueries.page<PaymentReconciliationRow, ReconSummary>(
      'payment_reconciliation',
      runParams,
      search.tab === 'reconciliation' && Boolean(search.runId),
    ),
  );
  const deductions = useQuery(
    reportQueries.page<PayrollDeductionRow, DeductionsSummary>(
      'payroll_deductions',
      deductionParams,
      search.tab === 'deductions',
    ),
  );

  const runFilter = (
    <FilterField label="Payroll run">
      {(id) => (
        <Select
          id={id}
          className="w-full sm:w-80"
          value={search.runId ?? ''}
          onChange={(e) => set({ runId: e.target.value || undefined })}
        >
          <option value="">{search.tab === 'deductions' ? 'All runs in the year' : 'Choose a run'}</option>
          {(runs.data ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {runLabel(r)}
            </option>
          ))}
        </Select>
      )}
    </FilterField>
  );
  const noRun = (
    <EmptyState
      icon={Banknote}
      variant="no-results"
      title="Choose a payroll run"
      description={
        runs.data && !runs.data.length
          ? 'There are no payroll runs yet.'
          : 'Pick a run above to see its figures.'
      }
    />
  );
  const runSuffix = run ? run.runNumber : 'run';
  const reset = () =>
    void navigate({ search: { tab: search.tab, page: 1, pageSize: search.pageSize, year: thisYear } });

  const registerColumns: ReportColumn<PayrollRegisterRow>[] = [
    ...employeeColumns<PayrollRegisterRow>(),
    { key: 'days', header: 'Days employed', type: 'integer', numeric: true, value: (r) => r.daysEmployed },
    money('gross', 'Gross (BDT)', (r) => r.grossAmount.amount),
    money('deductions', 'Deductions (BDT)', (r) => r.deductionAmount.amount),
    money('reimbursements', 'Claims (BDT)', (r) => r.reimbursementAmount.amount),
    money('net', 'Net (BDT)', (r) => r.netAmount.amount),
    { key: 'payment', header: 'Payment', value: (r) => t(`status.${r.paymentStatus}`, r.paymentStatus) },
  ];
  const deductionColumns: ReportColumn<PayrollDeductionRow>[] = [
    { key: 'run', header: 'Run', width: 16, value: (r) => r.runNumber },
    {
      key: 'period',
      header: 'Period',
      width: 16,
      value: (r) => `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`,
      render: (r) => formatMonth(r.periodYear, r.periodMonth),
    },
    ...employeeColumns<PayrollDeductionRow>(),
    { key: 'code', header: 'Code', value: (r) => r.code },
    { key: 'label', header: 'Deduction', width: 22, value: (r) => r.label },
    money('amount', 'Amount (BDT)', (r) => r.amount.amount),
  ];
  const reconColumns: ReportColumn<PaymentReconciliationRow>[] = [
    ...employeeColumns<PaymentReconciliationRow>(),
    money('net', 'Net (BDT)', (r) => r.netAmount.amount),
    money('paid', 'Paid (BDT)', (r) => r.paidAmount.amount),
    money('difference', 'Difference (BDT)', (r) => r.differenceAmount.amount),
    { key: 'payments', header: 'Payments', type: 'integer', numeric: true, value: (r) => r.paymentCount },
    { key: 'methods', header: 'Method', value: (r) => r.methods.join(', ') },
    {
      key: 'lastPaidOn',
      header: 'Last paid',
      value: (r) => r.lastPaidOn,
      render: (r) => (r.lastPaidOn ? formatDate(r.lastPaidOn) : null),
    },
    { key: 'status', header: 'Payment', value: (r) => t(`status.${r.paymentStatus}`, r.paymentStatus) },
  ];

  return (
    <>
      <PageHeader
        title="Payroll reports"
        breadcrumb={{ label: 'Reports', to: '/reports' }}
        description="Register, deductions and payment reconciliation for a payroll run."
      />
      <Tabs
        value={search.tab}
        onValueChange={(tab) => set({ tab: tab as PayrollTab })}
        tabs={[
          { value: 'register', label: 'Register' },
          { value: 'deductions', label: 'Deductions' },
          { value: 'reconciliation', label: 'Payment reconciliation' },
        ]}
      >
        <TabPanel value="register">
          <ReportView
            report="payroll_register"
            title="Payroll register"
            query={register}
            params={runParams}
            columns={registerColumns}
            fileName={`payroll-register-${runSuffix}`}
            rowKey={(r) => r.payrollItemId}
            stats={(d) => [
              { label: 'Employees', value: d.summary.totals.employeeCount },
              { label: 'Gross', value: formatMoney(d.summary.totals.grossAmount.amount) },
              { label: 'Deductions', value: formatMoney(d.summary.totals.deductionAmount.amount) },
              { label: 'Net pay', value: formatMoney(d.summary.totals.netAmount.amount) },
            ]}
            filters={runFilter}
            filtered={Boolean(search.runId)}
            onReset={reset}
            blocked={search.runId ? undefined : noRun}
            {...paging}
          />
        </TabPanel>
        <TabPanel value="deductions">
          <ReportView
            report="payroll_deductions"
            title="Payroll deductions"
            query={deductions}
            params={deductionParams}
            columns={deductionColumns}
            fileName={`payroll-deductions-${search.runId ? runSuffix : search.year}`}
            rowKey={(r) => `${r.runId}-${r.employeeId}-${r.code}`}
            stats={(d) => [
              { label: 'Deduction lines', value: d.page.totalItems.toLocaleString('en-US') },
              { label: 'Total deductions', value: formatMoney(d.summary.totalAmount.amount) },
            ]}
            filters={
              <>
                {runFilter}
                {search.runId ? null : <YearFilter value={search.year} onChange={(year) => set({ year })} />}
              </>
            }
            filtered={Boolean(search.runId) || search.year !== thisYear}
            onReset={reset}
            {...paging}
          />
        </TabPanel>
        <TabPanel value="reconciliation">
          <ReportView
            report="payment_reconciliation"
            title="Payment reconciliation"
            query={recon}
            params={runParams}
            columns={reconColumns}
            fileName={`payment-reconciliation-${runSuffix}`}
            rowKey={(r) => r.payrollItemId}
            stats={(d) => [
              { label: 'Net pay', value: formatMoney(d.summary.totals.netAmount.amount) },
              { label: 'Paid', value: formatMoney(d.summary.totals.paidAmount.amount) },
              { label: 'Difference', value: formatMoney(d.summary.totals.differenceAmount.amount) },
              { label: 'Employees', value: d.summary.totals.employeeCount },
            ]}
            filters={runFilter}
            filtered={Boolean(search.runId)}
            onReset={reset}
            blocked={search.runId ? undefined : noRun}
            {...paging}
          />
        </TabPanel>
      </Tabs>
    </>
  );
}
