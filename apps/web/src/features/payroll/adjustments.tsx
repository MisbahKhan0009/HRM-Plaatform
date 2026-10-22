import { adjustmentStatusValues, type PayrollAdjustment } from '@hrm/contracts';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  Field,
  LoadingBlock,
  MoneyInput,
  notify,
  Pagination,
  Select,
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
import { Plus, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PageHeader } from '../../components/page-header';
import { useErrorMessage } from '../../lib/api/errors';
import { useCan } from '../../lib/auth/me';
import { formatMoney, formatMonth, formatRelative } from '../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../lib/forms';
import { type AdjustmentListParams, payrollQueries, useCreateAdjustment, useDecideAdjustment } from './api';
import {
  EmployeePicker,
  errorCode,
  isStepUpCancel,
  Money,
  SelfApprovedBadge,
  StatusLabel,
} from './components';
import { MONEY_INPUT, toDecimal } from './money';

const LINE_LABEL = { addition: 'Addition', deduction: 'Deduction', arrears: 'Arrears' } as const;

// SCREEN-INVENTORY 9.4, FR-PAY-011: additions and deductions applied by the next calculation of the target period.
export function AdjustmentsPage({
  params,
  onSearch,
}: {
  params: AdjustmentListParams;
  onSearch: (p: AdjustmentListParams) => void;
}) {
  const { t } = useTranslation();
  const canPrepare = useCan('payroll.prepare');
  const canApprove = useCan('payroll.approve');
  const list = useQuery(payrollQueries.adjustments(params));
  const periods = useQuery(payrollQueries.periods());
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ adj: PayrollAdjustment; decision: 'approve' | 'reject' } | null>(
    null,
  );
  const periodLabel = (id: string) => {
    const p = periods.data?.data.find((x) => x.id === id);
    return p ? formatMonth(p.year, p.month) : '—';
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payroll adjustments"
        description="One-off additions, deductions and arrears. Approved adjustments are applied when the target month's run is calculated."
        actions={
          canPrepare ? (
            <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setCreating(true)}>
              New adjustment
            </Button>
          ) : null
        }
      />
      <TableContainer
        toolbar={
          <>
            <Select
              aria-label="Status"
              className="w-44"
              value={params.status ?? ''}
              onChange={(e) =>
                onSearch({ ...params, page: 1, status: (e.target.value || undefined) as never })
              }
            >
              <option value="">All statuses</option>
              {adjustmentStatusValues.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Target month"
              className="w-48"
              value={params.periodId ?? ''}
              onChange={(e) => onSearch({ ...params, page: 1, periodId: e.target.value || undefined })}
            >
              <option value="">All months</option>
              {periods.data?.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {formatMonth(p.year, p.month)}
                </option>
              ))}
            </Select>
          </>
        }
      >
        {list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="adjustments" />
          </div>
        ) : list.isError ? (
          <p className="p-4 text-bad">We couldn't load adjustments.</p>
        ) : !list.data.data.length ? (
          <EmptyState
            icon={SlidersHorizontal}
            variant={params.status || params.periodId ? 'no-results' : 'first-use'}
            title={params.status || params.periodId ? 'No adjustments match' : 'No adjustments yet'}
            description="Corrections to a locked run go here and are paid in a later run."
            className="border-0"
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Employee</TH>
                  <TH>Type</TH>
                  <TH numeric>Amount</TH>
                  <TH>Reason</TH>
                  <TH>Target month</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {list.data.data.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      {a.employee.name}{' '}
                      <span className="font-mono text-sm text-text-2">{a.employee.employeeCode}</span>
                    </TD>
                    <TD>{LINE_LABEL[a.lineCode]}</TD>
                    <TD numeric>
                      <Money amount={a.type === 'deduction' ? `-${a.amount.amount}` : a.amount.amount} />
                    </TD>
                    <TD className="max-w-xs truncate" title={a.reason}>
                      {a.reason}
                    </TD>
                    <TD className="whitespace-nowrap">{periodLabel(a.targetPeriodId)}</TD>
                    <TD>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusLabel status={a.status} />
                        {a.selfApproved ? <SelfApprovedBadge /> : null}
                      </span>
                      {a.decidedAt ? (
                        <span className="text-xs text-text-3" title={a.decidedAt}>
                          {formatRelative(a.decidedAt)}
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-right whitespace-nowrap">
                      {canApprove && a.status === 'pending' ? (
                        <>
                          <Button variant="text" onClick={() => setDeciding({ adj: a, decision: 'reject' })}>
                            Reject
                          </Button>{' '}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setDeciding({ adj: a, decision: 'approve' })}
                          >
                            Approve
                          </Button>
                        </>
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
                onPage={(page) => onSearch({ ...params, page })}
                onPageSize={(pageSize) => onSearch({ ...params, page: 1, pageSize })}
              />
            </div>
          </>
        )}
      </TableContainer>
      {creating ? <CreateAdjustmentDialog onClose={() => setCreating(false)} /> : null}
      {deciding ? (
        <DecisionDialog
          adjustment={deciding.adj}
          decision={deciding.decision}
          periodLabel={periodLabel(deciding.adj.targetPeriodId)}
          onClose={() => setDeciding(null)}
        />
      ) : null}
    </div>
  );
}

const CreateSchema = z.object({
  employee: z.object({ id: z.uuid(), name: z.string(), employeeCode: z.string() }, 'Choose an employee.'),
  lineCode: z.enum(['addition', 'arrears', 'deduction']),
  amount: z
    .string()
    .trim()
    .regex(MONEY_INPUT, 'Enter an amount like 3000.00')
    .refine((v) => /[1-9]/.test(v), 'Enter an amount above zero.'),
  reason: z.string().trim().min(5, 'Enter at least 5 characters.').max(1000),
  targetPeriodId: z.uuid('Choose the month to apply it in.'),
});

function CreateAdjustmentDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateAdjustment();
  const errorMessage = useErrorMessage();
  const periods = useQuery(payrollQueries.periods());
  const open = periods.data?.data.filter((p) => p.status === 'open') ?? [];
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(CreateSchema, {
    employee: undefined as never,
    lineCode: 'addition',
    amount: '',
    reason: '',
    targetPeriodId: '',
  });
  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await create.mutateAsync({
        employeeId: v.employee.id,
        type: v.lineCode === 'deduction' ? 'deduction' : 'addition',
        lineCode: v.lineCode,
        amount: { amount: toDecimal(v.amount), currency: 'BDT' },
        reason: v.reason,
        targetPeriodId: v.targetPeriodId,
      });
      notify.success('Adjustment sent for approval');
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
      title="New adjustment"
      description="It's applied once approved, when the target month's run is calculated."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => void submit()}>
            Send for approval
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      {periods.data && !open.length ? (
        <Alert tone="warn">There's no open payroll month. Create a payroll run for the month first.</Alert>
      ) : null}
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <FormField
          control={form.control}
          name="employee"
          label="Employee"
          render={(p) => (
            <EmployeePicker
              id={p.id}
              value={(p.value as { id: string; name: string; employeeCode: string } | '') || null}
              onChange={(e) => p.onChange(e ?? undefined)}
              invalid={p['aria-invalid']}
              describedBy={p['aria-describedby']}
            />
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="lineCode"
            label="Type"
            render={(p) => (
              <Select {...p}>
                <option value="addition">Addition</option>
                <option value="arrears">Arrears (addition)</option>
                <option value="deduction">Deduction</option>
              </Select>
            )}
          />
          <FormField
            control={form.control}
            name="amount"
            label="Amount"
            render={(p) => <MoneyInput {...p} />}
          />
        </div>
        <FormField
          control={form.control}
          name="targetPeriodId"
          label="Apply in"
          render={(p) => (
            <Select {...p}>
              <option value="">Choose a month</option>
              {open.map((x) => (
                <option key={x.id} value={x.id}>
                  {formatMonth(x.year, x.month)}
                </option>
              ))}
            </Select>
          )}
        />
        <FormField
          control={form.control}
          name="reason"
          label="Reason"
          render={(p) => <Textarea {...p} className="min-h-16" />}
        />
      </form>
    </Dialog>
  );
}

