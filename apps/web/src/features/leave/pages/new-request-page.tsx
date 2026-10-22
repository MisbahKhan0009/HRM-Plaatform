import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreateLeaveRequestInput,
  CreateLeaveRequestInputSchema,
  type LeaveBalance,
  type LeaveRequestPreview,
  type LeaveType,
} from '@hrm/contracts';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  KeyValueList,
  notify,
  Select,
  Textarea,
} from '@hrm/ui';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { type Resolver, useForm, useWatch } from 'react-hook-form';
import { PageHeader } from '../../../components/page-header';
import { ApiError } from '../../../lib/api/client';
import { useErrorMessage } from '../../../lib/api/errors';
import { useCan, useMe } from '../../../lib/auth/me';
import { formatDays, formatShortDate, todayIso } from '../../../lib/format';
import { applyServerErrors, FormError, FormField } from '../../../lib/forms';
import { leaveQueries, useCreateLeaveRequest } from '../api';
import { EmployeePicker, type PickedEmployee } from '../components/employee-picker';
import { useDebouncedValue } from '../use-debounced-value';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
type FormValues = CreateLeaveRequestInput;

// Plain words for empty required fields instead of the schema's format messages (CONTENT-STYLE §5).
const REQUIRED: Partial<Record<keyof FormValues, string>> = {
  leaveTypeId: 'Choose a leave type.',
  startDate: 'Choose a start date.',
  endDate: 'Choose an end date.',
};
const contractResolver: Resolver<FormValues> = zodResolver(CreateLeaveRequestInputSchema as never) as never;
const resolver: Resolver<FormValues> = async (values, context, options) => {
  const result = await contractResolver(values, context, options);
  for (const [name, message] of Object.entries(REQUIRED)) {
    const error = result.errors[name as keyof FormValues];
    if (error && !values[name as keyof FormValues]) error.message = message;
  }
  return result;
};

/** The body to preview, or null until type and dates make a complete request (FORMS-AND-VALIDATION §2). */
function previewBody(
  v: Partial<FormValues>,
  onBehalf: PickedEmployee | null,
): CreateLeaveRequestInput | null {
  if (!v.leaveTypeId || !v.startDate || !v.endDate || !ISO.test(v.startDate) || !ISO.test(v.endDate))
    return null;
  if (v.endDate < v.startDate) return null;
  if (v.unit === 'half_day' && (!v.halfDayPart || v.startDate !== v.endDate)) return null;
  return {
    leaveTypeId: v.leaveTypeId,
    startDate: v.startDate,
    endDate: v.endDate,
    unit: v.unit ?? 'day',
    ...(v.unit === 'half_day' && v.halfDayPart ? { halfDayPart: v.halfDayPart } : {}),
    ...(onBehalf ? { employeeId: onBehalf.id } : {}),
  };
}

