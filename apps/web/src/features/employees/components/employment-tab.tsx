import {
  CreateEmploymentEventInputSchema,
  type EmployeeDetail,
  type EmploymentEvent,
  manualEventTypeValues,
} from '@hrm/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Input,
  LoadingBlock,
  notify,
  Pagination,
  Select,
  Textarea,
} from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { History } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useErrorMessage } from '../../../lib/api/errors';
import { useCan } from '../../../lib/auth/me';
import { formatDate, formatDateTime, todayIso } from '../../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../../lib/forms';
import { orgQueries } from '../../organization';
import { employeeQueries, useCreateEmploymentEvent } from '../api';
import { omitBlank } from '../forms';
import { displayValue, EVENT_LABEL, FIELD_LABEL, MANUAL_EVENT_LABEL } from '../labels';
import { EmployeePicker } from './employee-picker';
import { DepartmentPicker, PositionPicker } from './org-pickers';

/** Employment tab (SCREEN-INVENTORY §8.4): effective-dated history, newest first; scheduled events are marked. */
export function EmploymentTab({ employee }: { employee: EmployeeDetail }) {
  const [page, setPage] = useState(1);
  const history = useQuery(employeeQueries.history(employee.id, page));
  const errorMessage = useErrorMessage();
  return (
    <Card aria-labelledby="h-history">
      <CardHeader id="h-history" title="Employment history" label="Effective-dated" />
      {history.isPending ? (
        <LoadingBlock label="employment history" rows={3} />
      ) : history.isError ? (
        <p className="text-bad">{errorMessage(history.error)}</p>
      ) : !history.data.data.length ? (
        <EmptyState
          variant="no-results"
          icon={History}
          title="No employment events yet"
          description="Hiring, transfers, promotions and separations appear here with their effective dates."
          className="border-0"
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ol className="flex flex-col gap-5">
            {history.data.data.map((e, i) => (
              <EventItem key={e.id} event={e} latest={i === 0 && page === 1} />
            ))}
          </ol>
          {history.data.page.totalPages > 1 ? (
            <Pagination
              page={history.data.page.number}
              pageSize={history.data.page.size}
              totalItems={history.data.page.totalItems}
              onPage={setPage}
            />
          ) : null}
        </div>
      )}
    </Card>
  );
}

