import type { FieldError, PayrollRun } from '@hrm/contracts';
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Field,
  KeyValueList,
  notify,
  StatBar,
  Textarea,
} from '@hrm/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api/client';
import { useErrorMessage } from '../../lib/api/errors';
import { useCan, useMe } from '../../lib/auth/me';
import { formatMoney, formatMonth } from '../../lib/format';
import { payrollQueries, type RunAction, usePublishPayslips, useRunAction } from './api';
import { errorCode, isStepUpCancel, Money } from './components';

export type Dialogs = 'submit' | 'approve' | 'return' | 'lock' | 'mark-paid' | 'reconcile' | 'publish';

const ACTION_VERB: Record<string, string> = {
  calculate: 'calculate',
  submit: 'submit',
  approve: 'approve',
  return: 'return',
  lock: 'lock',
  'mark-paid': 'mark as paid',
  reconcile: 'reconcile',
  publish: 'publish payslips for',
};

/** Messages for run transitions (USER-FLOWS 7 "Failures", CONTENT-STYLE §6). */
function useRunErrorMessage() {
  const { t } = useTranslation();
  const message = useErrorMessage();
  return (err: unknown, run: PayrollRun, action: string): ReactNode => {
    const code = errorCode(err);
    if (code === 'VERSION_CONFLICT')
      return 'This run was changed by someone else. Review the latest version.';
    if (code === 'INVALID_TRANSITION')
      return `This run is now ${t(`status.${run.status}`).toLowerCase()}, so you can't ${ACTION_VERB[action] ?? action} it.`;
    if (code === 'PAYROLL_RUN_LOCKED')
      return `${formatMonth(run.period.year, run.period.month)} payroll is locked. Add an adjustment to the next run instead.`;
    if (code === 'PAYROLL_MIDPERIOD_SALARY_CHANGE_UNCONFIRMED')
      return (
        <>
          A salary changes during {formatMonth(run.period.year, run.period.month)}. Set the mid-period salary
          rule in{' '}
          <a href="/settings/payroll" className="font-medium underline">
            payroll settings
          </a>{' '}
          before calculating.
        </>
      );
    if (code === 'PAYMENT_AMOUNT_MISMATCH')
      return "Payments don't match net pay yet. Check the highlighted employees on the Reconciliation tab.";
    return message(err);
  };
}

const BLOCKING_CODES = new Set([
  'PAYROLL_MISSING_SALARY_STRUCTURE',
  'PAYROLL_NEGATIVE_NET',
  'PAYROLL_CURRENCY_MISMATCH',
]);

function Totals({ run }: { run: PayrollRun }) {
  if (!run.totals) return null;
  return (
    <KeyValueList
      className="rounded-control border border-line p-4"
      items={[
        { label: 'Employees', value: <span className="font-mono">{run.employeeCount ?? 0}</span> },
        { label: 'Gross', value: <Money amount={run.totals.gross.amount} /> },
        { label: 'Deductions', value: <Money amount={run.totals.deductions.amount} /> },
        { label: 'Net pay', value: <Money amount={run.totals.net.amount} className="font-semibold" /> },
      ]}
    />
  );
}

/**
 * The run's next step by status and permission (SCREEN-INVENTORY 9.2) and its confirmations (COMPONENT-SPECS §12,
 * CONTENT-STYLE §7.1). Transitions send the version read; money transitions send an Idempotency-Key.
 */
