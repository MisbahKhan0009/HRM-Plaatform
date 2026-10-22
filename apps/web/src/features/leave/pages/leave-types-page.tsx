import {
  allocationMethodValues,
  CreateLeavePolicyInputSchema,
  CreateLeaveTypeInputSchema,
  type LeavePolicy,
  type LeaveType,
  UpdateLeaveTypeInputSchema,
} from '@hrm/contracts';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Input,
  LoadingBlock,
  notify,
  Select,
  StatusBadge,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../components/page-header';
import { useErrorMessage } from '../../../lib/api/errors';
import { useCan } from '../../../lib/auth/me';
import { formatDate, formatDays, todayIso } from '../../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../../lib/forms';
import { ALLOCATION_LABEL, leaveQueries, useCreatePolicy, useSaveLeaveType } from '../api';

/** `Annual grant · 10 days`, `Per days worked · 1 day per 18 days`. */
export function policySummary(p: LeavePolicy) {
  switch (p.allocationMethod) {
    case 'annual_grant':
      return `${ALLOCATION_LABEL.annual_grant} · ${formatDays(p.annualEntitlement ?? '0')} a year`;
    case 'monthly_accrual':
      return `${ALLOCATION_LABEL.monthly_accrual} · ${formatDays(p.accrualPerMonth ?? '0')} a month`;
    case 'per_days_worked':
      return `${ALLOCATION_LABEL.per_days_worked} · 1 day per ${formatDays(p.daysWorkedPerUnit ?? '0')} worked`;
    case 'manual':
      return ALLOCATION_LABEL.manual;
  }
}

