import type { ReportName } from '@hrm/contracts';
import {
  Button,
  EmptyState,
  LoadingBlock,
  Pagination,
  type Stat,
  StatBar,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import type { ReactNode } from 'react';
import { LoadError } from '../../components/load-error';
import type { ReportParams, ReportResult } from './api';
import type { ReportColumn } from './columns';
import { ExportButton } from './ExportDialog';

export type ReportViewProps<Row, Summary> = {
  report: ReportName;
  /** Report title, used for the export dialog and the sheet name. */
  title: string;
  query: UseQueryResult<ReportResult<Row, Summary>>;
  params: ReportParams;
  columns: ReportColumn<Row>[];
  fileName: string;
  rowKey: (row: Row) => string;
  stats?: (data: ReportResult<Row, Summary>) => Stat[];
  /** Filter controls (they write to the URL search params). */
  filters: ReactNode;
  filtered: boolean;
  onReset: () => void;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  /** Shown instead of the table when a required filter (a payroll run) is missing. */
  blocked?: ReactNode;
};

/**
 * Body of a report page (SCREEN-INVENTORY 10.2): filters with Reset, summary StatBar, paginated table and Export….
 * Values in the StatBar come from the API, never computed here (COMPONENT-SPECS §11).
 */
export function ReportView<Row, Summary>(props: ReportViewProps<Row, Summary>) {
  const { query, columns } = props;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {props.filters}
          {props.filtered ? (
            <Button variant="text" className="h-10" onClick={props.onReset}>
              Reset filters
            </Button>
          ) : null}
        </div>
        <ExportButton
          report={props.report}
          title={props.title}
          params={props.params}
          columns={columns}
          fileName={props.fileName}
          totalItems={query.data?.page.totalItems}
          disabled={Boolean(props.blocked) || query.isError}
        />
      </div>
      {props.blocked ? (
        props.blocked
      ) : (
        <>
          {props.stats && query.data ? <StatBar stats={props.stats(query.data)} /> : null}
          <TableContainer>
            {query.isPending ? (
              <div className="p-4">
                <LoadingBlock label={`Loading ${props.title.toLowerCase()}`} rows={8} />
              </div>
            ) : query.isError ? (
              <LoadError thing="the report" error={query.error} onRetry={() => void query.refetch()} />
            ) : !query.data.data.length ? (
              <EmptyState
                icon={BarChart3}
                variant="no-results"
                title="No results"
                description="Nothing matches these filters. Try a different period or fewer filters."
                className="border-0"
              />
            ) : (
              <div
                aria-busy={query.isFetching}
                className={query.isPlaceholderData ? 'opacity-60' : undefined}
              >
                {/* relative: keeps sr-only text inside the scroll container, so it cannot widen the page */}
                <Table className="relative">
                  <caption className="sr-only">{props.title}</caption>
                  <THead>
                    <tr>
                      {columns.map((c) => (
                        <TH key={c.key} numeric={c.numeric ?? false}>
                          {c.header}
                        </TH>
                      ))}
                    </tr>
                  </THead>
                  <TBody>
                    {query.data.data.map((row) => (
                      <TR key={props.rowKey(row)}>
                        {columns.map((c) => (
                          <TD key={c.key} numeric={c.numeric ?? false} className="whitespace-nowrap">
                            {c.render
                              ? c.render(row)
                              : (c.value(row) ?? <span className="text-text-3">—</span>)}
                          </TD>
                        ))}
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <div className="border-t border-line px-4 py-2">
                  <Pagination
                    page={query.data.page.number}
                    pageSize={query.data.page.size}
                    totalItems={query.data.page.totalItems}
                    onPage={props.onPage}
                    onPageSize={props.onPageSize}
                  />
                </div>
              </div>
            )}
          </TableContainer>
          <p className="text-sm text-text-2">
            Export builds the file in your browser from the rows you can see.
          </p>
        </>
      )}
    </div>
  );
}

/** A labelled filter control in the report toolbar. */
export function FilterField({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = `filter-${label.toLowerCase().replaceAll(' ', '-')}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      {children(id)}
    </div>
  );
}