export function RunActions({
  run,
  onError,
  onBlocking,
  onTab,
}: {
  run: PayrollRun;
  onError: (message: ReactNode | null) => void;
  onBlocking: (errors: FieldError[]) => void;
  onTab: (tab: string) => void;
}) {
  const queryClient = useQueryClient();
  const me = useMe();
  const canPrepare = useCan('payroll.prepare');
  const canApprove = useCan('payroll.approve');
  const canLock = useCan('payroll.lock');
  const canPay = useCan('payroll.pay');
  const mutation = useRunAction(run.id);
  const publish = usePublishPayslips(run.id);
  const runError = useRunErrorMessage();
  const [open, setOpen] = useState<Dialogs | null>(null);
  const month = formatMonth(run.period.year, run.period.month);
  const n = run.employeeCount ?? 0;
  const net = run.totals?.net.amount ?? '0.00';
  const recon = useQuery({
    ...payrollQueries.reconciliation(run.id),
    enabled: run.status === 'locked',
  });

  const act = async (body: RunAction, success: string) => {
    onError(null);
    try {
      await mutation.mutateAsync(body);
      notify.success(success);
      setOpen(null);
      if (body.action === 'calculate') onBlocking([]);
    } catch (err) {
      if (isStepUpCancel(err)) return;
      const code = errorCode(err);
      if (code === 'SELF_APPROVAL_NOTE_REQUIRED') throw err;
      setOpen(null);
      if (code === 'VERSION_CONFLICT' || code === 'INVALID_TRANSITION')
        await queryClient.invalidateQueries({ queryKey: payrollQueries.run(run.id).queryKey });
      if (err instanceof ApiError && BLOCKING_CODES.has(err.code)) {
        onBlocking(err.errors);
        onTab('validation');
        return;
      }
      if (code === 'PAYMENT_AMOUNT_MISMATCH')
        onTab(body.action === 'mark-paid' ? 'payments' : 'reconciliation');
      onError(runError(err, run, body.action));
    }
  };

  const doPublish = async () => {
    onError(null);
    try {
      const result = await publish.mutateAsync();
      notify.success(`${result.published} payslips published`);
      setOpen(null);
    } catch (err) {
      if (isStepUpCancel(err)) return;
      setOpen(null);
      await queryClient.invalidateQueries({ queryKey: payrollQueries.run(run.id).queryKey });
      onError(runError(err, run, 'publish'));
    }
  };

  const busy = mutation.isPending || publish.isPending;
  const primary: ReactNode[] = [];
  const secondary: ReactNode[] = [];
  const btn = (key: string, label: string, onClick: () => void, opts: { disabled?: boolean } = {}) => (
    <Button
      key={key}
      variant="secondary"
      onClick={onClick}
      disabled={busy || (opts.disabled ?? false)}
      loading={key === 'calculate' && mutation.isPending}
    >
      {label}
    </Button>
  );
  const main = (key: string, label: string, onClick: () => void, opts: { disabled?: boolean } = {}) => (
    <Button
      key={key}
      variant="primary"
      onClick={onClick}
      disabled={busy || (opts.disabled ?? false)}
      loading={busy && (key === 'calculate' || open === key)}
    >
      {label}
    </Button>
  );
  const calc = () => void act({ action: 'calculate', version: run.version }, 'Payroll calculated');
  const blocked = (run.validation?.blockingItems ?? 0) > 0;
  const unpublished = !run.payslipsPublishedAt;

  switch (run.status) {
    case 'draft':
    case 'returned':
      if (canPrepare) primary.push(main('calculate', 'Calculate', calc));
      break;
    case 'calculated':
      if (canApprove) secondary.push(btn('return', 'Return to draft', () => setOpen('return')));
      if (canPrepare) {
        secondary.push(btn('calculate', 'Recalculate', calc));
        primary.push(main('submit', 'Submit for approval', () => setOpen('submit'), { disabled: blocked }));
      }
      break;
    case 'submitted':
      if (canApprove) {
        secondary.push(btn('return', 'Return to draft', () => setOpen('return')));
        primary.push(main('approve', 'Approve run', () => setOpen('approve')));
      }
      break;
    case 'approved':
      if (canLock) primary.push(main('lock', 'Lock run', () => setOpen('lock')));
      break;
    case 'locked':
      if (canPay) {
        if (unpublished) secondary.push(btn('publish', 'Publish payslips', () => setOpen('publish')));
        if (recon.data?.balanced) primary.push(main('mark-paid', 'Mark as paid', () => setOpen('mark-paid')));
        else primary.push(main('record', 'Record payments', () => onTab('payments')));
      }
      break;
    case 'paid':
      if (canPay) {
        if (unpublished) secondary.push(btn('publish', 'Publish payslips', () => setOpen('publish')));
        primary.push(main('reconcile', 'Mark as reconciled', () => setOpen('reconcile')));
      }
      break;
    case 'reconciled':
      if (canPay && unpublished) primary.push(main('publish', 'Publish payslips', () => setOpen('publish')));
      break;
  }

  const summary = run.totals ? (
    <StatBar
      stats={[
        { label: 'Employees', value: n },
        { label: 'Net pay', value: <Money amount={net} className="text-xl" /> },
      ]}
    />
  ) : null;
  const confirmProps = (key: Dialogs) => ({
    open: open === key,
    onOpenChange: (o: boolean) => !o && setOpen(null),
    loading: busy,
    tone: 'primary' as const,
  });
  const self = Boolean(me && run.preparedBy === me.user.id);

  return (
    <>
      {secondary}
      {primary}
      <ConfirmDialog
        {...confirmProps('submit')}
        title={`Submit ${month} payroll?`}
        description={`${n} employees, net pay ${formatMoney(net)}. Approvers will be emailed. You can't edit the run while it's waiting for approval.`}
        summary={<Totals run={run} />}
        confirmLabel="Submit for approval"
        onConfirm={() => act({ action: 'submit', version: run.version }, 'Submitted for approval')}
      />
      <ConfirmDialog
        {...confirmProps('lock')}
        title={`Lock ${month} payroll?`}
        description={`After locking, nothing in this run can be changed. Corrections go into an adjustment in a later run. Type ${run.runNumber} to confirm.`}
        summary={summary}
        typeToConfirm={run.runNumber}
        confirmLabel="Lock run"
        onConfirm={() => act({ action: 'lock', version: run.version }, 'Run locked')}
      />
      <ConfirmDialog
        {...confirmProps('mark-paid')}
        title={`Mark ${month} payroll as paid?`}
        description="Every employee has a recorded payment. Claims paid through this run are marked paid."
        summary={summary}
        confirmLabel="Mark as paid"
        onConfirm={() => act({ action: 'mark-paid', version: run.version }, 'Run marked as paid')}
      />
      <ConfirmDialog
        {...confirmProps('reconcile')}
        title={`Mark ${month} payroll as reconciled?`}
        description="Gross, deductions, net and payments match. The run will be closed."
        summary={<Totals run={run} />}
        confirmLabel="Mark as reconciled"
        onConfirm={() => act({ action: 'reconcile', version: run.version }, 'Run reconciled')}
      />
      <ConfirmDialog
        {...confirmProps('publish')}
        title={`Publish payslips for ${month}?`}
        description={`${n} employees will be able to see their payslip. We'll email them. This can't be undone. Type ${run.runNumber} to confirm.`}
        typeToConfirm={run.runNumber}
        confirmLabel="Publish payslips"
        onConfirm={doPublish}
      />
      {open === 'return' ? (
        <ReturnDialog
          run={run}
          loading={busy}
          onClose={() => setOpen(null)}
          onConfirm={(reason) => act({ action: 'return', version: run.version, reason }, 'Returned to draft')}
        />
      ) : null}
      {open === 'approve' ? (
        <ApproveDialog
          run={run}
          self={self}
          loading={busy}
          onClose={() => setOpen(null)}
          onConfirm={(body) => act({ action: 'approve', version: run.version, ...body }, 'Run approved')}
        />
      ) : null}
    </>
  );
}

