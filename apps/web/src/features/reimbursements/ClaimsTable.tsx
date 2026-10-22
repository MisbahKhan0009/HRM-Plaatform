import type { ReimbursementClaim } from '@hrm/contracts';
import { Table, TBody, TD, TH, THead, TR } from '@hrm/ui';
import { Link } from '@tanstack/react-router';
import { formatDate, formatMoney } from '../../lib/format';
import { ClaimStatusBadge } from './ClaimStatusBadge';

/** Claims list (SCREEN-INVENTORY 5.1 and 5.4); the claim number is the row's link. */
export function ClaimsTable({
  claims,
  caption,
  showEmployee = false,
}: {
  claims: ReimbursementClaim[];
  caption: string;
  showEmployee?: boolean;
}) {
  // relative: keeps the sr-only caption inside the scroll container, so it cannot widen the page.
  return (
    <Table className="relative">
      <caption className="sr-only">{caption}</caption>
      <THead>
        <tr>
          <TH>Claim</TH>
          {showEmployee ? <TH>Employee</TH> : null}
          <TH>Date of travel</TH>
          <TH numeric>Amount</TH>
          <TH>Status</TH>
          <TH>Payroll run</TH>
        </tr>
      </THead>
      <TBody>
        {claims.map((c) => (
          <TR key={c.id}>
            <TD>
              <Link
                to="/reimbursements/$claimId"
                params={{ claimId: c.id }}
                className="font-mono text-link hover:underline"
              >
                {c.claimNumber}
              </Link>
              <span className="block max-w-64 truncate text-sm text-text-2">{c.description}</span>
            </TD>
            {showEmployee ? (
              <TD className="whitespace-nowrap">
                {c.employee.name}{' '}
                <span className="font-mono text-sm text-text-2">{c.employee.employeeCode}</span>
              </TD>
            ) : null}
            <TD className="whitespace-nowrap">
              <time dateTime={c.expenseDate}>{formatDate(c.expenseDate)}</time>
            </TD>
            <TD numeric className="whitespace-nowrap">
              {formatMoney(c.amount.amount)}
            </TD>
            <TD>
              <ClaimStatusBadge status={c.status} />
            </TD>
            <TD className="font-mono text-sm">
              {c.payrollRunNumber ?? <span className="font-sans text-text-3">—</span>}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
