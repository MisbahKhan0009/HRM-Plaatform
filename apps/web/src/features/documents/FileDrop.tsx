import { Button, cn } from '@hrm/ui';
import { AlertCircle, FileImage, FileText, UploadCloud, X } from 'lucide-react';
import { type DragEvent, useId, useRef, useState } from 'react';
import { ACCEPT, checkFile, fileProblemMessage, formatBytes, RULE_LINE } from './files';

export type FileDropProps = {
  /** Accessible name of the file control, for example "Receipt". */
  label: string;
  file: File | null;
  onFile: (file: File | null) => void;
  /** 0 to 1 while uploading; null when idle. */
  progress?: number | null;
  /** Server or client error shown in the file row. */
  error?: string | null;
  /** Extra text on the file row, for example "resized for upload". */
  note?: string | null;
  disabled?: boolean;
  optional?: boolean;
};

/**
 * File upload (COMPONENT-SPECS §6): drop zone with a real file input behind a secondary button, then a file row with
 * size, type, progress and a remove button. Type and size are checked before the file is accepted.
 */
export function FileDrop({ label, file, onFile, progress, error, note, disabled, optional }: FileDropProps) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const shown = clientError ?? error ?? null;

  const take = (picked: File | undefined) => {
    if (!picked) return;
    const problem = checkFile(picked);
    if (problem) {
      setClientError(fileProblemMessage(problem, picked.size));
      onFile(null);
      return;
    }
    setClientError(null);
    onFile(picked);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled) take(e.dataTransfer.files[0]);
  };

  const Icon = file?.type.startsWith('image/') ? FileImage : FileText;
  const uploading = progress !== null && progress !== undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-medium text-text">
        {label}
        {optional ? <span className="font-normal text-text-2"> (optional)</span> : null}
      </span>
      {!file ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: the drop target is an enhancement; the button inside is the accessible control
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-card border border-dashed border-control-border bg-ground-2 px-4 py-5 text-center',
            dragging && 'border-accent bg-accent-tint',
          )}
        >
          <UploadCloud className="size-6 text-text-2" aria-hidden="true" />
          <p className="text-[15px] text-text">
            Drag a file here or{' '}
            <Button
              variant="text"
              disabled={disabled}
              onClick={() => input.current?.click()}
              aria-describedby={`${id}-rule`}
              aria-labelledby={`${id}-label ${id}-browse`}
            >
              <span id={`${id}-browse`}>browse</span>
            </Button>
          </p>
          <p id={`${id}-rule`} className="text-sm text-text-2">
            {RULE_LINE}
          </p>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              take(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface px-3 py-2.5">
          <div className="flex items-center gap-3">
            <Icon className="size-5 shrink-0 text-text-2" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px]">{file.name}</p>
              <p className="text-sm text-text-2">
                {file.type.startsWith('image/') ? 'Image' : 'PDF'} · {formatBytes(file.size)}
                {note ? ` · ${note}` : ''}
              </p>
            </div>
            <Button
              variant="icon"
              size="icon-sm"
              aria-label={`Remove ${file.name}`}
              disabled={disabled || uploading}
              onClick={() => {
                setClientError(null);
                onFile(null);
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          {uploading ? (
            <div
              role="progressbar"
              aria-label={`Uploading ${file.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              className="h-1 overflow-hidden rounded-pill bg-line"
            >
              <div className="h-full bg-accent transition-[width]" style={{ width: `${progress * 100}%` }} />
            </div>
          ) : null}
        </div>
      )}
      {shown ? (
        <p className="flex items-start gap-1.5 text-sm text-bad" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{shown}</span>
        </p>
      ) : null}
    </div>
  );
}
