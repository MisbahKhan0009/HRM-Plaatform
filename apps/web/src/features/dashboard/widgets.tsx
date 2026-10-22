import type { ApprovalSummary, CurrentUser, Permission } from '@hrm/contracts';
import { Button, Card, CardHeader } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import { api } from '../../lib/api/client';
import { formatRelative } from '../../lib/format';
import { TeamTodayWidget, TodayAttendanceWidget } from '../attendance/widgets';

export interface DashboardWidget {
  key: string;
  /** Any one of these shows the widget (INFORMATION-ARCHITECTURE §5). */
  any: Permission[];
  /** Grid span on desktop (12 columns). */
  span: 4 | 6 | 8 | 12;
  Component: ComponentType<{ me: CurrentUser; primary: boolean }>;
}

const SUBJECT_LABEL: Record<string, string> = {
  leave_request: 'Leave request',
  attendance_correction: 'Attendance correction',
  reimbursement_claim: 'Claim',
  profile_change: 'Profile change',
  payroll_run: 'Payroll run',
  payroll_adjustment: 'Payroll adjustment',
};

function ApprovalsWidget({ primary }: { me: CurrentUser; primary: boolean }) {
  const inbox = useQuery({
    queryKey: ['approvals', 'inbox', { page: 1, pageSize: 5 }],
    queryFn: () =>
      api.get<{ data: ApprovalSummary[]; page: { totalItems: number } }>('/approvals/inbox', {
        query: { pageSize: 5 },
      }),
  });
  return (
    <Card aria-labelledby="w-approvals">
      <CardHeader
        id="w-approvals"
        label="Approvals"
        title={inbox.data ? `${inbox.data.page.totalItems} waiting` : 'Approvals waiting'}
        actions={
          <Button variant={primary ? 'primary' : 'secondary'} size="sm" asChild>
            <Link to="/approvals">Review approvals</Link>
          </Button>
        }
      />
      {inbox.data?.data.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {inbox.data.data.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.13em] text-text-3">
                  {SUBJECT_LABEL[a.subjectType]}
                </p>
                <p className="truncate">{a.subjectEmployee?.name ?? a.requester.name}</p>
              </div>
              <span className="shrink-0 text-sm text-text-2" title={a.createdAt}>
                {formatRelative(a.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-text-2">Nothing is waiting for you.</p>
      )}
    </Card>
  );
}

/**
 * Widgets in dashboard order (INFORMATION-ARCHITECTURE §5). Feature modules add theirs here; the first visible
 * widget with a primary action keeps the primary style.
 */
export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  { key: 'attendance-today', any: ['attendance.check_in.own'], span: 6, Component: TodayAttendanceWidget },
  { key: 'approvals', any: ['approval.inbox'], span: 6, Component: ApprovalsWidget },
  { key: 'team-today', any: ['attendance.read.team'], span: 6, Component: TeamTodayWidget },
];
