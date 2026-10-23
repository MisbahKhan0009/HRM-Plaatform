import type { AttendanceCorrection } from '@hrm/contracts';
import { Button, Card, CardHeader, ConfirmDialog, LoadingBlock, notify, StatusBadge } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorMessage } from '../../lib/api/errors';
import { formatDate, formatShortDate, formatTime } from '../../lib/format';
import { attendanceQueries, useWithdrawCorrection } from './api';

export function proposedText(c: Pick<AttendanceCorrection, 'proposedCheckInAt' | 'proposedCheckOutAt'>) {
  return [
    c.proposedCheckInAt ? `check-in ${formatTime(c.proposedCheckInAt)}` : null,
    c.proposedCheckOutAt ? `check-out ${formatTime(c.proposedCheckOutAt)}` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** "My corrections" on `/attendance` (SCREEN-INVENTORY §3.1), with withdraw while pending (DOMAIN-MODEL §5.4). */
export function MyCorrections({ employeeId, canRequest }: { employeeId: string; canRequest: boolean }) {
  const { t } = useTranslation();
  const list = useQuery(attendanceQueries.corrections({ page: 1, pageSize: 10, employeeId }));
  const withdraw = useWithdrawCorrection();
  const errorMessage = useErrorMessage();
  const [withdrawing, setWithdrawing] = useState<AttendanceCorrection | null>(null);
  return (
    <Card aria-labelledby="my-corrections">
      <CardHeader id="my-corrections" title="My corrections" />
      {list.isPending ? (
        <LoadingBlock label="corrections" rows={3} />
      ) : !list.data?.data.length ? (
        <p className="text-text-2">
          {canRequest
            ? 'No corrections yet. Choose a day in the calendar to request one.'
            : 'No corrections yet.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {list.data.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0">
                <Link
                  to="/attendance/corrections/$correctionId"
                  params={{ correctionId: c.id }}
                  className="font-medium text-link underline-offset-4 hover:underline"
                >
                  <time dateTime={c.workDate}>{formatShortDate(c.workDate)}</time>
                </Link>
                <span className="text-text-2"> · {proposedText(c)}</span>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={c.status} label={t(`status.${c.status}`)} />
                {c.status === 'pending' && canRequest ? (
                  <Button variant="text" className="text-bad" onClick={() => setWithdrawing(c)}>
                    Withdraw
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(o) => !o && setWithdrawing(null)}
        title="Withdraw correction"
        description={
          withdrawing
            ? `Your correction for ${formatDate(withdrawing.workDate)} will be withdrawn and removed from your manager's approvals. The day keeps its recorded times.`
            : ''
        }
        confirmLabel="Withdraw correction"
        loading={withdraw.isPending}
        onConfirm={async () => {
          if (!withdrawing) return;
          try {
            await withdraw.mutateAsync({ id: withdrawing.id, version: withdrawing.version });
            notify.success('Correction withdrawn');
            setWithdrawing(null);
          } catch (err) {
            notify.error(errorMessage(err));
          }
        }}
      />
    </Card>
  );
}