/** Dates in [from, to] the server did not count: weekends and holidays (USER-FLOWS 5.1 step 3). */
function skippedDates(from: string, to: string, counted: string[]) {
  const out: string[] = [];
  const set = new Set(counted);
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < 62; i++) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > to) break;
    if (!set.has(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// SCREEN-INVENTORY 4.2, USER-FLOWS 5.1.
export function NewLeaveRequestPage() {
  const me = useMe();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const canOwn = useCan('leave.request.own') && Boolean(me?.employee);
  const canOnBehalf = useCan('leave.request.review.all');
  const [forOther, setForOther] = useState(!canOwn);
  const [employee, setEmployee] = useState<PickedEmployee | null>(null);
  const [employeeError, setEmployeeError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const submitted = useRef(false);
  const create = useCreateLeaveRequest();
  const year = Number(todayIso().slice(0, 4));

  // useZodForm's options (FORMS-AND-VALIDATION §1) with the friendlier resolver above.
  const form = useForm<FormValues>({
    resolver,
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: {
      leaveTypeId: '',
      startDate: '',
      endDate: '',
      unit: 'day',
      halfDayPart: undefined,
      reason: undefined,
    },
  });
  const { isDirty } = form.formState;
  const values = useWatch({ control: form.control }) as Partial<FormValues>;
  const onBehalf = forOther ? employee : null;

  const types = useQuery(leaveQueries.types());
  const ownBalances = useQuery({ ...leaveQueries.myBalances(year), enabled: canOwn && !forOther });
  const otherBalances = useQuery({
    ...leaveQueries.balances({ employeeId: employee?.id, year, page: 1, pageSize: 100 }),
    enabled: forOther && Boolean(employee),
  });
  const balances: LeaveBalance[] =
    (forOther ? (employee ? otherBalances.data?.data : undefined) : ownBalances.data?.data) ?? [];
  const type: LeaveType | undefined = types.data?.find((t) => t.id === values.leaveTypeId);

  const body = useDebouncedValue(previewBody(values, onBehalf));
  const preview = useQuery({
    ...leaveQueries.preview(body as CreateLeaveRequestInput),
    enabled: body !== null && (!forOther || Boolean(employee)),
  });

  const blocker = useBlocker({
    shouldBlockFn: () => isDirty && !submitted.current,
    enableBeforeUnload: () => isDirty && !submitted.current,
    withResolver: true,
  });

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    if (forOther && !employee) {
      setEmployeeError('Choose the employee this request is for.');
      return;
    }
    if (type?.requiresReason && !v.reason) {
      form.setError('reason', { type: 'required', message: `A reason is required for ${type.name}.` });
      return;
    }
    try {
      const created = await create.mutateAsync({
        ...v,
        ...(v.unit === 'half_day' ? { endDate: v.startDate } : { halfDayPart: undefined }),
        ...(onBehalf ? { employeeId: onBehalf.id } : {}),
      });
      submitted.current = true;
      notify.success(
        onBehalf ? 'Leave request submitted' : 'Request submitted. Your manager will review it.',
      );
      await navigate({ to: '/leave/requests/$requestId', params: { requestId: created.id } });
    } catch (err) {
      // INVALID_DATE carries no field pointer (notice period, joining date, leave year): show it on the start date.
      if (err instanceof ApiError && err.code === 'INVALID_DATE' && !err.errors.length) {
        form.setError('startDate', { type: 'server', message: errorMessage(err) });
        return;
      }
      if (err instanceof ApiError && err.errors.some((e) => e.path === '/employeeId')) {
        setEmployeeError('Choose an active employee.');
      }
      setFormError(applyServerErrors(form, err, errorMessage));
      // A half day has no end date field: show its errors on the date.
      const endError = form.getFieldState('endDate').error;
      if (v.unit === 'half_day' && endError) {
        form.clearErrors('endDate');
        form.setError('startDate', endError);
      }
    }
  });

  const halfDay = values.unit === 'half_day';
  const setUnit = (unit: 'day' | 'half_day') => {
    form.setValue('unit', unit, { shouldDirty: true });
    if (unit === 'half_day') {
      form.setValue('endDate', values.startDate ?? '', { shouldDirty: true });
      if (!values.halfDayPart) form.setValue('halfDayPart', 'first_half', { shouldDirty: true });
    } else {
      form.setValue('halfDayPart', undefined, { shouldDirty: true });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Request leave"
        breadcrumb={{ label: 'My leave', to: canOwn ? '/leave' : '/leave/manage' }}
      />
      <form
        noValidate
        onSubmit={submit}
        className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start"
      >
        <Card className="flex flex-col gap-5 lg:col-start-1">
          <FormError message={formError} />
          {canOnBehalf && canOwn ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium">Request for</legend>
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="for"
                    checked={!forOther}
                    onChange={() => setForOther(false)}
                    className="accent-[var(--action)]"
                  />
                  Myself
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="for"
                    checked={forOther}
                    onChange={() => setForOther(true)}
                    className="accent-[var(--action)]"
                  />
                  An employee (on their behalf)
                </label>
              </div>
            </fieldset>
          ) : null}
          {forOther ? (
            <>
              <Alert tone="info">You are acting on behalf of the employee. This is recorded.</Alert>
              <Field label="Employee" error={employeeError}>
                {({ id, describedBy, invalid }) => (
                  <EmployeePicker
                    id={id}
                    value={employee}
                    describedBy={describedBy}
                    invalid={invalid}
                    onChange={(e) => {
                      setEmployee(e);
                      setEmployeeError(undefined);
                    }}
                  />
                )}
              </Field>
            </>
          ) : null}
          <FormField
            control={form.control}
            name="leaveTypeId"
            label="Leave type"
            render={(p) => (
              <Select
                {...p}
                onChange={(e) => {
                  p.onChange(e.target.value);
                  const next = types.data?.find((t) => t.id === e.target.value);
                  if (next && !next.allowsHalfDay && halfDay) setUnit('day');
                }}
              >
                <option value="">Choose a leave type</option>
                {types.data?.map((t) => {
                  const b = balances.find((x) => x.leaveTypeId === t.id);
                  return (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {b ? ` · ${formatDays(b.available)} left` : ''}
                    </option>
                  );
                })}
              </Select>
            )}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">Duration</legend>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="unit"
                  checked={!halfDay}
                  onChange={() => setUnit('day')}
                  className="accent-[var(--action)]"
                />
                Full days
              </label>
              <label
                className={`inline-flex items-center gap-2 ${type && !type.allowsHalfDay ? 'text-text-3' : 'cursor-pointer'}`}
              >
                <input
                  type="radio"
                  name="unit"
                  checked={halfDay}
                  disabled={Boolean(type && !type.allowsHalfDay)}
                  onChange={() => setUnit('half_day')}
                  className="accent-[var(--action)]"
                />
                Half day
              </label>
            </div>
            {type && !type.allowsHalfDay ? (
              <p className="text-sm text-text-2">{type.name} is taken in full days.</p>
            ) : null}
          </fieldset>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="startDate"
              label={halfDay ? 'Date' : 'Start date'}
              render={(p) => (
                <Input
                  type="date"
                  {...p}
                  onChange={(e) => {
                    p.onChange(e.target.value);
                    if (halfDay || !values.endDate || values.endDate < e.target.value)
                      form.setValue('endDate', e.target.value, { shouldDirty: true });
                  }}
                />
              )}
            />
            {halfDay ? (
              <FormField
                control={form.control}
                name="halfDayPart"
                label="Part of the day"
                render={(p) => (
                  <Select {...p}>
                    <option value="first_half">First half</option>
                    <option value="second_half">Second half</option>
                  </Select>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name="endDate"
                label="End date"
                render={(p) => <Input type="date" min={values.startDate || undefined} {...p} />}
              />
            )}
          </div>
          <FormField
            control={form.control}
            name="reason"
            label="Reason"
            optional={!type?.requiresReason}
            hint={forOther ? 'The employee and their manager see this.' : 'Your manager sees this.'}
            render={(p) => (
              <Textarea {...p} maxLength={1000} onChange={(e) => p.onChange(e.target.value || undefined)} />
            )}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" asChild>
              <Link to={canOwn ? '/leave' : '/leave/manage'}>Cancel</Link>
            </Button>
            <Button variant="primary" type="submit" loading={create.isPending}>
              Submit request
            </Button>
          </div>
        </Card>
        <PreviewPanel
          body={body}
          preview={preview}
          waitingForEmployee={forOther && !employee}
          errorMessage={errorMessage}
        />
      </form>
      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(o) => {
          if (!o && blocker.status === 'blocked') blocker.reset();
        }}
        title="Discard changes?"
        description="Your leave request hasn't been submitted. Leave requests have no drafts, so your input will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          if (blocker.status === 'blocked') blocker.proceed();
        }}
      />
    </div>
  );
}

