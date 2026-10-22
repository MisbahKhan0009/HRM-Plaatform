import type { LeaveRequestDto } from '@hrm/contracts';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  KeyValueList,
  notify,
  StatBar,
  StatusBadge,
  Textarea,
} from '@hrm/ui';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../components/page-header';
import { ApiError } from '../../../lib/api/client';
import { useErrorMessage } from '../../../lib/api/errors';
import { useCan, useMe } from '../../../lib/auth/me';
import { formatDateTime, formatDays, todayIso } from '../../../lib/format';
import { type LeaveAction, leaveQueries, useLeaveAction } from '../api';
import { formatLeaveDates, formatQty } from '../format';

const route = getRouteApi('/_app/leave/requests/$requestId');

type DialogKind = 'withdraw' | 'cancel' | 'reject' | 'cancelReject';

const DIALOG: Record<
  DialogKind,
  {
    action: LeaveAction;
    title: string;
    body: (r: LeaveRequestDto) => string;
    confirm: string;
    comment?: 'required' | 'optional';
  }
> = {
  withdraw: {
    action: 'withdraw',
    title: 'Withdraw this request?',
    body: () => "Your manager won't need to review it. The reserved days go back to your balance.",
    confirm: 'Withdraw request',
  },
  cancel: {
    action: 'cancel',
    title: 'Cancel approved leave?',
    body: () => "Your manager will review the cancellation. Your balance is restored once it's approved.",
    confirm: 'Request cancellation',
    comment: 'optional',
  },
  reject: {
    action: 'reject',
    title: 'Reject this leave request?',
    body: (r) => `${r.employeeName} will see your comment. The reserved days go back to their balance.`,
    confirm: 'Reject request',
    comment: 'required',
  },
  cancelReject: {
    action: 'cancelReject',
    title: 'Reject this cancellation?',
    body: (r) => `${r.employeeName} will see your comment. The leave stays approved.`,
    confirm: 'Reject cancellation',
    comment: 'required',
  },
};

