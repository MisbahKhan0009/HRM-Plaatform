import type { ReimbursementClaim } from '@hrm/contracts';
import { Button, Card, CardHeader, ConfirmDialog, LoadingBlock, notify } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { PageHeader } from '../../components/page-header';
import { ApiError } from '../../lib/api/client';
import { useErrorMessage } from '../../lib/api/errors';
import { useMe } from '../../lib/auth/me';
import { formatMoney, formatShortDate } from '../../lib/format';
import { applyServerErrors, FormError, useZodForm } from '../../lib/forms';
import { FileDrop } from '../documents/FileDrop';
import { prepareFile } from '../documents/files';
import { claimQueries, uploadReceipt, useCreateClaim, useSubmitClaim, useUpdateClaim } from './api';
import { ClaimFields } from './ClaimFields';
import { ClaimStatusBadge } from './ClaimStatusBadge';
import { ClaimFormSchema, flattenAmountErrors, toMoney } from './form';

type Intent = 'submit' | 'draft';

// SCREEN-INVENTORY 5.2, USER-FLOWS 6, canvas ClaimNew.dc.html.
export function NewClaimPage() {
  const me = useMe();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const create = useCreateClaim();
  const update = useUpdateClaim();
  const submitClaim = useSubmitClaim();
  const form = useZodForm(ClaimFormSchema, { expenseDate: '', amount: '', description: '' });

  const [file, setFile] = useState<File | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Intent | null>(null);
  // Kept across retries so a failed submit never uploads the receipt or creates the claim twice.
  const receiptId = useRef<{ file: File; id: string } | null>(null);
  const draft = useRef<ReimbursementClaim | null>(null);
  const leaving = useRef(false);

  const dirty = form.formState.isDirty || file !== null;
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !leaving.current,
    enableBeforeUnload: () => dirty && !leaving.current,
    withResolver: true,
  });

  const save = (intent: Intent) =>
    form.handleSubmit(async (values) => {
      const employeeId = me?.employee?.id;
      if (!employeeId) return;
      setBusy(intent);
      setFormError(null);
      setFileError(null);
      try {
        let receiptDocumentId: string | null = null;
        if (file) {
          if (receiptId.current?.file === file) receiptDocumentId = receiptId.current.id;
          else {
            const prepared = await prepareFile(file);
            if (prepared.resized) setFileNote('resized for upload');
            const doc = await uploadReceipt(employeeId, prepared.file, setProgress);
            receiptId.current = { file, id: doc.id };
            receiptDocumentId = doc.id;
          }
        }
        const body = {
          expenseDate: values.expenseDate,
          amount: toMoney(values.amount),
          description: values.description,
          receiptDocumentId,
        };
        draft.current = draft.current
          ? await update.mutateAsync({ id: draft.current.id, version: draft.current.version, ...body })
          : await create.mutateAsync({ category: 'transport', ...body });
        const claim =
          intent === 'submit'
            ? await submitClaim.mutateAsync({ id: draft.current.id, version: draft.current.version })
            : draft.current;
        notify.success(intent === 'submit' ? 'Claim submitted. Your manager will review it.' : 'Draft saved');
        leaving.current = true;
        if (blocker.status === 'blocked') blocker.proceed();
        else await navigate({ to: '/reimbursements/$claimId', params: { claimId: claim.id } });
      } catch (err) {
        setProgress(null);
        if (
          err instanceof ApiError &&
          (err.code === 'FILE_TOO_LARGE' || err.code === 'UNSUPPORTED_FILE_TYPE')
        ) {
          setFileError(errorMessage(err));
        } else {
          setFormError(applyServerErrors(form, flattenAmountErrors(err), errorMessage));
        }
      } finally {
        setBusy(null);
      }
    })();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New transport claim"
        breadcrumb={{ label: 'My claims', to: '/reimbursements' }}
        description="Approved claims are paid with your next salary."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <form
            className="flex flex-col gap-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save('submit');
            }}
          >
            <FormError message={formError} />
            {draft.current ? (
              <p className="text-sm text-text-2">
                Saved as draft <span className="font-mono">{draft.current.claimNumber}</span>. Submitting
                again updates that draft.
              </p>
            ) : null}
            <ClaimFields form={form} />
            <FileDrop
              label="Receipt"
              optional
              file={file}
              onFile={(f) => {
                setFile(f);
                setFileNote(null);
                setFileError(null);
                setProgress(null);
              }}
              progress={progress}
              error={fileError}
              note={fileNote}
              disabled={busy !== null}
            />
            <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
              <Button variant="text" className="sm:mr-auto" asChild>
                <Link to="/reimbursements">Cancel</Link>
              </Button>
              <Button
                variant="secondary"
                loading={busy === 'draft'}
                disabled={busy !== null}
                onClick={() => void save('draft')}
              >
                Save draft
              </Button>
              <Button type="submit" variant="primary" loading={busy === 'submit'} disabled={busy !== null}>
                Submit claim
              </Button>
            </div>
          </form>
        </Card>
        <RecentClaims employeeId={me?.employee?.id ?? null} />
      </div>
      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(o) => !o && blocker.status === 'blocked' && blocker.reset()}
        title="Discard changes?"
        description="Your claim hasn't been saved. Save it as a draft to finish it later."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          leaving.current = true;
          blocker.proceed?.();
        }}
      >
        <Button variant="secondary" loading={busy === 'draft'} onClick={() => void save('draft')}>
          Save draft
        </Button>
      </ConfirmDialog>
    </div>
  );
}

function RecentClaims({ employeeId }: { employeeId: string | null }) {
  const list = useQuery({
    ...claimQueries.list({ page: 1, pageSize: 5, employeeId: employeeId ?? undefined }),
    enabled: employeeId !== null,
  });
  return (
    <Card aria-labelledby="recent-claims">
      <CardHeader id="recent-claims" label="History" title="My recent claims" />
      {list.isPending ? (
        <LoadingBlock label="Loading recent claims" rows={3} />
      ) : list.data?.data.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {list.data.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <Link
                  to="/reimbursements/$claimId"
                  params={{ claimId: c.id }}
                  className="font-mono text-sm text-link hover:underline"
                >
                  {c.claimNumber}
                </Link>
                <p className="text-sm text-text-2">{formatShortDate(c.expenseDate)}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="font-mono text-sm tabular-nums">{formatMoney(c.amount.amount)}</span>
                <ClaimStatusBadge status={c.status} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-text-2">Your claims will appear here.</p>
      )}
      <p className="mt-4 border-t border-line pt-3 text-sm text-text-2">
        Approved → included in a payroll run → paid with salary.
      </p>
    </Card>
  );
}
