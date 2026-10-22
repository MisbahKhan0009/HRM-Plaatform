import { type Document, IsoDateSchema } from '@hrm/contracts';
import {
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  LoadingBlock,
  notify,
  Table,
  TBody,
  TD,
  Textarea,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../lib/api/client';
import { useErrorMessage } from '../../lib/api/errors';
import { formatDateTime } from '../../lib/format';
import { FormError } from '../../lib/forms';
import { documentQueries, downloadUrl, useAddVersion, useDeleteDocument } from './api';
import { FileDrop } from './FileDrop';
import { formatBytes, prepareFile } from './files';

/** Every version of a document, newest first, each downloadable (FR-DOC-005). */
export function VersionsDialog({ document: doc, onClose }: { document: Document; onClose: () => void }) {
  const detail = useQuery(documentQueries.detail(doc.id));
  const errorMessage = useErrorMessage();
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={doc.title}
      description="Earlier versions are kept. Download any version below."
    >
      {detail.isPending ? (
        <LoadingBlock label="Loading versions" rows={2} />
      ) : detail.isError ? (
        <FormError message={errorMessage(detail.error)} />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line">
          {/* relative: keeps sr-only text inside the scroll container, so it cannot widen the page */}
          <Table className="relative">
            <caption className="sr-only">Versions of {doc.title}</caption>
            <THead>
              <tr>
                <TH>Version</TH>
                <TH>File</TH>
                <TH>Uploaded</TH>
                <TH>
                  <span className="sr-only">Download</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {detail.data.versions.map((v) => (
                <TR key={v.version}>
                  <TD className="font-mono">v{v.version}</TD>
                  <TD>
                    <span className="block max-w-56 truncate">{v.fileName}</span>
                    <span className="text-sm text-text-2">{formatBytes(v.sizeBytes)}</span>
                  </TD>
                  <TD>
                    <time dateTime={v.uploadedAt}>{formatDateTime(v.uploadedAt)}</time>
                    {v.uploadedByName ? (
                      <span className="block text-sm text-text-2">{v.uploadedByName}</span>
                    ) : null}
                  </TD>
                  <TD className="text-right">
                    <Button variant="text" asChild>
                      <a href={downloadUrl(doc.id, v.version)} download>
                        Download<span className="sr-only"> version {v.version}</span>
                      </a>
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}

/** Upload a new file to an existing document; the previous version stays (USER-FLOWS 9.1 step 4). */
export function NewVersionDialog({ document: doc, onClose }: { document: Document; onClose: () => void }) {
  const add = useAddVersion(doc.id);
  const errorMessage = useErrorMessage();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [issueDate, setIssueDate] = useState(doc.issueDate ?? '');
  const [expiryDate, setExpiryDate] = useState(doc.expiryDate ?? '');
  const datesOk =
    (!issueDate || IsoDateSchema.safeParse(issueDate).success) &&
    (!expiryDate || IsoDateSchema.safeParse(expiryDate).success) &&
    (!issueDate || !expiryDate || expiryDate >= issueDate);

  const submit = async () => {
    if (!file) {
      setFileError('Choose a file to upload.');
      return;
    }
    if (!datesOk) return;
    setFormError(null);
    try {
      const prepared = await prepareFile(file);
      if (prepared.resized) setNote('resized for upload');
      await add.mutateAsync({
        file: prepared.file,
        onProgress: setProgress,
        fields: { issueDate: issueDate || undefined, expiryDate: expiryDate || undefined },
      });
      notify.success('New version uploaded');
      onClose();
    } catch (err) {
      setProgress(null);
      if (
        err instanceof ApiError &&
        (err.code === 'FILE_TOO_LARGE' || err.code === 'UNSUPPORTED_FILE_TYPE')
      ) {
        setFileError(errorMessage(err));
      } else setFormError(errorMessage(err));
    }
  };

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && !add.isPending && onClose()}
      title="Upload new version"
      description={`${doc.title} is on version ${doc.currentVersion}. The current file stays in the history.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={add.isPending} onClick={() => void submit()}>
            {add.isPending ? 'Uploading…' : 'Upload version'}
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <FileDrop
        label="File"
        file={file}
        onFile={(f) => {
          setFile(f);
          setNote(null);
          setFileError(null);
        }}
        progress={progress}
        error={fileError}
        note={note}
        disabled={add.isPending}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Issue date" optional>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Expiry date"
          optional
          error={datesOk ? undefined : 'The expiry date must be on or after the issue date.'}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Retention deletion (FR-DOC-010): reason required, level 2 confirmation; the API asks for a fresh sign-in. */
export function DeleteDocumentDialog({
  document: doc,
  onClose,
}: {
  document: Document;
  onClose: () => void;
}) {
  const remove = useDeleteDocument();
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const reasonError = reason.trim().length < 5 ? 'Give a reason of at least 5 characters.' : undefined;
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delete ${doc.title}?`}
      description="The document and all its versions will no longer be available to anyone. The reason is kept in the audit log."
      confirmLabel="Delete document"
      loading={remove.isPending}
      onConfirm={async () => {
        setTouched(true);
        if (reasonError) return;
        try {
          await remove.mutateAsync({ id: doc.id, reason: reason.trim(), version: doc.version });
          notify.success('Document deleted');
          onClose();
        } catch (err) {
          setFormError(errorMessage(err));
        }
      }}
    >
      <FormError message={formError} />
      <Field
        label="Reason"
        error={touched ? reasonError : undefined}
        hint={`Uploaded ${formatDateTime(doc.createdAt)}.`}
      >
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        )}
      </Field>
    </ConfirmDialog>
  );
}
