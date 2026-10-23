import type { LeaveRequestDto } from '@hrm/contracts';
import { StatusBadge, Table, TBody, TD, TH, THead, TR } from '@hrm/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { formatRelative } from '../../../lib/format';
import { formatLeaveDates, formatQty } from '../format';

/** Leave requests (SCREEN-INVENTORY 4.1, 4.5): number links to the detail, where every action happens. */
export function RequestsTable({
  requests,
  showEmployee = false,
}: {
  requests: LeaveRequestDto[];
  showEmployee?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Table>
      <THead>
        <tr>
          <TH>Request</TH>
          {showEmployee ? <TH>Employee</TH> : null}
          <TH>Type</TH>
          <TH>Dates</TH>
          <TH numeric>Days</TH>
          <TH>Status</TH>
          <TH>Submitted</TH>
        </tr>
      </THead>
      <TBody>
        {requests.map((r) => (
          <TR key={r.id}>
            <TD className="whitespace-nowrap">
              <Link
                to="/leave/requests/$requestId"
                params={{ requestId: r.id }}
                className="font-mono text-link underline-offset-4 hover:underline"
              >
                {r.requestNumber}
              </Link>
            </TD>
            {showEmployee ? (
              <TD className="whitespace-nowrap">
                {r.employeeName} <span className="font-mono text-sm text-text-2">{r.employeeCode}</span>
              </TD>
            ) : null}
            <TD className="whitespace-nowrap">{r.leaveTypeName}</TD>
            <TD className="whitespace-nowrap">{formatLeaveDates(r)}</TD>
            <TD numeric>{formatQty(r.requestedUnits)}</TD>
            <TD>
              <StatusBadge status={r.status} label={t(`status.${r.status}`)} />
            </TD>
            <TD className="whitespace-nowrap text-text-2" title={r.submittedAt ?? undefined}>
              {r.submittedAt ? formatRelative(r.submittedAt) : '—'}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