// SCREEN-INVENTORY §11 `/settings/leave-types`: read-only with `settings.read`; edits need `leave.policy.manage`.
export function LeaveTypesPage() {
  const { t } = useTranslation();
  const canManage = useCan('leave.policy.manage');
  const list = useQuery(leaveQueries.types(true));
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  const [policiesFor, setPoliciesFor] = useState<LeaveType | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Leave types"
        description="Each type has effective-dated policies. A new policy version starts today or later; past versions never change."
        actions={
          canManage ? (
            <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setEditing('new')}>
              Add leave type
            </Button>
          ) : null
        }
      />
      <TableContainer>
        {list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="Loading leave types" />
          </div>
        ) : !list.data?.length ? (
          <EmptyState
            icon={CalendarDays}
            title="No leave types yet"
            description="Add the leave types your company offers, then set a policy for each."
            className="border-0"
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Code</TH>
                <TH>Name</TH>
                <TH>Current policy</TH>
                <TH>Rules</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {list.data.map((ty) => (
                <TR key={ty.id}>
                  <TD className="font-mono">{ty.code}</TD>
                  <TD className="whitespace-nowrap">{ty.name}</TD>
                  <TD className="min-w-48">
                    {ty.currentPolicy ? (
                      policySummary(ty.currentPolicy)
                    ) : (
                      <span className="text-text-2">No policy in force</span>
                    )}
                  </TD>
                  <TD className="text-sm text-text-2">
                    {[
                      ty.isPaid ? 'Paid' : 'Unpaid',
                      ty.allowsHalfDay ? 'half days allowed' : 'full days only',
                      ty.requiresReason ? 'reason required' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </TD>
                  <TD>
                    <StatusBadge
                      status={ty.isActive ? 'active' : 'archived'}
                      label={ty.isActive ? t('status.active') : 'Inactive'}
                    />
                  </TD>
                  <TD className="text-right whitespace-nowrap">
                    {canManage ? (
                      <>
                        <Button variant="text" onClick={() => setPoliciesFor(ty)}>
                          Policies<span className="sr-only"> for {ty.name}</span>
                        </Button>
                        <Button variant="text" className="ml-4" onClick={() => setEditing(ty)}>
                          Edit<span className="sr-only"> {ty.name}</span>
                        </Button>
                      </>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </TableContainer>
      {editing ? (
        <LeaveTypeDialog type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
      {policiesFor ? <PoliciesDialog type={policiesFor} onClose={() => setPoliciesFor(null)} /> : null}
    </div>
  );
}

const field = (name: string) => name as never;

function LeaveTypeDialog({ type, onClose }: { type: LeaveType | null; onClose: () => void }) {
  const save = useSaveLeaveType();
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(type ? UpdateLeaveTypeInputSchema : CreateLeaveTypeInputSchema, {
    name: type?.name ?? '',
    isPaid: type?.isPaid ?? true,
    allowsHalfDay: type?.allowsHalfDay ?? true,
    requiresReason: type?.requiresReason ?? false,
    sortOrder: type?.sortOrder ?? 0,
    ...(type ? { version: type.version, isActive: type.isActive } : { code: '' }),
  } as never);
  const submit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(type ? { id: type.id, update: values as never } : { create: values as never });
      notify.success(type ? 'Leave type saved' : 'Leave type added');
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  const check = (name: string, label: string) => <Checkbox label={label} {...form.register(field(name))} />;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={type ? `Edit ${type.name}` : 'Add leave type'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            {type ? 'Save changes' : 'Add leave type'}
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {!type ? (
          <FormField
            control={form.control}
            name={field('code')}
            label="Code"
            hint="2 to 10 letters, for example CL. It can't be changed later."
            render={(p) => <Input autoComplete="off" className="font-mono uppercase" {...p} />}
          />
        ) : null}
        <FormField
          control={form.control}
          name={field('name')}
          label="Name"
          render={(p) => <Input {...p} />}
        />
        <FormField
          control={form.control}
          name={field('sortOrder')}
          label="Order in lists"
          render={(p) => (
            <Input
              type="number"
              min={0}
              max={1000}
              {...p}
              onChange={(e) => p.onChange(Number(e.target.value))}
            />
          )}
        />
        <div className="flex flex-col gap-1">
          {check('isPaid', 'Paid leave')}
          {check('allowsHalfDay', 'Half days allowed')}
          {check('requiresReason', 'Reason required')}
          {type ? check('isActive', 'Active (employees can request it)') : null}
        </div>
      </form>
    </Dialog>
  );
}

function PoliciesDialog({ type, onClose }: { type: LeaveType; onClose: () => void }) {
  const list = useQuery(leaveQueries.policies(type.id));
  const [creating, setCreating] = useState(false);
  const today = todayIso();
  if (creating)
    return (
      <PolicyForm
        type={type}
        latest={list.data?.[0] ?? type.currentPolicy}
        onClose={() => setCreating(false)}
      />
    );
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={`${type.name} policies`}
      description="Newest first. Versions are never edited: a change is a new version from a future date."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            New policy version
          </Button>
        </>
      }
    >
      {list.isPending ? (
        <LoadingBlock label="Loading policies" rows={2} />
      ) : !list.data?.length ? (
        <p className="text-text-2">No policy yet. Employees can't request this type until one is in force.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {list.data.map((p) => {
            const current = p.effectiveFrom <= today && (p.effectiveTo === null || p.effectiveTo >= today);
            return (
              <li key={p.id} className="flex flex-col gap-1 py-3">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {formatDate(p.effectiveFrom)} to {p.effectiveTo ? formatDate(p.effectiveTo) : 'open'}
                  {current ? (
                    <Badge tone="ok">Current</Badge>
                  ) : p.effectiveFrom > today ? (
                    <Badge tone="info">Scheduled</Badge>
                  ) : null}
                </p>
                <p>{policySummary(p)}</p>
                <p className="text-sm text-text-2">
                  {[
                    p.prorateFirstYear ? 'prorated in the first year' : 'full grant in the first year',
                    p.eligibilityAfterDays ? `eligible after ${p.eligibilityAfterDays} days` : null,
                    p.maxCarryForward
                      ? `carry forward up to ${formatDays(p.maxCarryForward)}`
                      : 'no carry-forward',
                    p.carryForwardExpiryMonths
                      ? `carried days expire after ${p.carryForwardExpiryMonths} months`
                      : null,
                    p.maxBalance ? `balance capped at ${formatDays(p.maxBalance)}` : null,
                    p.maxConsecutiveDays ? `at most ${formatDays(p.maxConsecutiveDays)} in a row` : null,
                    p.minNoticeDays ? `${p.minNoticeDays} days' notice` : null,
                    p.allowNegativeBalance ? 'negative balance allowed' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Dialog>
  );
}

const PARAMETER = {
  annual_grant: { name: 'annualEntitlement', label: 'Days a year' },
  monthly_accrual: { name: 'accrualPerMonth', label: 'Days a month' },
  per_days_worked: { name: 'daysWorkedPerUnit', label: 'Days worked for one day of leave' },
} as const;

function PolicyForm({
  type,
  latest,
  onClose,
}: {
  type: LeaveType;
  latest: LeavePolicy | null | undefined;
  onClose: () => void;
}) {
  const create = useCreatePolicy();
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const today = todayIso();
  // Prefilled from the latest version so only the changed values need typing (WCAG 3.3.7).
  const form = useZodForm(CreateLeavePolicyInputSchema, {
    effectiveFrom: today,
    allocationMethod: latest?.allocationMethod ?? 'annual_grant',
    annualEntitlement: latest?.annualEntitlement ?? null,
    accrualPerMonth: latest?.accrualPerMonth ?? null,
    daysWorkedPerUnit: latest?.daysWorkedPerUnit ?? null,
    prorateFirstYear: latest?.prorateFirstYear ?? true,
    eligibilityAfterDays: latest?.eligibilityAfterDays ?? 0,
    maxCarryForward: latest?.maxCarryForward ?? null,
    maxBalance: latest?.maxBalance ?? null,
    carryForwardExpiryMonths: latest?.carryForwardExpiryMonths ?? null,
    allowNegativeBalance: latest?.allowNegativeBalance ?? false,
    maxConsecutiveDays: latest?.maxConsecutiveDays ?? null,
    minNoticeDays: latest?.minNoticeDays ?? 0,
  });
  const method = form.watch('allocationMethod');
  const submit = form.handleSubmit(async (v) => {
    // Only the selected method's parameter is sent; the others would be ignored by the allocation job anyway.
    const input = {
      ...v,
      annualEntitlement: v.allocationMethod === 'annual_grant' ? v.annualEntitlement : null,
      accrualPerMonth: v.allocationMethod === 'monthly_accrual' ? v.accrualPerMonth : null,
      daysWorkedPerUnit: v.allocationMethod === 'per_days_worked' ? v.daysWorkedPerUnit : null,
    };
    try {
      await create.mutateAsync({ typeId: type.id, input });
      notify.success('Policy version added');
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  const qty = (name: string, label: string, hint?: string) => (
    <FormField
      control={form.control}
      name={field(name)}
      label={label}
      optional
      {...(hint ? { hint } : {})}
      render={(p) => (
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="font-mono"
          {...p}
          onChange={(e) => p.onChange(e.target.value.trim() || null)}
        />
      )}
    />
  );
  const int = (name: string, label: string, nullable = false) => (
    <FormField
      control={form.control}
      name={field(name)}
      label={label}
      {...(nullable ? { optional: true } : {})}
      render={(p) => (
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          {...p}
          onChange={(e) => p.onChange(e.target.value === '' ? (nullable ? null : 0) : Number(e.target.value))}
        />
      )}
    />
  );
  const check = (name: string, label: string) => <Checkbox label={label} {...form.register(field(name))} />;
  const parameter = method !== 'manual' ? PARAMETER[method] : null;
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={`New ${type.name} policy version`}
      description="The current version ends the day before this one starts. Balances already posted don't change."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => void submit()}>
            Add policy version
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="effectiveFrom"
            label="Effective from"
            hint="Today or later."
            render={(p) => <Input type="date" min={today} {...p} />}
          />
          <FormField
            control={form.control}
            name="allocationMethod"
            label="Allocation"
            render={(p) => (
              <Select {...p}>
                {allocationMethodValues.map((m) => (
                  <option key={m} value={m}>
                    {ALLOCATION_LABEL[m]}
                  </option>
                ))}
              </Select>
            )}
          />
        </div>
        {parameter ? (
          <FormField
            key={parameter.name}
            control={form.control}
            name={parameter.name}
            label={parameter.label}
            render={(p) => (
              <Input
                inputMode="decimal"
                autoComplete="off"
                className="font-mono"
                {...p}
                onChange={(e) => p.onChange(e.target.value.trim() || null)}
              />
            )}
          />
        ) : (
          <p className="text-sm text-text-2">
            HR grants days with balance adjustments; nothing is posted automatically.
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {int('eligibilityAfterDays', 'Eligible after (days of service)')}
          {int('minNoticeDays', 'Notice needed (days)')}
          {qty('maxCarryForward', 'Carry forward up to (days)', 'Empty means nothing carries forward.')}
          {int('carryForwardExpiryMonths', 'Carried days expire after (months)', true)}
          {qty('maxBalance', 'Maximum balance (days)')}
          {qty('maxConsecutiveDays', 'Most days in one request')}
        </div>
        <div className="flex flex-col gap-1">
          {check('prorateFirstYear', 'Prorate the first year')}
          {check('allowNegativeBalance', 'Allow a negative balance')}
        </div>
      </form>
    </Dialog>
  );
}
