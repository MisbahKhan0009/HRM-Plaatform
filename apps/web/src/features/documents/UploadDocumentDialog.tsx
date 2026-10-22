import { type DocumentCategory, documentCategoryValues, IsoDateSchema } from '@hrm/contracts';
import { Button, Checkbox, Dialog, Input, notify, Select } from '@hrm/ui';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { ApiError } from '../../lib/api/client';
import { useErrorMessage } from '../../lib/api/errors';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../lib/forms';
import { CATEGORY_LABEL, useUploadDocument } from './api';
import { FileDrop } from './FileDrop';
import { prepareFile } from './files';

const optionalDate = z.union([z.literal(''), IsoDateSchema]);

const UploadFormSchema = z
  .object({
    category: z.enum(documentCategoryValues),
    title: z.string().trim().min(1, 'Enter a title.').max(200),
    issueDate: optionalDate,
    expiryDate: optionalDate,
    visible: z.boolean(),
  })
  .refine((v) => !v.issueDate || !v.expiryDate || v.expiryDate >= v.issueDate, {
    message: 'The expiry date must be on or after the issue date.',
    path: ['expiryDate'],
  });

// USER-FLOWS 9.1: "visible to employee" defaults on for contract, certificate and policy; off for identity until the
// owner decides (open question there). Other categories follow the visible default.
const VISIBLE_BY_DEFAULT: Record<DocumentCategory, boolean> = {
  identity: false,
  contract: true,
  certificate: true,
  payslip: true,
  receipt: true,
  policy: true,
  other: true,
};

/** Upload a new document to an employee record or, with `employeeId` null, to the company (USER-FLOWS 9.1). */
export function UploadDocumentDialog({
  employeeId,
  onClose,
}: {
  employeeId: string | null;
  onClose: () => void;
}) {
  const uploadDoc = useUploadDocument(employeeId);
  const errorMessage = useErrorMessage();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const categories = employeeId ? documentCategoryValues : (['policy', 'other'] as const);
  const form = useZodForm(UploadFormSchema, {
    category: employeeId ? 'contract' : 'policy',
    title: '',
    issueDate: '',
    expiryDate: '',
    visible: true,
  });

  const submit = form.handleSubmit(async (values) => {
    if (!file) {
      setFileError('Choose a file to upload.');
      return;
    }
    setFormError(null);
    setFileError(null);
    try {
      const prepared = await prepareFile(file);
      if (prepared.resized) setNote('resized for upload');
      await uploadDoc.mutateAsync({
        file: prepared.file,
        onProgress: setProgress,
        fields: {
          category: values.category,
          title: values.title,
          issueDate: values.issueDate || undefined,
          expiryDate: values.expiryDate || undefined,
          isRestricted: !values.visible,
        },
      });
      notify.success('Document uploaded');
      onClose();
    } catch (err) {
      setProgress(null);
      if (
        err instanceof ApiError &&
        (err.code === 'FILE_TOO_LARGE' || err.code === 'UNSUPPORTED_FILE_TYPE')
      ) {
        setFileError(errorMessage(err));
        return;
      }
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });

  const busy = uploadDoc.isPending;
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && !busy && onClose()}
      title="Upload document"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {busy ? 'Uploading…' : 'Upload document'}
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <FileDrop
          label="File"
          file={file}
          onFile={(f) => {
            setFile(f);
            setNote(null);
            setFileError(null);
            if (f && !form.getValues('title')) form.setValue('title', f.name.replace(/\.[^.]+$/, ''));
          }}
          progress={progress}
          error={fileError}
          note={note}
          disabled={busy}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="category"
            label="Category"
            render={(p) => (
              <Select
                {...p}
                onChange={(e) => {
                  p.onChange(e.target.value);
                  form.setValue('visible', VISIBLE_BY_DEFAULT[e.target.value as DocumentCategory]);
                }}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            )}
          />
          <FormField
            control={form.control}
            name="title"
            label="Title"
            render={(p) => <Input {...p} autoComplete="off" />}
          />
          <FormField
            control={form.control}
            name="issueDate"
            label="Issue date"
            optional
            render={(p) => <Input type="date" {...p} />}
          />
          <FormField
            control={form.control}
            name="expiryDate"
            label="Expiry date"
            optional
            hint="People who manage documents get a reminder email before it expires."
            render={(p) => <Input type="date" {...p} />}
          />
        </div>
        {employeeId ? (
          <Controller
            control={form.control}
            name="visible"
            render={({ field }) => (
              <Checkbox
                label="Visible to the employee"
                checked={field.value}
                onChange={(e) => field.onChange(e.target.checked)}
                onBlur={field.onBlur}
              />
            )}
          />
        ) : null}
      </form>
    </Dialog>
  );
}
