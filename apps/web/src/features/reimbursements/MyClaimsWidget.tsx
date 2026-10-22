import type { CurrentUser } from '@hrm/contracts';
import { Button, Card, CardHeader, LoadingBlock } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { formatMoney, formatShortDate } from '../../lib/format';
import { claimQueries } from './api';
import { ClaimStatusBadge } from './ClaimStatusBadge';

/**
 * Dashboard "My claims" (INFORMATION-ARCHITECTURE §5 widget 4 covers claims; until the cross-module "My requests"
 * widget exists this lists the caller's open claims).
 */
export function MyClaimsWidget({ me }: { me: CurrentUser; primary: boolean }) {
  const employeeId = me.employee?.id;
  const list = useQuery({
    ...claimQueries.list({ page: 1, pageSize: 5, employeeId, status: 'draft,submitted,approved' }),
    enabled: Boolean(employeeId),
  });
  return (
    <Card aria-labelledby="w-claims">
      <CardHeader
        id="w-claims"
        label="Claims"
        title={list.data ? `${list.data.page.totalItems} open` : 'My claims'}
        actions={
          <Button variant="secondary" size="sm" asChild>
            <Link to="/reimbursements/new">New claim</Link>
          </Button>
        }
      />
      {list.isPending && employeeId ? (
        <LoadingBlock label="Loading claims" rows={2} />
      ) : list.data?.data.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {list.data.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <Link
                  to="/reimbursements/$claimId"
                  params={{ claimId: c.id }}
                  className="font-mono text-sm text-link hover:underline"
                >
                  {c.claimNumber}
                </Link>
                <p className="text-sm text-text-2">
                  {formatShortDate(c.expenseDate)} · {formatMoney(c.amount.amount)}
                </p>
              </div>
              <ClaimStatusBadge status={c.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-text-2">No open claims.</p>
      )}
      <Link to="/reimbursements" className="mt-3 inline-block text-sm text-link hover:underline">
        View all claims
      </Link>
    </Card>
  );
}
