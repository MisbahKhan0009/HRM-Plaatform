import type { ReportName } from '@hrm/contracts';
import { Alert, Button, Dialog, notify } from '@hrm/ui';
import { Download } from 'lucide-react';
import { useRef, useState } from 'react';
import { useErrorMessage } from '../../lib/api/errors';
import { auditExport, exportFilters, fetchAllRows, type ReportParams } from './api';
import { exportColumns, type ReportColumn } from './columns';

type Format = 'csv' | 'xlsx';
type Phase = { kind: 'choose' } | { kind: 'fetching'; done: number; total: number } | { kind: 'building' };

/** TABLES-AND-LISTS §6: above this many rows the dialog warns before starting. */
const LARGE_EXPORT = 5000;

function saveFile(data: BlobPart, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ExportButtonProps<Row> = {
  report: ReportName;
  title: string;
  params: ReportParams;
  columns: ReportColumn<Row>[];
  /** File name without extension, for example `attendance-2026-10-01-2026-10-31`. */
  fileName: string;
  /** Rows matching the current filters, from the on-screen page. */
  totalItems: number | undefined;
  disabled?: boolean;
};

/**
 * "Export…" (SCREEN-INVENTORY 10.2, D-037): picks CSV or XLSX, fetches every page with progress and Cancel, logs the
 * export (`POST /reports/exports`, FR-REP-005), then builds the file in the browser with `@hrm/documents/export`,
 * which is loaded only now so the spreadsheet code stays out of the page bundle.
 */
export function ExportButton<Row>(props: ExportButtonProps<Row>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="primary"
        icon={<Download aria-hidden="true" />}
        disabled={props.disabled || !props.totalItems}
        onClick={() => setOpen(true)}
      >
        Export…
      </Button>
      {open ? <ExportDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ExportDialog<Row>({
  report,
  title,
  params,
  columns,
  fileName,
  totalItems = 0,
  onClose,
}: ExportButtonProps<Row> & { onClose: () => void }) {
  const errorMessage = useErrorMessage();
  const [format, setFormat] = useState<Format>('xlsx');
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const running = phase.kind !== 'choose';

  const run = async () => {
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: 'fetching', done: 0, total: Math.max(1, Math.ceil(totalItems / 100)) });
    try {
      const rows = await fetchAllRows<Row>(
        report,
        params,
        (done, total) => setPhase({ kind: 'fetching', done, total }),
        controller.signal,
      );
      setPhase({ kind: 'building' });
      await auditExport({ report, format, filters: exportFilters(params), rowCount: rows.length });
      const lib = await import('@hrm/documents/export');
      const table = { sheetName: title, columns: exportColumns(columns), rows };
      if (format === 'csv') {
        // A byte-order mark lets spreadsheet apps read the file as UTF-8 (names, the taka sign).
        saveFile(`﻿${lib.tableToCsv(table)}`, 'text/csv;charset=utf-8', `${fileName}.csv`);
      } else {
        saveFile(lib.toXlsx(table) as BlobPart, lib.XLSX_MIME, `${fileName}.xlsx`);
      }
      notify.success(`Exported ${rows.length} rows`);
      onClose();
    } catch (err) {
      setPhase({ kind: 'choose' });
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(errorMessage(err));
    } finally {
      abort.current = null;
    }
  };

  const cancel = () => {
    if (abort.current) abort.current.abort();
    else onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && cancel()}
      title={`Export ${title.toLowerCase()}`}
      description="The file is built in your browser from the rows you can see. Nothing is uploaded."
      footer={
        <>
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" loading={running} onClick={() => void run()}>
            Export {format === 'csv' ? 'CSV' : 'XLSX'}
          </Button>
        </>
      }
    >
      {error ? (
        <Alert tone="bad" assertive>
          {error}
        </Alert>
      ) : null}
      <fieldset className="flex flex-col gap-2" disabled={running}>
        <legend className="mb-1 text-sm font-medium">Format</legend>
        {(
          [
            ['xlsx', 'Excel workbook (.xlsx)', 'Money as numbers with 2 decimals.'],
            ['csv', 'CSV (.csv)', 'Plain text for any spreadsheet or tool.'],
          ] as const
        ).map(([value, label, hint]) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-3 rounded-control border border-line px-3 py-2.5 has-[:checked]:border-accent has-[:checked]:bg-accent-tint"
          >
            <input
              type="radio"
              name="export-format"
              value={value}
              checked={format === value}
              onChange={() => setFormat(value)}
              className="mt-1 accent-[var(--action)]"
            />
            <span className="flex flex-col">
              <span className="text-[15px]">{label}</span>
              <span className="text-sm text-text-2">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-text-2">
        <span className="font-mono tabular-nums">{totalItems.toLocaleString('en-US')}</span> rows match the
        current filters.
      </p>
      {totalItems > LARGE_EXPORT ? (
        <Alert tone="warn">
          This is a large export. Fetching every page can take a minute; keep this tab open.
        </Alert>
      ) : null}
      <div aria-live="polite" className="text-sm">
        {phase.kind === 'fetching' ? (
          <div className="flex flex-col gap-2">
            <span>
              Fetching {phase.done} of {phase.total} pages
            </span>
            <div
              role="progressbar"
              aria-label="Export progress"
              aria-valuemin={0}
              aria-valuemax={phase.total}
              aria-valuenow={phase.done}
              className="h-1 overflow-hidden rounded-pill bg-line"
            >
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${(phase.done / phase.total) * 100}%` }}
              />
            </div>
          </div>
        ) : phase.kind === 'building' ? (
          <span>Building the file…</span>
        ) : null}
      </div>
    </Dialog>
  );
}