function ReturnDialog({
  run,
  loading,
  onClose,
  onConfirm,
}: {
  run: PayrollRun;
  loading: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Return this run to draft?"
      description="The preparer will be emailed with your comment. Calculations will need to be run again."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={loading}
            onClick={() => {
              if (!reason.trim()) {
                setError('Enter a reason so the preparer knows what to fix.');
                return;
              }
              void onConfirm(reason.trim());
            }}
          >
            Return to draft
          </Button>
        </>
      }
    >
      <p className="font-mono text-sm text-text-2">{run.runNumber}</p>
      <Field label="Reason" error={error}>
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={reason}
            maxLength={1000}
            onChange={(e) => {
              setReason(e.target.value);
              setError(undefined);
            }}
          />
        )}
      </Field>
    </Dialog>
  );
}

/** Level 3 approval; a self-approval needs a justification of at least 20 characters and a review check (D-007). */
function ApproveDialog({
  run,
  self,
  loading,
  onClose,
  onConfirm,
}: {
  run: PayrollRun;
  self: boolean;
  loading: boolean;
  onClose: () => void;
  onConfirm: (body: { comment?: string; selfApprovalNote?: string }) => Promise<void>;
}) {
  const month = formatMonth(run.period.year, run.period.month);
  const [needsNote, setNeedsNote] = useState(self);
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [noteError, setNoteError] = useState<string | undefined>();
  const [checkError, setCheckError] = useState<string | undefined>();
  const message = useErrorMessage();
  const noteRef = useRef<HTMLDivElement>(null);
  const n = run.employeeCount ?? 0;
  const net = run.totals?.net.amount ?? '0.00';

  const confirm = async () => {
    let ok = true;
    if (needsNote && note.trim().length < 20) {
      setNoteError("Explain why you're approving your own run (at least 20 characters).");
      ok = false;
    }
    if (needsNote && !reviewed) {
      setCheckError('Confirm you have reviewed the totals and validation results.');
      ok = false;
    }
    if (!ok) return;
    try {
      await onConfirm({
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(needsNote ? { selfApprovalNote: note.trim() } : {}),
      });
    } catch (err) {
      // SELF_APPROVAL_NOTE_REQUIRED: the server knows this approver prepared or submitted the run.
      setNeedsNote(true);
      setNoteError(message(err));
      setTimeout(() => noteRef.current?.querySelector('textarea')?.focus(), 0);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={needsNote ? 'Approve your own payroll run?' : `Approve ${month} payroll?`}
      description={
        needsNote
          ? "You prepared this run. Approving it yourself is allowed but flagged for review. Explain why another approver isn't available."
          : `${n} employees, net pay ${formatMoney(net)}. After approval the run can be locked for payment.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={loading} onClick={() => void confirm()}>
            Approve run
          </Button>
        </>
      }
    >
      <Totals run={run} />
      {needsNote ? (
        <>
          <Alert tone="warn">The run will show a "Self-approved" badge permanently.</Alert>
          <div ref={noteRef}>
            <Field label="Reason for approving your own run" error={noteError} hint="At least 20 characters.">
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  value={note}
                  maxLength={1000}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setNoteError(undefined);
                  }}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-col gap-1">
            <Checkbox
              label="I have reviewed the totals and validation results"
              checked={reviewed}
              onChange={(e) => {
                setReviewed(e.target.checked);
                setCheckError(undefined);
              }}
            />
            {checkError ? <p className="text-sm text-bad">{checkError}</p> : null}
          </div>
        </>
      ) : (
        <Field label="Comment" optional>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={comment}
              maxLength={1000}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
        </Field>
      )}
    </Dialog>
  );
}
