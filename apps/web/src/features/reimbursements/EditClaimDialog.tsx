import type { ReimbursementClaim } from '@hrm/contracts';
import { Button, Dialog, notify } from '@hrm/ui';
import { useState } from 'react';
import { ApiError } from '../../lib/api/client';
import { useErrorMessage } from '../../lib/api/errors';
import { applyServerErrors, FormError, useZodForm } from '../../lib/forms';
import { FileDrop } from '../documents/FileDrop';
import { prepareFile } from '../documents/files';
import { uploadReceipt, useUpdateClaim } from './api';
import { ClaimFields } from './ClaimFields';
import { ClaimFormSchema, flattenAmountErrors, toMoney } from './form';

/** Edit a draft claim (FR-REIM-004: only drafts can be edited). */
export function EditClaimDialog({ claim, onClose }: { claim: ReimbursementClaim; onClose: () => void }) {
  const update = useUpdateClaim();
  const errorMessage = useErrorMessage();
  const form = useZodForm(ClaimFormSchema, {
    expenseDate: claim.expenseDate,
    amount: claim.amount.amount,
    description: claim.description,
  });
  const [keepReceipt, setKeepReceipt] = useState(claim.receiptDocumentId !== null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = form.handleSubmit(async (values) => {
    setBusy(true);
    setFormError(null);
    setFileError(null);
    try {
      let receiptDocumentId = keepReceipt ? claim.receiptDocumentId : null;
      if (file) {
        const prepared = await prepareFile(file);
        receiptDocumentId = (await uploadReceipt(claim.employee.id, prepared.file, setProgress)).id;
      }
      await update.mutateAsync({
        id: claim.id,
        version: claim.version,
        expenseDate: values.expenseDate,
        amount: toMoney(values.amount),
        description: values.description,
        receiptDocumentId,
      });
      notify.success('Claim saved');
      onClose();
    } catch (err) {
      setProgress(null);
      if (
        err instanceof ApiError &&
        (err.code === 'FILE_TOO_LARGE' || err.code === 'UNSUPPORTED_FILE_TYPE')
      ) {
        setFileError(errorMessage(err));
      } else setFormError(applyServerErrors(form, flattenAmountErrors(err), errorMessage));
    } finally {
      setBusy(false);
    }
  });

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && !busy && onClose()}
      title={`Edit ${claim.claimNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Save changes
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <ClaimFields form={form} />
        {keepReceipt && !file ? (
          <div className="flex items-center justify-between gap-3 rounded-card border border-line px-3 py-2.5">
            <span className="text-[15px]">A receipt is attached.</span>
            <Button variant="text" onClick={() => setKeepReceipt(false)}>
              Remove receipt
            </Button>
          </div>
        ) : (
          <FileDrop
            label="Receipt"
            optional
            file={file}
            onFile={(f) => {
              setFile(f);
              setFileError(null);
            }}
            progress={progress}
            error={fileError}
            disabled={busy}
          />
        )}
      </form>
    </Dialog>
  );
}
