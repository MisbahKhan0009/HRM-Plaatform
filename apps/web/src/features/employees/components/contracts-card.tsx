import {
  CreateEmploymentContractInputSchema,
  contractStatusValues,
  contractTypeValues,
  type EmploymentContract,
} from '@hrm/contracts';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Input,
  LoadingBlock,
  notify,
  Select,
  StatusBadge,
  Table,
  TBody,
  TD,
  Textarea,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { FileSignature, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useErrorMessage } from '../../../lib/api/errors';
import { formatDate, todayIso } from '../../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../../lib/forms';
import { employeeQueries, useSaveContract } from '../api';
import { blank } from '../forms';
import { CONTRACT_STATUS_LABEL, CONTRACT_TYPE_LABEL } from '../labels';

/** Contracts (FR-DOC-009): `employee.read.all` or own to read, `employee.manage` to add and edit. */
export function ContractsCard({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const list = useQuery(employeeQueries.contracts(employeeId));
  const errorMessage = useErrorMessage();
  const [editing, setEditing] = useState<EmploymentContract | 'new' | null>(null);
  return (
    <Card aria-labelledby="h-contracts" className="p-0 sm:p-0">
      <div className="p-4 pb-0 sm:p-6 sm:pb-0">
        <CardHeader
          id="h-contracts"
          title="Contracts"
          actions={
            canEdit ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus aria-hidden="true" />}
                onClick={() => setEditing('new')}
              >
                Add contract
              </Button>
            ) : null
          }
        />
      </div>
      {list.isPending ? (
        <div className="p-4 sm:p-6">
          <LoadingBlock label="contracts" rows={2} />
        </div>
      ) : list.isError ? (
        <p className="p-4 text-bad sm:p-6">{errorMessage(list.error)}</p>
      ) : !list.data.data.length ? (
        <EmptyState
          variant="no-results"
          icon={FileSignature}
          title="No contracts yet"
          description={
            canEdit
              ? 'Record the employment contract here; the signed file goes in Documents.'
              : 'Contracts appear here once HR records them.'
          }
          className="border-0"
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <tr>
                <TH>Type</TH>
                <TH>Start</TH>
                <TH>End</TH>
                <TH>Status</TH>
                <TH>Notes</TH>
                {canEdit ? (
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                ) : null}
              </tr>
            </THead>
            <TBody>
              {list.data.data.map((c) => (
                <TR key={c.id}>
                  <TD>{CONTRACT_TYPE_LABEL[c.type]}</TD>
                  <TD className="whitespace-nowrap">{formatDate(c.startDate)}</TD>
                  <TD className="whitespace-nowrap">{c.endDate ? formatDate(c.endDate) : 'Open-ended'}</TD>
                  <TD>
                    <StatusBadge
                      status={c.status}
                      label={t(`status.${c.status}`, { defaultValue: CONTRACT_STATUS_LABEL[c.status] })}
                    />
                  </TD>
                  <TD className="max-w-xs truncate text-text-2">{c.notes ?? '—'}</TD>
                  {canEdit ? (
                    <TD className="text-right">
                      <Button variant="text" onClick={() => setEditing(c)}>
                        Edit
                      </Button>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
      {editing ? (
        <ContractDialog
          employeeId={employeeId}
          contract={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

const K = CreateEmploymentContractInputSchema.shape;
const ContractForm = z
  .object({
    type: K.type,
    startDate: K.startDate,
    endDate: blank(K.endDate),
    status: K.status,
    notes: blank(K.notes),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: 'The end date is before the start date.',
    path: ['endDate'],
  })
  .refine((v) => v.type !== 'fixed_term' || Boolean(v.endDate), {
    message: 'A fixed-term contract needs an end date.',
    path: ['endDate'],
  });

function ContractDialog({
  employeeId,
  contract,
  onClose,
}: {
  employeeId: string;
  contract: EmploymentContract | null;
  onClose: () => void;
}) {
  const save = useSaveContract(employeeId);
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(ContractForm, {
    type: contract?.type ?? 'permanent',
    startDate: contract?.startDate ?? todayIso(),
    endDate: contract?.endDate ?? '',
    status: contract?.status ?? 'active',
    notes: contract?.notes ?? '',
  });
  const submit = form.handleSubmit(async (v) => {
    try {
      if (contract) await save.mutateAsync({ id: contract.id, update: { ...v, version: contract.version } });
      else await save.mutateAsync({ create: v });
      notify.success(contract ? 'Contract saved' : 'Contract added');
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={contract ? 'Edit contract' : 'Add contract'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            {contract ? 'Save changes' : 'Add contract'}
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <FormField
          control={form.control}
          name="type"
          label="Type"
          render={(p) => (
            <Select {...p} onChange={(e) => p.onChange(e.target.value)}>
              {contractTypeValues.map((v) => (
                <option key={v} value={v}>
                  {CONTRACT_TYPE_LABEL[v]}
                </option>
              ))}
            </Select>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="startDate"
            label="Start date"
            render={(p) => <Input type="date" {...p} />}
          />
          <FormField
            control={form.control}
            name="endDate"
            label="End date"
            optional
            render={(p) => <Input type="date" {...p} />}
          />
        </div>
        <FormField
          control={form.control}
          name="status"
          label="Status"
          render={(p) => (
            <Select {...p} onChange={(e) => p.onChange(e.target.value)}>
              {contractStatusValues.map((v) => (
                <option key={v} value={v}>
                  {CONTRACT_STATUS_LABEL[v]}
                </option>
              ))}
            </Select>
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          label="Notes"
          optional
          render={(p) => <Textarea {...p} />}
        />
      </form>
    </Dialog>
  );
}
