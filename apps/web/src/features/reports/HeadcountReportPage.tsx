import { type HeadcountRow, type HeadcountSummarySchema, headcountGroupValues } from '@hrm/contracts';
import { Select } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { PageHeader } from '../../components/page-header';
import { formatDate, todayIso } from '../../lib/format';
import { reportQueries } from './api';
import type { ReportColumn } from './columns';
import { DateFilter, DepartmentFilter } from './filters';
import { FilterField, ReportView } from './ReportView';

const route = getRouteApi('/_app/reports/headcount');
type Summary = z.infer<typeof HeadcountSummarySchema>;

const STATUSES = [
  'active',
  'probation',
  'notice_period',
  'preboarding',
  'draft',
  'separated',
  'archived',
] as const;
const GROUP_LABEL = { department: 'Department', position: 'Position', status: 'Status' } as const;

// FR-REP-001: headcount by department, position or status as of a date.
export function HeadcountReportPage() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/reports/headcount' });
  const query = useQuery(reportQueries.page<HeadcountRow, Summary>('headcount', search));
  const set = (patch: Partial<typeof search>) => void navigate({ search: { ...search, ...patch, page: 1 } });

  const groupLabel = (r: HeadcountRow) =>
    search.groupBy === 'status' ? t(`status.${r.groupLabel ?? 'active'}`) : (r.groupLabel ?? 'None');
  const columns: ReportColumn<HeadcountRow>[] = [
    { key: 'group', header: GROUP_LABEL[search.groupBy], width: 24, value: groupLabel },
    { key: 'total', header: 'Total', type: 'integer', numeric: true, value: (r) => r.total },
    ...(search.groupBy === 'status'
      ? []
      : STATUSES.map(
          (s): ReportColumn<HeadcountRow> => ({
            key: s,
            header: t(`status.${s}`),
            type: 'integer',
            numeric: true,
            value: (r) => r.byStatus[s] ?? 0,
          }),
        )),
  ];

  return (
    <>
      <PageHeader
        title="Headcount report"
        breadcrumb={{ label: 'Reports', to: '/reports' }}
        description="Employees on record as of a date, grouped the way you choose."
      />
      <ReportView
        report="headcount"
        title="Headcount report"
        query={query}
        params={search}
        columns={columns}
        fileName={`headcount-${search.asOf ?? todayIso()}`}
        rowKey={(r) => `${r.groupId ?? r.groupLabel ?? 'none'}`}
        stats={(d) => [
          { label: 'Employees', value: d.summary.total.toLocaleString('en-US') },
          { label: 'As of', value: formatDate(d.summary.asOf) },
          { label: `${GROUP_LABEL[search.groupBy]} groups`, value: d.page.totalItems },
        ]}
        filtered={Boolean(search.asOf || search.departmentId || search.groupBy !== 'department')}
        onReset={() =>
          void navigate({ search: { page: 1, pageSize: search.pageSize, groupBy: 'department' } })
        }
        onPage={(page) => void navigate({ search: { ...search, page } })}
        onPageSize={(pageSize) => void navigate({ search: { ...search, page: 1, pageSize } })}
        filters={
          <>
            <DateFilter
              label="As of"
              value={search.asOf}
              max={todayIso()}
              onChange={(asOf) => set({ asOf })}
            />
            <DepartmentFilter
              value={search.departmentId}
              onChange={(departmentId) => set({ departmentId })}
            />
            <FilterField label="Group by">
              {(id) => (
                <Select
                  id={id}
                  className="w-40"
                  value={search.groupBy}
                  onChange={(e) => set({ groupBy: e.target.value as (typeof headcountGroupValues)[number] })}
                >
                  {headcountGroupValues.map((g) => (
                    <option key={g} value={g}>
                      {GROUP_LABEL[g]}
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
