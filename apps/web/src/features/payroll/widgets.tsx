import type { CurrentUser, PayrollRun } from '@hrm/contracts';
import { Button, Card, CardHeader, KeyValueList } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { formatDate, formatMonth, todayIso } from '../../lib/format';
import { payrollQueries } from './api';
import { Money, SelfApprovedBadge, StatusLabel } from './components';

const NEXT_STEP: Record<PayrollRun['status'], string> = {
  draft: 'Next: calculate the run.',
  returned: 'Next: fix and recalculate the run.',
  calculated: 'Next: review checks and submit for approval.',
  submitted: 'Next: approve or return the run.',
  approved: 'Next: lock the run for payment.',
  locked: 'Next: record payments.',
  paid: 'Next: reconcile the run.',
  reconciled: 'Run complete.',
};

/** Dashboard widget 5 (INFORMATION-ARCHITECTURE §5): the owner's latest published payslip. */
export function LatestPayslipWidget(_: { me: CurrentUser; primary: boolean }) {
  const list = useQuery(payrollQueries.payslipsMine({ page: 1, pageSize: 1 }));
  const latest = list.data?.data[0];
  return (
    <Card aria-labelledby="w-payslip">
      <CardHeader
        id="w-payslip"
        label="Latest payslip"
        title={latest ? formatMonth(latest.period.year, latest.period.month) : 'No payslips yet'}
        actions={
          latest ? (
            <Button variant="secondary" size="sm" asChild>
              <Link to="/payslips/$payslipId" params={{ payslipId: latest.id }}>
                View payslip
              </Link>
            </Button>
          ) : null
        }
      />
      {latest ? (
        <KeyValueList
          items={[
            { label: 'Net pay', value: <Money amount={latest.netAmount.amount} className="text-lg" /> },
            { label: 'Published', value: formatDate(todayIso(new Date(latest.publishedAt))) },
          ]}
        />
      ) : (
        <p className="text-text-2">Payslips appear here once payroll for a month is published.</p>
      )}
    </Card>
  );
}

/** Dashboard widget 11: the most recent run, its status, next step and totals once calculated. */
export function PayrollStatusWidget({ primary }: { me: CurrentUser; primary: boolean }) {
  const list = useQuery(payrollQueries.runs({ page: 1, pageSize: 1 }));
  const run = list.data?.data[0];
  return (
    <Card aria-labelledby="w-payroll">
      <CardHeader
        id="w-payroll"
        label="Payroll status"
        title={run ? `${formatMonth(run.period.year, run.period.month)} payroll` : 'No payroll runs yet'}
        actions={
          <Button variant={primary ? 'primary' : 'secondary'} size="sm" asChild>
            {run ? (
              <Link to="/payroll/runs/$runId" params={{ runId: run.id }}>
                Open payroll run
              </Link>
            ) : (
              <Link to="/payroll">Payroll runs</Link>
            )}
          </Button>
        }
      />
      {run ? (
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-text-2">{run.runNumber}</span>
            <StatusLabel status={run.status} />
            {run.selfApproved ? <SelfApprovedBadge /> : null}
          </p>
          <p className="text-text-2">{NEXT_STEP[run.status]}</p>
          {run.totals ? (
            <KeyValueList
              items={[
                { label: 'Employees', value: <span className="font-mono">{run.employeeCount ?? 0}</span> },
                { label: 'Gross', value: <Money amount={run.totals.gross.amount} /> },
                { label: 'Net pay', value: <Money amount={run.totals.net.amount} /> },
              ]}
            />
          ) : null}
        </div>
      ) : (
        <p className="text-text-2">Create the first run from Payroll runs.</p>
      )}
    </Card>
  );
}