function EventItem({ event: e, latest }: { event: EmploymentEvent; latest: boolean }) {
  const { t } = useTranslation();
  const status = e.changes.status?.to;
  const title =
    e.type === 'status_changed' && typeof status === 'string'
      ? `Status changed to ${t(`status.${status}`)}`
      : EVENT_LABEL[e.type];
  // Salary is never shown on employee screens (SECURITY-MODEL §5): the event is listed without its values.
  const fields = e.type === 'salary_changed' ? [] : Object.keys(e.changes).filter((f) => f !== 'status');
  return (
    <li className="relative flex gap-3 pl-5">
      <span
        className={`absolute top-2 left-0 size-2 rounded-full ${latest ? 'bg-accent' : 'bg-line-strong'}`}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {title}
          {e.status === 'scheduled' ? <Badge tone="warn">Scheduled</Badge> : null}
          {e.status === 'cancelled' ? <Badge tone="neutral">Cancelled</Badge> : null}
        </p>
        <p className="text-sm text-text-2">
          {e.status === 'scheduled' ? 'Takes effect' : 'Effective'} {formatDate(e.effectiveDate)}
          {e.createdBy ? ` · by ${e.createdBy.name}` : ''}
          <span className="sr-only">, recorded {formatDateTime(e.createdAt)}</span>
        </p>
        {fields.length ? (
          <dl className="mt-1 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
            {fields.map((f) => (
              <div key={f} className="contents">
                <dt className="text-text-2">{FIELD_LABEL[f] ?? f}</dt>
                <dd>
                  <ChangeValue field={f} value={e.changes[f]?.from} /> →{' '}
                  <ChangeValue field={f} value={e.changes[f]?.to} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {e.reason ? <p className="text-sm text-text-2">“{e.reason}”</p> : null}
      </div>
    </li>
  );
}

/** Ids in event changes shown as names (departments and positions from the org lists, managers by lookup). */
function ChangeValue({ field, value }: { field: string; value: unknown }) {
  const { t } = useTranslation();
  const departments = useQuery({ ...orgQueries.departments(true), enabled: field === 'departmentId' });
  const positions = useQuery({ ...orgQueries.positions(true), enabled: field === 'positionId' });
  if (value === null || value === undefined) return <span className="text-text-3">none</span>;
  if (field === 'departmentId')
    return <>{departments.data?.find((d) => d.id === value)?.name ?? 'a department'}</>;
  if (field === 'positionId')
    return <>{positions.data?.find((p) => p.id === value)?.title ?? 'a position'}</>;
  if (field === 'managerId' && typeof value === 'string') return <EmployeeName id={value} />;
  if (field === 'status' && typeof value === 'string') return <>{t(`status.${value}`)}</>;
  return <>{displayValue(field, value)}</>;
}

function EmployeeName({ id }: { id: string }) {
  const lookup = useQuery(employeeQueries.detail(id));
  if (!lookup.data) return <>another employee</>;
  return (
    <Link to="/employees/$employeeId" params={{ employeeId: id }} className="text-link hover:underline">
      {lookup.data.displayName}
    </Link>
  );
}

type ManualEventType = (typeof manualEventTypeValues)[number];

/** The field each event type must change (contract rule, CreateEmploymentEventInputSchema). */
const REQUIRED_FIELD = {
  promoted: 'positionId',
  transferred: 'departmentId',
  manager_changed: 'managerId',
  position_changed: 'positionId',
} as const satisfies Record<ManualEventType, string>;

const showFor = (type: ManualEventType) => ({
  departmentId: type === 'transferred' || type === 'promoted',
  positionId: type !== 'manager_changed',
  managerId: type === 'manager_changed' || type === 'transferred',
});

const C = CreateEmploymentEventInputSchema.shape;
const EventForm = z
  .object({
    type: C.type,
    effectiveDate: C.effectiveDate,
    departmentId: omitBlank(C.departmentId),
    positionId: omitBlank(C.positionId),
    managerId: omitBlank(C.managerId),
    reason: omitBlank(C.reason),
  })
  .superRefine((v, ctx) => {
    const key = REQUIRED_FIELD[v.type];
    if (!v[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Required for this event.' });
  });

/** "Record employment event" (FR-EMP-005): promotion, transfer, manager or position change, dated. */
export function EmploymentEventDialog({
  employee,
  onClose,
}: {
  employee: EmployeeDetail;
  onClose: () => void;
}) {
  const save = useCreateEmploymentEvent(employee.id);
  const errorMessage = useErrorMessage();
  const canPickManager = useCan('employee.read.all', 'employee.read.team');
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(EventForm, {
    type: 'transferred',
    effectiveDate: todayIso(),
    departmentId: '',
    positionId: '',
    managerId: '',
    reason: '',
  });
  const type = form.watch('type') as ManualEventType;
  const submit = form.handleSubmit(async (v) => {
    // Only the fields shown for the chosen event type are sent.
    const shown = showFor(v.type);
    try {
      const event = await save.mutateAsync({
        type: v.type,
        effectiveDate: v.effectiveDate,
        ...(v.reason ? { reason: v.reason } : {}),
        ...(shown.departmentId && v.departmentId ? { departmentId: v.departmentId } : {}),
        ...(shown.positionId && v.positionId ? { positionId: v.positionId } : {}),
        ...(shown.managerId && v.managerId ? { managerId: v.managerId } : {}),
      });
      notify.success(event.status === 'scheduled' ? 'Event scheduled' : 'Event recorded');
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  const show = showFor(type);
  const isRequired = (f: string) => REQUIRED_FIELD[type] === f;
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="Record employment event"
      description={`For ${employee.displayName}. A future date is scheduled and applied on that day.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            Record event
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
        <FormField
          control={form.control}
          name="type"
          label="Event"
          render={(p) => (
            <Select {...p} onChange={(e) => p.onChange(e.target.value)}>
              {manualEventTypeValues.map((v) => (
                <option key={v} value={v}>
                  {MANUAL_EVENT_LABEL[v]}
                </option>
              ))}
            </Select>
          )}
        />
        <FormField
          control={form.control}
          name="effectiveDate"
          label="Effective date"
          render={(p) => <Input type="date" {...p} />}
        />
        {show.departmentId ? (
          <FormField
            control={form.control}
            name="departmentId"
            label="New department"
            optional={!isRequired('departmentId')}
            render={(p) => (
              <DepartmentPicker {...p} value={p.value} onChange={(id) => p.onChange(id ?? '')} />
            )}
          />
        ) : null}
        {show.positionId ? (
          <FormField
            control={form.control}
            name="positionId"
            label="New position"
            optional={!isRequired('positionId')}
            render={(p) => <PositionPicker {...p} value={p.value} onChange={(id) => p.onChange(id ?? '')} />}
          />
        ) : null}
        {show.managerId && canPickManager ? (
          <FormField
            control={form.control}
            name="managerId"
            label="New manager"
            optional={!isRequired('managerId')}
            render={(p) => (
              <EmployeePicker
                {...p}
                value={p.value}
                exclude={[employee.id]}
                onChange={(id) => p.onChange(id ?? '')}
              />
            )}
          />
        ) : null}
        <FormField
          control={form.control}
          name="reason"
          label="Reason"
          optional
          className="sm:col-span-2"
          render={(p) => <Textarea {...p} />}
        />
      </form>
    </Dialog>
  );
}
