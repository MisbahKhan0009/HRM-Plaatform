import { Button, Card, CardHeader, KeyValueList, LoadingBlock, StatusBadge } from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../components/page-header';
import { approvalQueries, SUBJECT_LABEL, subjectPath } from '../../../features/approvals/api';
import { requireAny } from '../../../lib/auth/me';
import { formatDateTime } from '../../../lib/format';

export const Route = createFileRoute('/_app/approvals/$approvalId')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['approval.inbox']),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(approvalQueries.detail(params.approvalId)),
  pendingComponent: () => <LoadingBlock label="approval" />,
  component: ApprovalDetailPage,
});

// The approval history (COMPONENT-SPECS §16) with a link to the subject, where the decision is made.
function ApprovalDetailPage() {
  const { t } = useTranslation();
  const { approvalId } = Route.useParams();
  const { data } = useSuspenseQuery(approvalQueries.detail(approvalId));
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={SUBJECT_LABEL[data.subjectType]}
        breadcrumb={{ label: 'Approvals', to: '/approvals' }}
        status={<StatusBadge status={data.state} label={t(`status.${data.state}`)} />}
        actions={
          <Button variant="primary" asChild>
            <a href={subjectPath(data.subjectType, data.subjectId)}>Open request →</a>
          </Button>
        }
      />
      <Card>
        <KeyValueList
          items={[
            {
              label: 'Employee',
              value: data.subjectEmployee
                ? `${data.subjectEmployee.name} · ${data.subjectEmployee.employeeCode}`
                : '—',
            },
            { label: 'Requested by', value: data.requester.name },
            { label: 'Submitted', value: formatDateTime(data.createdAt) },
          ]}
        />
      </Card>
      <Card aria-labelledby="history">
        <CardHeader id="history" title="History" />
        <ol className="flex flex-col gap-4">
          {[...data.steps].reverse().map((s, i) => (
            <li key={s.sequence} className="relative flex gap-3 pl-5">
              <span
                className={`absolute top-1.5 left-0 size-2 rounded-full ${i === 0 ? 'bg-accent' : 'bg-line-strong'}`}
                aria-hidden="true"
              />
              <div className="flex flex-col gap-1">
                <p>
                  <StatusBadge status={s.decision} label={t(`status.${s.decision}`)} />{' '}
                  <span className="text-text-2">
                    {s.decidedByName ??
                      s.approverName ??
                      (s.approverPermission ? 'Any authorised reviewer' : '')}
                    {s.onBehalf ? ' (on behalf)' : ''}
                  </span>
                </p>
                {s.decidedAt ? (
                  <time dateTime={s.decidedAt} className="text-sm text-text-2">
                    {formatDateTime(s.decidedAt)}
                  </time>
                ) : null}
                {s.comment ? (
                  <blockquote className="rounded-control bg-ground-2 px-3 py-2 text-[15px]">
                    {s.comment}
                  </blockquote>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