function DecisionDialog({
  adjustment,
  decision,
  periodLabel,
  onClose,
}: {
  adjustment: PayrollAdjustment;
  decision: 'approve' | 'reject';
  periodLabel: string;
  onClose: () => void;
}) {
  const decide = useDecideAdjustment();
  const errorMessage = useErrorMessage();
  const [text, setText] = useState('');
  const [needsNote, setNeedsNote] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const name = adjustment.employee.name;
  const amount = formatMoney(adjustment.amount.amount);
  const reject = decision === 'reject';

  const confirm = async () => {
    setError(null);
    if (reject && !text.trim()) return setFieldError(`Enter a comment. ${name}'s preparer will see it.`);
    if (needsNote && text.trim().length < 20)
      return setFieldError("Explain why you're approving your own adjustment (at least 20 characters).");
    try {
      await decide.mutateAsync(
        reject
          ? { id: adjustment.id, decision: 'reject', version: adjustment.version, comment: text.trim() }
          : {
              id: adjustment.id,
              decision: 'approve',
              version: adjustment.version,
              ...(needsNote ? { selfApprovalNote: text.trim() } : {}),
            },
      );
      notify.success(reject ? 'Adjustment rejected' : 'Adjustment approved');
      onClose();
    } catch (err) {
      if (isStepUpCancel(err)) return;
      if (errorCode(err) === 'SELF_APPROVAL_NOTE_REQUIRED') {
        setNeedsNote(true);
        setFieldError(undefined);
        return;
      }
      setError(errorMessage(err));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        reject
          ? 'Reject this adjustment?'
          : needsNote
            ? 'Approve your own adjustment?'
            : 'Approve this adjustment?'
      }
      description={
        reject
          ? 'The preparer will see your comment.'
          : needsNote
            ? "You created this adjustment. Approving it yourself is allowed but flagged for review. Explain why another approver isn't available."
            : `${amount} ${adjustment.type} for ${name}, applied in ${periodLabel}.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={reject ? 'destructive' : 'primary'}
            loading={decide.isPending}
            onClick={() => void confirm()}
          >
            {reject ? 'Reject adjustment' : 'Approve adjustment'}
          </Button>
        </>
      }
    >
      <FormError message={error} />
      <p>
        {name} <span className="font-mono text-sm text-text-2">{adjustment.employee.employeeCode}</span> ·{' '}
        <Money
          amount={adjustment.type === 'deduction' ? `-${adjustment.amount.amount}` : adjustment.amount.amount}
        />
      </p>
      <blockquote className="rounded-control bg-ground-2 px-3 py-2 text-[15px]">
        {adjustment.reason}
      </blockquote>
      {reject || needsNote ? (
        <Field
          label={reject ? 'Comment' : 'Reason for approving your own adjustment'}
          error={fieldError}
          hint={needsNote ? 'At least 20 characters.' : undefined}
        >
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={text}
              maxLength={1000}
              autoFocus={needsNote}
              onChange={(e) => {
                setText(e.target.value);
                setFieldError(undefined);
              }}
            />
          )}
        </Field>
      ) : null}
    </Dialog>
  );
}
