import type { PaymentImportResult, PayrollItem, PayrollPayment, PayrollRun } from '@hrm/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Input,
  KeyValueList,
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
import { Upload, Wallet } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { useErrorMessage } from '../../lib/api/errors';
import { useCan } from '../../lib/auth/me';
import { formatDate, formatMoney, todayIso } from '../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../lib/forms';
import { payrollQueries, useCancelPayment, useImportPayments, useRecordPayment } from './api';
import { errorCode, isStepUpCancel, Money, StatusLabel } from './components';
import { MONEY_INPUT, sumMoney, toDecimal } from './money';

const PAGE = 100;

/** The `paid` payment per item: what the row shows and what "Cancel payment" acts on (D-042: at most one). */
function usePaidPayments(run: PayrollRun) {
  const payments = useQuery(payrollQueries.paidPayments(run.id));
  const byItem = new Map<string, PayrollPayment>();
  for (const p of payments.data ?? []) if (!byItem.has(p.payrollItemId)) byItem.set(p.payrollItemId, p);
  return byItem;
}

export function PaymentsTab({ run }: { run: PayrollRun }) {
  const canPay = useCan('payroll.pay');
  const [page, setPage] = useState(1);
  const items = useQuery({
    ...payrollQueries.items(run.id, { page, pageSize: PAGE }),
    enabled: Boolean(run.totals),
  });
  const payments = usePaidPayments(run);
  const [recording, setRecording] = useState<PayrollItem | null>(null);
  const [cancelling, setCancelling] = useState<{ item: PayrollItem; payment: PayrollPayment } | null>(null);
  const [importing, setImporting] = useState(false);
  const editable = canPay && run.status === 'locked';

  if (!['locked', 'paid', 'reconciled'].includes(run.status)) {
    return (
      <EmptyState
        icon={Wallet}
        title="Payments open after the run is locked"
        description="Approve and lock the run, then record each cash or cheque payment here."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <TableContainer
        toolbar={
          <>
            <p className="flex-1 text-sm text-text-2">
              Recording a payment doesn't move money. It records what was paid outside the system.
            </p>
            {editable ? (
              <Button icon={<Upload aria-hidden="true" />} onClick={() => setImporting(true)}>
                Import CSV
              </Button>
            ) : null}
          </>
        }
      >
        {items.isPending ? (
          <div className="p-4">
            <LoadingBlock label="payments" />
          </div>
        ) : items.isError ? (
          <div className="p-4">
            <Alert tone="bad">We couldn't load payments.</Alert>
          </div>
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Employee</TH>
                  <TH numeric>Net pay</TH>
                  <TH>Method</TH>
                  <TH>Paid on</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {items.data.data.map((i) => {
                  const p = payments.get(i.id);
                  const live = p && i.paymentStatus === 'paid' ? p : null;
                  return (
                    <TR key={i.id}>
                      <TD>
                        {i.employee.name}{' '}
                        <span className="font-mono text-sm text-text-2">{i.employee.employeeCode}</span>
                      </TD>
                      <TD numeric>
                        <Money amount={i.netAmount.amount} />
                      </TD>
                      <TD>
                        {live
                          ? live.method === 'cheque'
                            ? `Cheque No. ${live.chequeNumber ?? ''}`
                            : 'Cash'
                          : '—'}
                      </TD>
                      <TD className="whitespace-nowrap">{live ? formatDate(live.paidOn) : '—'}</TD>
                      <TD>
                        <StatusLabel status={i.paymentStatus} />
                      </TD>
                      <TD className="text-right whitespace-nowrap">
                        {editable && i.paymentStatus !== 'paid' && i.netAmount.amount !== '0.00' ? (
                          <Button size="sm" variant="secondary" onClick={() => setRecording(i)}>
                            Record payment
                          </Button>
                        ) : null}
                        {editable && live ? (
                          <Button variant="text" onClick={() => setCancelling({ item: i, payment: live })}>
                            Cancel payment
                          </Button>
                        ) : null}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <div className="border-t border-line px-4 py-2">
              <Pagination
                page={items.data.page.number}
                pageSize={items.data.page.size}
                totalItems={items.data.page.totalItems}
                onPage={setPage}
              />
            </div>
          </>
        )}
      </TableContainer>
      {recording ? (
        <RecordPaymentDialog run={run} item={recording} onClose={() => setRecording(null)} />
      ) : null}
      {cancelling ? (
        <CancelPaymentDialog
          item={cancelling.item}
          payment={cancelling.payment}
          onClose={() => setCancelling(null)}
        />
      ) : null}
      {importing ? <ImportDialog run={run} onClose={() => setImporting(false)} /> : null}
    </div>
  );
}

const PaymentFormSchema = z
  .object({
    method: z.enum(['cash', 'cheque']),
    amount: z.string().trim().regex(MONEY_INPUT, 'Enter an amount like 45000.00'),
    paidOn: z.iso.date('Enter a date.'),
    chequeNumber: z.string().trim().max(40),
    reference: z.string().trim().max(200),
    acknowledgedByName: z.string().trim().max(200),
  })
  .superRefine((v, ctx) => {
    if (v.method === 'cheque' && !v.chequeNumber)
      ctx.addIssue({ code: 'custom', path: ['chequeNumber'], message: 'Enter the cheque number.' });
    if (v.method === 'cash' && !v.reference)
      ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Enter the acknowledgment reference.' });
  });
type PaymentForm = z.output<typeof PaymentFormSchema>;

/** Record one payment (US-PAY-007): the form, then a level 3 confirmation with the summary (COMPONENT-SPECS §12). */
function RecordPaymentDialog({
  run,
  item,
  onClose,
}: {
  run: PayrollRun;
  item: PayrollItem;
  onClose: () => void;
}) {
  const record = useRecordPayment(run.id);
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const [review, setReview] = useState<PaymentForm | null>(null);
  const form = useZodForm(PaymentFormSchema, {
    method: 'cheque',
    amount: item.netAmount.amount,
    paidOn: todayIso(),
    chequeNumber: '',
    reference: '',
    acknowledgedByName: '',
  });
  const method = form.watch('method');
  const name = item.employee.name;

  const confirm = async () => {
    if (!review) return;
    try {
      await record.mutateAsync({
        payrollItemId: item.id,
        method: review.method,
        amount: { amount: toDecimal(review.amount), currency: 'BDT' },
        paidOn: review.paidOn,
        ...(review.method === 'cheque' ? { chequeNumber: review.chequeNumber } : {}),
        ...(review.reference ? { reference: review.reference } : {}),
        ...(review.acknowledgedByName ? { acknowledgedByName: review.acknowledgedByName } : {}),
      });
      notify.success(`Payment recorded for ${name}`);
      onClose();
    } catch (err) {
      setReview(null);
      if (isStepUpCancel(err)) return;
      if (errorCode(err) === 'PAYMENT_AMOUNT_MISMATCH') {
        form.setError('amount', {
          type: 'server',
          message: `This must equal ${name}'s net pay of ${formatMoney(item.netAmount.amount)}. Split payments aren't allowed.`,
        });
        return;
      }
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  };

  if (review) {
    const by = review.method === 'cheque' ? `cheque no. ${review.chequeNumber}` : 'cash';
    return (
      <ConfirmDialog
        open
        onOpenChange={(o) => !o && setReview(null)}
        tone="primary"
        title={`Record payment for ${name}?`}
        description={`${formatMoney(toDecimal(review.amount))} paid by ${by} on ${formatDate(review.paidOn)}.`}
        summary={
          <KeyValueList
            className="rounded-control border border-line p-4"
            items={[
              { label: 'Employee', value: `${name} · ${item.employee.employeeCode}` },
              { label: 'Net pay', value: <Money amount={item.netAmount.amount} /> },
              { label: 'Amount', value: <Money amount={toDecimal(review.amount)} /> },
            ]}
          />
        }
        confirmLabel="Record payment"
        loading={record.isPending}
        onConfirm={confirm}
      />
    );
  }
  const submit = form.handleSubmit((v) => {
    setFormError(null);
    setReview(v);
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record payment"
      description={`${name} · ${item.employee.employeeCode}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()}>
            Record payment
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <FormField
          control={form.control}
          name="amount"
          label="Amount"
          hint="Must equal net pay. Split payments aren't allowed."
          render={(p) => <MoneyInput {...p} />}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="method"
            label="Method"
            render={(p) => (
              <Select {...p}>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash</option>
              </Select>
            )}
          />
          <FormField
            control={form.control}
            name="paidOn"
            label="Paid on"
            render={(p) => <Input type="date" {...p} />}
          />
        </div>
        {method === 'cheque' ? (
          <FormField
            control={form.control}
            name="chequeNumber"
            label="Cheque number"
            render={(p) => <Input {...p} className="font-mono" autoComplete="off" />}
          />
        ) : null}
        <FormField
          control={form.control}
          name="reference"
          label={method === 'cash' ? 'Acknowledgment reference' : 'Reference'}
          optional={method !== 'cash'}
          hint={method === 'cash' ? 'For example the signed receipt number.' : undefined}
          render={(p) => <Input {...p} autoComplete="off" />}
        />
        {method === 'cash' ? (
          <FormField
            control={form.control}
            name="acknowledgedByName"
            label="Received by"
            optional
            render={(p) => <Input {...p} autoComplete="off" />}
          />
        ) : null}
      </form>
    </Dialog>
  );
}

/** PAY-11: a wrong entry is `cancelled`; a bounced cheque or failed hand-over is `failed`. Level 2, destructive. */
function CancelPaymentDialog({
  item,
  payment,
  onClose,
}: {
  item: PayrollItem;
  payment: PayrollPayment;
  onClose: () => void;
}) {
  const cancel = useCancelPayment();
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<'cancelled' | 'failed'>('cancelled');
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | undefined>();
  const confirm = async () => {
    if (!reason.trim()) {
      setReasonError('Enter a reason.');
      return;
    }
    try {
      await cancel.mutateAsync({ paymentId: payment.id, reason: reason.trim(), outcome });
      notify.success('Payment cancelled');
      onClose();
    } catch (err) {
      if (isStepUpCancel(err)) return;
      setError(errorMessage(err));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Cancel payment for ${item.employee.name}?`}
      description="The item goes back to unpaid (or failed) so a new payment can be recorded. This is kept in the audit log."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="destructive" loading={cancel.isPending} onClick={() => void confirm()}>
            Cancel payment
          </Button>
        </>
      }
    >
      <FormError message={error} />
      <Field label="What happened">
        {({ id }) => (
          <Select id={id} value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
            <option value="cancelled">Recorded by mistake</option>
            <option value="failed">Cheque bounced or cash not handed over</option>
          </Select>
        )}
      </Field>
      <Field label="Reason" error={reasonError}>
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={reason}
            maxLength={1000}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(undefined);
            }}
          />
        )}
      </Field>
    </Dialog>
  );
}

const CSV_HEADER = 'employeeCode,method,amount,paidOn,chequeNumber,reference,acknowledgedByName';

/** CSV import with a dry-run preview; a file with any row error records nothing (API-CATALOGUE §8). */
function ImportDialog({ run, onClose }: { run: PayrollRun; onClose: () => void }) {
  const mutation = useImportPayments(run.id);
  const errorMessage = useErrorMessage();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<PaymentImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run_ = async (dryRun: boolean) => {
    setError(null);
    try {
      const result = await mutation.mutateAsync({ csv, dryRun });
      if (dryRun) setPreview(result);
      else {
        notify.success(`${result.validRows} payments recorded`);
        onClose();
      }
    } catch (err) {
      setConfirming(false);
      if (isStepUpCancel(err)) return;
      setError(errorMessage(err));
    }
  };
  const valid = preview?.rows.filter((r) => !r.errors.length) ?? [];
  const total = sumMoney(valid.map((r) => r.amount));
  const methods = [...new Set(valid.map((r) => r.method))].join(' and ');

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="Import payments"
      description="Upload a CSV, check the preview, then record every row at once."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {preview && preview.invalidRows === 0 && preview.validRows > 0 ? (
            <Button variant="primary" onClick={() => setConfirming(true)}>
              Record {preview.validRows} payments
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!csv.trim()}
              loading={mutation.isPending}
              onClick={() => void run_(true)}
            >
              Preview
            </Button>
          )}
        </>
      }
    >
      <FormError message={error} />
      <Field label="CSV file" hint={<span className="font-mono text-xs break-all">{CSV_HEADER}</span>}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            type="file"
            accept=".csv,text/csv"
            className="py-2"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setPreview(null);
              if (file) void file.text().then(setCsv);
            }}
          />
        )}
      </Field>
      <Field label="Or paste rows" optional>
        {({ id }) => (
          <Textarea
            id={id}
            className="font-mono text-sm"
            spellCheck={false}
            value={csv}
            placeholder={`${CSV_HEADER}\nEMP-0014,cheque,66850.00,${todayIso()},004588,,`}
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview(null);
            }}
          />
        )}
      </Field>
      {preview ? (
        <>
          {preview.invalidRows ? (
            <Alert tone="bad">
              {preview.invalidRows} {preview.invalidRows === 1 ? 'row has' : 'rows have'} errors. Fix the file
              and preview again; nothing is recorded until every row is valid.
            </Alert>
          ) : (
            <Alert tone="ok">
              {preview.validRows} rows are ready, total {formatMoney(total)}.
            </Alert>
          )}
          <div className="max-h-72 overflow-auto rounded-card border border-line">
            <Table>
              <THead>
                <tr>
                  <TH>Line</TH>
                  <TH>Employee</TH>
                  <TH>Method</TH>
                  <TH numeric>Amount</TH>
                  <TH>Result</TH>
                </tr>
              </THead>
              <TBody>
                {preview.rows.map((r) => (
                  <TR key={r.line}>
                    <TD className="font-mono">{r.line}</TD>
                    <TD className="font-mono whitespace-nowrap">{r.employeeCode}</TD>
                    <TD>
                      {r.method}
                      {r.chequeNumber ? ` ${r.chequeNumber}` : ''}
                    </TD>
                    <TD numeric>
                      {/^-?\d+\.\d{2}$/.test(r.amount) ? <Money amount={r.amount} /> : r.amount}
                    </TD>
                    <TD>
                      {r.errors.length ? (
                        <span className="text-bad">{r.errors.map((e) => e.message).join(' ')}</span>
                      ) : (
                        <span className="text-ok">Ready</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="primary"
        title={`Record ${valid.length} payments?`}
        description={`Total ${formatMoney(total)} paid by ${methods || 'cash or cheque'}.`}
        confirmLabel="Record payments"
        loading={mutation.isPending}
        onConfirm={() => run_(false)}
      />
    </Dialog>
  );
}
