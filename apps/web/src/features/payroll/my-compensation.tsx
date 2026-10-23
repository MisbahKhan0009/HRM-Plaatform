import { Card, CardHeader, EmptyState, LoadingBlock, StatBar } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { PageHeader } from '../../components/page-header';
import { useMe } from '../../lib/auth/me';
import { formatDate, todayIso } from '../../lib/format';
import { payrollQueries } from './api';
import { Money } from './components';
import { StructureTimeline } from './salary-structures';

// SCREEN-INVENTORY 2.3: current gross monthly salary and its history (own scope; drafts are not shown).
export function MyCompensationPage() {
  const me = useMe();
  const employeeId = me?.employee?.id;
  const list = useQuery({
    ...payrollQueries.structures({ page: 1, pageSize: 100, ...(employeeId ? { employeeId } : {}) }),
    enabled: Boolean(employeeId),
  });
  const today = todayIso();
  const approved = (list.data?.data ?? []).filter((s) => s.status === 'approved');
  const current =
    approved.find((s) => s.effectiveFrom <= today && (!s.effectiveTo || s.effectiveTo >= today)) ?? null;
  const upcoming = approved.find((s) => s.effectiveFrom > today) ?? null;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="My compensation"
        breadcrumb={{ label: 'My profile', to: '/me' }}
        description="Your gross monthly salary as approved by payroll. Payslips show what was paid each month."
      />
      {!employeeId ? (
        <EmptyState
          icon={Wallet}
          title="No salary structure yet"
          description="Your account isn't linked to an employee record."
        />
      ) : list.isPending ? (
        <LoadingBlock label="compensation" />
      ) : list.isError ? (
        <p className="text-bad">We couldn't load your compensation.</p>
      ) : !approved.length ? (
        <EmptyState icon={Wallet} title="No salary structure yet" />
      ) : (
        <>
          <StatBar
            stats={[
              {
                label: 'Gross per month',
                value: current ? <Money amount={current.grossAmount.amount} className="text-2xl" /> : '—',
              },
              {
                label: 'Effective from',
                value: current ? <span className="text-2xl">{formatDate(current.effectiveFrom)}</span> : '—',
              },
            ]}
          />
          {upcoming ? (
            <p className="text-text-2">
              From {formatDate(upcoming.effectiveFrom)} your gross salary will be{' '}
              <Money amount={upcoming.grossAmount.amount} />.
            </p>
          ) : null}
          <Card aria-labelledby="comp-history">
            <CardHeader id="comp-history" title="History" />
            <StructureTimeline structures={approved} />
          </Card>
        </>
      )}
    </div>
  );
}
