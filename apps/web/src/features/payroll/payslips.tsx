import type { PayslipData, PayslipSummary } from '@hrm/contracts';
import {
  Button,
  Card,
  EmptyState,
  KeyValueList,
  LoadingBlock,
  notify,
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
import { Link } from '@tanstack/react-router';
import { Download, Printer, Wallet } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/page-header';
import { useErrorMessage } from '../../lib/api/errors';
import { useCan } from '../../lib/auth/me';
import { formatDate, formatDateRange, formatMonth, todayIso } from '../../lib/format';
import { payrollQueries } from './api';
import { EmployeePicker, Money, StatusLabel } from './components';
import type { PayslipSearch } from './search';

/**
 * Builds the PDF in the browser (D-037). pdf-lib loads only here, at click time, as its own chunk; the PDF always
 * uses the Paper lockup. On touch devices with file sharing, the share sheet opens instead of a download.
 */
export async function downloadPayslipPdf(data: PayslipData) {
  const [{ buildPayslipPdf, payslipFileName }, logo] = await Promise.all([
    import('@hrm/documents/payslip'),
    fetch('/logo-paper.png')
      .then((r) => (r.ok ? r.arrayBuffer() : undefined))
      .catch(() => undefined),
  ]);
  const bytes = await buildPayslipPdf(data, logo ? { logoPng: logo } : {});
  const name = payslipFileName(data);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const file = new File([blob], name, { type: 'application/pdf' });
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name }).catch(() => undefined);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function useDownload() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState<string | null>(null);
  const download = async (id: string) => {
    setBusy(id);
    try {
      await downloadPayslipPdf(await queryClient.fetchQuery(payrollQueries.payslip(id)));
    } catch (err) {
      notify.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  return { busy, download };
}

// SCREEN-INVENTORY 6.1: own payslips; with `payslip.read.all`, everyone's with an employee filter.
export function PayslipsPage({
  search,
  onSearch,
}: {
  search: PayslipSearch;
  onSearch: (s: PayslipSearch) => void;
}) {
  const canOwn = useCan('payslip.read.own');
  const canAll = useCan('payslip.read.all');
  const scope = search.scope ?? (canOwn ? 'mine' : 'all');
  const [employee, setEmployee] = useState<{ id: string; name: string; employeeCode: string } | null>(null);
  const thisYear = Number(todayIso().slice(0, 4));
  const params = { page: search.page, pageSize: search.pageSize, year: search.year };
  const list = useQuery(
    scope === 'mine'
      ? payrollQueries.payslipsMine(params)
      : payrollQueries.payslipsAll({ ...params, employeeId: search.employeeId }),
  );
  const { busy, download } = useDownload();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={scope === 'mine' ? 'My payslips' : 'Payslips'}
        description="Payslips appear once payroll for a month is published. The PDF is generated on your device."
      />
      <TableContainer
        toolbar={
          <>
            {canOwn && canAll ? (
              <Select
                aria-label="Whose payslips"
                className="w-48"
                value={scope}
                onChange={(e) => onSearch({ ...search, page: 1, scope: e.target.value as 'mine' | 'all' })}
              >
                <option value="mine">My payslips</option>
                <option value="all">Everyone's payslips</option>
              </Select>
            ) : null}
            <Select
              aria-label="Year"
              className="w-32"
              value={search.year ?? ''}
              onChange={(e) =>
                onSearch({ ...search, page: 1, year: e.target.value ? Number(e.target.value) : undefined })
              }
            >
              <option value="">All years</option>
              {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            {scope === 'all' ? (
              <div className="w-full max-w-xs">
                <EmployeePicker
                  id="payslip-employee"
                  ariaLabel="Filter by employee"
                  value={employee}
                  onChange={(e) => {
                    setEmployee(e);
                    onSearch({ ...search, page: 1, employeeId: e?.id });
                  }}
                />
              </div>
            ) : null}
          </>
        }
      >
        {list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="payslips" />
          </div>
        ) : list.isError ? (
          <p className="p-4 text-bad">We couldn't load payslips.</p>
        ) : !list.data.data.length ? (
          <EmptyState
            icon={Wallet}
            title="No payslips yet"
            description="They appear here once payroll for a month is published."
            className="border-0"
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Period</TH>
                  {scope === 'all' ? <TH>Employee</TH> : null}
                  <TH numeric>Net pay</TH>
                  <TH>Published</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {list.data.data.map((p: PayslipSummary) => (
                  <TR key={p.id}>
                    <TD>
                      <Link
                        to="/payslips/$payslipId"
                        params={{ payslipId: p.id }}
                        className="text-accent-text underline-offset-4 hover:underline"
                      >
                        {formatMonth(p.period.year, p.period.month)}
                      </Link>
                      <span className="ml-2 font-mono text-sm text-text-2">{p.runNumber}</span>
                    </TD>
                    {scope === 'all' ? (
                      <TD>
                        {p.employee.name}{' '}
                        <span className="font-mono text-sm text-text-2">{p.employee.employeeCode}</span>
                      </TD>
                    ) : null}
                    <TD numeric>
                      <Money amount={p.netAmount.amount} />
                    </TD>
                    <TD>{formatDate(todayIso(new Date(p.publishedAt)))}</TD>
                    <TD className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Download aria-hidden="true" />}
                        loading={busy === p.id}
                        onClick={() => void download(p.id)}
                        aria-label={`Download PDF for ${formatMonth(p.period.year, p.period.month)}`}
                      >
                        Download PDF
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="border-t border-line px-4 py-2">
              <Pagination
                page={list.data.page.number}
                pageSize={list.data.page.size}
                totalItems={list.data.page.totalItems}
                onPage={(page) => onSearch({ ...search, page })}
              />
            </div>
          </>
        )}
      </TableContainer>
    </div>
  );
}

const PAYMENT_LABEL = {
  unpaid: 'Not paid yet',
  paid: 'Paid',
  failed: 'Payment failed',
  cancelled: 'Cancelled',
};

function LineTable({ title, lines, total }: { title: string; lines: PayslipData['lines']; total: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <Table>
        <THead>
          <tr>
            <TH>{title}</TH>
            <TH numeric>Amount</TH>
          </tr>
        </THead>
        <TBody>
          {lines.length ? (
            lines.map((l) => (
              <TR key={`${l.code}-${l.label}`}>
                <TD>{l.label}</TD>
                <TD numeric>
                  <Money amount={l.amount.amount} />
                </TD>
              </TR>
            ))
          ) : (
            <TR>
              <TD className="text-text-2">None this month</TD>
              <TD numeric>
                <Money amount="0.00" />
              </TD>
            </TR>
          )}
          <TR className="font-semibold">
            <TD>Total {title.toLowerCase()}</TD>
            <TD numeric>
              <Money amount={total} />
            </TD>
          </TR>
        </TBody>
      </Table>
    </section>
  );
}

// SCREEN-INVENTORY 6.2: the immutable snapshot; Download PDF (primary) and Print.
export function PayslipPage({ payslipId }: { payslipId: string }) {
  const { data } = useSuspenseQuery(payrollQueries.payslip(payslipId));
  const { busy, download } = useDownload();
  const month = formatMonth(data.period.year, data.period.month);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={`Payslip ${month}`}
        breadcrumb={{ label: 'Payslips', to: '/payslips' }}
        code={data.runNumber}
        actions={
          <>
            <Button icon={<Printer aria-hidden="true" />} onClick={() => window.print()}>
              Print
            </Button>
            <Button
              variant="primary"
              icon={<Download aria-hidden="true" />}
              loading={busy === data.id}
              onClick={() => void download(data.id)}
            >
              Download PDF
            </Button>
          </>
        }
      />
      <Card className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-display text-lg font-semibold">
              {data.company.legalName ?? data.company.name}
            </p>
            {data.company.address ? <p className="text-sm text-text-2">{data.company.address}</p> : null}
          </div>
          <div className="text-right">
            <p className="font-mono text-[11px] uppercase tracking-[0.13em] text-text-3">Payslip</p>
            <p className="font-display text-xl font-semibold">{month}</p>
            <p className="text-sm text-text-2">
              {formatDateRange(data.period.startDate, data.period.endDate)}
            </p>
          </div>
        </div>
        <KeyValueList
          items={[
            { label: 'Employee', value: data.employee.name },
            { label: 'Code', value: <span className="font-mono">{data.employee.employeeCode}</span> },
            { label: 'Department', value: data.employee.department ?? '—' },
            { label: 'Position', value: data.employee.position ?? '—' },
            { label: 'Days paid', value: `${data.daysEmployed} of ${data.period.daysInPeriod}` },
            {
              label: 'Payment',
              value: data.payment ? (
                data.payment.method === 'cheque' ? (
                  <span>
                    Cheque <span className="font-mono">No. {data.payment.chequeNumber}</span>
                  </span>
                ) : (
                  'Cash'
                )
              ) : (
                <StatusLabel status={data.paymentStatus} label={PAYMENT_LABEL[data.paymentStatus]} />
              ),
            },
            ...(data.payment ? [{ label: 'Paid on', value: formatDate(data.payment.paidOn) }] : []),
            { label: 'Published', value: formatDate(todayIso(new Date(data.publishedAt))) },
          ]}
        />
        <div className="overflow-x-auto rounded-card border border-line">
          <LineTable
            title="Earnings"
            lines={data.lines.filter((l) => l.kind === 'earning')}
            total={data.totals.gross.amount}
          />
        </div>
        <div className="overflow-x-auto rounded-card border border-line">
          <LineTable
            title="Deductions"
            lines={data.lines.filter((l) => l.kind === 'deduction')}
            total={data.totals.deductions.amount}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line-strong p-4">
          <span className="font-display text-lg font-semibold">Net pay</span>
          <Money amount={data.totals.net.amount} className="text-2xl font-semibold" />
        </div>
        <p className="text-sm text-text-2">
          Generated from the locked payroll run {data.runNumber}. Amounts in Bangladeshi taka (BDT).
        </p>
      </Card>
    </div>
  );
}
