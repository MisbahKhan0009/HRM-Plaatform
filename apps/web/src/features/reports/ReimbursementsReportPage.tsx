import type { ReimbursementReportRow, ReimbursementSummarySchema } from '@hrm/contracts';
import { Select } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { PageHeader } from '../../components/page-header';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { ClaimStatusBadge } from '../reimbursements/ClaimStatusBadge';
import { reportQueries } from './api';
import { employeeColumns, type ReportColumn } from './columns';
import { currentMonth, DateFilter } from './filters';
import { FilterField, ReportView } from './ReportView';
import { REPORTED_CLAIM_STATUSES } from './search';

const route = getRouteApi('/_app/reports/reimbursements');
type Summary = z.infer<typeof ReimbursementSummarySchema>;

// FR-REIM, FR-REP: claims by date of travel; drafts never appear.
export function ReimbursementsReportPage() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/reports/reimbursements' });
  const query = useQuery(reportQueries.page<ReimbursementReportRow, Summary>('reimbursements', search));
  const set = (patch: Partial<typeof search>) => void navigate({ search: { ...search, ...patch, page: 1 } });
  const month = currentMonth();
  const columns: ReportColumn<ReimbursementReportRow>[] = [
    {
      key: 'claim',
      header: 'Claim',
      width: 14,
      value: (r) => r.claimNumber,
      render: (r) => <span className="font-mono">{r.claimNumber}</span>,
    },
    ...employeeColumns<ReimbursementReportRow>(),
    {
      key: 'expenseDate',
      header: 'Date of travel',
      width: 14,
      value: (r) => r.expenseDate,
      render: (r) => formatDate(r.expenseDate),
    },
    {
      key: 'amount',
      header: 'Amount (BDT)',
      type: 'money',
      numeric: true,
      width: 14,
      value: (r) => r.amount.amount,
      render: (r) => formatMoney(r.amount.amount),
    },
    {
      key: 'status',
      header: 'Status',
      value: (r) => t(`status.${r.status}`),
      render: (r) => <ClaimStatusBadge status={r.status} />,
    },
    {
      key: 'decidedAt',
      header: 'Decided',
      width: 20,
      value: (r) => r.decidedAt,
      render: (r) => (r.decidedAt ? formatDateTime(r.decidedAt) : null),
    },
    { key: 'run', header: 'Payroll run', width: 16, value: (r) => r.runNumber },
  ];
  return (
    <>
      <PageHeader
        title="Claims report"
        breadcrumb={{ label: 'Reports', to: '/reports' }}
        description="Submitted transport claims by date of travel, with their decision and payroll run."
      />
      <ReportView
        report="reimbursements"
        title="Claims report"
        query={query}
        params={search}
        columns={columns}
        fileName={`claims-${search.from}-${search.to}`}
        rowKey={(r) => r.claimId}
        stats={(d) => [
          { label: 'Claims', value: d.summary.count.toLocaleString('en-US') },
          { label: 'Total amount', value: formatMoney(d.summary.totalAmount.amount) },
        ]}
        filtered={search.from !== month.from || search.to !== month.to || Boolean(search.status)}
        onReset={() => void navigate({ search: { page: 1, pageSize: search.pageSize, ...month } })}
        onPage={(page) => void navigate({ search: { ...search, page } })}
        onPageSize={(pageSize) => void navigate({ search: { ...search, page: 1, pageSize } })}
        filters={
          <>
            <DateFilter
              label="From"
              value={search.from}
              max={search.to}
              onChange={(from) => from && set({ from })}
            />
            <DateFilter label="To" value={search.to} min={search.from} onChange={(to) => to && set({ to })} />
            <FilterField label="Status">
              {(id) => (
                <Select
                  id={id}
                  className="w-44"
                  value={search.status ?? ''}
                  onChange={(e) => set({ status: (e.target.value || undefined) as never })}
                >
                  <option value="">All statuses</option>
                  {REPORTED_CLAIM_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`status.${s}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FilterField>
          </>
        }
      />
    </>
  );
}
