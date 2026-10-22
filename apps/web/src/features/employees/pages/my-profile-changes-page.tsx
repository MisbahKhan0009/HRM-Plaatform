import type { ProfileChangeRequest } from '@hrm/contracts';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  LoadingBlock,
  notify,
  Pagination,
  StatusBadge,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { FilePen } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../components/page-header';
import { useErrorMessage } from '../../../lib/api/errors';
import { useCan, useMe } from '../../../lib/auth/me';
import { formatRelative } from '../../../lib/format';
import { employeeQueries, useWithdrawProfileChange } from '../api';
import { RequestChangeDialog } from '../components/request-change-dialog';
import { profileChangeSummary } from '../labels';

// SCREEN-INVENTORY §2.4: my requests, newest first; withdraw while pending.
export function MyProfileChangesPage() {
  const { t } = useTranslation();
  const me = useMe();
  const canRequest = useCan('profile_change.request.own');
  const [page, setPage] = useState(1);
  const linked = Boolean(me?.employee);
  // HR reviewers list every request, so the own filter is explicit.
  const list = useQuery({
    ...employeeQueries.profileChanges({ page, pageSize: 25, employeeId: me?.employee?.id ?? '' }),
    enabled: linked,
  });
  const profile = useQuery({ ...employeeQueries.myProfile(), enabled: linked && canRequest });
  const contact = useQuery({
    ...employeeQueries.contact(me?.employee?.id ?? ''),
    enabled: linked && canRequest,
  });
  const [requesting, setRequesting] = useState(false);
  const [withdrawing, setWithdrawing] = useState<ProfileChangeRequest | null>(null);
  const withdraw = useWithdrawProfileChange();
  const errorMessage = useErrorMessage();

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="My change requests"
        breadcrumb={{ label: 'My profile', to: '/me' }}
        description="Changes to your profile that HR reviews."
        actions={
          canRequest && profile.data ? (
            <Button variant="primary" onClick={() => setRequesting(true)}>
              Request a change
            </Button>
          ) : null
        }
      />
      <TableContainer>
        {list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="change requests" />
          </div>
        ) : list.isError ? (
          <p className="p-4 text-bad">{errorMessage(list.error)}</p>
        ) : !list.data.data.length ? (
          <EmptyState
            icon={FilePen}
            title="No change requests yet"
            description="Requests you submit appear here with their status."
            className="border-0"
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Changes</TH>
                  <TH>Submitted</TH>
                  <TH>Status</TH>
                  <TH>HR comment</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {list.data.data.map((r) => (
                  <TR key={r.id}>
                    <TD>{profileChangeSummary(r)}</TD>
                    <TD className="whitespace-nowrap" title={r.createdAt}>
                      {formatRelative(r.createdAt)}
                    </TD>
                    <TD>
                      <StatusBadge status={r.status} label={t(`status.${r.status}`)} />
                    </TD>
                    <TD className="text-text-2">{r.decisionComment ?? '—'}</TD>
                    <TD className="text-right">
                      {r.status === 'pending' ? (
                        <Button variant="text" onClick={() => setWithdrawing(r)}>
                          Withdraw
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="border-t border-line px-4 py-2">
              <Pagination
                page={list.data.page.number}
                pageSize={list.data.page.size}
                totalItems={list.data.page.totalItems}
                onPage={setPage}
              />
            </div>
          </>
        )}
      </TableContainer>
      {withdrawing ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setWithdrawing(null)}
          title="Withdraw this request?"
          description="HR won't need to review it. Your profile stays as it is."
          confirmLabel="Withdraw request"
          loading={withdraw.isPending}
          onConfirm={async () => {
            try {
              await withdraw.mutateAsync({ id: withdrawing.id, version: withdrawing.version });
              notify.success('Request withdrawn');
              setWithdrawing(null);
            } catch (err) {
              notify.error(errorMessage(err));
            }
          }}
        />
      ) : null}
      {requesting && profile.data ? (
        <RequestChangeDialog
          profile={profile.data}
          contact={contact.data}
          initialSection="contact"
          onClose={() => setRequesting(false)}
        />
      ) : null}
    </div>
  );
}
