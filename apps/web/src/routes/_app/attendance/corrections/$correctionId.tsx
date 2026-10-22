import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  KeyValueList,
  LoadingBlock,
  notify,
  StatusBadge,
  Textarea,
} from '@hrm/ui';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../../components/page-header';
import {
  attendanceQueries,
  ensureFound,
  useDecideCorrection,
  useWithdrawCorrection,
} from '../../../../features/attendance/api';
import { EventTimeline } from '../../../../features/attendance/event-timeline';
import { useErrorMessage } from '../../../../lib/api/errors';
import { can, requireAny, useCan, useMe } from '../../../../lib/auth/me';
import { formatDate, formatDateTime, formatTime } from '../../../../lib/format';

export const Route = createFileRoute('/_app/attendance/corrections/$correctionId')({
  beforeLoad: ({ context }) =>
    requireAny(context.queryClient, [
      'attendance.correction.request.own',
      'attendance.correction.review.team',
      'attendance.correction.review.all',
    ]),
  loader: ({ context, params }) =>
    ensureFound(context.queryClient.ensureQueryData(attendanceQueries.correction(params.correctionId))),
  pendingComponent: () => <LoadingBlock label="correction" />,
  component: CorrectionPage,
});

type Dialog = 'reject' | 'withdraw' | null;

// The correction's own page, where the decision is made (USER-FLOWS §4 step 4, API-CATALOGUE §10): the reviewer sees
// the recorded events, the proposed times and the reason; the requester sees the outcome and can withdraw.
function CorrectionPage() {
  const { t } = useTranslation();
  const { correctionId } = Route.useParams();
  const { data: c } = useSuspenseQuery(attendanceQueries.correction(correctionId));
  const day = useQuery(attendanceQueries.day(c.employee.id, c.workDate));
  const me = useMe();
  const queryClient = useQueryClient();
  const decide = useDecideCorrection();
  const withdraw = useWithdrawCorrection();
  const errorMessage = useErrorMessage();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);

  const own = me?.employee?.id === c.employee.id;
  const pending = c.status === 'pending';
  const canReview =
    useCan('attendance.correction.review.team', 'attendance.correction.review.all') && !own && pending;
  const canWithdraw = useCan('attendance.correction.request.own') && own && pending;
  const back =
    !own && can(me, 'approval.inbox')
      ? { label: 'Approvals', to: '/approvals' }
      : { label: 'My attendance', to: '/attendance' };

  const fail = (err: unknown) => {
    notify.error(errorMessage(err));
    void queryClient.invalidateQueries({ queryKey: attendanceQueries.correction(correctionId).queryKey });
  };
  const approve = async () => {
    try {
      await decide.mutateAsync({ id: c.id, version: c.version, decision: 'approve' });
      notify.success('Correction approved');
    } catch (err) {
      fail(err);
    }
  };
  const reject = async () => {
    if (!comment.trim()) {
      setCommentError('Tell the employee why the correction is rejected.');
      return;
    }
    try {
      await decide.mutateAsync({ id: c.id, version: c.version, decision: 'reject', comment: comment.trim() });
      notify.success('Correction rejected');
      setDialog(null);
    } catch (err) {
      setDialog(null);
      fail(err);
    }
  };
  const doWithdraw = async () => {
    try {
      await withdraw.mutateAsync({ id: c.id, version: c.version });
      notify.success('Correction withdrawn');
      setDialog(null);
    } catch (err) {
      setDialog(null);
      fail(err);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Attendance correction"
        breadcrumb={back}
        status={<StatusBadge status={c.status} label={t(`status.${c.status}`)} />}
        actions={
          canReview ? (
            <>
              <Button variant="destructive" onClick={() => setDialog('reject')}>
                Reject
              </Button>
              <Button
                variant="primary"
                loading={decide.isPending && dialog === null}
                onClick={() => void approve()}
              >
                Approve
              </Button>
            </>
          ) : canWithdraw ? (
            <Button variant="destructive" onClick={() => setDialog('withdraw')}>
              Withdraw
            </Button>
          ) : null
        }
      />
      <Card aria-labelledby="request">
        <CardHeader id="request" title="Request" />
        <KeyValueList
          items={[
            { label: 'Employee', value: `${c.employee.name} · ${c.employee.employeeCode}` },
            {
              label: 'Date',
              value: (
                <Link
                  to="/attendance/$employeeId/$workDate"
                  params={{ employeeId: c.employee.id, workDate: c.workDate }}
                  className="text-link underline-offset-4 hover:underline"
                >
                  {formatDate(c.workDate)}
                </Link>
              ),
            },
            {
              label: 'Proposed check-in',
              value: c.proposedCheckInAt ? formatTime(c.proposedCheckInAt) : 'No change',
            },
            {
              label: 'Proposed check-out',
              value: c.proposedCheckOutAt ? formatDateTime(c.proposedCheckOutAt) : 'No change',
            },
            {
              label: 'Reason',
              value: <blockquote className="rounded-control bg-ground-2 px-3 py-2">{c.reason}</blockquote>,
            },
            { label: 'Submitted', value: <time dateTime={c.createdAt}>{formatDateTime(c.createdAt)}</time> },
            ...(c.decidedAt
              ? [
                  {
                    label: c.status === 'rejected' ? 'Rejected' : 'Approved',
                    value: <time dateTime={c.decidedAt}>{formatDateTime(c.decidedAt)}</time>,
                  },
                ]
              : []),
            ...(c.decisionComment
              ? [
                  {
                    label: 'Comment',
                    value: (
                      <blockquote className="rounded-control bg-ground-2 px-3 py-2">
                        {c.decisionComment}
                      </blockquote>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
      <Card aria-labelledby="recorded">
        <CardHeader
          id="recorded"
          title="Recorded events"
          actions={
            day.data?.record ? (
              <StatusBadge status={day.data.record.status} label={t(`status.${day.data.record.status}`)} />
            ) : null
          }
        />
        {day.isPending ? (
          <LoadingBlock label="events" rows={2} />
        ) : day.isError ? (
          <p className="text-text-2">{errorMessage(day.error)}</p>
        ) : (
          <EventTimeline events={day.data.events} />
        )}
        <p className="mt-4 text-sm text-text-2">
          Approving adds a correction event and recomputes the day. The original events are kept.
        </p>
      </Card>

      <ConfirmDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => {
          if (!o) {
            setDialog(null);
            setCommentError(null);
          }
        }}
        title="Reject correction"
        description={`${c.employee.name}'s day on ${formatDate(c.workDate)} keeps its recorded times. They'll see your comment.`}
        confirmLabel="Reject correction"
        loading={decide.isPending}
        onConfirm={reject}
      >
        <Field label="Comment" error={commentError ?? undefined}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                if (commentError) setCommentError(null);
              }}
            />
          )}
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'withdraw'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Withdraw correction"
        description={`Your correction for ${formatDate(c.workDate)} will be withdrawn and removed from your manager's approvals. The day keeps its recorded times.`}
        confirmLabel="Withdraw correction"
        loading={withdraw.isPending}
        onConfirm={doWithdraw}
      />
    </div>
  );
}
