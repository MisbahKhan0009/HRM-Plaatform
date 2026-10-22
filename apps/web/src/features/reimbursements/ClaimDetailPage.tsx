import type { ReimbursementClaim } from '@hrm/contracts';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  KeyValueList,
  notify,
  Textarea,
} from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { PageHeader } from '../../components/page-header';
import { useErrorMessage } from '../../lib/api/errors';
import { useCan, useMe } from '../../lib/auth/me';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { FormError } from '../../lib/forms';
import { downloadUrl } from '../documents/api';
import {
  claimQueries,
  useApproveClaim,
  useDeleteClaim,
  useRejectClaim,
  useSubmitClaim,
  useWithdrawClaim,
} from './api';
import { ClaimStatusBadge } from './ClaimStatusBadge';
import { EditClaimDialog } from './EditClaimDialog';

const route = getRouteApi('/_app/reimbursements/$claimId');

type Pending = 'submit' | 'edit' | 'delete' | 'withdraw' | 'approve' | 'reject' | null;

// SCREEN-INVENTORY 5.3, USER-FLOWS 6: owner actions while draft or submitted; reviewers approve or reject.
export function ClaimDetailPage() {
  const { claimId } = route.useParams();
  const { data: claim } = useSuspenseQuery(claimQueries.detail(claimId));
  const me = useMe();
  const isOwner = me?.employee?.id === claim.employee.id;
  const canReview = useCan('reimbursement.review.team', 'reimbursement.review.all');
  const canReadAllDocuments = useCan('document.read.all');
  const canReadAll = useCan('reimbursement.read.all');
  const [dialog, setDialog] = useState<Pending>(null);
  const submit = useSubmitClaim();
  const errorMessage = useErrorMessage();

  const reviewer = canReview && !isOwner && claim.status === 'submitted';
  const actions =
    isOwner && claim.status === 'draft' ? (
      <>
        <Button variant="destructive" onClick={() => setDialog('delete')}>
          Delete
        </Button>
        <Button variant="secondary" onClick={() => setDialog('edit')}>
          Edit
        </Button>
        <Button
          variant="primary"
          loading={submit.isPending}
          onClick={async () => {
            try {
              await submit.mutateAsync({ id: claim.id, version: claim.version });
              notify.success('Claim submitted. Your manager will review it.');
            } catch (err) {
              notify.error(errorMessage(err));
            }
          }}
        >
          Submit claim
        </Button>
      </>
    ) : isOwner && claim.status === 'submitted' ? (
      <Button variant="secondary" onClick={() => setDialog('withdraw')}>
        Withdraw
      </Button>
    ) : reviewer ? (
      <>
        <Button variant="destructive" onClick={() => setDialog('reject')}>
          Reject
        </Button>
        <Button variant="primary" onClick={() => setDialog('approve')}>
          Approve
        </Button>
      </>
    ) : null;

  const receipt = claim.receiptDocumentId ? (
    isOwner || canReadAllDocuments ? (
      <Button variant="text" asChild>
        <a href={downloadUrl(claim.receiptDocumentId)} download>
          Download receipt
        </a>
      </Button>
    ) : (
      'Attached'
    )
  ) : (
    <span className="text-text-2">No receipt</span>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Transport claim"
        code={claim.claimNumber}
        breadcrumb={
          isOwner
            ? { label: 'My claims', to: '/reimbursements' }
            : canReadAll
              ? { label: 'Claims', to: '/reimbursements/manage' }
              : { label: 'Approvals', to: '/approvals' }
        }
        status={<ClaimStatusBadge status={claim.status} />}
        actions={actions}
      />
      {claim.status === 'approved' ? <Alert tone="info">Waiting for the next payroll run.</Alert> : null}
      {claim.status === 'rejected' && claim.decisionComment ? (
        <Alert tone="bad" title="Rejected">
          {claim.decisionComment}
        </Alert>
      ) : null}
      <Card>
        <KeyValueList
          items={[
            ...(isOwner
              ? []
              : [{ label: 'Employee', value: `${claim.employee.name} · ${claim.employee.employeeCode}` }]),
            { label: 'Category', value: 'Transport' },
            {
              label: 'Date of travel',
              value: <time dateTime={claim.expenseDate}>{formatDate(claim.expenseDate)}</time>,
            },
            {
              label: 'Amount',
              value: <span className="font-mono tabular-nums">{formatMoney(claim.amount.amount)}</span>,
            },
            { label: 'Purpose', value: <span className="whitespace-pre-line">{claim.description}</span> },
            { label: 'Receipt', value: receipt },
            {
              label: 'Payroll run',
              value: claim.payrollRunNumber ? (
                <span className="font-mono">{claim.payrollRunNumber}</span>
              ) : (
                <span className="text-text-2">Not yet included</span>
              ),
            },
          ]}
        />
      </Card>
      <Timeline claim={claim} />
      {dialog === 'edit' ? <EditClaimDialog claim={claim} onClose={() => setDialog(null)} /> : null}
      {dialog === 'delete' ? <DeleteDraft claim={claim} onClose={() => setDialog(null)} /> : null}
      {dialog === 'withdraw' ? <WithdrawClaim claim={claim} onClose={() => setDialog(null)} /> : null}
      {dialog === 'approve' ? <ApproveClaim claim={claim} onClose={() => setDialog(null)} /> : null}
      {dialog === 'reject' ? <RejectClaim claim={claim} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

/** History built from the claim's own timestamps (COMPONENT-SPECS §16), newest first. */
function Timeline({ claim }: { claim: ReimbursementClaim }) {
  const entries: { key: string; label: string; at: string; comment?: string | null }[] = [
    { key: 'created', label: 'Draft created', at: claim.createdAt },
  ];
  if (claim.submittedAt) entries.push({ key: 'submitted', label: 'Submitted', at: claim.submittedAt });
  if (claim.decidedAt) {
    const label =
      claim.status === 'rejected' ? 'Rejected' : claim.status === 'withdrawn' ? 'Withdrawn' : 'Approved';
    entries.push({ key: 'decided', label, at: claim.decidedAt, comment: claim.decisionComment });
  } else if (claim.status === 'withdrawn') {
    entries.push({ key: 'withdrawn', label: 'Withdrawn', at: claim.updatedAt });
  }
  if (claim.status === 'included' || claim.status === 'paid') {
    entries.push({
      key: claim.status,
      label:
        claim.status === 'paid'
          ? 'Paid with salary'
          : `Included in ${claim.payrollRunNumber ?? 'a payroll run'}`,
      at: claim.updatedAt,
    });
  }
  return (
    <Card aria-labelledby="claim-history">
      <CardHeader id="claim-history" title="History" />
      <ol className="flex flex-col gap-4">
        {[...entries].reverse().map((e, i) => (
          <li key={e.key} className="relative flex flex-col gap-1 pl-5">
            <span
              className={`absolute top-1.5 left-0 size-2 rounded-full ${i === 0 ? 'bg-accent' : 'bg-line-strong'}`}
              aria-hidden="true"
            />
            <p>{e.label}</p>
            <time dateTime={e.at} className="text-sm text-text-2">
              {formatDateTime(e.at)}
            </time>
            {e.comment ? (
              <blockquote className="rounded-control bg-ground-2 px-3 py-2 text-[15px]">
                {e.comment}
              </blockquote>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function DeleteDraft({ claim, onClose }: { claim: ReimbursementClaim; onClose: () => void }) {
  const remove = useDeleteClaim();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Delete this draft?"
      description={`${claim.claimNumber} will be removed. You can't undo this.`}
      confirmLabel="Delete draft"
      loading={remove.isPending}
      onConfirm={async () => {
        try {
          await remove.mutateAsync(claim.id);
          notify.success('Draft deleted');
          await navigate({ to: '/reimbursements' });
        } catch (err) {
          notify.error(errorMessage(err));
        }
      }}
    />
  );
}

function WithdrawClaim({ claim, onClose }: { claim: ReimbursementClaim; onClose: () => void }) {
  const withdraw = useWithdrawClaim();
  const errorMessage = useErrorMessage();
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Withdraw this request?"
      description="Your manager won't need to review it."
      confirmLabel="Withdraw request"
      cancelLabel="Keep it"
      loading={withdraw.isPending}
      onConfirm={async () => {
        try {
          await withdraw.mutateAsync({ id: claim.id, version: claim.version });
          notify.success('Claim withdrawn');
          onClose();
        } catch (err) {
          notify.error(errorMessage(err));
        }
      }}
    />
  );
}

function ApproveClaim({ claim, onClose }: { claim: ReimbursementClaim; onClose: () => void }) {
  const approve = useApproveClaim();
  const errorMessage = useErrorMessage();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open
      tone="primary"
      onOpenChange={(o) => !o && onClose()}
      title="Approve this claim?"
      description={`${claim.employee.name} will be paid ${formatMoney(claim.amount.amount)} with the next payroll run.`}
      confirmLabel="Approve claim"
      loading={approve.isPending}
      onConfirm={async () => {
        try {
          await approve.mutateAsync({
            id: claim.id,
            version: claim.version,
            comment: comment.trim() || undefined,
          });
          notify.success('Claim approved');
          onClose();
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <FormError message={error} />
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
    </ConfirmDialog>
  );
}

function RejectClaim({ claim, onClose }: { claim: ReimbursementClaim; onClose: () => void }) {
  const reject = useRejectClaim();
  const errorMessage = useErrorMessage();
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commentError = comment.trim() ? undefined : 'Add a comment so they know why.';
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Reject this claim?"
      description={`${claim.employee.name} will see your comment.`}
      confirmLabel="Reject claim"
      loading={reject.isPending}
      onConfirm={async () => {
        setTouched(true);
        if (commentError) return;
        try {
          await reject.mutateAsync({ id: claim.id, version: claim.version, comment: comment.trim() });
          notify.success('Claim rejected');
          onClose();
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <FormError message={error} />
      <Field label="Comment" error={touched ? commentError : undefined}>
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={comment}
            maxLength={1000}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        )}
      </Field>
    </ConfirmDialog>
  );
}
