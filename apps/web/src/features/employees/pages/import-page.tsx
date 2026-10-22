import {
  type EmployeeImportPreview,
  type EmployeeImportResult,
  IMPORT_MAX_CSV_CHARS,
  IMPORT_MAX_ROWS,
  type ImportField,
  importFieldValues,
} from '@hrm/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Select,
  StatBar,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { Link } from '@tanstack/react-router';
import { Download, FileUp } from 'lucide-react';
import { useId, useState } from 'react';
import { PageHeader } from '../../../components/page-header';
import { StepUpCancelledError } from '../../../lib/api/client';
import { useErrorMessage } from '../../../lib/api/errors';
import { useImportCommit, useImportPreview } from '../api';
import { IMPORT_FIELD_LABEL } from '../labels';

type Mapping = Record<string, ImportField | null>;

/** Builds a CSV file in the browser and hands it to the user (D-037: no server-side file generation). */
function downloadCsv(name: string, rows: string[][]) {
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const text = rows.map((r) => r.map(quote).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const sameMapping = (a: Mapping, b: Mapping) =>
  Object.keys({ ...a, ...b }).every((k) => (a[k] ?? null) === (b[k] ?? null));

// SCREEN-INVENTORY §8.3, FR-EMP-008: upload, map columns, preview with row errors and duplicates, import.
export function ImportPage() {
  const errorMessage = useErrorMessage();
  const preview = useImportPreview();
  const commit = useImportCommit();
  const fileId = useId();
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [result, setResult] = useState<EmployeeImportResult | null>(null);

  const runPreview = async (csv: string, m?: Mapping) => {
    try {
      const res = await preview.mutateAsync({ csv, ...(m ? { mapping: m } : {}) });
      setMapping(res.mapping);
    } catch {
      // Shown from preview.error below.
    }
  };

  const onFile = async (f: File | undefined) => {
    setFileError(null);
    setResult(null);
    preview.reset();
    if (!f) return;
    const csv = await f.text();
    if (csv.length > IMPORT_MAX_CSV_CHARS) {
      setFile(null);
      setFileError(
        `This file is too large to import at once. Split it into files of at most ${IMPORT_MAX_ROWS} rows.`,
      );
      return;
    }
    setFile({ name: f.name, csv });
    await runPreview(csv);
  };

  const onImport = async () => {
    if (!file || !preview.data) return;
    try {
      setResult(
        await commit.mutateAsync({
          csv: file.csv,
          previewToken: preview.data.previewToken,
          mapping: preview.data.mapping,
        }),
      );
    } catch {
      // Shown from commit.error below.
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setMapping({});
    preview.reset();
    commit.reset();
  };

  if (result) return <ImportResult result={result} onAgain={reset} />;

  const data = preview.data;
  const dirty = data ? !sameMapping(mapping, data.mapping) : false;
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Import employees"
        breadcrumb={{ label: 'Employees', to: '/employees' }}
        description={`Upload a CSV file with up to ${IMPORT_MAX_ROWS} rows. Valid rows are created as Draft; nothing is saved until you import.`}
      />
      <Card aria-labelledby="h-upload">
        <CardHeader
          id="h-upload"
          label="Step 1"
          title="Upload file"
          actions={
            <Button
              variant="text"
              icon={<Download aria-hidden="true" />}
              onClick={() => downloadCsv('employee-import-template.csv', [[...importFieldValues]])}
            >
              Download template
            </Button>
          }
        />
        <div className="flex flex-col gap-3">
          <input
            id={fileId}
            type="file"
            accept=".csv,text/csv"
            className="peer sr-only"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <label
            htmlFor={fileId}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed border-line-strong px-6 py-8 text-center hover:bg-ground-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
          >
            <FileUp className="size-8 text-text-2" aria-hidden="true" />
            <span className="font-medium">{file ? file.name : 'Choose a CSV file'}</span>
            <span className="text-sm text-text-2">
              First row: column names. Dates as YYYY-MM-DD; department by code, manager by employee code.
            </span>
          </label>
          {fileError ? (
            <Alert tone="bad" assertive>
              {fileError}
            </Alert>
          ) : null}
          {preview.isError ? (
            <Alert tone="bad" assertive>
              {errorMessage(preview.error)}
            </Alert>
          ) : null}
          {preview.isPending ? <p className="text-text-2">Checking the file…</p> : null}
        </div>
      </Card>

      {data && file ? (
        <>
          <Card aria-labelledby="h-map">
            <CardHeader
              id="h-map"
              label="Step 2"
              title="Map columns"
              actions={
                dirty ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={preview.isPending}
                    onClick={() => void runPreview(file.csv, mapping)}
                  >
                    Check again
                  </Button>
                ) : null
              }
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.keys(mapping).map((header) => (
                <div key={header} className="flex flex-col gap-1.5">
                  <label htmlFor={`map-${header}`} className="font-mono text-sm">
                    {header}
                  </label>
                  <Select
                    id={`map-${header}`}
                    value={mapping[header] ?? ''}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [header]: (e.target.value || null) as ImportField | null }))
                    }
                  >
                    <option value="">Ignore this column</option>
                    {importFieldValues.map((f) => (
                      <option key={f} value={f}>
                        {IMPORT_FIELD_LABEL[f]}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            {dirty ? (
              <Alert tone="info" className="mt-4">
                The mapping changed. Check the file again before importing.
              </Alert>
            ) : null}
          </Card>
          <PreviewCard
            preview={data}
            importing={commit.isPending}
            canImport={!dirty && !preview.isPending && data.validRows > 0}
            onImport={() => void onImport()}
            onBack={reset}
            error={
              commit.isError && !(commit.error instanceof StepUpCancelledError)
                ? errorMessage(commit.error)
                : null
            }
          />
        </>
      ) : null}
    </div>
  );
}

function PreviewCard({
  preview,
  importing,
  canImport,
  onImport,
  onBack,
  error,
}: {
  preview: EmployeeImportPreview;
  importing: boolean;
  canImport: boolean;
  onImport: () => void;
  onBack: () => void;
  error: string | null;
}) {
  const duplicates = new Set(preview.duplicates);
  const errorsByRow = new Map<number, string[]>();
  for (const e of preview.errors) {
    const field = e.path.replace(/^\//, '');
    const label = IMPORT_FIELD_LABEL[field as ImportField] ?? field;
    errorsByRow.set(e.row, [...(errorsByRow.get(e.row) ?? []), label ? `${label}: ${e.message}` : e.message]);
  }
  return (
    <Card aria-labelledby="h-preview" className="flex flex-col gap-4">
      <CardHeader id="h-preview" label="Step 3" title="Preview" />
      <StatBar
        stats={[
          { label: 'Rows', value: preview.totalRows },
          { label: 'Ready to import', value: preview.validRows },
          { label: 'With errors', value: preview.invalidRows },
          { label: 'Duplicates', value: preview.duplicates.length },
        ]}
      />
      <TableContainer className="max-h-[480px]">
        <Table>
          <THead>
            <tr>
              <TH numeric>Row</TH>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Check</TH>
            </tr>
          </THead>
          <TBody>
            {preview.rows.map((r) => (
              <TR key={r.row}>
                <TD numeric>{r.row}</TD>
                <TD className="font-mono text-sm">{r.employeeCode ?? 'New code'}</TD>
                <TD>{r.name || '—'}</TD>
                <TD>
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap gap-1.5">
                      {r.valid ? <Badge tone="ok">Ready</Badge> : <Badge tone="bad">Error</Badge>}
                      {duplicates.has(r.row) ? <Badge tone="warn">Duplicate</Badge> : null}
                    </div>
                    {errorsByRow.get(r.row)?.map((m) => (
                      <span key={m} className="text-sm text-bad">
                        {m}
                      </span>
                    ))}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableContainer>
      {error ? (
        <Alert tone="bad" assertive>
          {error}
        </Alert>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        {preview.errors.length ? (
          <Button
            variant="secondary"
            icon={<Download aria-hidden="true" />}
            onClick={() =>
              downloadCsv('employee-import-errors.csv', [
                ['row', 'column', 'message'],
                ...preview.errors.map((e) => [String(e.row), e.path.replace(/^\//, ''), e.message]),
              ])
            }
          >
            Download error report
          </Button>
        ) : null}
        <Button variant="primary" loading={importing} disabled={!canImport} onClick={onImport}>
          Import {preview.validRows} {preview.validRows === 1 ? 'employee' : 'employees'}
        </Button>
      </div>
    </Card>
  );
}

function ImportResult({ result, onAgain }: { result: EmployeeImportResult; onAgain: () => void }) {
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader title="Import finished" breadcrumb={{ label: 'Employees', to: '/employees' }} />
      <StatBar
        stats={[
          { label: 'Created as Draft', value: result.createdCount },
          { label: 'Skipped', value: result.skippedCount },
        ]}
      />
      {result.errors.length ? (
        <Alert tone="warn" title="Some rows were skipped">
          <ul className="list-disc pl-5">
            {result.errors.slice(0, 20).map((e) => (
              <li key={`${e.row}-${e.path}-${e.code}`}>
                Row {e.row}: {e.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {result.created.length ? (
        <Card aria-labelledby="h-created">
          <CardHeader id="h-created" title="Created" />
          <ul className="flex flex-wrap gap-2">
            {result.created.map((c) => (
              <li key={c.id}>
                <Link
                  to="/employees/$employeeId"
                  params={{ employeeId: c.id }}
                  className="font-mono text-sm text-link hover:underline"
                >
                  {c.employeeCode}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onAgain}>
          Import another file
        </Button>
        <Button variant="primary" asChild>
          <Link to="/employees">View employees</Link>
        </Button>
      </div>
    </div>
  );
}