function PreviewPanel({
  body,
  preview,
  waitingForEmployee,
  errorMessage,
}: {
  body: CreateLeaveRequestInput | null;
  preview: UseQueryResult<LeaveRequestPreview>;
  waitingForEmployee: boolean;
  errorMessage: (e: unknown) => string;
}) {
  const p = preview.data;
  const skipped = p && body ? skippedDates(body.startDate, body.endDate, p.workingDates) : [];
  return (
    <aside
      aria-labelledby="preview-title"
      className="rounded-card border border-line bg-surface p-4 sm:p-6 lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1"
    >
      <h2 id="preview-title" className="mb-3 font-display text-[17px] font-semibold">
        Before you submit
      </h2>
      <div aria-live="polite" className="flex flex-col gap-3">
        {waitingForEmployee ? (
          <p className="text-text-2">Choose the employee to see working days and their balance.</p>
        ) : !body ? (
          <p className="text-text-2">
            Choose a leave type and dates to see working days and your balance after.
          </p>
        ) : preview.isError && !preview.isFetching ? (
          <Alert tone="warn">{errorMessage(preview.error)}</Alert>
        ) : !p ? (
          <p className="text-text-2">Checking dates…</p>
        ) : (
          <>
            <KeyValueList
              className={preview.isFetching ? 'opacity-60' : undefined}
              items={[
                {
                  label: 'Working days',
                  value: <span className="font-mono">{formatDays(p.requestedUnits)}</span>,
                },
                {
                  label: 'Available now',
                  value: <span className="font-mono">{formatDays(p.available)}</span>,
                },
                {
                  label: 'Balance after',
                  value: <span className="font-mono">{formatDays(p.availableAfter)}</span>,
                },
              ]}
            />
            {skipped.length ? (
              <p className="text-sm text-text-2">
                Not counted (weekend or holiday):{' '}
                {skipped
                  .slice(0, 8)
                  .map((d) => formatShortDate(d))
                  .join(', ')}
                {skipped.length > 8 ? ` and ${skipped.length - 8} more` : ''}.
              </p>
            ) : null}
            {!p.sufficientBalance ? (
              <Alert tone="warn">
                Not enough balance: {formatDays(p.available)} available. Shorten the request or choose another
                type.
              </Alert>
            ) : null}
            {p.overlapsExisting ? <Alert tone="warn">There is already leave on these dates.</Alert> : null}
            <p className="text-sm text-text-3">An estimate. The request is checked again when you submit.</p>
          </>
        )}
      </div>
    </aside>
  );
}
