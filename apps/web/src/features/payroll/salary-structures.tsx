import type { SalaryStructure } from '@hrm/contracts';
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Input,
  KeyValueList,
  LoadingBlock,
  MoneyInput,
  notify,
  Pagination,
  Sheet,
  Table,
  TableContainer,
  TBody,
  TD,
  Textarea,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Plus, Wallet, X } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { PageHeader } from '../../components/page-header';
import { useErrorMessage } from '../../lib/api/errors';
import { useCan } from '../../lib/auth/me';
import { formatDate, formatMoney, todayIso } from '../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../lib/forms';
import { payrollQueries, type StructureListParams, useApproveStructure, useCreateStructure } from './api';
import { EmployeePicker, errorCode, isStepUpCancel, Money, StatusLabel } from './components';
import { MONEY_INPUT, toDecimal } from './money';

type Employee = { id: string; name: string; employeeCode: string };

const STATUS_LABEL = { draft: 'Draft', approved: 'Approved', superseded: 'Superseded' } as const;

function StructureStatus({ s }: { s: SalaryStructure }) {
  return (
    <StatusLabel status={s.status === 'superseded' ? 'archived' : s.status} label={STATUS_LABEL[s.status]} />
  );
}

const effective = (s: SalaryStructure) =>
  s.effectiveTo
    ? `${formatDate(s.effectiveFrom)} to ${formatDate(s.effectiveTo)}`
    : `From ${formatDate(s.effectiveFrom)}`;

// SCREEN-INVENTORY 9.3: effective-dated gross per employee; draft (Strong) then approve (Fresh).
export function SalaryStructuresPage({
  params,
  onSearch,
}: {
  params: StructureListParams;
  onSearch: (p: StructureListParams) => void;
}) {
  const canManage = useCan('compensation.manage');
  const list = useQuery(payrollQueries.structures(params));
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<Employee | null>(null);
  const [approving, setApproving] = useState<SalaryStructure | null>(null);
  const [filter, setFilter] = useState<Employee | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Salary structures"
        description="One gross monthly amount per employee, effective-dated. Past payroll keeps the salary it was calculated with."
        actions={
          canManage ? (
            <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setCreating(true)}>
              Add salary structure
            </Button>
          ) : null
        }
      />
      <TableContainer
        toolbar={
          <div className="w-full max-w-sm">
            <EmployeePicker
              id="structure-employee-filter"
              ariaLabel="Filter by employee"
              value={filter}
              onChange={(e) => {
                setFilter(e);
                onSearch({ ...params, page: 1, employeeId: e?.id });
              }}
            />
          </div>
        }
        footer={<p className="text-sm text-text-2">Visible to payroll, HR (read only) and directors.</p>}
      >
        {list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="salary structures" />
          </div>
        ) : list.isError ? (
          <p className="p-4 text-bad">We couldn't load salary structures.</p>
        ) : !list.data.data.length ? (
          <EmptyState
            icon={Wallet}
            variant={params.employeeId ? 'no-results' : 'first-use'}
            title={params.employeeId ? 'No salary structure for this employee' : 'No salary structures yet'}
            description="Add a gross monthly salary for each employee before calculating payroll."
            className="border-0"
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Employee</TH>
                  <TH numeric>Gross / month</TH>
                  <TH>Effective</TH>
                  <TH>Reason</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {list.data.data.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      {s.employee.name}{' '}
                      <span className="font-mono text-sm text-text-2">{s.employee.employeeCode}</span>
                    </TD>
                    <TD numeric>
                      <Money amount={s.grossAmount.amount} />
                    </TD>
                    <TD className="whitespace-nowrap">{effective(s)}</TD>
                    <TD className="max-w-xs truncate" title={s.reason ?? undefined}>
                      {s.reason ?? '—'}
                    </TD>
                    <TD>
                      <StructureStatus s={s} />
                    </TD>
                    <TD className="text-right whitespace-nowrap">
                      {canManage && s.status === 'draft' ? (
                        <Button size="sm" variant="secondary" onClick={() => setApproving(s)}>
                          Approve
                        </Button>
                      ) : null}{' '}
                      <Button variant="text" onClick={() => setHistory(s.employee)}>
                        History
                      </Button>
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
                onPage={(page) => onSearch({ ...params, page })}
                onPageSize={(pageSize) => onSearch({ ...params, page: 1, pageSize })}
              />
            </div>
          </>
        )}
      </TableContainer>
      {creating ? <CreateStructureDialog onClose={() => setCreating(false)} /> : null}
      {approving ? <ApproveStructureDialog structure={approving} onClose={() => setApproving(null)} /> : null}
      {history ? <HistoryDrawer employee={history} onClose={() => setHistory(null)} /> : null}
    </div>
  );
}

const CreateSchema = z.object({
  employee: z.object({ id: z.uuid(), name: z.string(), employeeCode: z.string() }, 'Choose an employee.'),
  amount: z.string().trim().regex(MONEY_INPUT, 'Enter a monthly amount like 45000.00'),
  effectiveFrom: z.iso.date('Enter a date.'),
  reason: z.string().trim().min(3, 'Enter at least 3 characters, for example "Annual review".').max(500),
});

function CreateStructureDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateStructure();
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(CreateSchema, {
    employee: undefined as never,
    amount: '',
    effectiveFrom: todayIso(),
    reason: '',
  });
  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await create.mutateAsync({
        employeeId: v.employee.id,
        grossAmount: { amount: toDecimal(v.amount), currency: 'BDT' },
        effectiveFrom: v.effectiveFrom,
        reason: v.reason,
      });
      notify.success('Draft salary structure added. Approve it to use it in payroll.');
      onClose();
    } catch (err) {
      if (isStepUpCancel(err)) return;
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add salary structure"
      description="Starts as a draft. It applies to payroll once approved."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => void submit()}>
            Add salary structure
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <FormField
          control={form.control}
          name="employee"
          label="Employee"
          render={(p) => (
            <EmployeePicker
              id={p.id}
              value={(p.value as Employee | '') || null}
              onChange={(e) => p.onChange(e ?? undefined)}
              invalid={p['aria-invalid']}
              describedBy={p['aria-describedby']}
            />
          )}
        />
        <FormField
          control={form.control}
          name="amount"
          label="Gross monthly salary"
          render={(p) => <MoneyInput {...p} />}
        />
        <FormField
          control={form.control}
          name="effectiveFrom"
          label="Effective from"
          hint="A date inside a locked payroll period applies from the next unlocked period only."
          render={(p) => <Input type="date" {...p} />}
        />
        <FormField
          control={form.control}
          name="reason"
          label="Reason"
          hint="For example New hire, Annual review or Promotion."
          render={(p) => <Textarea {...p} className="min-h-16" />}
        />
      </form>
    </Dialog>
  );
}

function ApproveStructureDialog({ structure, onClose }: { structure: SalaryStructure; onClose: () => void }) {
  const approve = useApproveStructure();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      tone="primary"
      title={`Approve salary for ${structure.employee.name}?`}
      description={`${formatMoney(structure.grossAmount.amount)} a month from ${formatDate(structure.effectiveFrom)}. The previous structure ends the day before. Payroll calculated from now on uses it.`}
      summary={
        <KeyValueList
          className="rounded-control border border-line p-4"
          items={[
            { label: 'Employee', value: `${structure.employee.name} · ${structure.employee.employeeCode}` },
            { label: 'Gross / month', value: <Money amount={structure.grossAmount.amount} /> },
            { label: 'Reason', value: structure.reason ?? '—' },
          ]}
        />
      }
      confirmLabel="Approve salary"
      loading={approve.isPending}
      onConfirm={async () => {
        setError(null);
        try {
          await approve.mutateAsync({ id: structure.id, version: structure.version });
          notify.success('Salary structure approved');
          onClose();
        } catch (err) {
          if (isStepUpCancel(err)) return;
          setError(
            errorCode(err) === 'VERSION_CONFLICT'
              ? 'Someone else changed this structure. We have loaded the latest version.'
              : errorMessage(err),
          );
        }
      }}
    >
      {error ? <p className="text-sm text-bad">{error}</p> : null}
    </ConfirmDialog>
  );
}

/** Row drawer: every structure of one employee, newest first. */
function HistoryDrawer({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const list = useQuery(payrollQueries.structures({ page: 1, pageSize: 100, employeeId: employee.id }));
  return (
    <Sheet
      open
      side="right"
      title={`Salary history for ${employee.name}`}
      onOpenChange={(o) => !o && onClose()}
      className="w-[min(480px,100vw)] bg-surface"
    >
      <div className="flex flex-col gap-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.13em] text-text-3">History</p>
            <h2 className="font-display text-xl font-semibold">{employee.name}</h2>
            <p className="font-mono text-sm text-text-2">{employee.employeeCode}</p>
          </div>
          <Button variant="icon" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
        {list.isPending ? (
          <LoadingBlock label="salary history" />
        ) : (
          <StructureTimeline structures={list.data?.data ?? []} />
        )}
      </div>
    </Sheet>
  );
}

export function StructureTimeline({ structures }: { structures: SalaryStructure[] }) {
  if (!structures.length) return <p className="text-text-2">No salary structure yet.</p>;
  const sorted = [...structures].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return (
    <ol className="flex flex-col gap-4">
      {sorted.map((s, i) => (
        <li key={s.id} className="relative flex gap-3 pl-5">
          <span
            className={`absolute top-2 left-0 size-2 rounded-full ${i === 0 && s.status === 'approved' ? 'bg-accent' : 'bg-line-strong'}`}
            aria-hidden="true"
          />
          <div className="flex flex-col gap-1">
            <p className="flex flex-wrap items-center gap-2">
              <Money amount={s.grossAmount.amount} className="text-lg" />
              <StructureStatus s={s} />
            </p>
            <p className="text-sm text-text-2">
              {effective(s)}
              {s.reason ? ` · ${s.reason}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
