import { CommentSchema, type ProfileChangeField } from '@hrm/contracts';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  KeyValueList,
  notify,
  StatusBadge,
  Table,
  TableContainer,
  TBody,
  TD,
  Textarea,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../components/page-header';
import { StepUpCancelledError } from '../../../lib/api/client';
import { useErrorMessage } from '../../../lib/api/errors';
import { formatDateTime } from '../../../lib/format';
import { employeeQueries, useDecideProfileChange } from '../api';
import { displayValue, PROFILE_FIELD_LABEL } from '../labels';

const route = getRouteApi('/_app/employees/profile-changes/$id');

// USER-FLOWS 8 step 4, SCREEN-INVENTORY approval subject page: field-by-field before/after; approve or reject.
export function ProfileChangeReviewPage() {
  const { t } = useTranslation();
  const { id } = route.useParams();
  const { data: r } = useSuspenseQuery(employeeQueries.profileChange(id));
  const decide = useDecideProfileChange();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState<'approve' | 'reject' | null>(null);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (decision: 'approve' | 'reject') => {
    setError(null);
    if (decision === 'reject' && !CommentSchema.safeParse(comment).success) {
      setCommentError('Add a comment so they know why.');
      return;
    }
    try {
      await decide.mutateAsync({
        id: r.id,
        decision,
        version: r.version,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      notify.success(decision === 'approve' ? 'Change approved and applied' : 'Request rejected');
      setOpen(null);
    } catch (err) {
      if (err instanceof StepUpCancelledError) return;
      setOpen(null);
      setError(errorMessage(err));
    }
  };

  const fields = Object.keys(r.changes) as ProfileChangeField[];
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Profile change"
        breadcrumb={{ label: 'Approvals', to: '/approvals' }}
        status={<StatusBadge status={r.status} label={t(`status.${r.status}`)} />}
        actions={
          r.status === 'pending' ? (
            <>
              <Button variant="destructive" onClick={() => setOpen('reject')}>
                Reject
              </Button>
              <Button variant="primary" onClick={() => setOpen('approve')}>
                Approve
              </Button>
            </>
          ) : null
        }
      />
      {r.status !== 'pending' ? (
        <Alert tone={r.status === 'approved' ? 'ok' : 'info'}>
          This was {t(`status.${r.status}`).toLowerCase()}
          {r.decidedAt ? ` on ${formatDateTime(r.decidedAt)}` : ''}.
          {r.decisionComment ? ` Comment: “${r.decisionComment}”` : ''}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="bad" assertive>
          {error}
        </Alert>
      ) : null}
      <Card>
        <KeyValueList
          items={[
            {
              label: 'Employee',
              value: (
                <Link
                  to="/employees/$employeeId"
                  params={{ employeeId: r.employee.id }}
                  className="text-link underline-offset-4 hover:underline"
                >
                  {r.employee.name} <span className="font-mono text-text-2">{r.employee.employeeCode}</span>
                </Link>
              ),
            },
            { label: 'Submitted', value: formatDateTime(r.createdAt) },
            { label: 'Reason', value: r.reason ?? '—' },
          ]}
        />
      </Card>
      <Card aria-labelledby="h-changes" className="flex flex-col gap-3">
        <CardHeader id="h-changes" title="Requested changes" />
        <TableContainer>
          <Table>
            <THead>
              <tr>
                <TH>Field</TH>
                <TH>Before</TH>
                <TH>After</TH>
              </tr>
            </THead>
            <TBody>
              {fields.map((f) => (
                <TR key={f}>
                  <TD className="font-medium">{PROFILE_FIELD_LABEL[f] ?? f}</TD>
                  <TD className="text-text-2">{displayValue(f, r.changes[f]?.from)}</TD>
                  <TD>{displayValue(f, r.changes[f]?.to)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      </Card>
      <ConfirmDialog
        open={open === 'approve'}
        onOpenChange={(o) => !o && setOpen(null)}
        tone="primary"
        title="Approve this change?"
        description={`The new values replace the current ones on ${r.employee.name}'s record straight away.`}
        confirmLabel="Approve"
        loading={decide.isPending}
        onConfirm={() => run('approve')}
      />
      <ConfirmDialog
        open={open === 'reject'}
        onOpenChange={(o) => {
          if (!o) {
            setOpen(null);
            setCommentError(null);
          }
        }}
        title="Reject this request?"
        description={`${r.employee.name} will see your comment.`}
        confirmLabel="Reject request"
        loading={decide.isPending}
        onConfirm={() => run('reject')}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reject-comment" className="text-sm font-medium">
            Comment
          </label>
          <Textarea
            id="reject-comment"
            value={comment}
            aria-invalid={Boolean(commentError)}
            aria-describedby={commentError ? 'reject-comment-error' : undefined}
            onChange={(e) => {
              setComment(e.target.value);
              setCommentError(null);
            }}
          />
          {commentError ? (
            <p id="reject-comment-error" className="text-sm text-bad">
              {commentError}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