// SCREEN-INVENTORY 4.3, USER-FLOWS 5.2 and 5.3.
export function LeaveRequestDetailPage() {
  const { t } = useTranslation();
  const { requestId } = route.useParams();
  const { data: r, refetch } = useSuspenseQuery(leaveQueries.request(requestId));
  const me = useMe();
  const errorMessage = useErrorMessage();
  const act = useLeaveAction();
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | undefined>();
  const [pendingAction, setPendingAction] = useState<LeaveAction | null>(null);

  const isOwn = me?.employee?.id === r.employeeId;
  const reviewTeam = useCan('leave.request.review.team');
  const reviewAll = useCan('leave.request.review.all');
  const canReview = !isOwn && (reviewTeam || reviewAll);
  const canRead = useCan('leave.read.all', 'leave.read.team');
  const canReadAll = useCan('leave.read.all');
  const today = todayIso();

  const canWithdraw = isOwn && r.status === 'pending';
  const canCancel = (isOwn || reviewAll) && r.status === 'approved' && r.endDate >= today;
  const canDecide = canReview && r.status === 'pending';
  const canDecideCancellation = canReview && r.status === 'cancellation_pending';
  // USER-FLOWS 5.3: HR deciding through `leave.request.review.all` acts for the approver (audited, D-014).
  const onBehalf = (canDecide || canDecideCancellation) && reviewAll && !reviewTeam;

  const run = async (action: LeaveAction, text?: string) => {
    setPendingAction(action);
    try {
      await act.mutateAsync({ id: r.id, action, version: r.version, comment: text });
      notify.success(SUCCESS[action]);
      setDialog(null);
      setComment('');
    } catch (err) {
      notify.error(errorMessage(err));
      if (err instanceof ApiError && CLOSES_DIALOG.has(err.code)) {
        setDialog(null);
        void refetch();
      }
    } finally {
      setPendingAction(null);
    }
  };

  const open = (kind: DialogKind) => {
    setComment('');
    setCommentError(undefined);
    setDialog(kind);
  };
  const current = dialog ? DIALOG[dialog] : null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={r.leaveTypeName}
        code={r.requestNumber}
        breadcrumb={
          isOwn
            ? { label: 'My leave', to: '/leave' }
            : canReadAll
              ? { label: 'Leave management', to: '/leave/manage' }
              : { label: 'Approvals', to: '/approvals' }
        }
        status={<StatusBadge status={r.status} label={t(`status.${r.status}`)} />}
        actions={
          <>
            {canWithdraw ? <Button onClick={() => open('withdraw')}>Withdraw request</Button> : null}
            {canCancel ? <Button onClick={() => open('cancel')}>Request cancellation</Button> : null}
            {canDecide ? (
              <>
                <Button variant="destructive" onClick={() => open('reject')}>
                  Reject
                </Button>
                <Button
                  variant="primary"
                  loading={pendingAction === 'approve'}
                  onClick={() => void run('approve')}
                >
                  Approve
                </Button>
              </>
            ) : null}
            {canDecideCancellation ? (
              <>
                <Button variant="destructive" onClick={() => open('cancelReject')}>
                  Reject cancellation
                </Button>
                <Button
                  variant="primary"
                  loading={pendingAction === 'cancelApprove'}
                  onClick={() => void run('cancelApprove')}
                >
                  Approve cancellation
                </Button>
              </>
            ) : null}
          </>
        }
      />
      {onBehalf ? (
        <Alert tone="info">You are acting on behalf of the approver. This is recorded.</Alert>
      ) : null}
      {r.status === 'cancellation_pending' && isOwn ? (
        <Alert tone="warn">
          Your cancellation is waiting for your manager. The leave stays approved until then.
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Card aria-labelledby="details">
          <CardHeader id="details" title="Details" />
          <KeyValueList
            items={[
              { label: 'Employee', value: `${r.employeeName} · ${r.employeeCode}` },
              { label: 'Leave type', value: r.leaveTypeName },
              { label: 'Dates', value: formatLeaveDates(r) },
              {
                label: 'Working days',
                value: <span className="font-mono">{formatDays(r.requestedUnits)}</span>,
              },
              {
                label: 'Reason',
                value: r.reason ? <span className="whitespace-pre-line">{r.reason}</span> : '—',
              },
              ...(r.onBehalf ? [{ label: 'Filed by', value: 'HR on the employee’s behalf' }] : []),
            ]}
          />
        </Card>
        <BalanceImpact request={r} isOwn={isOwn} canRead={canRead} />
      </div>
      {canRead && !isOwn ? <AlsoOnLeave request={r} /> : null}
      <Card aria-labelledby="history">
        <CardHeader id="history" title="History" />
        <Timeline request={r} />
      </Card>
      <ConfirmDialog
        open={current !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={current?.title ?? ''}
        description={current ? current.body(r) : ''}
        confirmLabel={current?.confirm ?? ''}
        loading={act.isPending}
        onConfirm={() => {
          if (!current) return;
          const text = comment.trim();
          if (current.comment === 'required' && !text) {
            setCommentError('Add a comment so the employee knows why.');
            return;
          }
          void run(current.action, text || undefined);
        }}
      >
        {current?.comment ? (
          <Field
            label={current.action === 'cancel' ? 'Reason' : 'Comment'}
            optional={current.comment === 'optional'}
            error={commentError}
          >
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                maxLength={1000}
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  if (e.target.value.trim()) setCommentError(undefined);
                }}
              />
            )}
          </Field>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

/** Errors after which the action is no longer possible as shown: close the dialog and reload the request. */
const CLOSES_DIALOG = new Set(['VERSION_CONFLICT', 'INVALID_TRANSITION', 'SELF_APPROVAL_FORBIDDEN']);

const SUCCESS: Record<LeaveAction, string> = {
  withdraw: 'Leave request withdrawn',
  approve: 'Leave request approved',
  reject: 'Leave request rejected',
  cancel: 'Cancellation requested. Your manager will review it.',
  cancelApprove: 'Cancellation approved',
  cancelReject: 'Cancellation rejected',
};

/** The employee's balance for this type as the API reports it (USER-FLOWS 5.2: balance before deciding). */
function BalanceImpact({
  request: r,
  isOwn,
  canRead,
}: {
  request: LeaveRequestDto;
  isOwn: boolean;
  canRead: boolean;
}) {
  const year = Number(r.startDate.slice(0, 4));
  const own = useQuery({ ...leaveQueries.myBalances(year), enabled: isOwn });
  const other = useQuery({
    ...leaveQueries.balances({
      year,
      employeeId: r.employeeId,
      leaveTypeId: r.leaveTypeId,
      page: 1,
      pageSize: 1,
    }),
    enabled: !isOwn && canRead,
  });
  const balance = isOwn
    ? own.data?.data.find((b) => b.leaveTypeId === r.leaveTypeId)
    : other.data?.data.find((b) => b.leaveTypeId === r.leaveTypeId);
  if (!isOwn && !canRead) return null;
  return (
    <Card aria-labelledby="balance">
      <CardHeader id="balance" label={String(year)} title={`${r.leaveTypeCode} balance`} />
      {balance ? (
        <>
          <StatBar
            stats={[
              { label: 'Available', value: formatQty(balance.available) },
              { label: 'Reserved', value: formatQty(balance.reserved) },
            ]}
          />
          <p className="mt-3 text-sm text-text-2">
            {r.status === 'pending'
              ? `This request holds ${formatDays(r.requestedUnits)} in Reserved until it's decided.`
              : `Used this year: ${formatDays(balance.used)}.`}
          </p>
        </>
      ) : (
        <p className="text-text-2">
          {own.isPending || other.isPending ? 'Loading…' : 'No balance recorded.'}
        </p>
      )}
    </Card>
  );
}

/** Team members on leave on the same dates (USER-FLOWS 5.2, readers only). */
function AlsoOnLeave({ request: r }: { request: LeaveRequestDto }) {
  const cal = useQuery(leaveQueries.calendar(r.startDate, r.endDate));
  const others = (cal.data?.data ?? []).filter((e) => e.employeeId !== r.employeeId);
  if (!cal.data) return null;
  return (
    <Card aria-labelledby="also">
      <CardHeader id="also" title="Also on leave on these dates" />
      {others.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {others.map((e) => (
            <li
              key={`${e.employeeId}-${e.startDate}-${e.halfDayPart ?? ''}`}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <span>{e.employeeName}</span>
              <span className="text-sm text-text-2">
                {formatLeaveDates(e)}
                {e.status !== 'approved' ? ' · Pending' : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-text-2">Nobody else is on leave then.</p>
      )}
    </Card>
  );
}

type Event = { key: string; status: string; label: string; at: string | null; note?: string | null };

/**
 * History from the request's own fields (COMPONENT-SPECS §16). The leave API has no per-request approval history, so
 * cancellation steps show the time of the latest change only.
 */
function Timeline({ request: r }: { request: LeaveRequestDto }) {
  const { t } = useTranslation();
  const events: Event[] = [];
  if (r.submittedAt)
    events.push({
      key: 'submitted',
      status: 'submitted',
      label: r.onBehalf ? 'Submitted by HR on the employee’s behalf' : 'Submitted',
      at: r.submittedAt,
    });
  if (r.decidedAt) {
    const rejected = r.status === 'rejected';
    events.push({
      key: 'decided',
      status: rejected ? 'rejected' : 'approved',
      label: rejected ? 'Rejected' : 'Approved',
      at: r.decidedAt,
      note: r.decisionComment,
    });
  }
  if (r.status === 'withdrawn')
    events.push({ key: 'withdrawn', status: 'withdrawn', label: 'Withdrawn', at: r.updatedAt });
  const cancellationAsked =
    r.status === 'cancellation_pending' ||
    r.status === 'cancelled' ||
    (r.status === 'approved' && r.cancellationReason !== null);
  if (cancellationAsked)
    events.push({
      key: 'cancel',
      status: 'cancellation_pending',
      label: 'Cancellation requested',
      at: r.status === 'cancellation_pending' ? r.updatedAt : null,
      note: r.cancellationReason,
    });
  if (r.status === 'cancelled')
    events.push({ key: 'cancelled', status: 'cancelled', label: 'Cancellation approved', at: r.updatedAt });
  if (r.status === 'approved' && r.cancellationReason !== null)
    events.push({ key: 'kept', status: 'approved', label: 'Cancellation rejected', at: r.updatedAt });
  if (r.status === 'pending' || r.status === 'cancellation_pending')
    events.push({ key: 'waiting', status: 'pending', label: 'Waiting for the approver', at: null });

  return (
    <ol className="flex flex-col gap-4">
      {[...events].reverse().map((e, i) => (
        <li key={e.key} className="relative flex gap-3 pl-5">
          <span
            className={`absolute top-1.5 left-0 size-2 rounded-full ${i === 0 ? 'bg-accent' : 'bg-line-strong'}`}
            aria-hidden="true"
          />
          <div className="flex flex-col gap-1">
            <p className="flex flex-wrap items-center gap-2">
              <StatusBadge status={e.status} label={t(`status.${e.status}`)} />
              <span className="text-text-2">{e.label}</span>
            </p>
            {e.at ? (
              <time dateTime={e.at} className="text-sm text-text-2">
                {formatDateTime(e.at)}
              </time>
            ) : null}
            {e.note ? (
              <blockquote className="rounded-control bg-ground-2 px-3 py-2 text-[15px] whitespace-pre-line">
                {e.note}
              </blockquote>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
